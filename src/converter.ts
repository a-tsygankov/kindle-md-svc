import { mkdir, readFile, writeFile, rename, rm, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';
import { renderMermaid } from '@mermaid-js/mermaid-cli';
import { contains } from '../scripts/host-lib.mjs';
import { selectedFile, localAsset, readLimited } from './library.js';
import { runTool } from './process.js';

export type Format = 'epub' | 'pdf';
export interface ConversionResult {
  format: Format; diagrams: number; images: number; bytes: number;
  sha256: string; sourceSha256: string; warnings: string[];
}
interface Options { sourceRoot: string; file: string; jobDir: string; format: Format }
type Node = { t: string; c: any };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function visit(value: any, visitor: (node: Node) => Promise<any>): Promise<any> {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = await visit(value[i], visitor);
  } else if (value && typeof value === 'object') {
    if (value.t) { const replacement = await visitor(value); if (replacement !== value) return replacement; }
    for (const key of Object.keys(value)) value[key] = await visit(value[key], visitor);
  }
  return value;
}

function rasterExtension(bytes: Buffer): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return '.png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return '.jpg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return '.gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return '.webp';
  throw new Error('Image is not a supported PNG, JPEG, GIF, or WebP raster. SVG and active content are blocked.');
}

function textMeta(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textMeta).join('');
  if (value.t === 'Str' || value.t === 'MetaString') return String(value.c);
  if (['Space', 'SoftBreak', 'LineBreak'].includes(value.t)) return ' ';
  return textMeta(value.c);
}

export async function convertDocument(options: Options): Promise<ConversionResult> {
  if (!['epub', 'pdf'].includes(options.format)) throw new Error('Choose EPUB or PDF.');
  const root = await realpath(options.sourceRoot);
  const source = await selectedFile(root, options.file);
  const job = await realpath(options.jobDir);
  if (contains(root, job) || contains(job, root)) throw new Error('Conversion output must be outside source.');
  if ((await lstat(options.jobDir)).isSymbolicLink()) throw new Error('Redirected job folder is blocked.');
  const work = path.join(job, '.work');
  await mkdir(work); // A fresh per-job workspace; never reuse failed work.
  const rendered = path.join(work, 'artifacts'); await mkdir(rendered);
  const original = await readLimited(source, 2 * 1024 * 1024);
  await writeFile(path.join(work, 'source.md'), original);
  const tracked = new Map<string, string>([[source, hash(original)]]);
  const pandoc = process.env.PANDOC_BIN || 'pandoc';
  const ast = JSON.parse(await runTool(pandoc, ['--sandbox', '--from=gfm+yaml_metadata_block+footnotes-raw_html', '--to=json'], original));
  // Only descriptive metadata survives. Drop cover-image, includes, CSS, etc.
  const meta: Record<string, any> = {};
  for (const key of ['title', 'author', 'date', 'lang', 'description']) {
    const text = textMeta(ast.meta[key]).slice(0, 512);
    if (text) meta[key] = { t: 'MetaInlines', c: [{ t: 'Str', c: text }] };
  }
  meta.title ??= { t: 'MetaInlines', c: [{ t: 'Str', c: path.basename(source, path.extname(source)) }] };
  meta.lang ??= { t: 'MetaString', c: 'en-US' };
  ast.meta = meta;
  let browser: Browser | undefined;
  let blocked = false;
  const indexFile = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@mermaid-js/mermaid-cli'))), '../dist/index.html');
  async function getBrowser(): Promise<Browser> {
    browser ??= await puppeteer.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
    return browser;
  }
  const guarded = { newPage: async () => {
    const page = await (await getBrowser()).newPage();
    await page.setRequestInterception(true);
    page.on('request', request => {
      let allowed = /^(data:|about:)/.test(request.url()) || new URL(request.url()).origin === 'https://mermaid-cli-intercept.invalid';
      if (request.url().startsWith('file:')) allowed = path.resolve(fileURLToPath(request.url())) === indexFile;
      if (allowed) void request.continue({}, -10);
      else { blocked = true; void request.abort('blockedbyclient', 100); }
    });
    return page;
  } } as unknown as Browser;
  let diagrams = 0, images = 0, assetBytes = 0;
  const warnings: string[] = [];
  const assets = new Map<string, string>();
  const assetSizes = new Map<string, number>();
  function countEmbedded(bytes: number): void {
    assetBytes += bytes;
    if (assetBytes > 25 * 1024 * 1024) throw new Error('Embedded images exceed the 25 MiB limit, including repeated references.');
  }
  try {
    await visit(ast, async node => {
      // GFM may still emit Raw nodes even with -raw_html. Escape explicitly.
      if (node.t === 'RawBlock') return { t: 'CodeBlock', c: [['', [], []], String(node.c[1])] };
      if (node.t === 'RawInline') return { t: 'Str', c: String(node.c[1]) };
      if (node.t === 'CodeBlock' && node.c[0][1].includes('mermaid')) {
        if (++diagrams > 20) throw new Error('This document exceeds the limit of 20 diagrams.');
        const definition = String(node.c[1]);
        if (/%%\s*\{|^\s*---|\bimg\s*:/im.test(definition)) throw new Error('Mermaid configuration directives and external images are not supported.');
        let png: Uint8Array;
        try {
          png = (await renderMermaid(guarded, definition, 'png', {
            size: 2400, viewport: { width: 1600, height: 1200, deviceScaleFactor: 2 }, backgroundColor: 'white',
            mermaidConfig: { theme: 'neutral', securityLevel: 'strict', flowchart: { htmlLabels: false }, themeVariables: { fontFamily: 'Arial', fontSize: '20px' } },
          })).data;
        } catch { throw new Error(`Mermaid diagram ${diagrams} could not be rendered. Check its syntax.`); }
        if (blocked) throw new Error('Mermaid attempted to load a blocked external or local resource.');
        countEmbedded(png.byteLength);
        const image = path.join(work, `diagram-${diagrams}.png`);
        await writeFile(image, png);
        const bytes = Buffer.from(png), width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
        if (width / height > 3 || height / width > 2.5) warnings.push(`Diagram ${diagrams} may need zooming on the Scribe.`);
        return { t: 'Para', c: [{ t: 'Image', c: [['', [], []], [{ t: 'Str', c: `Diagram ${diagrams}` }], [image.replaceAll('\\', '/'), '']] }] };
      }
      if (node.t === 'Image') {
        if (++images > 100) throw new Error('This document exceeds the limit of 100 image references.');
        const file = await localAsset(root, source, String(node.c[2][0]));
        let copied = assets.get(file);
        if (!copied) {
          const bytes = await readLimited(file, 10 * 1024 * 1024);
          countEmbedded(bytes.length);
          copied = path.join(work, `asset-${assets.size}${rasterExtension(bytes)}`);
          await writeFile(copied, bytes); assets.set(file, copied); assetSizes.set(file, bytes.length); tracked.set(file, hash(bytes));
        } else countEmbedded(assetSizes.get(file) || 0);
        node.c[2][0] = copied.replaceAll('\\', '/');
      }
      if (node.t === 'Link' && /^(?!https?:|mailto:)[a-z][a-z0-9+.-]*:/i.test(node.c[2][0])) return { t: 'Span', c: [['', [], []], node.c[1]] };
      return node;
    });
    const json = JSON.stringify(ast);
    const preview = path.join(rendered, 'preview.html');
    const cssRoot = fileURLToPath(new URL('../../assets/', import.meta.url));
    await runTool(pandoc, ['--from=json', '--to=html5', '--standalone', '--embed-resources', '--syntax-highlighting=none', `--css=${path.join(cssRoot, 'print.css')}`, '--output', preview], json);
    const artifact = path.join(rendered, `book.${options.format}`);
    if (options.format === 'epub') {
      await runTool(pandoc, ['--from=json', '--to=epub3', '--toc', '--split-level=2', '--syntax-highlighting=none', `--css=${path.join(cssRoot, 'epub.css')}`, '--output', artifact], json);
    }
    if (options.format === 'pdf' || images > 0) {
      const page = await (await getBrowser()).newPage();
      try {
        await page.setJavaScriptEnabled(false); await page.setRequestInterception(true);
        page.on('request', request => { void (/^(data:|about:)/.test(request.url()) ? request.continue() : request.abort()); });
        await page.setContent(await readFile(preview, 'utf8'), { waitUntil: 'load', timeout: 15_000 });
        const broken = await page.evaluate(() => [...document.images].some(image => !image.complete || image.naturalWidth === 0));
        if (broken) throw new Error('A local image could not be decoded.');
        if (options.format === 'pdf') await page.pdf({ path: artifact, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font:9px Arial"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
      } finally { await page.close(); }
    }
    for (const [file, expected] of tracked) {
      if (hash(await readLimited(file, file === source ? 2 * 1024 * 1024 : 10 * 1024 * 1024)) !== expected) throw new Error('A source file changed during conversion. Retry to publish a consistent copy.');
    }
    const artifactBytes = await readFile(artifact);
    const result: ConversionResult = { format: options.format, diagrams, images, warnings, bytes: artifactBytes.length, sha256: hash(artifactBytes), sourceSha256: hash(original) };
    await writeFile(path.join(rendered, 'manifest.json'), JSON.stringify(result));
    await rename(rendered, path.join(job, 'artifacts'));
    await rm(work, { recursive: true, force: true });
    return result;
  } finally { await browser?.close(); }
}

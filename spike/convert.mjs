/** Throwaway conversion proof; not the production publisher or a web service. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';
import { renderMermaid } from '@mermaid-js/mermaid-cli';

const spikeDir = path.dirname(fileURLToPath(import.meta.url));
const pandoc = process.env.PANDOC_BIN || 'pandoc';

export function run(executable, args, { input, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false });
    const output = [], errors = [];
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      const stderr = Buffer.concat(errors).toString();
      if (code !== 0) reject(new Error(`${path.basename(executable)} failed (${code}): ${stderr}`));
      else resolve({ stdout: Buffer.concat(output).toString(), stderr });
    });
    child.stdin.on('error', () => {}); // Early child exit is reported above.
    child.stdin.end(input);
  });
}

export async function walkAst(value, visitor) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = await walkAst(value[i], visitor);
  } else if (value && typeof value === 'object') {
    const replacement = await visitor(value);
    if (replacement !== value) return replacement;
    for (const key of Object.keys(value)) value[key] = await walkAst(value[key], visitor);
  }
  return value;
}

export async function resolveImage(sourceDir, target) {
  // Proof scope: local raster images only; never fetch remote resources.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
    throw new Error(`Only local raster images are supported in this proof: ${target}`);
  }
  const root = await realpath(sourceDir);
  const imagePath = await realpath(path.resolve(root, decodeURIComponent(target)));
  const relative = path.relative(root, imagePath);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Image escapes the document folder: ${target}`);
  }
  if (!/\.(png|jpe?g|gif|webp)$/i.test(imagePath)) {
    throw new Error(`Unsupported image type in proof: ${target}`);
  }
  return imagePath;
}

async function convert(source, destination, browser) {
  const started = performance.now();
  const original = await readFile(source);
  const digest = createHash('sha256').update(original).digest('hex');
  const work = await mkdtemp(path.join(destination, '.work-'));
  const warnings = [];
  const reviewNotes = [];
  const parsed = await run(pandoc, [
    '--from=gfm+yaml_metadata_block+footnotes-raw_html', '--to=json',
  ], { input: original });
  if (parsed.stderr) warnings.push(parsed.stderr);
  const document = JSON.parse(parsed.stdout);
  document.meta.title ??= { t: 'MetaString', c: path.basename(source, path.extname(source)) };
  document.meta.lang ??= { t: 'MetaString', c: 'en-US' };
  let diagrams = 0, images = 0;
  await walkAst(document, async node => {
    if (node.t === 'CodeBlock' && node.c[0][1].includes('mermaid')) {
      const index = ++diagrams;
      const rendered = await renderMermaid(browser, node.c[1], 'png', {
        size: 2400,
        viewport: { width: 1600, height: 1200, deviceScaleFactor: 2 },
        backgroundColor: 'white',
        mermaidConfig: {
          theme: 'neutral', securityLevel: 'strict',
          themeVariables: { fontFamily: 'Arial', fontSize: '20px' },
          flowchart: { htmlLabels: false },
        },
      });
      const imagePath = path.join(work, `diagram-${index}.png`);
      await writeFile(imagePath, rendered.data);
      const png = Buffer.from(rendered.data);
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
      if (width / height > 3 || height / width > 2.5) {
        reviewNotes.push(`Diagram ${index} is ${width} x ${height}; check label readability on the Scribe and zoom if needed.`);
      }
      return { t: 'Para', c: [{ t: 'Image', c: [
        ['', [], []], [{ t: 'Str', c: rendered.desc || `Diagram ${index}` }], [imagePath.replaceAll('\\', '/'), ''],
      ] }] };
    }
    if (node.t === 'Image') {
      node.c[2][0] = (await resolveImage(path.dirname(source), node.c[2][0])).replaceAll('\\', '/');
      images++;
    }
    return node;
  });
  const ast = JSON.stringify(document);
  const stem = path.basename(source, path.extname(source));
  const htmlPath = path.join(destination, `${stem}.html`);
  const epubPath = path.join(destination, `${stem}.epub`);
  const pdfPath = path.join(destination, `${stem}.pdf`);
  const html = await run(pandoc, [
    '--from=json', '--to=html5', '--standalone', '--embed-resources',
    '--syntax-highlighting=none', `--css=${path.join(spikeDir, 'print.css')}`,
    '--output', htmlPath,
  ], { input: ast });
  const epub = await run(pandoc, [
    '--from=json', '--to=epub3', '--toc', '--split-level=2',
    '--syntax-highlighting=none', `--css=${path.join(spikeDir, 'epub.css')}`,
    '--output', epubPath,
  ], { input: ast });
  if (html.stderr) warnings.push(html.stderr);
  if (epub.stderr) warnings.push(epub.stderr);
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (/^(data:|about:)/.test(request.url())) request.continue();
      else request.abort();
    });
    await page.setContent(await readFile(htmlPath, 'utf8'), { waitUntil: 'load' });
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await page.pdf({
      path: pdfPath, preferCSSPageSize: true, printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;text-align:center;font:9px Arial;color:#444"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
  } finally { await page.close(); }
  if (createHash('sha256').update(await readFile(source)).digest('hex') !== digest) {
    throw new Error('Source changed during conversion; discard this proof and retry.');
  }
  const outputs = {};
  for (const file of [htmlPath, epubPath, pdfPath]) outputs[path.basename(file)] = (await stat(file)).size;
  return {
    source: path.basename(source), sourceSha256: digest,
    diagrams, localImages: images, outputs, warnings, reviewNotes,
    seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
  };
}

async function main() {
  const { values, positionals } = parseArgs({ options: { out: { type: 'string', default: 'output/proof' } }, allowPositionals: true });
  const sources = (positionals.length ? positionals : [
    path.join(spikeDir, 'fixtures', 'reading-sample.md'),
    path.join(spikeDir, 'fixtures', 'diagram-stress.md'),
  ]).map(file => path.resolve(file));
  for (const file of sources) {
    if (!/\.(md|markdown)$/i.test(file) || !(await stat(file)).isFile()) throw new Error(`Expected a Markdown file: ${file}`);
  }
  if (new Set(sources.map(file => path.basename(file, path.extname(file)).toLowerCase())).size !== sources.length) {
    throw new Error('Inputs with the same base filename need separate --out directories.');
  }
  const destination = path.resolve(values.out);
  if (sources.some(file => path.dirname(file) === destination)) throw new Error('Use an output directory separate from source documents.');
  await mkdir(destination, { recursive: true });
  const version = await run(pandoc, ['--version']);
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  });
  try {
    const results = [];
    for (const source of sources) {
      console.log(`Converting ${path.basename(source)} ...`);
      results.push(await convert(source, destination, browser));
    }
    const report = { proofOnly: true, node: process.version, pandoc: version.stdout.split(/\r?\n/)[0], browser: await browser.version(), results };
    await writeFile(path.join(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { epubPackage } from './helpers/epub.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convertDocument } from '../dist/src/converter.js';

async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kindle-converter-'));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5 }));
  const source = path.join(base, 'source'); await mkdir(source);
  await cp(new URL('../spike/fixtures/', import.meta.url), source, { recursive: true });
  const job = path.join(base, 'job'); await mkdir(job);
  return { base, source, job };
}

test('service converter publishes standalone preview and EPUB with real Mermaid and unchanged inputs', async t => {
  const { source, job } = await fixture(t);
  const before = await readFile(path.join(source, 'reading-sample.md'));
  const result = await convertDocument({ sourceRoot: source, file: 'reading-sample.md', jobDir: job, format: 'epub' });
  assert.equal(result.diagrams, 2);
  assert.equal(result.images, 1);
  assert.equal((await readFile(path.join(job, 'artifacts', 'book.epub'))).subarray(0, 2).toString(), 'PK');
  const html = await readFile(path.join(job, 'artifacts', 'preview.html'), 'utf8');
  assert.equal((html.match(/data:image\/png;base64,/g) || []).length, 3);
  assert.ok(!html.includes('flowchart TB'));
  assert.deepEqual(await readFile(path.join(source, 'reading-sample.md')), before);
  await assert.rejects(access(path.join(job, '.work')));
});

test('service PDF and preview preserve nested fences while active metadata and raw HTML stay inert', async t => {
  const { source, job } = await fixture(t);
  await writeFile(path.join(source, 'plain.md'), '---\ntitle: Test\nheader-includes: "<script>alert(1)</script>"\ncover-image: /private.png\n---\n\n# Notes\n<script>alert(2)</script>\n\n````markdown\n```mermaid\nA --> B\n```\n````\n');
  const result = await convertDocument({ sourceRoot: source, file: 'plain.md', jobDir: job, format: 'pdf' });
  assert.equal(result.diagrams, 0);
  assert.equal((await readFile(path.join(job, 'artifacts', 'book.pdf'))).subarray(0, 5).toString(), '%PDF-');
  const html = await readFile(path.join(job, 'artifacts', 'preview.html'), 'utf8');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('/private.png'));
  assert.match(html, /A --&gt; B/);
});

test('remote images and source escape never publish artifacts', async t => {
  const { base, source, job } = await fixture(t);
  await writeFile(path.join(base, 'outside.png'), 'private');
  for (const target of ['https://example.com/image.png', '../outside.png', 'file:///private.png']) {
    const output = path.join(job, String(target.length)); await mkdir(output, { recursive: true });
    await writeFile(path.join(source, 'bad.md'), `# Bad\n![image](${target})`);
    await assert.rejects(convertDocument({ sourceRoot: source, file: 'bad.md', jobDir: output, format: 'epub' }), /local|remote|escapes/i);
    await assert.rejects(access(path.join(output, 'artifacts')));
  }
});

test('source changes during conversion fail without publishing mixed versions', async t => {
  const { source, job } = await fixture(t);
  const conversion = convertDocument({ sourceRoot: source, file: 'reading-sample.md', jobDir: job, format: 'epub' }).then(value => ({ value }), error => ({ error }));
  for (let i = 0; i < 100; i++) {
    try { await access(path.join(job, '.work', 'source.md')); break; } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  await writeFile(path.join(source, 'reading-sample.md'), '# Changed source');
  const outcome = await conversion;
  assert.match(outcome.error?.message || '', /changed/i);
  await assert.rejects(access(path.join(job, 'artifacts')));
});

test('repeated image references are bounded before publishing oversized documents', async t => {
  const { source, job } = await fixture(t);
  await writeFile(path.join(source, 'many.md'), '# Many images\n\n' + Array(101).fill('![chart](assets/reading%20progress.png)').join('\n\n'));
  await assert.rejects(convertDocument({ sourceRoot: source, file: 'many.md', jobDir: job, format: 'epub' }), /image.*limit|limit.*image/i);
  await assert.rejects(access(path.join(job, 'artifacts')));
});

for (const format of ['epub', 'pdf']) {
  test(`generated ${format} uses filename title and service author over front matter`, async t => {
    const { source, job } = await fixture(t);
    const file = 'Café & planning.v2.md';
    await writeFile(path.join(source, file), '---\ntitle: Wrong title\nauthor: Wrong author\n---\n\n# Notes\nReading material.');
    await convertDocument({ sourceRoot: source, file, jobDir: job, format, author: 'AT & Team' });
    const artifact = path.join(job, 'artifacts', `book.${format}`);
    if (format === 'pdf') {
      const pdf = await PDFDocument.load(await readFile(artifact));
      assert.equal(pdf.getTitle(), 'Café & planning.v2');
      assert.equal(pdf.getAuthor(), 'AT & Team');
      assert.ok(pdf.getPageCount() > 0);
    } else {
      const metadata = epubPackage(await readFile(artifact));
      assert.match(metadata, /<dc:title[^>]*>Café &amp; planning.v2<\/dc:title>/);
      assert.match(metadata, /<dc:creator[^>]*>AT &amp; Team<\/dc:creator>/);
    }
    const html = await readFile(path.join(job, 'artifacts', 'preview.html'), 'utf8');
    assert.ok(!html.includes('Wrong title') && !html.includes('Wrong author'));
    assert.match(html, /Café &amp; planning.v2/);
  });
}

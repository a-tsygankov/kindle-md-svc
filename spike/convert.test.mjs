import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, resolveImage } from './convert.mjs';

const spikeDir = path.dirname(fileURLToPath(import.meta.url));

test('both formats embed real diagrams and preserve literal nested fences', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'kindle-proof-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const out = path.join(temp, 'exports with spaces');
  await run(process.execPath, [path.join(spikeDir, 'convert.mjs'), '--out', out]);
  const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
  assert.deepEqual(report.results.map(item => [item.diagrams, item.localImages]), [[2, 1], [3, 0]]);
  assert.deepEqual(report.results.map(item => item.warnings), [[], []]);
  assert.ok(report.results[1].reviewNotes.length > 0, 'a very wide diagram needs a readability note');
  for (const stem of ['reading-sample', 'diagram-stress']) {
    const pdf = await readFile(path.join(out, `${stem}.pdf`));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const epub = await readFile(path.join(out, `${stem}.epub`));
    assert.equal(epub.subarray(0, 2).toString(), 'PK');
    const html = await readFile(path.join(out, `${stem}.html`), 'utf8');
    assert.equal((html.match(/data:image\/png;base64,/g) || []).length, 3);
    const pngs = [...html.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=\s]+?)"/g)]
      .map(match => Buffer.from(match[1], 'base64'));
    const firstDiagram = pngs[0];
    assert.ok(Math.max(firstDiagram.readUInt32BE(16), firstDiagram.readUInt32BE(20)) >= 2000,
      'diagram raster must retain enough detail for zooming');
    assert.ok(!html.includes('flowchart TB'), 'a real Mermaid block must become an image');
    if (stem === 'diagram-stress') assert.match(html, /Example --&gt; Documentation/);
  }
});

test('ordinary Markdown converts without Mermaid or images', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'kindle-plain-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'plain notes.md');
  await writeFile(source, '# Plain notes\n\nNo diagrams needed.\n');
  await run(process.execPath, [path.join(spikeDir, 'convert.mjs'), source, '--out', path.join(temp, 'out')]);
  const report = JSON.parse(await readFile(path.join(temp, 'out', 'report.json'), 'utf8'));
  assert.equal(report.results[0].diagrams, 0);
  assert.match(await readFile(path.join(temp, 'out', 'plain notes.html'), 'utf8'), /No diagrams needed/);
  assert.equal(await readFile(source, 'utf8'), '# Plain notes\n\nNo diagrams needed.\n');
});

test('invalid Mermaid fails without publishing a book', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'kindle-invalid-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'broken.md');
  await writeFile(source, '# Broken\n\n```mermaid\nthis is not a diagram\n```\n');
  const out = path.join(temp, 'out');
  await assert.rejects(run(process.execPath, [path.join(spikeDir, 'convert.mjs'), source, '--out', out]), /diagram|syntax/i);
  assert.equal((await readdir(out)).filter(name => /\.(epub|pdf)$/.test(name)).length, 0);
});

test('local images support encoded spaces and reject remote resources or escapes', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'kindle-images-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'source');
  await mkdir(root);
  await copyFile(path.join(spikeDir, 'fixtures/assets/reading progress.png'), path.join(root, 'local chart.png'));
  assert.match(await resolveImage(root, 'local%20chart.png'), /local chart\.png$/);
  await writeFile(path.join(temp, 'private.png'), 'outside');
  await assert.rejects(resolveImage(root, '../private.png'), /escapes/);
  await assert.rejects(resolveImage(root, 'https://example.com/image.png'), /Only local/);
  await assert.rejects(resolveImage(root, 'file:///private.png'), /Only local/);
  await writeFile(path.join(root, 'vector.svg'), '<svg/>');
  await assert.rejects(resolveImage(root, 'vector.svg'), /Unsupported image type/);
});

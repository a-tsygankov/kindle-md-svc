import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UploadStore } from '../dist/src/uploads.js';

const file = (name, text) => ({ path: name, data: Buffer.from(text).toString('base64') });
async function fixture(t) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'kindle-uploads-'));
  t.after(() => rm(repo, { recursive: true, force: true, maxRetries: 10 }));
  return { repo, store: new UploadStore(repo) };
}
test('upload bundles preserve portable paths and can be listed again without source configuration', async t => {
  const { repo, store } = await fixture(t);
  const result = await store.import([file('Project/Café notes.md', '# Hello\r\n\r\n![x](assets/chart.png)'), { path: 'Project/assets/chart.png', data: 'iVBORw0KGgo=' }]);
  assert.equal(result.entries.length, 1);
  const entry = result.entries[0];
  assert.equal(entry.name, 'Café notes.md');
  assert.match(entry.id, /^[a-f0-9-]{36}\/Project\/Café notes.md$/);
  assert.deepEqual((await new UploadStore(repo).list()).entries.map(e => e.id), [entry.id]);
  assert.match(await readFile(path.join(await store.root(), entry.id), 'utf8'), /# Hello/);
  assert.equal(JSON.stringify(result).includes(repo), false);
});
test('uploads reject path tricks, collisions, invalid encoding and unsupported files atomically', async t => {
  const { store } = await fixture(t);
  for (const name of ['../escape.md', '/absolute.md', 'C:\\escape.md', 'a/../escape.md', 'a//b.md', 'CON.md', 'a./b.md', 'a/file.txt', '.private.md']) {
    await assert.rejects(store.import([file(name, '# Bad')]), /upload|path|Markdown|supported|portable/i);
  }
  await assert.rejects(store.import([file('A.md', '# First'), file('a.md', '# Second')]), /duplicate/i);
  await assert.rejects(store.import([{ path: 'x.md', data: 'not base64' }]), /encoding/i);
  await assert.rejects(store.import([{ path: 'x.md', data: Buffer.from([0xff, 0xfe]).toString('base64') }]), /UTF-8/i);
  await assert.rejects(store.import([file('huge.md', 'x'.repeat(2 * 1024 * 1024 + 1))]), /limit|large/i);
  await assert.rejects(store.import(Array.from({ length: 11 }, (_, i) => file(`${i}.md`, '# Too many'))), /10|limit/i);
  assert.deepEqual((await store.list()).entries, []);
  assert.deepEqual(await readdir(await store.root()), []);
});
test('redirected upload roots and batches never expose outside Markdown', async t => {
  const { repo, store } = await fixture(t);
  const outside = path.join(repo, 'outside'); await mkdir(outside);
  await mkdir(path.join(repo, 'output'));
  await symlink(outside, path.join(repo, 'output', 'uploads'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.import([file('x.md', '# No')]), /redirected|symlink|junction/i);
  assert.deepEqual(await readdir(outside), []);
});

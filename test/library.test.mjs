import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { listDirectory, selectedFile, localAsset, readLimited, sortEntries } from '../dist/src/library.js';
import { cloudAvailability, windowsAttributes } from '../dist/src/cloud-status.js';

test('cloud flags distinguish pin intent, recall, cached entries and unknown status', () => {
  assert.equal(cloudAvailability(0x80000), 'pinned');
  assert.equal(cloudAvailability(0x80000 | 0x400000), 'pinned-pending');
  assert.equal(cloudAvailability(0x100000), 'on-demand');
  assert.equal(cloudAvailability(0x400000), 'online-only');
  assert.equal(cloudAvailability(0x410), 'local');
  assert.equal(cloudAvailability(undefined), 'unknown');
  assert.equal(cloudAvailability(0x180000), 'unknown');
});

test('picker sorting groups folders, prioritizes pins optionally, handles timestamps and missing sizes', () => {
  const entries = [
    { id: 'b', name: 'Folder 2', kind: 'directory', availability: 'local', modified: '2020-01-01' },
    { id: 'a', name: 'Folder 10', kind: 'directory', availability: 'pinned', modified: '2024-01-01' },
    { id: 'x', name: 'File 10', kind: 'document', bytes: 2, modified: '2024-01-01', created: '2020-01-01' },
    { id: 'y', name: 'File 2', kind: 'document', bytes: 10, modified: '2020-01-01', created: '2024-01-01' },
    { id: 'z', name: 'Missing', kind: 'document' },
  ];
  const ids = options => sortEntries(entries, options).map(entry => entry.id);
  assert.deepEqual(ids({}), ['b', 'a', 'y', 'x', 'z']);
  assert.deepEqual(ids({ pinnedFirst: true }), ['a', 'b', 'y', 'x', 'z']);
  assert.deepEqual(ids({ sort: 'modified', direction: 'desc' }), ['a', 'b', 'x', 'y', 'z']);
  assert.deepEqual(ids({ sort: 'created' }).slice(2), ['x', 'y', 'z']);
  assert.deepEqual(ids({ sort: 'size', direction: 'desc' }).slice(2), ['y', 'x', 'z']);
  assert.equal(entries[0].id, 'b');
});

test('Windows attribute adapter preserves Unicode names and does not read file contents', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kindle-attributes-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  await mkdir(path.join(root, "Café ' & folder"));
  const before = await windowsAttributes(root);
  assert.equal(typeof before.get("Café ' & folder"), 'number');
  const listing = await listDirectory(root, '');
  assert.equal(listing.entries[0].availability, 'local');
  assert.ok(listing.entries[0].modified && listing.entries[0].created);
});

test('library returns relative Markdown IDs and folders without exposing escaped links', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kindle-library-'));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5 }));
  const root = path.join(base, 'cloud'); await mkdir(root);
  await mkdir(path.join(root, 'subfolder'));
  await writeFile(path.join(root, 'space notes.md'), '# Notes');
  await writeFile(path.join(root, 'photo.png'), 'not a document');
  const outside = path.join(base, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'secret.md'), '# Private');
  await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const alias = path.join(base, 'sync-root');
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const listing = await listDirectory(alias, '');
  assert.deepEqual(listing.entries.map(entry => [entry.id, entry.kind]), [['subfolder', 'directory'], ['space notes.md', 'document']]);
  assert.equal(JSON.stringify(listing).includes(base), false);
  await assert.rejects(selectedFile(root, '../outside/secret.md'), /outside|escapes/i);
  await assert.rejects(selectedFile(root, 'escape/secret.md'), /outside|escapes/i);
  await assert.rejects(selectedFile(root, 'photo.png'), /Markdown/);
  assert.equal(await selectedFile(root, 'space notes.md'), path.join(root, 'space notes.md'));
  await writeFile(path.join(root, 'subfolder', 'asset.png'), 'PNG');
  assert.equal(await localAsset(root, path.join(root, 'space notes.md'), 'subfolder/asset.png'), path.join(root, 'subfolder', 'asset.png'));
  await assert.rejects(localAsset(root, path.join(root, 'space notes.md'), 'https://example.com/image.png'), /local|remote/i);
  await assert.rejects(localAsset(root, path.join(root, 'space notes.md'), '../outside/secret.md'), /outside|escapes/i);
  await assert.rejects(readLimited(path.join(root, 'space notes.md'), 3), /limit|large/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeviceSessions, SESSION_SECONDS } from '../dist/src/sessions.js';

test('remembered browsers survive reopening; hashes only, rolling renewal, revocation and expiry', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'kindle-sessions-'));
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));
  const file = path.join(folder, 'devices.json');
  let now = Date.now();
  const token = 'test-access-token-secret';
  let store = await DeviceSessions.open(file, token, () => now);
  const first = await store.issue(), second = await store.issue();
  assert.equal(await store.issue(first), first, 'reopening an already remembered browser reuses its credential');
  const saved = await readFile(file, 'utf8');
  assert.ok(!saved.includes(first) && !saved.includes(second) && !saved.includes(token));
  store = await DeviceSessions.open(file, token, () => now);
  assert.equal((await store.authenticate(first)).valid, true);
  assert.equal((await store.authenticate('forged')).valid, false);
  now += 2 * 86400 * 1000;
  assert.equal((await store.authenticate(first)).renew, true);
  await store.revoke(second);
  store = await DeviceSessions.open(file, token, () => now);
  assert.equal((await store.authenticate(second)).valid, false);
  now += (SESSION_SECONDS - 86400) * 1000;
  assert.equal((await store.authenticate(first)).valid, true);
  now += (SESSION_SECONDS + 1) * 1000;
  assert.equal((await store.authenticate(first)).valid, false);
});

test('access-token rotation invalidates remembered browsers and corrupt state fails closed', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'kindle-sessions-'));
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));
  const file = path.join(folder, 'devices.json');
  const store = await DeviceSessions.open(file, 'old-token');
  const cookie = await store.issue();
  const rotated = await DeviceSessions.open(file, 'new-token');
  assert.equal((await rotated.authenticate(cookie)).valid, false);
  await writeFile(file, '{broken');
  await assert.rejects(DeviceSessions.open(file, 'new-token'), /remembered|session|JSON/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { configure, resetHost } from '../scripts/host-lib.mjs';
import { createPublisher } from '../dist/src/http.js';

export async function publisherFixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kindle-http-'));
  const repo = path.join(base, 'host'), source = path.join(base, 'source');
  await mkdir(repo); await mkdir(source);
  await writeFile(path.join(source, 'hello.md'), '# Hello Scribe\n\n```mermaid\nflowchart LR\nA-->B\n```');
  await configure(repo, { sourceDir: source, port: 0 });
  const app = await createPublisher(repo);
  t.after(async () => { await app.close(); await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const token = (await readFile(app.tokenFile, 'utf8')).trim();
  return { ...app, repo, source, token };
}

test('HTTP protects private endpoints, checks origins and serves only ready job artifacts', async t => {
  const app = await publisherFixture(t);
  await assert.rejects(resetHost(app.repo), /active|service|stop/i);
  assert.equal((await fetch(app.url + '/api/library')).status, 401);
  const headers = { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' };
  const library = await (await fetch(app.url + '/api/library', { headers })).json();
  assert.equal(library.entries[0].id, 'hello.md');
  assert.equal(JSON.stringify(library).includes(app.source), false);
  assert.equal((await fetch(app.url + '/api/jobs', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: JSON.stringify({ files: ['hello.md'], format: 'epub' }) })).status, 403);
  assert.equal((await fetch(app.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'wrong' }) })).status, 401);
  const session = await fetch(app.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: app.token }) });
  assert.match(session.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict/);
  const cookie = session.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(app.url + '/api/status', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(app.url + '/api/jobs', { method: 'POST', headers, body: JSON.stringify({ files: ['hello.md'], format: 'exe' }) })).status, 400);
  const created = await fetch(app.url + '/api/jobs', { method: 'POST', headers, body: JSON.stringify({ files: ['hello.md'], format: 'epub' }) });
  assert.equal(created.status, 202);
  const { jobs } = await created.json();
  let job;
  for (let i = 0; i < 200; i++) {
    job = (await (await fetch(app.url + '/api/jobs', { headers })).json()).jobs.find(value => value.id === jobs[0].id);
    if (!['queued', 'running'].includes(job.state)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(job.state, 'ready', job.error);
  const download = await fetch(`${app.url}/api/jobs/${job.id}/download`, { headers });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  const preview = await fetch(`${app.url}/api/jobs/${job.id}/preview`, { headers });
  assert.match(preview.headers.get('content-security-policy'), /sandbox/);
  assert.match(await preview.text(), /data:image\/png;base64/);
  assert.equal((await fetch(`${app.url}/api/jobs/${job.id}/send`, { method: 'POST', headers, body: '{}' })).status, 400);
  assert.equal((await fetch(app.url + '/config.local.json', { headers })).status, 404);
});

test('JSON filenames survive a UTF-8 character split across request chunks', async t => {
  const app = await publisherFixture(t);
  await writeFile(path.join(app.source, 'café.md'), '# Unicode notes');
  const data = Buffer.from(JSON.stringify({ files: ['café.md'], format: 'epub' }));
  const split = data.indexOf(Buffer.from('é')) + 1;
  const status = await new Promise((resolve, reject) => {
    const request = http.request(app.url + '/api/jobs', { method: 'POST', headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.write(data.subarray(0, split));
    setTimeout(() => request.end(data.subarray(split)), 25);
  });
  assert.equal(status, 202);
});

test('remembered browser works after service restart and sign-out revocation survives restart', async t => {
  const app = await publisherFixture(t);
  const login = await fetch(app.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: app.token }) });
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /Max-Age=31536000/);
  const cookie = setCookie.split(';')[0];
  const again = await fetch(app.url + '/api/session', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: app.token }) });
  assert.equal(again.headers.get('set-cookie').split(';')[0], cookie);
  await app.close();
  let restarted = await createPublisher(app.repo);
  t.after(() => restarted.close());
  assert.equal((await fetch(restarted.url + '/api/status', { headers: { Cookie: cookie } })).status, 200);
  const logout = await fetch(restarted.url + '/api/logout', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  await restarted.close();
  restarted = await createPublisher(app.repo);
  assert.equal((await fetch(restarted.url + '/api/status', { headers: { Cookie: cookie } })).status, 401);
});

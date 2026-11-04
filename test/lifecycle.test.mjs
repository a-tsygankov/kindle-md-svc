import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, symlink, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configure, startRun, stopRun, readStatus, resetHost } from '../scripts/host-lib.mjs';

async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kindle-service-host-'));
  const repo = path.join(base, 'host'), source = path.join(base, 'source'); await mkdir(repo); await mkdir(source);
  await writeFile(path.join(source, 'notes.md'), '# Notes');
  await cp(new URL('../dist/', import.meta.url), path.join(repo, 'dist'), { recursive: true });
  await cp(new URL('../public/', import.meta.url), path.join(repo, 'public'), { recursive: true });
  await cp(new URL('../assets/', import.meta.url), path.join(repo, 'assets'), { recursive: true });
  await symlink(fileURLToPath(new URL('../node_modules/', import.meta.url)), path.join(repo, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await configure(repo, { sourceDir: source, port: 0 });
  t.after(async () => { await stopRun(repo).catch(() => {}); await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { repo, base };
}

test('managed start waits for service readiness and stop closes the listening socket', async t => {
  const { repo } = await fixture(t);
  const started = await startRun(repo, [], { mode: 'service' });
  assert.equal(started.mode, 'publishing-service');
  assert.equal(started.status, 'running');
  assert.equal((await fetch(started.url + '/health')).status, 200);
  assert.equal((await readStatus(repo)).url, started.url);
  await assert.rejects(resetHost(repo), /active|stop/i);
  assert.equal((await stopRun(repo)).status, 'stopped');
  await assert.rejects(fetch(started.url + '/health'));
});

test('Windows PowerShell 5 captured startup returns while its background service stays running', { skip: process.platform !== 'win32' }, async t => {
  const { repo, base } = await fixture(t);
  const launcher = path.join(base, 'launch.mjs');
  await writeFile(launcher, `import {startRun} from ${JSON.stringify(new URL('../scripts/host-lib.mjs', import.meta.url).href)}; console.log(JSON.stringify(await startRun(process.argv[2],[],{mode:'service'})));`);
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const command = `$captured = & ${quote(process.execPath)} ${quote(launcher)} ${quote(repo)}; Write-Output ($captured -join [Environment]::NewLine)`;
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let timer;
  try {
    const result = await Promise.race([
      promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Captured startup did not return while service was alive.')), 6000); }),
    ]);
    const started = JSON.parse(result.stdout);
    assert.equal(started.status, 'running');
    assert.equal((await fetch(started.url + '/health')).status, 200);
  } finally { clearTimeout(timer); await stopRun(repo); }
});

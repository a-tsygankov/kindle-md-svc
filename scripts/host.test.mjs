import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access, copyFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { configure, loadConfig, resolveSelection, resetPlan, resetHost, startRun, readStatus, stopRun, isAlive, writeJson } from './host-lib.mjs';

async function fixture(t) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kindle host tests '));
  const repo = path.join(base, 'repo with spaces');
  const source = path.join(base, 'cloud source');
  await mkdir(repo); await mkdir(source);
  t.after(async () => {
    await stopRun(repo).catch(() => {});
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { base, repo, source };
}

test('configuration round trips and updates preserve existing values', async t => {
  const { repo, source } = await fixture(t);
  assert.equal((await loadConfig(repo)).sourceDir, '');
  await configure(repo, { sourceDir: source, pandocPath: 'tools/pandoc' });
  await configure(repo, { browserPath: 'tools/chrome' });
  const config = await loadConfig(repo);
  assert.equal(config.sourceDir, source);
  assert.equal(config.pandocPath, 'tools/pandoc');
  assert.equal(config.browserPath, 'tools/chrome');
  await assert.rejects(configure(repo, { sourceDir: path.join(repo, 'missing') }), /source.*exist|ENOENT/i);
  assert.equal((await loadConfig(repo)).sourceDir, source, 'failed update must preserve config');
  await assert.rejects(configure(repo, { pandocPath: 'bad\0path' }), /null character/i);
  assert.equal((await loadConfig(repo)).pandocPath, 'tools/pandoc');
});

test('malformed or future configuration is rejected without overwriting it', async t => {
  const { repo } = await fixture(t);
  const configFile = path.join(repo, 'config.local.json');
  for (const content of ['{broken', '{"schemaVersion":99}', '{"schemaVersion":1,"sourceDir":3}']) {
    await writeFile(configFile, content);
    await assert.rejects(configure(repo, {}));
    assert.equal(await readFile(configFile, 'utf8'), content);
  }
});

test('selection resolves spaces but blocks files outside the source and non-Markdown', async t => {
  const { repo, source } = await fixture(t);
  await writeFile(path.join(source, 'meeting notes.md'), '# Notes');
  await writeFile(path.join(repo, 'private.md'), '# Outside');
  await writeFile(path.join(source, 'photo.png'), 'not Markdown');
  const config = await configure(repo, { sourceDir: source });
  assert.deepEqual(await resolveSelection(repo, config, ['meeting notes.md']), [path.join(source, 'meeting notes.md')]);
  await assert.rejects(resolveSelection(repo, config, [path.join(repo, 'private.md')]), /outside|escapes/i);
  await assert.rejects(resolveSelection(repo, config, ['photo.png']), /Markdown/);
  await assert.rejects(resolveSelection(repo, { ...config, sourceDir: '' }, ['meeting notes.md']), /sourceDir/);
});

test('a redirected source root is allowed but an image/file escape through a junction is rejected', async t => {
  const { repo, source, base } = await fixture(t);
  await writeFile(path.join(source, 'notes.md'), '# Notes');
  const redirectedRoot = path.join(base, 'synced root');
  await symlink(source, redirectedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const config = await configure(repo, { sourceDir: redirectedRoot });
  assert.deepEqual(await resolveSelection(repo, config, ['notes.md']), [path.join(source, 'notes.md')]);
  await writeFile(path.join(repo, 'outside.md'), '# Private');
  await symlink(repo, path.join(source, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resolveSelection(repo, config, ['escape/outside.md']), /outside|escapes/i);
});

test('default reset deletes generated files but preserves config, source, tools, and dependencies', async t => {
  const { repo, source } = await fixture(t);
  await configure(repo, { sourceDir: source });
  await writeFile(path.join(source, 'keep.md'), '# Keep');
  for (const name of ['output', '.state', '.tools', 'node_modules', 'docs']) {
    await mkdir(path.join(repo, name));
    await writeFile(path.join(repo, name, 'keep.txt'), name);
  }
  const planned = await resetPlan(repo);
  assert.deepEqual(planned.map(p => path.basename(p)), ['output', '.state']);
  await resetHost(repo, { dryRun: true });
  await access(path.join(repo, 'output', 'keep.txt'));
  await resetHost(repo);
  await assert.rejects(access(path.join(repo, 'output')));
  await assert.rejects(access(path.join(repo, '.state')));
  for (const name of ['.tools', 'node_modules', 'docs']) await access(path.join(repo, name, 'keep.txt'));
  await access(path.join(repo, 'config.local.json'));
  assert.equal(await readFile(path.join(source, 'keep.md'), 'utf8'), '# Keep');
});

test('reset preflights every target and refuses source overlap before deleting anything', async t => {
  const { repo } = await fixture(t);
  await mkdir(path.join(repo, 'output')); await mkdir(path.join(repo, '.state'));
  await mkdir(path.join(repo, 'node_modules'));
  await writeFile(path.join(repo, 'output', 'keep.txt'), 'keep');
  await configure(repo, { sourceDir: path.join(repo, 'node_modules') });
  await assert.rejects(resetHost(repo, { dependencies: true }), /source|overlap/i);
  assert.equal(await readFile(path.join(repo, 'output', 'keep.txt'), 'utf8'), 'keep');
});

test('reset refuses an output junction without touching its destination', async t => {
  const { repo, source } = await fixture(t);
  await writeFile(path.join(source, 'keep.md'), '# Do not delete');
  await symlink(source, path.join(repo, 'output'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(resetHost(repo), /redirect|link|junction/i);
  assert.equal(await readFile(path.join(source, 'keep.md'), 'utf8'), '# Do not delete');
});

async function waitFor(check, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for managed run');
}

test('a managed run finishes with logs, and a later start gets a different output directory', async t => {
  const { repo } = await fixture(t);
  await mkdir(path.join(repo, 'spike'));
  await writeFile(path.join(repo, 'spike', 'convert.mjs'), 'console.log("fixture converted");');
  const first = await startRun(repo, []);
  await waitFor(async () => (await readStatus(repo)).status === 'completed');
  assert.match(await readFile(first.logFile, 'utf8'), /fixture converted/);
  const second = await startRun(repo, []);
  assert.notEqual(first.outputDir, second.outputDir);
  await waitFor(async () => (await readStatus(repo)).status === 'completed');
  assert.equal((await stopRun(repo)).status, 'completed', 'stop is harmless after completion');
});

test('stop cancels only its owned process tree; concurrent start and reset are refused', async t => {
  const { repo } = await fixture(t);
  await mkdir(path.join(repo, 'spike'));
  const heartbeat = path.join(repo, 'child-heartbeat.txt');
  const childCode = `const fs=require('node:fs'); setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),100);`;
  await writeFile(path.join(repo, 'spike', 'convert.mjs'), `
    import {spawn} from 'node:child_process';
    spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], {stdio:'ignore', windowsHide:true});
    setTimeout(()=>{},30000);
  `);
  t.after(() => stopRun(repo).catch(() => {}));
  await startRun(repo, []);
  await waitFor(async () => { try { return (await readFile(heartbeat)).length > 0; } catch { return false; } });
  await assert.rejects(startRun(repo, []), /active|running/i);
  await assert.rejects(resetHost(repo), /active|stop/i);
  let stopped;
  try { stopped = await stopRun(repo); }
  catch (error) {
    const recorded = JSON.parse(await readFile(path.join(repo, '.state', 'run.json'), 'utf8'));
    t.diagnostic(JSON.stringify(recorded)); t.diagnostic(await readFile(recorded.logFile, 'utf8'));
    throw error;
  }
  assert.equal(stopped.status, 'stopped');
  const final = await readFile(heartbeat, 'utf8');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(await readFile(heartbeat, 'utf8'), final, 'owned descendant must stop too');
});

test('failed proof records failure and stale state cannot kill a stored unrelated PID', async t => {
  const { repo } = await fixture(t);
  await mkdir(path.join(repo, 'spike'));
  await writeFile(path.join(repo, 'spike', 'convert.mjs'), 'console.error("intentional failure"); process.exitCode=7;');
  await startRun(repo, []);
  const failed = await waitFor(async () => { const status = await readStatus(repo); return status.status === 'failed' ? status : false; });
  assert.equal(failed.exitCode, 7);
  const stale = { ...failed, status: 'running', pid: process.pid, heartbeat: '2000-01-01T00:00:00Z' };
  await writeFile(path.join(repo, '.state', 'run.json'), JSON.stringify(stale));
  assert.equal((await readStatus(repo)).status, 'stale');
  await assert.rejects(stopRun(repo), /stale|respond/i);
  assert.ok(process.pid > 0); // This test process must survive the attempted stop.
});

test('real Chromium exits when its managed conversion is stopped', async t => {
  const { repo } = await fixture(t);
  const { default: puppeteer } = await import('puppeteer');
  const browserPath = process.env.BROWSER_EXECUTABLE || await puppeteer.executablePath();
  const ready = path.join(repo, 'browser-ready.json');
  await mkdir(path.join(repo, 'spike'));
  await writeFile(path.join(repo, 'spike', 'convert.mjs'), `
    import puppeteer from ${JSON.stringify(import.meta.resolve('puppeteer'))};
    import {writeFile} from 'node:fs/promises';
    const browser = await puppeteer.launch({headless:true, executablePath:${JSON.stringify(browserPath)}});
    await writeFile(${JSON.stringify(ready)}, JSON.stringify({pid:browser.process().pid}));
    setTimeout(()=>{},30000);
  `);
  await startRun(repo, []);
  const browser = await waitFor(async () => {
    try { return JSON.parse(await readFile(ready, 'utf8')); } catch { return false; }
  });
  try { assert.equal((await stopRun(repo)).status, 'stopped'); }
  catch (error) {
    const state = JSON.parse(await readFile(path.join(repo, '.state', 'run.json'), 'utf8'));
    t.diagnostic(JSON.stringify(state));
    t.diagnostic(await readFile(state.logFile, 'utf8'));
    throw error;
  }
  await waitFor(() => !isAlive(browser.pid));
});

test('managed start rejects a source inside .state before writing any state files', async t => {
  const { repo } = await fixture(t);
  const source = path.join(repo, '.state');
  await mkdir(source); await mkdir(path.join(repo, 'spike'));
  await writeFile(path.join(source, 'notes.md'), '# Keep');
  await writeFile(path.join(repo, 'spike', 'convert.mjs'), 'setTimeout(()=>{},5000)');
  await configure(repo, { sourceDir: source });
  await assert.rejects(startRun(repo, []), /overlap|sourceDir/i);
  assert.deepEqual(await readdir(source), ['notes.md']);
});

for (const [managedRoot, childName] of [['output', 'runs'], ['.state', 'logs']]) {
  test(`managed start rejects redirected ${managedRoot}/${childName} before writing into source`, async t => {
    const { repo, source } = await fixture(t);
    await mkdir(path.join(repo, managedRoot)); await mkdir(path.join(repo, 'spike'));
    await writeFile(path.join(repo, 'spike', 'convert.mjs'), 'setTimeout(()=>{},5000)');
    await configure(repo, { sourceDir: source });
    await symlink(source, path.join(repo, managedRoot, childName), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(startRun(repo, []), /redirect|junction|link/i);
    assert.deepEqual(await readdir(source), []);
  });
}

test('Windows bootstrap rejects configured or supplied source overlap before touching tools', { skip: process.platform !== 'win32' }, async t => {
  const { repo, base } = await fixture(t);
  await mkdir(path.join(repo, 'scripts'));
  for (const name of ['setup.ps1', 'common.ps1']) await copyFile(new URL(`./${name}`, import.meta.url), path.join(repo, 'scripts', name));
  const guard = new URL('./bootstrap-guard.ps1', import.meta.url);
  try { await copyFile(guard, path.join(repo, 'scripts', 'bootstrap-guard.ps1')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await copyFile(new URL('../toolchain.json', import.meta.url), path.join(repo, 'toolchain.json'));
  const tools = path.join(repo, '.tools');
  await mkdir(path.join(tools, 'node-v26.13.0-win-x64'), { recursive: true });
  const sentinel = path.join(tools, 'node-v26.13.0-win-x64', 'node.exe');
  await writeFile(sentinel, 'SOURCE DOCUMENT: DO NOT OVERWRITE');
  const sourceAlias = path.join(base, 'synced alias');
  await symlink(tools, sourceAlias, 'junction');
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'scripts', 'setup.ps1'), '-SkipToolDownloads'];
  await configure(repo, { sourceDir: sourceAlias });
  await assert.rejects(promisify(execFile)(powershell, args, { windowsHide: true, timeout: 15_000 }), /source.*overlap|overlap.*source/i);
  await configure(repo, { sourceDir: '' });
  await assert.rejects(promisify(execFile)(powershell, [...args, '-SourceDir', sourceAlias], { windowsHide: true, timeout: 15_000 }), /source.*overlap|overlap.*source/i);
  assert.equal(await readFile(sentinel, 'utf8'), 'SOURCE DOCUMENT: DO NOT OVERWRITE');
  assert.equal((await loadConfig(repo)).sourceDir, '');
});

test('stop waits for its terminal acknowledgement across a transient stale read', async t => {
  const { repo } = await fixture(t);
  const dir = path.join(repo, '.state');
  await mkdir(dir);
  const state = { runId: randomUUID(), status: 'running', pid: process.pid, heartbeat: new Date().toISOString() };
  const stateFile = path.join(dir, 'run.json');
  await writeJson(stateFile, state);
  const result = stopRun(repo).then(value => ({ value }), error => ({ error }));
  await waitFor(async () => {
    try { await access(path.join(dir, `cancel-${state.runId}.json`)); return true; } catch { return false; }
  });
  await writeJson(stateFile, { ...state, status: 'stopping', pid: -1 });
  await new Promise(resolve => setTimeout(resolve, 350));
  await writeJson(stateFile, { ...state, status: 'stopped' });
  const outcome = await result;
  assert.ifError(outcome.error);
  assert.equal(outcome.value.status, 'stopped');
});

test('old config gains service defaults and partial SMTP updates preserve other settings', async t => {
  const { repo, source } = await fixture(t);
  await writeFile(path.join(repo, 'config.local.json'), JSON.stringify({ schemaVersion: 1, sourceDir: source, pandocPath: '', browserPath: '' }));
  const old = await loadConfig(repo);
  assert.equal(old.listenHost, '127.0.0.1');
  assert.equal(old.port, 8787);
  assert.equal(old.smtp.enabled, false);
  await configure(repo, { smtp: { host: 'smtp.example.com', from: 'reader@example.com', to: 'reader@kindle.com' } });
  await configure(repo, { port: 8790, smtp: { enabled: true } });
  const updated = await loadConfig(repo);
  assert.equal(updated.sourceDir, source);
  assert.equal(updated.smtp.host, 'smtp.example.com');
  assert.equal(updated.smtp.security, 'starttls');
  assert.equal(updated.smtp.enabled, true);
  const before = await readFile(path.join(repo, 'config.local.json'), 'utf8');
  for (const changes of [{ port: -1 }, { listenHost: 'evil.example' }, { smtp: { security: 'none' } }, { smtp: { password: 'never-store-this' } }]) {
    await assert.rejects(configure(repo, changes));
    assert.equal(await readFile(path.join(repo, 'config.local.json'), 'utf8'), before);
  }
});

test('concurrent atomic state updates remain valid JSON and preserve call order', async t => {
  const { repo } = await fixture(t);
  const file = path.join(repo, 'state.json');
  await Promise.all(Array.from({ length: 60 }, (_, sequence) => writeJson(file, { sequence })));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).sequence, 59);
});

test('service author defaults, config validation, and CLI configuration round trip', async t => {
  const { repo } = await fixture(t);
  assert.equal((await loadConfig(repo)).author, 'AT');
  const exec = promisify(execFile);
  await exec(process.execPath, [path.resolve('scripts/host.mjs'), 'configure', '--repo', repo, '--author', 'AT & Team']);
  assert.equal((await loadConfig(repo)).author, 'AT & Team');
  for (const author of ['', ' ', 'bad\nname', 'x'.repeat(513), 3]) {
    await assert.rejects(configure(repo, { author }), /author/i);
  }
  assert.equal((await loadConfig(repo)).author, 'AT & Team');
});

test('mail-to-kindle accepts one or multiple addresses, deduplicates, validates, and clears via CLI', async t => {
  const { repo } = await fixture(t);
  assert.deepEqual((await loadConfig(repo)).mailToKindle, []);
  await configure(repo, { mailToKindle: 'reader@kindle.com' });
  assert.deepEqual((await loadConfig(repo)).mailToKindle, ['reader@kindle.com']);
  const exec = promisify(execFile);
  await exec(process.execPath, [path.resolve('scripts/host.mjs'), 'configure', '--repo', repo,
    '--mail-to-kindle', 'first@kindle.com', '--mail-to-kindle', 'second@kindle.com', '--mail-to-kindle', 'FIRST@kindle.com']);
  assert.deepEqual((await loadConfig(repo)).mailToKindle, ['first@kindle.com', 'second@kindle.com']);
  for (const value of [null, 3, [''], ['bad'], ['x@kindle.com\r\nBcc: bad@example.test'], ['a@b.test,c@d.test'], Array(21).fill('reader@kindle.com')]) {
    await assert.rejects(configure(repo, { mailToKindle: value }), /mailToKindle/);
  }
  assert.equal((await loadConfig(repo)).mailToKindle.length, 2);
  await exec(process.execPath, [path.resolve('scripts/host.mjs'), 'configure', '--repo', repo, '--clear-mail-to-kindle']);
  assert.deepEqual((await loadConfig(repo)).mailToKindle, []);
});

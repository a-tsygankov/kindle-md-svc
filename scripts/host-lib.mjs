import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

export const activeStates = ['starting', 'running', 'stopping'];
export const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export const smtpDefaults = Object.freeze({ enabled: false, host: '', port: 587, security: 'starttls', from: '', to: '', user: '', passwordEnv: 'KINDLE_SMTP_PASSWORD', maxAttachmentBytes: 20 * 1024 * 1024 });
export const defaults = Object.freeze({ schemaVersion: 1, sourceDir: '', pandocPath: '', browserPath: '', listenHost: '127.0.0.1', port: 8787, smtp: smtpDefaults });

function validateConfig(config) {
  for (const key of Object.keys(config)) if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown config field: ${key}`);
  const result = { ...defaults, ...config };
  for (const key of ['sourceDir', 'pandocPath', 'browserPath', 'listenHost']) {
    if (typeof result[key] !== 'string' || result[key].includes('\0')) throw new Error(`Config ${key} must be a string without a null character.`);
  }
  if (result.listenHost !== 'localhost' && !isIP(result.listenHost)) throw new Error('listenHost must be localhost or an IP address.');
  if (!Number.isInteger(result.port) || result.port < 0 || result.port > 65535) throw new Error('port must be between 0 and 65535.');
  if (!result.smtp || typeof result.smtp !== 'object' || Array.isArray(result.smtp)) throw new Error('smtp must be an object.');
  for (const key of Object.keys(result.smtp)) if (!Object.hasOwn(smtpDefaults, key)) throw new Error(`Unknown SMTP field: ${key}. Passwords belong in an environment variable.`);
  result.smtp = { ...smtpDefaults, ...result.smtp };
  const smtp = result.smtp;
  for (const key of ['host', 'security', 'from', 'to', 'user', 'passwordEnv']) {
    if (typeof smtp[key] !== 'string' || /[\r\n\0]/.test(smtp[key])) throw new Error(`Invalid SMTP ${key}.`);
  }
  if (typeof smtp.enabled !== 'boolean' || !Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535) throw new Error('Invalid SMTP enabled/port.');
  if (!['tls', 'starttls', 'none'].includes(smtp.security)) throw new Error('SMTP security must be tls, starttls, or none.');
  if (smtp.security === 'none' && !['127.0.0.1', '::1', 'localhost'].includes(smtp.host)) throw new Error('Unencrypted SMTP is allowed only on loopback for development.');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(smtp.passwordEnv)) throw new Error('Invalid SMTP password environment-variable name.');
  if (!Number.isInteger(smtp.maxAttachmentBytes) || smtp.maxAttachmentBytes < 1024 || smtp.maxAttachmentBytes > 30 * 1024 * 1024) throw new Error('SMTP attachment cap must be 1 KiB to 30 MiB.');
  if (smtp.enabled && (!smtp.host || !/^[^\s<>@,;]+@[^\s<>@,;]+$/.test(smtp.from) || !/^[^\s<>@,;]+@[^\s<>@,;]+$/.test(smtp.to))) throw new Error('Enabled SMTP needs a host, sender, and one fixed recipient.');
  return result;
}
const comparable = value => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value);
export const contains = (parent, child) => {
  const relative = path.relative(comparable(parent), comparable(child));
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
};
export async function exists(file) {
  try { await access(file, constants.F_OK); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`Cannot read JSON in ${path.basename(file)}: ${error.message}`); }
}
const pendingWrites = new Map();
export async function writeJson(file, value) {
  const snapshot = JSON.stringify(value, null, 2) + '\n';
  const previous = pendingWrites.get(file) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, snapshot, { flag: 'wx', mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        try { await rename(temp, file); break; }
        catch (error) {
          if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 8) throw error;
          await delay(20 * (attempt + 1));
        }
      }
    } finally { await rm(temp, { force: true }).catch(() => {}); }
  });
  pendingWrites.set(file, operation);
  try { await operation; } finally { if (pendingWrites.get(file) === operation) pendingWrites.delete(file); }
}

export async function loadConfig(repo) {
  const config = await readJson(path.join(repo, 'config.local.json'), { ...defaults });
  if (!config || Array.isArray(config) || typeof config !== 'object' || config.schemaVersion !== 1) {
    throw new Error('Unsupported configuration schemaVersion; expected 1. Preserve the file and migrate it explicitly.');
  }
  return validateConfig(config);
}

export async function configure(repo, changes) {
  const current = await loadConfig(repo);
  for (const key of Object.keys(changes)) {
    if (!Object.hasOwn(defaults, key) || key === 'schemaVersion') {
      throw new Error(`Invalid configuration update: ${key}`);
    }
  }
  const next = validateConfig({ ...current, ...changes, smtp: { ...current.smtp, ...(changes.smtp || {}) } });
  if (next.sourceDir) {
    const source = path.resolve(repo, next.sourceDir);
    if (!(await stat(source)).isDirectory()) throw new Error('Configured sourceDir must be an existing directory.');
    next.sourceDir = source;
  }
  await writeJson(path.join(repo, 'config.local.json'), next);
  return next;
}

export async function resolveSelection(repo, config, files) {
  if (!files.length) return []; // The synthetic fixtures remain the default.
  if (!config.sourceDir) throw new Error('Configure sourceDir before selecting files.');
  const root = await realpath(path.resolve(repo, config.sourceDir));
  const results = [];
  for (const input of files) {
    const candidate = await realpath(path.resolve(root, input));
    if (!contains(root, candidate)) throw new Error(`Selected file is outside the configured source: ${input}`);
    if (!/\.(md|markdown)$/i.test(candidate) || !(await stat(candidate)).isFile()) throw new Error(`Expected a Markdown file: ${input}`);
    results.push(candidate);
  }
  return results;
}

export async function assertManagedDirectory(repo, name) {
  const root = await realpath(repo);
  const target = path.join(root, name);
  if (!['output', '.state', 'node_modules', '.tools', 'dist'].includes(name)) throw new Error('Not a managed directory.');
  let info;
  try { info = await lstat(target); } catch (error) { if (error.code === 'ENOENT') return target; throw error; }
  if (info.isSymbolicLink() || !info.isDirectory() || comparable(await realpath(target)) !== comparable(target)) {
    throw new Error(`Refusing redirected directory, file, symlink, or junction: ${target}`);
  }
  return target;
}

export async function assertManagedChild(repo, rootName, childName) {
  const root = await assertManagedDirectory(repo, rootName);
  const target = path.join(root, childName);
  let info;
  try { info = await lstat(target); } catch (error) { if (error.code === 'ENOENT') return target; throw error; }
  if (info.isSymbolicLink() || !info.isDirectory() || comparable(await realpath(target)) !== comparable(target)) {
    throw new Error(`Refusing redirected subdirectory, symlink, or junction: ${target}`);
  }
  return target;
}

export async function startPaths(repo) {
  const config = await loadConfig(repo);
  const stateDir = await assertManagedDirectory(repo, '.state');
  const outputDir = await assertManagedDirectory(repo, 'output');
  await assertManagedDirectory(repo, '.tools');
  await assertManagedChild(repo, 'output', 'runs');
  await assertManagedChild(repo, 'output', 'jobs');
  await assertManagedChild(repo, '.state', 'logs');
  if (config.sourceDir) {
    const source = await realpath(path.resolve(repo, config.sourceDir));
    for (const target of [stateDir, outputDir]) {
      if (contains(source, target) || contains(target, source)) throw new Error('Managed state/output overlaps sourceDir. Choose a separate source folder.');
    }
  }
  return { config, stateDir, outputDir };
}

export async function resetPlan(repo, { dependencies = false, tools = false } = {}) {
  const config = await loadConfig(repo);
  const names = ['output', '.state', ...(dependencies ? ['node_modules', 'dist'] : []), ...(tools ? ['.tools'] : [])];
  const targets = [];
  const source = config.sourceDir ? await realpath(path.resolve(repo, config.sourceDir)) : null;
  for (const name of names) {
    const target = await assertManagedDirectory(repo, name);
    if (source && (contains(target, source) || contains(source, target))) {
      throw new Error(`Reset target overlaps configured sourceDir: ${name}. Nothing was deleted.`);
    }
    targets.push(target);
  }
  const state = await readJson(path.join(repo, '.state', 'run.json'), null);
  const service = await readJson(path.join(repo, '.state', 'service.lock'), null);
  if (service && isAlive(service.pid)) throw new Error('The service is active; stop it before resetting or rebuilding.');
  if (state && activeStates.includes(state.status) && (isAlive(state.pid) || isAlive(state.childPid) || Date.now() - Date.parse(state.heartbeat) < 10_000)) {
    throw new Error('A managed run is active; stop it before resetting.');
  }
  return targets;
}

export async function resetHost(repo, options = {}) {
  await resetPlan(repo, options); // Preflight ALL targets before creating a lock.
  return withHostLock(repo, async () => {
    const targets = await resetPlan(repo, options);
    if (options.dryRun) return targets;
    if (options.tools && contains(path.join(await realpath(repo), '.tools'), process.execPath)) {
      throw new Error('Cannot remove the running Node tool; preserve .tools or use a Node installation outside this repo. Nothing was deleted.');
    }
    for (const target of targets) {
      await assertManagedDirectory(repo, path.basename(target));
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    return targets;
  });
}

export async function withHostLock(repo, operation) {
  const file = path.join(repo, '.host-operation.lock');
  const token = randomUUID();
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const old = await readJson(file, null);
    if (!old || isAlive(old.pid)) throw new Error('Another host operation is active or its lock needs inspection.');
    await rm(file);
    handle = await open(file, 'wx', 0o600);
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
  await handle.close();
  try { return await operation(); }
  finally {
    if ((await readJson(file, null))?.token === token) await rm(file, { force: true });
  }
}

export async function toolEnvironment(repo, config) {
  let pandoc = process.env.PANDOC_BIN || config.pandocPath;
  if (pandoc && (pandoc.includes('/') || pandoc.includes('\\'))) pandoc = path.resolve(repo, pandoc);
  if (!pandoc) {
    const toolsDir = await assertManagedDirectory(repo, '.tools');
    const directories = await readdir(toolsDir).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const name of directories.filter(name => name.startsWith('pandoc-')).sort().reverse()) {
      const candidate = path.join(toolsDir, name, process.platform === 'win32' ? 'pandoc.exe' : 'bin/pandoc');
      if (await exists(candidate)) { pandoc = candidate; break; }
    }
  }
  const env = {
    ...process.env,
    PANDOC_BIN: pandoc || 'pandoc',
    PUPPETEER_CACHE_DIR: process.env.PUPPETEER_CACHE_DIR || path.join(repo, '.tools', 'puppeteer'),
  };
  const browser = process.env.BROWSER_EXECUTABLE || config.browserPath;
  if (browser) env.BROWSER_EXECUTABLE = path.resolve(repo, browser);
  return env;
}

export async function readStatus(repo) {
  await assertManagedDirectory(repo, '.state');
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await readJson(path.join(repo, '.state', 'run.json'), null);
    if (!state) return { status: 'not-started', mode: 'conversion-proof' };
    if (!/^[0-9a-f-]{36}$/i.test(state.runId) || typeof state.status !== 'string') throw new Error('Invalid managed run state. Inspect .state/run.json.');
    if (activeStates.includes(state.status)) {
      const age = Date.now() - Date.parse(state.heartbeat);
      if (!Number.isFinite(age) || age > 10_000 || (state.pid && !isAlive(state.pid))) {
        // The supervisor can atomically publish a terminal state and exit
        // between our file read and PID check. Re-read before declaring stale.
        if (attempt < 2) { await delay(10); continue; }
        return { ...state, recordedStatus: state.status, status: 'stale' };
      }
    }
    return state;
  }
}

export async function startRun(repo, files, { mode = 'proof' } = {}) {
  await startPaths(repo); // No lock/log/state writes until all source checks pass.
  return withHostLock(repo, async () => {
    const { config, stateDir, outputDir } = await startPaths(repo);
    const previous = await readStatus(repo);
    if (activeStates.includes(previous.status) || previous.status === 'stale') {
      throw new Error('A run is active or has unresolved stale state. Use status/stop before starting another.');
    }
    const selected = await resolveSelection(repo, config, files);
    const runId = randomUUID();
    await mkdir(path.join(stateDir, 'logs'), { recursive: true });
    const logFile = path.join(stateDir, 'logs', `${runId}.log`);
    const state = {
      mode: mode === 'service' ? 'publishing-service' : 'conversion-proof', runId, status: 'starting', pid: null, childPid: null,
      startedAt: new Date().toISOString(), heartbeat: new Date().toISOString(),
      outputDir: path.join(outputDir, 'runs', runId), logFile, files: selected,
    };
    await writeJson(path.join(stateDir, 'run.json'), state);
    const log = await open(logFile, 'wx');
    try {
      const env = await toolEnvironment(repo, config);
      const workerArgs = [fileURLToPath(new URL('./worker.mjs', import.meta.url)), repo, runId];
      if (process.platform === 'win32') {
        // PowerShell 5 native-output capture can remain attached to a Node
        // descendant even with detached/redirected stdio. ShellExecute a hidden
        // independent console; the supervisor opens its own explicit log handles.
        const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
        if (workerArgs.some(value => value.includes('"'))) throw new Error('Invalid Windows process path.');
        const argumentsLine = workerArgs.map(value => '"' + value.replace(/(\\+)$/, '$1$1') + '"').join(' ');
        const script = `$ErrorActionPreference='Stop'; Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList ${psQuote(argumentsLine)} -WindowStyle Hidden`;
        const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        await new Promise((resolve, reject) => {
          const launcher = spawn(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: repo, env, windowsHide: true, stdio: 'ignore' });
          launcher.once('error', reject); launcher.once('close', code => code === 0 ? resolve(undefined) : reject(new Error('Windows background launch failed.')));
        });
      } else {
        const worker = spawn(process.execPath, workerArgs, { cwd: repo, env, detached: true, stdio: ['ignore', log.fd, log.fd] });
        const error = await Promise.race([new Promise(resolve => worker.once('error', resolve)), new Promise(resolve => worker.once('spawn', () => resolve(null)))]);
        if (error) throw error;
        worker.unref();
      }
    } catch (error) {
      await writeJson(path.join(stateDir, 'run.json'), { ...state, status: 'failed', error: error.message });
      throw error;
    } finally { await log.close(); }
    for (let i = 0; i < 100; i++) {
      const current = await readStatus(repo);
      if (current.status !== 'starting') return current;
      await delay(50);
    }
    throw new Error('Supervisor did not start promptly. Inspect status and the run log before retrying.');
  });
}

export async function buildApp(repo) {
  await resetPlan(repo, { dependencies: true, tools: true }); // Read-only full source-safety/active-run preflight.
  await assertManagedDirectory(repo, 'dist');
  const compiler = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!await exists(compiler)) throw new Error('Build tools are missing. Run setup first.');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [compiler, '-p', path.join(repo, 'tsconfig.json')], { cwd: repo, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve(undefined) : reject(new Error('TypeScript build failed.')));
  });
}

export async function stopRun(repo) {
  const state = await readStatus(repo);
  if (state.status === 'stale') throw new Error('Stale supervisor state: stop will not kill a stored PID. Inspect the run log and processes.');
  if (!activeStates.includes(state.status)) return state;
  await writeJson(path.join(repo, '.state', `cancel-${state.runId}.json`), { runId: state.runId });
  for (let i = 0; i < 150; i++) {
    await delay(100);
    const current = await readStatus(repo);
    // Once cancellation has been requested, allow the bounded acknowledgement
    // window even if a process exits just before publishing its terminal state.
    if (current.status === 'stale') continue;
    if (!activeStates.includes(current.status)) {
      return current;
    }
  }
  throw new Error('Stop timed out. No arbitrary PID was killed; inspect the run log.');
}

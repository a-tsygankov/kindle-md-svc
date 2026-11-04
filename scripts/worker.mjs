// Owns one service or proof process and its descendants.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { openSync, closeSync, appendFileSync } from 'node:fs';
import { activeStates, delay, readJson, writeJson } from './host-lib.mjs';

const [repo, runId] = process.argv.slice(2);
const stateFile = path.join(repo, '.state', 'run.json');
const cancelFile = path.join(repo, '.state', `cancel-${runId}.json`);
const execFileAsync = promisify(execFile);
let state;
let child;
const logFile = path.join(repo, '.state', 'logs', `${runId}.log`);
function log(message) { appendFileSync(logFile, String(message) + '\n'); }

async function killOwnedTree() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else { process.kill(-child.pid, 'SIGTERM'); }
  } catch (error) {
    // taskkill can report errors for Chrome descendants already disappearing
    // with their job object. Wait for the owned child's exit notification before
    // treating that diagnostic as a failure to stop the root process.
    for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await delay(50);
    if (child.exitCode === null && child.signalCode === null) throw error;
    log('OS reported termination diagnostics, but the owned application process exited.');
  }
}

async function main() {
  state = await readJson(stateFile, null);
  if (!state || state.runId !== runId || !activeStates.includes(state.status)) throw new Error('Run identity does not match supervisor state.');
  state.pid = process.pid;
  const service = state.mode === 'publishing-service';
  state.status = service ? 'starting' : 'running';
  const args = service ? [path.join(repo, 'dist', 'src', 'server.js'), repo, runId] : [path.join(repo, 'spike', 'convert.mjs'), '--out', state.outputDir, ...state.files];
  const logDescriptor = openSync(logFile, 'a');
  try {
    child = spawn(process.execPath, args, {
      cwd: repo, env: process.env, detached: process.platform !== 'win32', windowsHide: true,
      stdio: service ? ['ignore', logDescriptor, logDescriptor, 'ipc'] : ['ignore', logDescriptor, logDescriptor],
    });
  } finally { closeSync(logDescriptor); }
  state.childPid = child.pid;
  let result;
  const finished = new Promise(resolve => {
    child.once('error', error => { result = { code: null, error: error.message }; resolve(result); });
    child.once('close', (code, signal) => { result ??= { code, signal }; resolve(result); });
  });
  let cancelled = false;
  while (!result) {
    if (service && state.status === 'starting') {
      const ready = await readJson(path.join(repo, '.state', `service-${runId}.json`), null);
      if (ready?.runId === runId && ready.pid === child.pid) { state.status = 'running'; state.url = ready.url; state.tokenFile = ready.tokenFile; }
    }
    const request = await readJson(cancelFile, null);
    if (request?.runId === runId && !cancelled) {
      cancelled = true;
      state.status = 'stopping';
      await writeJson(stateFile, { ...state, heartbeat: new Date().toISOString() });
      if (service && child.connected) {
        child.send({ type: 'shutdown' });
        let graceTimer;
        try { await Promise.race([finished, new Promise(resolve => { graceTimer = setTimeout(resolve, 7000); })]); }
        finally { clearTimeout(graceTimer); }
      }
      await killOwnedTree();
    }
    state.heartbeat = new Date().toISOString();
    await writeJson(stateFile, state);
    await Promise.race([finished, delay(200)]);
  }
  await finished;
  state.status = cancelled ? 'stopped' : !service && result.code === 0 ? 'completed' : 'failed';
  state.exitCode = result.code;
  state.finishedAt = state.heartbeat = new Date().toISOString();
  if (result.error) state.error = result.error;
  await writeJson(stateFile, state);
}

main().catch(async error => {
  log(error.message);
  await killOwnedTree().catch(cleanup => log(`Child cleanup failed: ${cleanup.message}`));
  if (state?.runId === runId) {
    await writeJson(stateFile, { ...state, status: 'failed', error: error.message, finishedAt: new Date().toISOString() }).catch(() => {});
  }
  process.exitCode = 1;
});

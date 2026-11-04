import path from 'node:path';
import { createPublisher } from './http.js';
import { writeJson } from '../scripts/host-lib.mjs';

const repo = path.resolve(process.argv[2] || process.cwd());
const runId = process.argv[3];
try {
  const app = await createPublisher(repo);
  if (runId) await writeJson(path.join(repo, '.state', `service-${runId}.json`), { runId, url: app.url, tokenFile: app.tokenFile, pid: process.pid });
  console.log(`Kindle Markdown Publisher listening at ${app.url}`);
  console.log('Access token is stored in the private .state/access-token file.');
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return; shuttingDown = true;
    await app.close(); process.exitCode = 0;
    if (process.connected) process.disconnect?.();
  };
  process.on('message', message => { if ((message as { type?: string })?.type === 'shutdown') void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); }); process.once('SIGINT', () => { void shutdown(); });
} catch {
  console.error('Service could not start. Check configuration, generated directory safety, and whether the port is already in use.');
  process.exitCode = 1;
}

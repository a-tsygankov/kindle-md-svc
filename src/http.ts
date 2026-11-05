import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, lstat, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { getConfig } from './config.js';
import { listDirectory } from './library.js';
import { JobQueue } from './jobs.js';
import { startPaths, readJson, isAlive } from '../scripts/host-lib.mjs';

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const pageCsp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
function json(res: ServerResponse, status: number, data: unknown): void { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
function body(req: IncomingMessage): Promise<Record<string, any>> {
  if (!req.headers['content-type']?.toString().toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Use JSON for this action.');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0, rejected = false;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 65536) { if (!rejected) reject(new HttpError(413, 'Request is too large.')); rejected = true; return; }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      if (rejected) return;
      try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); resolve(value); }
      catch { reject(new HttpError(400, 'Invalid JSON request.')); }
    });
    req.on('error', () => reject(new HttpError(400, 'Request interrupted.')));
  });
}
const digest = (value: string) => createHash('sha256').update(value).digest();

export async function createPublisher(repo: string) {
  const { stateDir } = await startPaths(repo);
  const config = await getConfig(repo);
  await mkdir(stateDir, { recursive: true });
  const lockFile = path.join(stateDir, 'service.lock');
  const instance = randomUUID();
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const previous = await readJson(lockFile, null);
    if (!previous || isAlive(previous.pid) || (await lstat(lockFile)).isSymbolicLink()) throw new Error('A service is already active or its lock needs inspection.');
    await unlink(lockFile); lock = await open(lockFile, 'wx', 0o600);
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, instance })); await lock.close();
  const tokenFile = path.join(stateDir, 'access-token');
  let queue: JobQueue | undefined;
  const sessions = new Map<string, number>();
  let server: http.Server | undefined;
  try {
    let token: string;
    try {
      if ((await lstat(tokenFile)).isSymbolicLink()) throw new Error('Access-token file must not be redirected.');
      token = (await readFile(tokenFile, 'utf8')).trim();
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('Invalid access-token file. Stop and reset generated state to replace it.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      token = randomBytes(32).toString('base64url'); await writeFile(tokenFile, token + '\n', { flag: 'wx', mode: 0o600 });
    }
    queue = await JobQueue.open(repo, config);
    const jobs = queue;
    const publicDir = fileURLToPath(new URL('../../public/', import.meta.url));
    const uiScript = fileURLToPath(new URL('./ui.js', import.meta.url));
    const equalToken = (value: unknown) => typeof value === 'string' && value.length <= 512 && timingSafeEqual(digest(value), digest(token));
    function authenticated(req: IncomingMessage): boolean {
      if (req.headers.authorization?.startsWith('Bearer ') && equalToken(req.headers.authorization.slice(7))) return true;
      const cookie = /(?:^|;\s*)kindle_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
      if (!cookie) return false;
      const expires = sessions.get(cookie) || 0;
      if (expires < Date.now()) { sessions.delete(cookie); return false; }
      return true;
    }
    server = http.createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Content-Security-Policy', pageCsp);
      res.setHeader('X-Frame-Options', 'DENY');
      void (async () => {
        const host = req.headers.host;
        if (!host || host.length > 256) throw new HttpError(403, 'Invalid host.');
        let origin: URL;
        try { origin = new URL('http://' + host); } catch { throw new HttpError(403, 'Invalid host.'); }
        const local = req.socket.localAddress?.replace(/^::ffff:/, '');
        const hostname = origin.hostname.replace(/^\[|\]$/g, '');
        if (origin.username || origin.password || !['127.0.0.1', '::1', 'localhost', local].includes(hostname) || Number(origin.port || 80) !== req.socket.localPort) throw new HttpError(403, 'Use the service address shown by status.');
        if (req.headers.origin && req.headers.origin !== origin.origin) throw new HttpError(403, 'Cross-origin requests are not allowed.');
        const url = new URL(req.url || '/', origin);
        if (req.method === 'GET' && url.pathname === '/health') { json(res, 200, { status: 'ok', mode: 'publishing-service' }); return; }
        const assets: Record<string, [string, string]> = {
          '/': [path.join(publicDir, 'index.html'), 'text/html; charset=utf-8'],
          '/style.css': [path.join(publicDir, 'style.css'), 'text/css; charset=utf-8'],
          '/app.js': [uiScript, 'text/javascript; charset=utf-8'],
        };
        if (req.method === 'GET' && assets[url.pathname]) {
          const [file, type] = assets[url.pathname]; const bytes = await readFile(file); res.writeHead(200, { 'Content-Type': type }); res.end(bytes); return;
        }
        if (req.method === 'POST' && url.pathname === '/api/session') {
          const input = await body(req);
          if (!equalToken(input.token)) throw new HttpError(401, 'Access token not accepted.');
          for (const [key, expires] of sessions) if (expires < Date.now()) sessions.delete(key);
          if (sessions.size >= 200) throw new HttpError(429, 'Too many sessions. Restart the service to clear them.');
          const session = randomBytes(32).toString('base64url'); sessions.set(session, Date.now() + 24 * 60 * 60 * 1000);
          res.setHeader('Set-Cookie', `kindle_session=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
          json(res, 200, { ok: true }); return;
        }
        if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found.');
        if (!authenticated(req)) throw new HttpError(401, 'Sign in to your local library.');
        if (req.method === 'POST' && url.pathname === '/api/logout') {
          await body(req);
          const cookie = /(?:^|;\s*)kindle_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
          if (cookie) sessions.delete(cookie);
          res.setHeader('Set-Cookie', 'kindle_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'); json(res, 200, { ok: true }); return;
        }
        if (req.method === 'GET' && url.pathname === '/api/status') {
          json(res, 200, { sourceConfigured: !!config.sourceDir, sourceLabel: config.sourceDir ? path.basename(config.sourceDir) : '', emailAvailable: config.smtp.enabled && (!config.smtp.user || !!process.env[config.smtp.passwordEnv]), mode: 'publishing-service' }); return;
        }
        if (req.method === 'GET' && url.pathname === '/api/library') {
          if (!config.sourceDir) throw new HttpError(400, 'Configure a local source folder on the host first.');
          json(res, 200, await listDirectory(config.sourceDir, url.searchParams.get('directory') || '', {
            sort: url.searchParams.get('sort') || 'name', direction: url.searchParams.get('direction') || 'asc',
            pinnedFirst: url.searchParams.get('pinnedFirst') === 'true',
          })); return;
        }
        if (url.pathname === '/api/jobs') {
          if (req.method === 'GET') { json(res, 200, { jobs: jobs.list() }); return; }
          if (req.method === 'POST') { const input = await body(req); json(res, 202, { jobs: await jobs.create(input.files, input.format) }); return; }
        }
        const match = /^\/api\/jobs\/([a-f0-9-]{36})\/(download|preview|cancel|send)$/.exec(url.pathname);
        if (match) {
          const [, id, action] = match;
          if (req.method === 'POST' && action === 'cancel') { await body(req); json(res, 200, { job: await jobs.cancel(id) }); return; }
          if (req.method === 'POST' && action === 'send') {
            const input = await body(req);
            if (Object.keys(input).some(key => key !== 'retry')) throw new HttpError(400, 'Delivery uses the fixed host configuration.');
            json(res, 200, { job: await jobs.submit(id, input.retry === true) }); return;
          }
          if (req.method === 'GET' && (action === 'download' || action === 'preview')) {
            const file = await jobs.artifact(id, action);
            const job = jobs.get(id);
            if (action === 'preview') {
              res.removeHeader('X-Frame-Options');
              res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
            } else {
              res.setHeader('Content-Type', job.format === 'epub' ? 'application/epub+zip' : 'application/pdf');
              const name = path.basename(job.name, path.extname(job.name)) + '.' + job.format;
              res.setHeader('Content-Disposition', `attachment; filename="document.${job.format}"; filename*=UTF-8''${encodeURIComponent(name)}`);
            }
            const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res); return;
          }
        }
        throw new HttpError(404, 'Not found.');
      })().catch(error => {
        if (res.headersSent) { res.destroy(); return; }
        const status = error instanceof HttpError ? error.status : 400;
        const message = error instanceof HttpError ? error.message : (error as NodeJS.ErrnoException).code ? 'Local file unavailable. Make sure it is downloaded and inside your source folder.' : error instanceof Error ? error.message : 'Request failed.';
        if (status === 413) res.setHeader('Connection', 'close');
        json(res, status, { error: message });
      });
    });
    server.requestTimeout = 30_000; server.headersTimeout = 10_000;
    const listener = server;
    await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(config.port, config.listenHost, resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listening service address.');
    const displayHost = config.listenHost === '0.0.0.0' || config.listenHost === '::' ? '127.0.0.1' : config.listenHost.includes(':') ? `[${config.listenHost}]` : config.listenHost;
    const url = `http://${displayHost}:${address.port}`;
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      const stopped = new Promise<void>(resolve => listener.close(() => resolve()));
      listener.closeIdleConnections(); await jobs.close(); listener.closeAllConnections(); await stopped;
      const owner = await readJson(lockFile, null);
      if (owner?.instance === instance) await unlink(lockFile);
    })();
    return { server, queue: jobs, url, tokenFile, close };
  } catch (error) {
    server?.close(); await queue?.close();
    if ((await readJson(lockFile, null))?.instance === instance) await unlink(lockFile);
    throw error;
  }
}

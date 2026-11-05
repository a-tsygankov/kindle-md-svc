import { mkdir, readFile, writeFile, readdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { assertManagedChild, startPaths, writeJson, contains } from '../scripts/host-lib.mjs';
import type { Config } from './config.js';
import type { ConversionResult, Format } from './converter.js';
import { selectedFile } from './library.js';
import { stopOwnedChild } from './process.js';
import { submitEmail } from './delivery.js';

export interface Job {
  id: string; file: string; name: string; format: Format; createdAt: string;
  state: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'ready' | 'failed' | 'interrupted';
  error?: string; result?: ConversionResult;
  delivery: { state: 'none' | 'submitting' | 'submitted' | 'unknown'; submittedAt?: string; error?: string };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const pending = (job: Job) => ['queued', 'running', 'cancelling'].includes(job.state);

export class JobQueue {
  private jobs = new Map<string, Job>();
  private active?: { job: Job; child: ChildProcess; done: Promise<void> };
  private closing = false;
  private gate: Promise<void> = Promise.resolve();
  private deliveries = new Set<Promise<unknown>>();
  private constructor(readonly repo: string, readonly config: Config) {}

  static async open(repo: string, config: Config): Promise<JobQueue> {
    await startPaths(repo);
    const queue = new JobQueue(repo, config);
    const root = await assertManagedChild(repo, 'output', 'jobs');
    await mkdir(root, { recursive: true });
    const names = await readdir(root);
    if (names.length > 2000) throw new Error('Too many retained jobs. Back up exports and reset generated output.');
    for (const id of names.filter(name => uuid.test(name))) {
      try {
        const directory = await queue.directory(id);
        const job = JSON.parse(await readFile(path.join(directory, 'job.json'), 'utf8')) as Job;
        if (job.id !== id || !['epub', 'pdf'].includes(job.format) || typeof job.file !== 'string' || typeof job.name !== 'string' || !job.delivery ||
          typeof job.createdAt !== 'string' || !Number.isFinite(Date.parse(job.createdAt)) ||
          !['queued', 'running', 'cancelling', 'cancelled', 'ready', 'failed', 'interrupted'].includes(job.state) ||
          !['none', 'submitting', 'submitted', 'unknown'].includes(job.delivery.state) ||
          path.isAbsolute(job.file) || /^[a-z]:[\\/]/i.test(job.file) || job.file.split(/[\\/]/).includes('..')) continue;
        if (job.state === 'ready' && (!job.result || !/^[a-f0-9]{64}$/.test(job.result.sha256) || !Array.isArray(job.result.warnings))) continue;
        if (pending(job)) { job.state = 'interrupted'; job.error = 'Conversion interrupted by service restart. Create a new job to retry.'; }
        if (job.delivery.state === 'submitting') { job.delivery.state = 'unknown'; job.delivery.error = 'Submission interrupted; check your email/Kindle library before retrying.'; }
        queue.jobs.set(id, job); await queue.persist(job);
      } catch { /* Unknown/redirected/corrupt generated folders are not served. */ }
    }
    return queue;
  }

  private async directory(id: string): Promise<string> {
    if (!uuid.test(id)) throw new Error('Unknown publication job.');
    const root = await assertManagedChild(this.repo, 'output', 'jobs');
    const directory = path.join(root, id);
    try {
      const info = await lstat(directory);
      const canonical = await realpath(directory);
      if (info.isSymbolicLink() || !info.isDirectory() || !contains(directory, canonical) || !contains(canonical, directory)) throw new Error('Redirected job folder is blocked.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return directory;
  }
  private async persist(job: Job): Promise<void> { await writeJson(path.join(await this.directory(job.id), 'job.json'), job); }
  list(): Job[] { return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200); }
  get(id: string): Job { const job = this.jobs.get(id); if (!job) throw new Error('Unknown publication job.'); return job; }

  async create(files: string[], format: Format): Promise<Job[]> {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      if (this.closing) throw new Error('Service is stopping.');
      if (!Array.isArray(files) || files.length < 1 || files.length > 10) throw new Error('Select between 1 and 10 files per batch (limit).');
      if (!['epub', 'pdf'].includes(format)) throw new Error('Choose EPUB or PDF.');
      if (this.jobs.size + files.length > 1000) throw new Error('Retained job limit reached. Back up exports and reset generated output.');
      if ([...this.jobs.values()].filter(pending).length + files.length > 20) throw new Error('The queue is full (20 jobs). Wait or cancel a pending job.');
      const root = await realpath(this.config.sourceDir);
      const normalized: string[] = [];
      for (const file of files) normalized.push(path.relative(root, await selectedFile(root, file)).replaceAll('\\', '/'));
      const created: Job[] = [];
      for (const file of normalized) {
        const job: Job = { id: randomUUID(), file, name: path.basename(file), format, createdAt: new Date().toISOString(), state: 'queued', delivery: { state: 'none' } };
        await mkdir(await this.directory(job.id)); await this.persist(job); created.push(job);
      }
      for (const job of created) this.jobs.set(job.id, job);
      void this.pump();
      return created;
    } finally { release(); }
  }

  private async pump(): Promise<void> {
    if (this.active || this.closing) return;
    const job = [...this.jobs.values()].find(job => job.state === 'queued');
    if (!job) return;
    // Reserve active synchronously before the first await.
    let resolveDone!: () => void;
    const done = new Promise<void>(resolve => { resolveDone = resolve; });
    const reservation = { job, child: undefined as unknown as ChildProcess, done };
    this.active = reservation;
    let timer: NodeJS.Timeout | undefined;
    try {
      job.state = 'running'; await this.persist(job);
      const directory = await this.directory(job.id);
      const request = path.join(directory, 'input.json');
      await writeFile(request, JSON.stringify({ sourceRoot: this.config.sourceDir, author: this.config.author, file: job.file, format: job.format, jobDir: directory }));
      if ((job.state as string) === 'cancelling' || this.closing) { job.state = 'cancelled'; await this.persist(job); return; }
      const child = spawn(process.execPath, [fileURLToPath(new URL('./convert-worker.js', import.meta.url)), request], {
        cwd: this.repo, env: process.env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      });
      reservation.child = child;
      let stdout = '', timedOut = false;
      child.stdout?.on('data', chunk => { if (stdout.length < 64 * 1024) stdout += chunk; });
      child.stderr?.resume(); // Never log renderer output containing source text.
      timer = setTimeout(() => { timedOut = true; void stopOwnedChild(child).catch(() => {}); }, 120_000);
      const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      if ((job.state as string) === 'cancelling' || this.closing) job.state = 'cancelled';
      else if (timedOut) { job.state = 'failed'; job.error = 'Conversion exceeded its two-minute limit.'; }
      else if (code === 0) {
        job.result = JSON.parse(await readFile(path.join(directory, 'artifacts', 'manifest.json'), 'utf8')) as ConversionResult;
        job.state = 'ready';
      } else {
        job.state = 'failed';
        try { job.error = String(JSON.parse(stdout).error).replaceAll(this.config.sourceDir, '[source]').slice(0, 500); }
        catch { job.error = 'Conversion failed. Check Markdown syntax and local file availability.'; }
      }
    } catch { job.state = 'failed'; job.error = 'Conversion could not finish. Check local files and publishing tools.'; }
    finally {
      if (timer) clearTimeout(timer);
      await this.persist(job).catch(() => {});
      this.active = undefined; resolveDone();
      if (!this.closing) void this.pump();
    }
  }

  async cancel(id: string): Promise<Job> {
    const job = this.get(id);
    if (job.state === 'queued') { job.state = 'cancelled'; await this.persist(job); }
    else if (job.state === 'running' || job.state === 'cancelling') {
      job.state = 'cancelling'; await this.persist(job);
      const active = this.active;
      if (active?.job.id === id) {
        if (active.child) await stopOwnedChild(active.child);
        await active.done;
      }
    }
    return job;
  }

  async artifact(id: string, kind: 'download' | 'preview'): Promise<string> {
    const job = this.get(id);
    if (job.state !== 'ready') throw new Error('The document is not ready.');
    const folder = path.join(await this.directory(id), 'artifacts');
    if ((await lstat(folder)).isSymbolicLink()) throw new Error('Redirected artifacts are blocked.');
    const file = path.join(folder, kind === 'preview' ? 'preview.html' : `book.${job.format}`);
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Redirected artifact is blocked.');
    return file;
  }

  async submit(id: string, retry = false): Promise<Job> {
    const job = this.get(id);
    if (!this.config.smtp.enabled) throw new Error('Email delivery is disabled. Configure SMTP first.');
    if (job.state !== 'ready') throw new Error('The document is not ready.');
    if (job.delivery.state === 'submitted' || job.delivery.state === 'submitting') throw new Error('This document is already submitted or being submitted.');
    if (job.delivery.state === 'unknown' && !retry) throw new Error('Check your Kindle/email library before explicitly retrying an unconfirmed submission.');
    job.delivery = { state: 'submitting' }; // Synchronous guard against double clicks.
    const task = (async () => {
      try {
        await this.persist(job);
        const bytes = await readFile(await this.artifact(id, 'download'));
        if (createHash('sha256').update(bytes).digest('hex') !== job.result?.sha256) throw new Error('The exported file changed. Create a new conversion.');
        const name = path.basename(job.name, path.extname(job.name)) + '.' + job.format;
        await submitEmail(this.config.smtp, name, bytes, job.format);
        job.delivery = { state: 'submitted', submittedAt: new Date().toISOString() };
      } catch (error) {
        job.delivery = { state: 'unknown', error: error instanceof Error ? error.message : 'Submission failed or unconfirmed.' };
      } finally { await this.persist(job); }
      return job;
    })();
    this.deliveries.add(task);
    try { return await task; } finally { this.deliveries.delete(task); }
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const job of this.jobs.values()) if (pending(job)) await this.cancel(job.id);
    await Promise.allSettled(this.deliveries);
  }
}

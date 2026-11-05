import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { configure } from '../scripts/host-lib.mjs';
import { getConfig } from '../dist/src/config.js';
import { JobQueue } from '../dist/src/jobs.js';
import { smtpCapture } from './helpers/smtp.mjs';
import { epubPackage } from './helpers/epub.mjs';

async function waitFor(check) {
  for (let i = 0; i < 200; i++) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Timed out waiting for conversion');
}
async function fixture(t, settings = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kindle-jobs-'));
  const repo = path.join(base, 'app'), source = path.join(base, 'source');
  await mkdir(repo); await mkdir(source);
  await configure(repo, { sourceDir: source, ...settings });
  const queue = await JobQueue.open(repo, await getConfig(repo));
  t.after(async () => { await queue.close(); await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  return { base, repo, source, queue };
}

test('jobs publish ready artifacts, isolate duplicate basenames, and recover interrupted jobs', async t => {
  const { repo, source, queue } = await fixture(t, { author: 'Configured Service Author' });
  await mkdir(path.join(source, 'a')); await mkdir(path.join(source, 'b'));
  await writeFile(path.join(source, 'a', 'notes.md'), '# First');
  await writeFile(path.join(source, 'b', 'notes.md'), '# Second');
  const jobs = await queue.create(['a/notes.md', path.join(source, 'b', 'notes.md')], 'epub');
  assert.notEqual(jobs[0].id, jobs[1].id);
  assert.equal(jobs[1].file, 'b/notes.md');
  await waitFor(() => jobs.every(job => queue.get(job.id).state === 'ready'));
  for (const job of jobs) {
    const file = await queue.artifact(job.id, 'download');
    const metadata = epubPackage(await readFile(file));
    assert.match(metadata, /<dc:title[^>]*>notes<\/dc:title>/);
    assert.match(metadata, /<dc:creator[^>]*>Configured Service Author<\/dc:creator>/);
  }
  const id = randomUUID(), folder = path.join(repo, 'output', 'jobs', id);
  await mkdir(folder);
  await writeFile(path.join(folder, 'job.json'), JSON.stringify({ id, file: 'a/notes.md', name: 'notes.md', format: 'epub', state: 'running', createdAt: new Date().toISOString(), delivery: { state: 'none' } }));
  const recovered = await JobQueue.open(repo, await getConfig(repo));
  t.after(() => recovered.close());
  assert.equal(recovered.get(id).state, 'interrupted');
  assert.match(recovered.get(id).error, /restart|interrupted/i);
});

test('queued and running conversions cancel without exposing partial artifacts', async t => {
  const { source, queue } = await fixture(t);
  await writeFile(path.join(source, 'diagram.md'), '# Diagram\n\n```mermaid\nflowchart LR\nA-->B\n```');
  const jobs = await queue.create(['diagram.md', 'diagram.md'], 'pdf');
  await queue.cancel(jobs[1].id);
  assert.equal(queue.get(jobs[1].id).state, 'cancelled');
  await queue.cancel(jobs[0].id);
  await waitFor(() => queue.get(jobs[0].id).state === 'cancelled');
  await assert.rejects(queue.artifact(jobs[0].id, 'download'), /ready/i);
  await assert.rejects(queue.create(Array(21).fill('diagram.md'), 'epub'), /limit|many/i);
});

test('concurrent send clicks submit exactly one exported document to local SMTP', async t => {
  const capture = await smtpCapture(); t.after(capture.close);
  const { source, queue } = await fixture(t, { smtp: { enabled: true, host: '127.0.0.1', port: capture.port, security: 'none', from: 'reader@example.test', to: 'scribe@kindle.com' } });
  await writeFile(path.join(source, 'notes.md'), '# Local SMTP test');
  const [job] = await queue.create(['notes.md'], 'epub');
  await waitFor(() => queue.get(job.id).state === 'ready');
  const responses = await Promise.allSettled([queue.submit(job.id), queue.submit(job.id)]);
  assert.equal(responses.filter(response => response.status === 'fulfilled').length, 1);
  assert.equal(queue.get(job.id).delivery.state, 'submitted');
  assert.equal(capture.messages.length, 1);
  assert.match(capture.messages[0], /application\/epub\+zip/);
  await assert.rejects(queue.submit(job.id), /already/i);
  assert.equal(capture.messages.length, 1);
});

test('one malformed persisted record cannot break recovered job history', async t => {
  const { repo } = await fixture(t);
  for (const createdAt of [undefined, new Date().toISOString()]) {
    const id = randomUUID(), folder = path.join(repo, 'output', 'jobs', id);
    await mkdir(folder);
    await writeFile(path.join(folder, 'job.json'), JSON.stringify({ id, name: 'notes.md', file: 'notes.md', format: 'epub', state: 'interrupted', createdAt, delivery: { state: 'none' } }));
  }
  const recovered = await JobQueue.open(repo, await getConfig(repo)); t.after(() => recovered.close());
  assert.equal(recovered.list().length, 1);
});

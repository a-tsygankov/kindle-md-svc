import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer';
import { configure } from '../scripts/host-lib.mjs';
import { createPublisher } from '../dist/src/http.js';
import { sortEntries } from '../dist/src/library.js';

test('phone picker sorts, labels offline pin intent, and preserves preferences and selections', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kindle-sort-ui-'));
  const repo = path.join(base, 'host'), source = path.join(base, 'source'); await mkdir(repo); await mkdir(source);
  await configure(repo, { sourceDir: source, port: 0 });
  const app = await createPublisher(repo);
  const browser = await puppeteer.launch({ headless: true });
  t.after(async () => { await browser.close(); await app.close(); await rm(base, { recursive: true, force: true, maxRetries: 10 }); });
  const page = await browser.newPage(); await page.setViewport({ width: 390, height: 844 });
  const entries = [
    { id: 'a', name: 'A cached folder', kind: 'directory', availability: 'local', modified: '2020-01-01' },
    { id: 'z', name: 'Z pinned folder', kind: 'directory', availability: 'pinned', modified: '2024-01-01' },
    { id: 'b', name: 'B pending folder', kind: 'directory', availability: 'pinned-pending', modified: '2022-01-01' },
    { id: 'old.md', name: 'old.md', kind: 'document', modified: '2020-01-01', bytes: 2 },
    { id: 'new.md', name: 'new.md', kind: 'document', modified: '2024-01-01', bytes: 20 },
  ];
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/library') {
      const directory = url.searchParams.get('directory') || '';
      const respond = () => request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ directory, entries: sortEntries(entries, { sort: url.searchParams.get('sort'), direction: url.searchParams.get('direction'), pinnedFirst: url.searchParams.get('pinnedFirst') === 'true' }) }) });
      if (directory === 'z') setTimeout(() => { void respond(); }, 250);
      else void respond();
    }
    else void request.continue();
  });
  await page.goto(app.url + '/#token=' + (await readFile(app.tokenFile, 'utf8')).trim());
  await page.waitForSelector('#sort-by', { timeout: 3000 });
  await page.waitForSelector('input[data-file-id="old.md"]');
  await page.click('input[data-file-id="old.md"]');
  await page.click('#pinned-first');
  await page.waitForFunction(() => document.querySelector('#file-list [data-entry-id]')?.getAttribute('data-entry-id') === 'b');
  assert.match(await page.$eval('[data-entry-id="z"]', node => node.textContent), /Pinned for offline use/);
  assert.match(await page.$eval('[data-entry-id="b"]', node => node.textContent), /download pending/);
  await page.select('#sort-by', 'modified'); await page.select('#sort-direction', 'desc');
  await page.waitForFunction(() => document.querySelector('#file-list [data-entry-id]')?.getAttribute('data-entry-id') === 'z');
  assert.equal(await page.$eval('input[data-file-id="old.md"]', input => input.checked), true);
  await page.reload(); await page.waitForSelector('input[data-file-id="old.md"]');
  assert.equal(await page.$eval('#pinned-first', input => input.checked), true);
  assert.equal(await page.$eval('#sort-by', input => input.value), 'modified');
  assert.equal(await page.$eval('#sort-direction', input => input.value), 'desc');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mkdir('output', { recursive: true });
  await page.screenshot({ path: 'output/ui-sorting-mobile.png', fullPage: true });
  // Changing sort while navigation is waiting must keep the requested destination.
  await page.click('[data-entry-id="z"]');
  await page.select('#sort-by', 'created');
  await page.waitForFunction(() => [...document.querySelectorAll('#breadcrumbs button')].at(-1)?.textContent === 'z', { timeout: 3000 });
});

test('phone UI logs in, selects, converts, previews, and exposes a download without overflow', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'kindle-ui-'));
  const repo = path.join(base, 'host'), source = path.join(base, 'source'); await mkdir(repo); await mkdir(source);
  await writeFile(path.join(source, 'hello.md'), '# Hello Scribe\n\nRead this on e-ink.\n\n```mermaid\nflowchart LR\nA[Local notes]-->B[Kindle]\n```');
  await configure(repo, { sourceDir: source, port: 0 });
  const app = await createPublisher(repo);
  const browser = await puppeteer.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  t.after(async () => { await browser.close(); await app.close(); await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const page = await browser.newPage(); await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const consoleMessages = []; page.on('console', message => { if (message.type() === 'error') consoleMessages.push(message.text()); });
  let previewStatus; page.on('response', response => { if (response.url().endsWith('/preview')) previewStatus = response.status(); });
  const token = (await readFile(app.tokenFile, 'utf8')).trim();
  await page.goto(app.url);
  await page.type('#token', token); await page.click('#login-button');
  await page.waitForSelector('#library-panel:not([hidden])', { timeout: 10_000 });
  await page.waitForSelector('input[data-file-id="hello.md"]');
  await page.click('input[data-file-id="hello.md"]');
  await page.click('#publish');
  await page.waitForSelector('[data-state="ready"]', { timeout: 20_000 });
  assert.equal(await page.$eval('[data-send]', button => button.disabled), true);
  assert.match(await page.$eval('[data-download]', link => link.href), /\/api\/jobs\/.*\/download$/);
  await page.click('[data-preview]');
  await page.waitForSelector('#preview-dialog[open]');
  const frameHandle = await page.$('#preview-frame');
  const frame = await frameHandle.contentFrame();
  // Sandboxed documents cannot run timer/RAF callbacks. Poll from the test host,
  // preserving the production sandbox rather than weakening it for automation.
  let previewReady = false;
  for (let i = 0; i < 100; i++) {
    try { previewReady = await frame.evaluate(() => document.body.innerText.includes('Hello Scribe') && [...document.images].every(image => image.complete && image.naturalWidth > 0)); } catch {}
    if (previewReady) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(previewStatus, 200);
  assert.equal(previewReady, true, consoleMessages.join('\n'));
  assert.equal(await frame.$$eval('img', images => images.every(image => image.complete && image.naturalWidth > 0)), true);
  await page.click('#close-preview');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mkdir('output', { recursive: true });
  await page.screenshot({ path: 'output/ui-validation-mobile.png', fullPage: true });
  await page.setViewport({ width: 1280, height: 900 });
  await page.screenshot({ path: 'output/ui-validation-desktop.png', fullPage: true });
  assert.deepEqual(errors, []);
});

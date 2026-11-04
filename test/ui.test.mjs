import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer';
import { configure } from '../scripts/host-lib.mjs';
import { createPublisher } from '../dist/src/http.js';

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

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { buildApp, configure, loadConfig, readStatus, resetHost, resetPlan, startRun, stopRun, toolEnvironment } from './host-lib.mjs';

const execFileAsync = promisify(execFile);
const { values, positionals } = parseArgs({
  options: {
    repo: { type: 'string' }, source: { type: 'string' }, pandoc: { type: 'string' }, browser: { type: 'string' },
    out: { type: 'string' }, author: { type: 'string' },
    'mail-to-kindle': { type: 'string', multiple: true }, 'clear-mail-to-kindle': { type: 'boolean' },
    file: { type: 'string', multiple: true, default: [] },
    'clear-source': { type: 'boolean' }, 'dry-run': { type: 'boolean' },
    dependencies: { type: 'boolean' }, tools: { type: 'boolean' },
    proof: { type: 'boolean' }, host: { type: 'string' }, port: { type: 'string' },
    'smtp-host': { type: 'string' }, 'smtp-port': { type: 'string' }, 'smtp-security': { type: 'string' },
    'smtp-from': { type: 'string' }, 'kindle-email': { type: 'string' }, 'smtp-user': { type: 'string' },
    'smtp-password-env': { type: 'string' }, 'enable-email': { type: 'boolean' }, 'disable-email': { type: 'boolean' },
  }, allowPositionals: true,
});
const repo = path.resolve(values.repo || fileURLToPath(new URL('..', import.meta.url)));
const [command] = positionals;
const print = value => console.log(JSON.stringify(value, null, 2));

async function doctor() {
  const config = await loadConfig(repo);
  const env = await toolEnvironment(repo, config);
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({ name: 'node', ok: major >= 24 && major % 2 === 0, version: process.version });
  try {
    const result = await execFileAsync(env.PANDOC_BIN, ['--version'], { env, windowsHide: true, timeout: 10_000 });
    checks.push({ name: 'pandoc', ok: true, executable: env.PANDOC_BIN, version: result.stdout.split(/\r?\n/)[0] });
  } catch (error) { checks.push({ name: 'pandoc', ok: false, message: error.message }); }
  try {
    process.env.PUPPETEER_CACHE_DIR = env.PUPPETEER_CACHE_DIR;
    const { default: puppeteer } = await import('puppeteer');
    const browser = env.BROWSER_EXECUTABLE || await puppeteer.executablePath();
    await access(browser);
    checks.push({ name: 'browser', ok: true, executable: browser });
    await import('@mermaid-js/mermaid-cli');
    checks.push({ name: 'mermaid', ok: true });
  } catch (error) { checks.push({ name: 'publishing-dependencies', ok: false, message: error.message }); }
  if (config.sourceDir) {
    try { await access(config.sourceDir); checks.push({ name: 'sourceDir', ok: true, path: config.sourceDir }); }
    catch (error) { checks.push({ name: 'sourceDir', ok: false, message: error.message }); }
  } else checks.push({ name: 'sourceDir', ok: true, note: 'Not configured: synthetic fixtures only.' });
  try { await access(path.join(repo, 'dist', 'src', 'server.js')); await access(path.join(repo, 'public', 'index.html')); checks.push({ name: 'application-build', ok: true }); }
  catch { checks.push({ name: 'application-build', ok: false, message: 'Run setup/build before starting the service.' }); }
  checks.push({ name: 'email', ok: true, note: config.smtp.enabled ? config.smtp.user && !process.env[config.smtp.passwordEnv] ? 'Configured, but password environment variable is missing.' : 'Configured; SMTP and actual Kindle delivery are not verified by doctor.' : 'Disabled; downloads remain available.' });
  const result = { ok: checks.every(check => check.ok), checks, run: await readStatus(repo) };
  print(result);
  if (!result.ok) process.exitCode = 1;
}

async function main() {
  switch (command) {
    case 'test':
    case 'proof': {
      if (command === 'test') await buildApp(repo);
      const env = await toolEnvironment(repo, await loadConfig(repo));
      const args = command === 'test' ? ['--test', 'spike/*.test.mjs', 'scripts/*.test.mjs', 'test/*.test.mjs'] : [
        path.join(repo, 'spike', 'convert.mjs'), '--out', values.out || 'output/proof', ...positionals.slice(1),
      ];
      const child = spawn(process.execPath, args, { cwd: repo, env, windowsHide: true, stdio: 'inherit' });
      const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
      process.exitCode = code === 0 ? 0 : 1;
      break;
    }
    case 'configure': {
      const changes = {};
      if (values.author !== undefined) changes.author = values.author;
      if (values['mail-to-kindle'] && values['clear-mail-to-kindle']) throw new Error('Use --mail-to-kindle or --clear-mail-to-kindle, not both.');
      if (values['mail-to-kindle']) changes.mailToKindle = values['mail-to-kindle'];
      if (values['clear-mail-to-kindle']) changes.mailToKindle = [];
      if (values.source !== undefined) changes.sourceDir = values.source;
      if (values['clear-source']) changes.sourceDir = '';
      if (values.pandoc !== undefined) changes.pandocPath = values.pandoc;
      if (values.browser !== undefined) changes.browserPath = values.browser;
      if (values.host !== undefined) changes.listenHost = values.host;
      if (values.port !== undefined) changes.port = Number(values.port);
      const smtp = {};
      for (const [option, key] of Object.entries({ 'smtp-host': 'host', 'smtp-port': 'port', 'smtp-security': 'security', 'smtp-from': 'from', 'kindle-email': 'to', 'smtp-user': 'user', 'smtp-password-env': 'passwordEnv' })) {
        if (values[option] !== undefined) smtp[key] = key === 'port' ? Number(values[option]) : values[option];
      }
      if (values['enable-email']) smtp.enabled = true;
      if (values['disable-email']) smtp.enabled = false;
      if (Object.keys(smtp).length) changes.smtp = smtp;
      print(await configure(repo, changes)); break;
    }
    case 'config': print(await loadConfig(repo)); break;
    case 'doctor': await doctor(); break;
    case 'build': await buildApp(repo); break;
    case 'start': {
      const mode = values.proof || values.file.length ? 'proof' : 'service';
      if (mode === 'service') await buildApp(repo);
      print(await startRun(repo, values.file, { mode })); break;
    }
    case 'status': print(await readStatus(repo)); break;
    case 'stop': print(await stopRun(repo)); break;
    case 'reset-plan': print(await resetPlan(repo, { dependencies: values.dependencies, tools: values.tools })); break;
    case 'reset': print({ dryRun: !!values['dry-run'], targets: await resetHost(repo, {
      dependencies: values.dependencies, tools: values.tools, dryRun: values['dry-run'],
    }) }); break;
    default: throw new Error('Usage: node scripts/host.mjs configure|config|doctor|proof|test|start|status|stop|reset [--source DIR] [--file FILE] [--dry-run] [--dependencies]');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

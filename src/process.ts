import { spawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

export async function stopOwnedChild(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await new Promise(resolve => setTimeout(resolve, 50));
    if (child.exitCode === null && child.signalCode === null) throw error;
  }
}

export function runTool(executable: string, args: string[], input?: string | Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Publishing tool timed out.')); }, 60_000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 16 * 1024 * 1024) { child.kill(); reject(new Error('Publishing tool output is too large.')); } });
    child.stderr.on('data', chunk => { if (errors.length < 64 * 1024) errors += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(new Error(`Cannot run publishing tool: ${(error as NodeJS.ErrnoException).code || 'unavailable'}.`)); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new Error('Publishing tool failed. Check Markdown syntax and local image availability.')); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

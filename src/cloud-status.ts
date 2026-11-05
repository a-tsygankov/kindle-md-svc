import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export type Availability = 'pinned' | 'pinned-pending' | 'on-demand' | 'online-only' | 'local' | 'unknown';
export function cloudAvailability(attributes?: number): Availability {
  if (attributes === undefined || !Number.isInteger(attributes) || attributes < 0) return 'unknown';
  const pinned = !!(attributes & 0x80000), unpinned = !!(attributes & 0x100000);
  if (pinned && unpinned) return 'unknown';
  const recall = !!(attributes & (0x1000 | 0x40000 | 0x400000));
  if (pinned) return recall ? 'pinned-pending' : 'pinned';
  if (unpinned) return 'on-demand';
  return recall ? 'online-only' : 'local';
}

export async function windowsAttributes(folder: string): Promise<Map<string, number>> {
  if (process.platform !== 'win32') return new Map();
  try {
    const script = fileURLToPath(new URL('../../scripts/cloud-attributes.ps1', import.meta.url));
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, '-Folder', folder], {
      windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8',
    });
    const rows: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    if (!Array.isArray(rows)) return new Map();
    const result = new Map<string, number>();
    for (const row of rows) if (typeof row?.name === 'string' && Number.isInteger(row.attributes) && row.attributes >= 0) result.set(row.name, row.attributes);
    return result;
  } catch { return new Map(); } // Unsupported/provider errors must never imply offline readiness.
}

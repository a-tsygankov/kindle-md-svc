import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { contains } from '../scripts/host-lib.mjs';
import { cloudAvailability, windowsAttributes } from './cloud-status.js';
import type { Availability } from './cloud-status.js';

export interface LibraryEntry { id: string; name: string; kind: 'directory' | 'document'; bytes?: number; modified?: string; created?: string; availability?: Availability }
export interface LibraryListing { directory: string; entries: LibraryEntry[] }
export interface SortOptions { sort?: string; direction?: string; pinnedFirst?: boolean }

export function sortEntries(entries: LibraryEntry[], options: SortOptions = {}): LibraryEntry[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const name = (a: LibraryEntry, b: LibraryEntry) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id);
  const pinned = (entry: LibraryEntry) => entry.kind === 'directory' && ['pinned', 'pinned-pending'].includes(entry.availability || '');
  const key = ['modified', 'created', 'size'].includes(options.sort || '') ? options.sort : 'name';
  const direction = options.direction === 'desc' ? -1 : 1;
  const value = (entry: LibraryEntry): number | undefined => key === 'size' ? entry.bytes : entry[key as 'modified' | 'created'] ? Date.parse(entry[key as 'modified' | 'created']!) : undefined;
  return [...entries].sort((a, b) => {
    const group = Number(b.kind === 'directory') - Number(a.kind === 'directory');
    if (group) return group;
    if (options.pinnedFirst && pinned(a) !== pinned(b)) return Number(pinned(b)) - Number(pinned(a));
    if (key === 'name') return direction * name(a, b);
    const av = value(a), bv = value(b);
    const amissing = av === undefined || !Number.isFinite(av), bmissing = bv === undefined || !Number.isFinite(bv);
    if (amissing !== bmissing) return amissing ? 1 : -1;
    return (!amissing && !bmissing ? direction * (av! - bv!) : 0) || name(a, b);
  });
}

async function inside(root: string, target: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const canonical = await realpath(path.resolve(canonicalRoot, target));
  if (!contains(canonicalRoot, canonical)) throw new Error('Path escapes the configured source folder.');
  return canonical;
}

export async function selectedFile(root: string, id: string): Promise<string> {
  if (typeof id !== 'string' || !id || id.length > 2048 || id.includes('\0')) throw new Error('Invalid document selection.');
  const file = await inside(root, id);
  if (!/\.(md|markdown)$/i.test(file) || !(await stat(file)).isFile()) throw new Error('Select a Markdown file.');
  return file;
}

export async function listDirectory(root: string, directory: string, options: SortOptions = {}): Promise<LibraryListing> {
  if (typeof directory !== 'string' || directory.length > 2048 || directory.includes('\0')) throw new Error('Invalid folder.');
  const canonicalRoot = await realpath(root);
  const folder = await inside(canonicalRoot, directory);
  if (!(await stat(folder)).isDirectory()) throw new Error('Select a folder.');
  const entries: LibraryEntry[] = [];
  const children = await readdir(folder);
  if (children.length > 10_000) throw new Error('This folder is too large; choose a smaller source folder.');
  const attributes = await windowsAttributes(folder);
  for (const name of children) {
    if (name.startsWith('.')) continue;
    try {
      const file = await inside(canonicalRoot, path.join(folder, name));
      const info = await stat(file);
      const id = path.relative(canonicalRoot, path.join(folder, name)).replaceAll('\\', '/');
      const metadata = { modified: info.mtime.toISOString(), created: info.birthtime.toISOString(), availability: cloudAvailability(attributes.get(name)) };
      if (info.isDirectory()) entries.push({ id, name, kind: 'directory', ...metadata });
      else if (info.isFile() && /\.(md|markdown)$/i.test(name)) entries.push({ id, name, kind: 'document', bytes: info.size, ...metadata });
    } catch { /* Unavailable cloud entries and escaped links are not selectable. */ }
  }
  return { directory: path.relative(canonicalRoot, folder).replaceAll('\\', '/'), entries: sortEntries(entries, options) };
}

export async function localAsset(root: string, document: string, target: string): Promise<string> {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('\\\\')) throw new Error('Only local raster images are supported; remote images are blocked.');
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { throw new Error('Invalid image path encoding.'); }
  if (decoded.includes('\0') || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('//') || decoded.startsWith('\\\\')) throw new Error('Only local raster images are supported.');
  return inside(root, path.resolve(path.dirname(document), decoded));
}

export async function readLimited(file: string, limit: number): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    if ((await handle.stat()).size > limit) throw new Error('File is too large for the configured conversion limit.');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length <= limit) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error('File is too large for the configured conversion limit.');
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}

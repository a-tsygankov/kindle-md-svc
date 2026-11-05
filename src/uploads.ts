import { mkdir, readdir, lstat, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertManagedChild, startPaths, contains } from '../scripts/host-lib.mjs';
import { readLimited, selectedFile, sortEntries } from './library.js';
import type { LibraryListing, LibraryEntry, SortOptions } from './library.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9-]{27}$/;
const markdown = /\.(md|markdown)$/i;
function portablePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || value.split('/').length > 20) throw new Error('Invalid upload path.');
  const parts = value.split('/');
  if (parts.some(part => !part || part.startsWith('.') || /[<>:"\\|?*\x00-\x1f\x7f]/.test(part) || /[. ]$/.test(part) || part.length > 255 || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw new Error('Upload path must use safe portable folder and file names.');
  return value;
}

export class UploadStore {
  private gate: Promise<unknown> = Promise.resolve();
  constructor(private readonly repo: string) {}
  async root(): Promise<string> {
    await startPaths(this.repo);
    const root = await assertManagedChild(this.repo, 'output', 'uploads');
    await mkdir(root, { recursive: true });
    return root;
  }
  async batch(id: string): Promise<string> {
    if (!uuid.test(id)) throw new Error('Unknown upload batch.');
    const folder = path.join(await this.root(), id);
    const info = await lstat(folder), canonical = await realpath(folder);
    if (info.isSymbolicLink() || !info.isDirectory() || !contains(folder, canonical) || !contains(canonical, folder)) throw new Error('Redirected upload batch is blocked.');
    return canonical;
  }
  async list(options: SortOptions = {}): Promise<LibraryListing> {
    const root = await this.root(), entries: LibraryEntry[] = [];
    const names = await readdir(root);
    if (names.length > 200) throw new Error('Too many upload folders. Back up exports and reset generated output.');
    for (const id of names.filter(name => uuid.test(name))) {
      try {
        const folder = await this.batch(id), manifest = path.join(folder, '.manifest.json');
        if ((await lstat(manifest)).isSymbolicLink()) continue;
        const data = JSON.parse((await readLimited(manifest, 128 * 1024)).toString('utf8'));
        if (!Array.isArray(data.files) || data.files.length > 10) continue;
        for (const item of data.files) {
          const relative = portablePath(item.path);
          if (!markdown.test(relative) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > 2 * 1024 * 1024 || !Number.isFinite(Date.parse(item.modified))) continue;
          await selectedFile(folder, relative);
          entries.push({ id: `${id}/${relative}`, name: path.posix.basename(relative), kind: 'document', bytes: item.bytes, modified: item.modified, created: item.modified, availability: 'local' });
        }
      } catch { /* Invalid or redirected retained bundles are not exposed. */ }
    }
    return { directory: '', entries: sortEntries(entries, options) };
  }
  import(files: unknown): Promise<LibraryListing> {
    const operation = this.gate.catch(() => {}).then(() => this.importBatch(files));
    this.gate = operation;
    return operation;
  }
  private async importBatch(files: unknown): Promise<LibraryListing> {
    const root = await this.root();
    if ((await readdir(root)).length >= 100) throw new Error('Upload retention limit reached (100 batches). Save exports and reset generated output.');
    if (!Array.isArray(files) || !files.length || files.length > 110) throw new Error('Upload between 1 and 110 files (10 Markdown and 100 images maximum).');
    const decoded: { relative: string; bytes: Buffer; isMarkdown: boolean }[] = [];
    let total = 0, documents = 0, images = 0;
    const seen = new Set<string>();
    for (const item of files) {
      const relative = portablePath(item?.path), isMarkdown = markdown.test(relative);
      if (!isMarkdown && !/\.(png|jpe?g|gif|webp)$/i.test(relative)) throw new Error('Upload only Markdown and supported raster images.');
      const key = relative.normalize('NFC').toLowerCase();
      if (seen.has(key)) throw new Error('Duplicate upload paths are not portable across hosts.');
      seen.add(key);
      const limit = (isMarkdown ? 2 : 10) * 1024 * 1024;
      if (typeof item.data !== 'string' || item.data.length > 4 * Math.ceil(limit / 3)) throw new Error('Upload file exceeds its size limit.');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw new Error('Invalid upload encoding.');
      const bytes = Buffer.from(item.data, 'base64');
      if (bytes.toString('base64') !== item.data) throw new Error('Invalid upload encoding.');
      if (bytes.length > limit || (total += bytes.length) > 30 * 1024 * 1024) throw new Error('Upload exceeds file or 30 MiB batch size limit.');
      if (isMarkdown) {
        if (++documents > 10) throw new Error('Upload at most 10 Markdown documents per batch.');
        try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('Upload Markdown encoded as UTF-8.'); }
      } else if (++images > 100) throw new Error('Upload at most 100 images per batch.');
      decoded.push({ relative, bytes, isMarkdown });
    }
    if (!documents) throw new Error('Include at least one Markdown document in the upload.');
    const id = randomUUID(), temporary = path.join(root, `.${id}.tmp`), modified = new Date().toISOString();
    await mkdir(temporary);
    try {
      for (const item of decoded) {
        const destination = path.join(temporary, item.relative);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, item.bytes, { flag: 'wx', mode: 0o600 });
      }
      const documents = decoded.filter(item => item.isMarkdown);
      await writeFile(path.join(temporary, '.manifest.json'), JSON.stringify({ files: documents.map(item => ({ path: item.relative, bytes: item.bytes.length, modified })) }));
      await rename(temporary, path.join(root, id));
      return { directory: '', entries: documents.map(item => ({ id: `${id}/${item.relative}`, name: path.posix.basename(item.relative), kind: 'document', bytes: item.bytes.length, modified, created: modified, availability: 'local' })) };
    } catch (error) {
      if (!(await lstat(temporary)).isSymbolicLink()) await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
}

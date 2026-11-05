import type { Job } from './jobs.js';
import type { LibraryListing } from './library.js';
import type { LibraryEntry } from './library.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const selected = new Set<string>();
let listing: LibraryListing = { directory: '', entries: [] };
let emailAvailable = false, signedIn = false, polling = false;
let previousJobs = '';
let directoryRequest = 0;
let desiredDirectory = '';
let libraryLabel = '';
let sourceRequest = 0, uploadingFiles = false;
let reading: { id: string; source: 'library' | 'upload'; name: string } | undefined;
const currentSource = () => $<HTMLSelectElement>('source-mode').value as 'library' | 'upload';
const sortStorageKey = 'kindle-picker-sort-v1';
try {
  const saved = JSON.parse(localStorage.getItem(sortStorageKey) || '{}');
  if (['name', 'modified', 'created', 'size'].includes(saved.sort)) $<HTMLSelectElement>('sort-by').value = saved.sort;
  if (['asc', 'desc'].includes(saved.direction)) $<HTMLSelectElement>('sort-direction').value = saved.direction;
  $<HTMLInputElement>('pinned-first').checked = saved.pinnedFirst === true;
} catch { /* Sorting works even if browser storage is disabled. */ }
function sortPreferences() {
  return { sort: $<HTMLSelectElement>('sort-by').value, direction: $<HTMLSelectElement>('sort-direction').value, pinnedFirst: $<HTMLInputElement>('pinned-first').checked };
}
function entryMetadata(entry: LibraryEntry): string {
  const availability = {
    pinned: '✓ Pinned for offline use', 'pinned-pending': '↓ Pinned · download pending',
    'on-demand': 'On demand', 'online-only': 'Download needed',
    local: entry.kind === 'directory' ? 'No offline pin' : 'Available locally', unknown: 'Storage status unavailable',
  }[entry.availability || 'unknown'];
  const field = $<HTMLSelectElement>('sort-by').value === 'created' ? 'created' : 'modified';
  const date = entry[field] ? new Date(entry[field]!) : undefined;
  return [availability, date && !Number.isNaN(date.getTime()) ? `${field === 'created' ? 'Created' : 'Modified'} ${date.toLocaleString()}` : ''].filter(Boolean).join(' · ');
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node;
}
function notice(error: unknown): void { $('notice').textContent = error instanceof Error ? error.message : String(error); $('notice').hidden = false; }
async function api<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401 && url !== '/api/session') showLogin(); throw new Error(result.error || 'Request failed.'); }
  return result as T;
}
function showLogin(): void {
  signedIn = false; $('workspace').hidden = true; $('library-panel').hidden = true;
  $('login-panel').hidden = false; $('logout').hidden = true; $('privacy-note').hidden = true;
  reading = undefined; sourceRequest++; directoryRequest++; selected.clear();
  $('source-content').textContent = ''; $('source-title').textContent = 'Read Markdown';
  $<HTMLButtonElement>('convert-document').disabled = true;
}
async function readMarkdown(id: string, source: 'library' | 'upload', focusReader = false): Promise<void> {
  const request = ++sourceRequest;
  reading = undefined; $<HTMLButtonElement>('convert-document').disabled = true;
  $('source-title').textContent = 'Loading Markdown…'; $('source-content').textContent = '';
  const result = await api<{ name: string; text: string; bytes: number }>('/api/source?' + new URLSearchParams({ file: id, source }));
  if (request !== sourceRequest || !signedIn) return;
  reading = { id, source, name: result.name };
  $('source-title').textContent = result.name;
  $('reader-origin').textContent = source === 'upload' ? 'Uploaded copy' : 'Synced folder';
  $('source-details').textContent = `${Math.max(1, Math.round(result.bytes / 1024))} KB · Markdown source · Convert to preview rendered diagrams and formatting.`;
  $('source-content').textContent = result.text;
  $('source-content').scrollTop = 0;
  $<HTMLButtonElement>('convert-document').disabled = false;
  if (focusReader && matchMedia('(max-width: 800px)').matches) $('reader-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function uploadFiles(files: File[], folder = false): Promise<void> {
  if (uploadingFiles) throw new Error('Wait for the current upload to finish.');
  if (folder) files = files.filter(file => /\.(md|markdown|png|jpe?g|gif|webp)$/i.test(file.name) && !file.webkitRelativePath.split('/').some(part => part.startsWith('.')));
  if (!files.length || files.length > 110) throw new Error('Choose Markdown documents and optional images (110 files maximum).');
  let documents = 0, images = 0, bytes = 0;
  for (const file of files) {
    const markdown = /\.(md|markdown)$/i.test(file.name);
    if (!markdown && !/\.(png|jpe?g|gif|webp)$/i.test(file.name)) throw new Error('Choose only Markdown or PNG/JPEG/GIF/WebP images. Use Choose folder for directories.');
    if (file.size > (markdown ? 2 : 10) * 1024 * 1024) throw new Error('Markdown files must be at most 2 MiB; images at most 10 MiB.');
    if (markdown) documents++; else images++;
    bytes += file.size;
  }
  if (!documents || documents > 10 || images > 100 || bytes > 30 * 1024 * 1024) throw new Error('Choose 1–10 Markdown files and up to 100 images, at most 30 MiB total.');
  uploadingFiles = true; $('upload-status').textContent = 'Uploading copies…';
  try {
    const payload = [];
    for (const file of files) {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read a selected file.')); reader.readAsDataURL(file);
      });
      payload.push({ path: folder ? file.webkitRelativePath || file.name : file.name, data });
    }
    const result = await api<LibraryListing>('/api/uploads', { files: payload });
    if (!signedIn) return;
    $<HTMLSelectElement>('source-mode').value = 'upload';
    desiredDirectory = ''; selected.clear();
    for (const entry of result.entries) selected.add(entry.id);
    await loadDirectory(''); updateSelection();
    $('upload-status').textContent = `Uploaded ${result.entries.length} document${result.entries.length === 1 ? '' : 's'}. Originals unchanged.`;
    if (result.entries[0]) await readMarkdown(result.entries[0].id, 'upload', true);
  } finally { uploadingFiles = false; }
}
function updateSelection(): void {
  $('selection-count').textContent = selected.size ? `${selected.size} file${selected.size === 1 ? '' : 's'} selected` : 'No files selected';
  $('clear-selection').hidden = !selected.size;
  $('selected-names').textContent = [...selected].map(id => currentSource() === 'upload' ? id.split('/').slice(1).join('/') : id).join(' · ');
  $<HTMLButtonElement>('publish').disabled = !selected.size;
}
function renderFiles(): void {
  const filter = $<HTMLInputElement>('filter').value.toLocaleLowerCase();
  const container = $('file-list'); container.replaceChildren();
  for (const entry of listing.entries.filter(value => value.name.toLocaleLowerCase().includes(filter))) {
    const source = currentSource();
    if (entry.kind === 'directory') {
      const button = element('button', undefined, 'folder-row');
      button.dataset.entryId = entry.id;
      const pinned = entry.availability === 'pinned';
      const icon = element('span', pinned ? '✓' : entry.availability === 'pinned-pending' ? '↓' : '▱', 'folder-icon'); icon.setAttribute('aria-hidden', 'true');
      const text = element('span', entry.name, 'file-name');
      text.append(element('span', entryMetadata(entry), pinned ? 'file-meta offline-pin' : 'file-meta'));
      button.append(icon, text, element('span', '›', 'folder-arrow'));
      button.addEventListener('click', () => { void loadDirectory(entry.id).catch(notice); }); container.append(button);
    } else {
      const label = element('label', undefined, 'file-row');
      label.dataset.entryId = entry.id;
      const input = element('input'); input.type = 'checkbox'; input.dataset.fileId = entry.id; input.checked = selected.has(entry.id);
      input.addEventListener('change', () => {
        if (input.checked && selected.size >= 10) { input.checked = false; notice('Select up to 10 files per conversion batch.'); return; }
        if (input.checked) { selected.add(entry.id); void readMarkdown(entry.id, source).catch(notice); } else selected.delete(entry.id); updateSelection();
      });
      const text = element('span', entry.name, 'file-name');
      text.append(element('span', `${Math.max(1, Math.round((entry.bytes || 0) / 1024))} KB · ${entryMetadata(entry)}`, 'file-meta'));
      const read = element('button', 'Read', 'read-file'); read.dataset.read = entry.id;
      read.setAttribute('aria-label', `Read ${entry.name}`);
      read.addEventListener('click', () => { void readMarkdown(entry.id, source, true).catch(notice); });
      const row = element('div', undefined, 'document-row'); label.append(input, text); row.append(label, read); container.append(row);
    }
  }
  if (!container.children.length) container.append(element('p', filter ? 'No filenames match your filter.' : 'No Markdown files in this folder.', 'empty'));
}
async function loadDirectory(directory: string, resetFilter = true): Promise<void> {
  const request = ++directoryRequest;
  desiredDirectory = directory;
  const preferences = sortPreferences();
  const params = new URLSearchParams({ directory, sort: preferences.sort, direction: preferences.direction, pinnedFirst: String(preferences.pinnedFirst) });
  let result: LibraryListing;
  try { result = await api<LibraryListing>((currentSource() === 'upload' ? '/api/uploads?' : '/api/library?') + params); }
  catch (error) {
    if (request === directoryRequest) desiredDirectory = listing.directory;
    throw error;
  }
  if (request !== directoryRequest || !signedIn) return;
  listing = result;
  const uploaded = currentSource() === 'upload';
  $('source-label').textContent = uploaded ? 'Uploaded copies on the service laptop' : libraryLabel;
  $('pin-options').hidden = uploaded;
  const breadcrumbs = $('breadcrumbs'); breadcrumbs.replaceChildren();
  const home = element('button', uploaded ? 'Uploads' : 'Library'); home.addEventListener('click', () => { void loadDirectory('').catch(notice); }); breadcrumbs.append(home);
  let current = '';
  for (const part of listing.directory.split('/').filter(Boolean)) {
    current += (current ? '/' : '') + part; const target = current;
    const button = element('button', part); button.addEventListener('click', () => { void loadDirectory(target).catch(notice); });
    breadcrumbs.append(element('span', '›'), button);
  }
  if (resetFilter) $<HTMLInputElement>('filter').value = ''; renderFiles();
}
const states: Record<string, string> = { queued: 'Queued', running: 'Converting', cancelling: 'Cancelling', cancelled: 'Cancelled', ready: 'Ready', failed: 'Failed', interrupted: 'Interrupted' };
function renderJobs(jobs: Job[]): void {
  const root = $('job-list'); root.replaceChildren();
  if (!jobs.length) { root.append(element('p', 'Your converted documents will appear here.', 'empty')); return; }
  for (const job of jobs) {
    const card = element('article', undefined, 'job-card'); card.dataset.state = job.state;
    const heading = element('div', undefined, 'job-heading'), title = element('div', undefined, 'job-title');
    const sourcePath = job.source === 'upload' ? `Uploaded · ${job.file.split('/').slice(1).join('/')}` : job.file;
    title.append(element('h3', job.name), element('p', `${job.format.toUpperCase()} · ${sourcePath}`, 'job-path'));
    heading.append(title, element('span', states[job.state] || job.state, `badge state-${job.state}`)); card.append(heading);
    if (job.error) card.append(element('p', job.error, 'job-error'));
    if (job.result) card.append(element('p', `${Math.round(job.result.bytes / 1024)} KB · ${job.result.diagrams} diagram${job.result.diagrams === 1 ? '' : 's'}`, 'job-description'));
    for (const warning of job.result?.warnings || []) card.append(element('p', warning, 'job-description'));
    const actions = element('div', undefined, 'job-actions');
    if (job.state === 'ready') {
      const preview = element('button', 'Preview'); preview.dataset.preview = job.id;
      preview.addEventListener('click', () => {
        $('preview-title').textContent = job.name;
        $<HTMLIFrameElement>('preview-frame').src = `/api/jobs/${job.id}/preview`;
        $<HTMLDialogElement>('preview-dialog').showModal();
      });
      const download = element('a', 'Download', 'button-link'); download.href = `/api/jobs/${job.id}/download`; download.dataset.download = job.id;
      const send = element('button', job.delivery.state === 'submitted' ? 'Submitted' : job.delivery.state === 'submitting' ? 'Submitting…' : 'Send to Kindle', 'primary'); send.dataset.send = job.id;
      send.disabled = !emailAvailable || ['submitted', 'submitting'].includes(job.delivery.state);
      send.title = emailAvailable ? 'Submit to your configured Kindle email address' : 'Email is not configured on the host; download is available.';
      send.addEventListener('click', () => {
        const retry = job.delivery.state === 'unknown';
        if (retry && !confirm('The previous submission is unconfirmed. Check your Kindle/email library first. Submit again?')) return;
        send.disabled = true;
        void api(`/api/jobs/${job.id}/send`, { retry }).then(() => refreshJobs(true)).catch(error => { send.disabled = false; notice(error); });
      });
      actions.append(preview, download, send);
    } else if (['queued', 'running', 'cancelling'].includes(job.state)) {
      const cancel = element('button', 'Cancel'); cancel.disabled = job.state === 'cancelling';
      cancel.addEventListener('click', () => { cancel.disabled = true; void api(`/api/jobs/${job.id}/cancel`, {}).then(() => refreshJobs(true)).catch(notice); }); actions.append(cancel);
    }
    if (job.delivery.state === 'submitted') card.append(element('p', 'Submitted to SMTP. Kindle delivery is not yet confirmed.', 'job-description'));
    if (job.delivery.error) card.append(element('p', job.delivery.error, 'job-error'));
    card.append(actions); root.append(card);
  }
}
async function refreshJobs(force = false): Promise<void> {
  if (!signedIn || polling) return; polling = true;
  try {
    const { jobs } = await api<{ jobs: Job[] }>('/api/jobs'); const serialized = JSON.stringify(jobs);
    if (force || serialized !== previousJobs) { renderJobs(jobs); previousJobs = serialized; }
  } finally { polling = false; }
}
async function openLibrary(): Promise<void> {
  const status = await api<{ sourceConfigured: boolean; sourceLabel: string; emailAvailable: boolean }>('/api/status');
  signedIn = true; emailAvailable = status.emailAvailable;
  $('login-panel').hidden = true; $('workspace').hidden = false; $('library-panel').hidden = false;
  $('logout').hidden = false; $('privacy-note').hidden = false; $('notice').hidden = true;
  libraryLabel = status.sourceLabel || 'No synced folder configured';
  updateSelection();
  $('email-note').textContent = emailAvailable ? 'Preview, download, or submit a copy to your Kindle email.' : 'Downloads are ready to use. Email stays off until configured on the host.';
  if (!status.sourceConfigured) $<HTMLSelectElement>('source-mode').value = 'upload';
  await loadDirectory('');
  await refreshJobs(true);
}
async function login(token: string): Promise<void> { await api('/api/session', { token }); $<HTMLInputElement>('token').value = ''; await openLibrary(); }
$('login-form').addEventListener('submit', event => { event.preventDefault(); void login($<HTMLInputElement>('token').value.trim()).catch(notice); });
$('logout').addEventListener('click', () => { void api('/api/logout', {}).then(() => { selected.clear(); previousJobs = ''; showLogin(); }).catch(notice); });
$('filter').addEventListener('input', renderFiles);
$('source-mode').addEventListener('change', () => { desiredDirectory = ''; selected.clear(); updateSelection(); void loadDirectory('').catch(notice); });
$('wrap-source').addEventListener('change', () => { $('source-content').classList.toggle('no-wrap', !$<HTMLInputElement>('wrap-source').checked); });
$('choose-files').addEventListener('click', () => $<HTMLInputElement>('upload-files').click());
$('choose-folder').addEventListener('click', () => $<HTMLInputElement>('upload-folder').click());
for (const id of ['upload-files', 'upload-folder']) $(id).addEventListener('change', () => {
  const input = $<HTMLInputElement>(id), files = [...(input.files || [])]; input.value = '';
  if (files.length) void uploadFiles(files, id === 'upload-folder').catch(error => { $('upload-status').textContent = 'Upload failed.'; notice(error); });
});
$('upload-zone').addEventListener('dragover', event => { event.preventDefault(); $('upload-zone').classList.add('drag-over'); });
$('upload-zone').addEventListener('dragleave', () => $('upload-zone').classList.remove('drag-over'));
$('upload-zone').addEventListener('drop', event => {
  event.preventDefault(); $('upload-zone').classList.remove('drag-over');
  if ([...(event.dataTransfer?.items || [])].some(item => item.webkitGetAsEntry?.()?.isDirectory)) { notice('For folders, use Choose folder to preserve image paths.'); return; }
  void uploadFiles([...(event.dataTransfer?.files || [])]).catch(error => { $('upload-status').textContent = 'Upload failed.'; notice(error); });
});
$('convert-document').addEventListener('click', () => {
  if (!reading) return;
  const button = $<HTMLButtonElement>('convert-document'); button.disabled = true;
  void api('/api/jobs', { files: [reading.id], source: reading.source, format: $<HTMLSelectElement>('format').value })
    .then(() => refreshJobs(true)).catch(notice).finally(() => { button.disabled = !reading; });
});
for (const id of ['sort-by', 'sort-direction', 'pinned-first']) $(id).addEventListener('change', () => {
  try { localStorage.setItem(sortStorageKey, JSON.stringify(sortPreferences())); } catch {}
  void loadDirectory(desiredDirectory, false).catch(notice);
});
$('refresh').addEventListener('click', () => { void loadDirectory(desiredDirectory).catch(notice); });
$('clear-selection').addEventListener('click', () => { selected.clear(); updateSelection(); renderFiles(); });
$('publish').addEventListener('click', () => {
  const button = $<HTMLButtonElement>('publish'); button.disabled = true; $('notice').hidden = true;
  void api('/api/jobs', { files: [...selected], source: currentSource(), format: $<HTMLSelectElement>('format').value })
    .then(async () => { selected.clear(); updateSelection(); renderFiles(); await refreshJobs(true); })
    .catch(error => { updateSelection(); notice(error); });
});
$('close-preview').addEventListener('click', () => { $<HTMLDialogElement>('preview-dialog').close(); $<HTMLIFrameElement>('preview-frame').src = 'about:blank'; });
setInterval(() => { if (signedIn) void refreshJobs().catch(notice); }, 1500);
const fragment = new URLSearchParams(location.hash.slice(1)).get('token');
if (location.hash) history.replaceState(null, '', location.pathname);
if (fragment) void login(fragment).catch(notice);
else void openLibrary().catch(() => showLogin());

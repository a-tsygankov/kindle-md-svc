import type { Job } from './jobs.js';
import type { LibraryListing } from './library.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const selected = new Set<string>();
let listing: LibraryListing = { directory: '', entries: [] };
let emailAvailable = false, signedIn = false, polling = false;
let previousJobs = '';

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
}
function updateSelection(): void {
  $('selection-count').textContent = selected.size ? `${selected.size} file${selected.size === 1 ? '' : 's'} selected` : 'No files selected';
  $('clear-selection').hidden = !selected.size;
  $('selected-names').textContent = [...selected].join(' · ');
  $<HTMLButtonElement>('publish').disabled = !selected.size;
}
function renderFiles(): void {
  const filter = $<HTMLInputElement>('filter').value.toLocaleLowerCase();
  const container = $('file-list'); container.replaceChildren();
  for (const entry of listing.entries.filter(value => value.name.toLocaleLowerCase().includes(filter))) {
    if (entry.kind === 'directory') {
      const button = element('button', undefined, 'folder-row');
      button.append(element('span', '▱', 'folder-icon'), element('span', entry.name, 'file-name'), element('span', '›', 'folder-arrow'));
      button.addEventListener('click', () => { void loadDirectory(entry.id).catch(notice); }); container.append(button);
    } else {
      const label = element('label', undefined, 'file-row');
      const input = element('input'); input.type = 'checkbox'; input.dataset.fileId = entry.id; input.checked = selected.has(entry.id);
      input.addEventListener('change', () => {
        if (input.checked && selected.size >= 10) { input.checked = false; notice('Select up to 10 files per conversion batch.'); return; }
        if (input.checked) selected.add(entry.id); else selected.delete(entry.id); updateSelection();
      });
      const text = element('span', entry.name, 'file-name');
      text.append(element('span', `${Math.max(1, Math.round((entry.bytes || 0) / 1024))} KB · Markdown`, 'file-meta'));
      label.append(input, text); container.append(label);
    }
  }
  if (!container.children.length) container.append(element('p', filter ? 'No filenames match your filter.' : 'No Markdown files in this folder.', 'empty'));
}
async function loadDirectory(directory: string): Promise<void> {
  listing = await api<LibraryListing>('/api/library?directory=' + encodeURIComponent(directory));
  const breadcrumbs = $('breadcrumbs'); breadcrumbs.replaceChildren();
  const home = element('button', 'Library'); home.addEventListener('click', () => { void loadDirectory('').catch(notice); }); breadcrumbs.append(home);
  let current = '';
  for (const part of listing.directory.split('/').filter(Boolean)) {
    current += (current ? '/' : '') + part; const target = current;
    const button = element('button', part); button.addEventListener('click', () => { void loadDirectory(target).catch(notice); });
    breadcrumbs.append(element('span', '›'), button);
  }
  $<HTMLInputElement>('filter').value = ''; renderFiles();
}
const states: Record<string, string> = { queued: 'Queued', running: 'Converting', cancelling: 'Cancelling', cancelled: 'Cancelled', ready: 'Ready', failed: 'Failed', interrupted: 'Interrupted' };
function renderJobs(jobs: Job[]): void {
  const root = $('job-list'); root.replaceChildren();
  if (!jobs.length) { root.append(element('p', 'Your converted documents will appear here.', 'empty')); return; }
  for (const job of jobs) {
    const card = element('article', undefined, 'job-card'); card.dataset.state = job.state;
    const heading = element('div', undefined, 'job-heading'), title = element('div', undefined, 'job-title');
    title.append(element('h3', job.name), element('p', `${job.format.toUpperCase()} · ${job.file}`, 'job-path'));
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
  $('source-label').textContent = status.sourceLabel || 'No source folder configured';
  $('email-note').textContent = emailAvailable ? 'Preview, download, or submit a copy to your Kindle email.' : 'Downloads are ready to use. Email stays off until configured on the host.';
  if (status.sourceConfigured) await loadDirectory(''); else notice('Configure a local source folder on the host, then restart the service.');
  await refreshJobs(true);
}
async function login(token: string): Promise<void> { await api('/api/session', { token }); $<HTMLInputElement>('token').value = ''; await openLibrary(); }
$('login-form').addEventListener('submit', event => { event.preventDefault(); void login($<HTMLInputElement>('token').value.trim()).catch(notice); });
$('logout').addEventListener('click', () => { void api('/api/logout', {}).then(() => { selected.clear(); previousJobs = ''; showLogin(); }).catch(notice); });
$('filter').addEventListener('input', renderFiles);
$('refresh').addEventListener('click', () => { void loadDirectory(listing.directory).catch(notice); });
$('clear-selection').addEventListener('click', () => { selected.clear(); updateSelection(); renderFiles(); });
$('publish').addEventListener('click', () => {
  const button = $<HTMLButtonElement>('publish'); button.disabled = true; $('notice').hidden = true;
  void api('/api/jobs', { files: [...selected], format: $<HTMLSelectElement>('format').value })
    .then(async () => { selected.clear(); updateSelection(); renderFiles(); await refreshJobs(true); })
    .catch(error => { updateSelection(); notice(error); });
});
$('close-preview').addEventListener('click', () => { $<HTMLDialogElement>('preview-dialog').close(); $<HTMLIFrameElement>('preview-frame').src = 'about:blank'; });
setInterval(() => { if (signedIn) void refreshJobs().catch(notice); }, 1500);
const fragment = new URLSearchParams(location.hash.slice(1)).get('token');
if (location.hash) history.replaceState(null, '', location.pathname);
if (fragment) void login(fragment).catch(notice);
else void openLibrary().catch(() => showLogin());

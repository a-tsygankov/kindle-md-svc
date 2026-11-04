# Project status

Updated: 2026-11-04. Integration branch: local `main`.

## Implemented

- Authenticated phone/desktop picker: browse local folders, filter names,
  multi-select Markdown, choose EPUB/PDF, track/cancel jobs, preview and download.
- Mermaid PNG rendering, local raster images, inert raw HTML, descriptive metadata
  whitelist, source snapshots/hashes, bounded resources and atomic publication.
- One conversion at a time, persisted job history, duplicate-basename isolation,
  restart recovery and explicit fixed-recipient SMTP submission with TLS.
- Email is disabled until configured; duplicate sends are guarded and uncertain
  submissions require explicit review/retry. SMTP acceptance is not delivery.
- Setup/build/configure/start/open/status/stop/doctor/reset/test utilities updated
  for the persistent service; the original proof remains an explicit mode.
- Markdown progress/handoff/operations/decision records and Mermaid diagrams.

## Verified

- TypeScript build and full suite: **38 passed, 0 failed/skipped**.
- Real Pandoc/Chromium conversion, hostile resources, nested fences, changed
  sources, bounds, source/junction containment, queue cancellation and recovery.
- Local SMTP capture checked MIME attachments, fixed recipient, duplicate clicks;
  no real email or private iCloud document conversion occurred during testing.
- Real browser at phone width: login, select, convert, sandboxed preview, download
  link, disabled email, no overflow or page errors. Desktop/mobile PNGs inspected.
- Windows PowerShell 5.1 recreation: setup/build, captured start returning while
  service stays running, authenticated browse/convert/download, stop and reset
  preview. Source/config preserved. PowerShell 7/npm entry points also exercised.
- Independent review findings fixed with failing-then-passing regressions: split
  UTF-8 filenames and malformed recovered records. Windows output-handle and
  concurrent atomic-write races were reproduced and corrected.

## Current host

The service was left running at `http://127.0.0.1:8787` after verification.
Public health returned 200 and unauthenticated library access returned 401.
Source remains configured in ignored local JSON. Use `scripts/status.ps1` for
live state and `scripts/start.ps1 -Open` to open it signed in. SMTP remains
disabled because no account/recipient was supplied.

## Remaining validation / limits

- Actual Scribe import, delivery, reading comfort and handwriting.
- Real SMTP-provider credentials/account behavior; only local capture was used.
- macOS execution and EPUBCheck. LAN requires explicit binding/firewall allowance;
  HTTP is intended for a trusted local network, not public hosting.
- Annotation sync back to Markdown is outside initial scope.
- Generated snapshots/exports are retained until reset; save wanted exports first.

The initial implementation is integrated on local `main`; nothing was pushed.
Generated tools, build, output, runtime state and config are ignored. The retained
recreation scratch copy remains in ignored `tmp/` after the earlier cleanup
approval rejection. See `git log -1` for the integrated commit.

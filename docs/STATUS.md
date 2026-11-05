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
- New EPUB/PDF title is the Markdown filename stem; author comes from service
  configuration (default/current host `AT`). Both override front matter.
- Picker sorts by natural name, modified/created timestamp, or file size in either
  direction; optional pinned-folders-first grouping. Browser remembers settings.
- Windows offline-pin/recall indicators distinguish retention intent from pending
  downloads; metadata-only checks, unknown fallback on unsupported/error states.

## Verified

- Latest TypeScript build and full suite: **45 passed, 0 failed/skipped**.
- Sorting, flag classification, real Windows metadata with Unicode names, and
  phone-width preference/selection persistence verified; screenshot inspected.
- Real EPUB/PDF metadata and configured author propagation through job workers
  verified, including conflicting front matter, Unicode and XML escaping.
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

The service is running with LAN binding (`0.0.0.0:8787`) in ignored local config.
Health and picker returned 200 through the laptop LAN IP. Existing Windows Node
firewall allow rules were found; no firewall settings changed. Phone connectivity
remains to be checked. Reserve the laptop IP in the router for a stable bookmark.
Source remains configured in ignored local JSON. Use `scripts/status.ps1` for
live state and `scripts/start.ps1 -Open` to open it signed in. SMTP remains
disabled because no account/recipient was supplied.

## Remaining validation / limits

- Actual Scribe import, delivery, reading comfort and handwriting.
- Real SMTP-provider credentials/account behavior; only local capture was used.
- macOS execution and EPUBCheck. LAN requires explicit binding/firewall allowance;
  HTTP is intended for a trusted local network, not public hosting.
- Annotation sync back to Markdown is outside initial scope.
- Pin badges show storage intent, not recursive sync-completion or upload state.
  macOS offline-pin detection is not implemented; it reports unknown status.
- Generated snapshots/exports are retained until reset; save wanted exports first.

The initial implementation is published on GitHub `main`; the user authorized
PR creation/checks/merge for follow-up metadata and picker work. See GitHub for
the current PR state; the branch is `codex/document-metadata-and-picker`.
Generated tools, build, output, runtime state and config are ignored. The retained
recreation scratch copy remains in ignored `tmp/` after the earlier cleanup
approval rejection. See `git log -1` for the integrated commit.

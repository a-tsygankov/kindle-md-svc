# Kindle Markdown Publisher

A local, on-demand Markdown publisher for Kindle Scribe. Browse locally synced
iCloud Drive or another folder, select documents, render Mermaid diagrams,
preview, and download EPUB/PDF or submit to a configured Send to Kindle email.

Generated document titles match the Markdown filename without its extension.
Author defaults to `AT`; change it with `scripts/configure.ps1 -Author 'Your name'`
and restart. These values override front matter and apply to new conversions.

The picker sorts by name, modified/created date, or file size, with optional
**Pinned folders first**. Windows iCloud offline pin settings have distinct icons
and labels. A pin indicates storage intent; it does not verify recursive sync
completion. Sort preferences are remembered in your browser.

## Start on Windows

```powershell
.\scripts\setup.ps1 -SourceDir '<your locally synced folder>'
.\scripts\start.ps1 -Open
```

The existing host already has a configured source folder, so setup can omit
`-SourceDir`. `start` builds and launches the web service; `-Open` opens a signed-in
browser window without printing the private access token. If already running,
`start -Open` reopens it. `scripts/open.ps1` also opens a running service.

```powershell
.\scripts\status.ps1
.\scripts\stop.ps1
.\scripts\doctor.ps1
.\scripts\test.ps1
```

Default address is `http://127.0.0.1:8787`. Access is token-protected. The token is
stored in ignored `.state/access-token`; the browser stores an HttpOnly session
cookie. Resetting generated state rotates the token. Keep the token private.

## Read and send

1. Open folders or filter filenames; select up to ten Markdown files per batch.
2. Choose EPUB for adjustable text or PDF for fixed diagrams/tables.
3. Convert. Each selected file becomes a separate document and a preview.
4. Preview and download, or use **Send to Kindle** after configuring SMTP.

Downloads can be uploaded through [Amazon Send to Kindle](https://www.amazon.com/sendtokindle).
Amazon converts EPUB; it is not a USB-native Kindle format. PDF imported through
Send to Kindle supports direct pen markup on Scribe; actual behavior still needs
validation on your device. This app does not synchronize annotations into Markdown.

## Use from a phone on your trusted LAN

```powershell
.\scripts\stop.ps1
.\scripts\configure.ps1 -ListenHost 0.0.0.0
.\scripts\start.ps1
```

Use the laptop's LAN IP and configured port on the phone; paste the host's private
access token at login. Windows may require allowing Node on the private network.
The laptop must be awake and files/images available locally. LAN HTTP is intended
for a trusted network; internet exposure requires an external TLS setup. Return
to local-only binding with `-ListenHost 127.0.0.1` and restart.

## Optional email

Email is off by default. Configure a fixed sender/recipient and your SMTP provider:

```powershell
.\scripts\configure.ps1 -SmtpHost '<provider SMTP host>' -SmtpPort 587 `
  -SmtpSecurity starttls -SmtpFrom '<approved sender email>' `
  -KindleEmail '<your Kindle email>' -SmtpUser '<SMTP username>' -EnableEmail
$env:KINDLE_SMTP_PASSWORD = '<provider app password>'
.\scripts\start.ps1 -Open
```

Stop an existing service before restarting with new settings/environment. The
sender must be approved in Amazon's personal-document settings. Use provider TLS
requirements; port 465 normally uses `-SmtpSecurity tls`. Password values stay in
an environment variable, never command-line configuration or committed files.

Success means **submitted to SMTP**, not delivered to Kindle. Double clicks do
not send twice. Unconfirmed/failed submissions require checking your library and
explicit retry. The default attachment cap is 20 MiB; download larger exports.
No real SMTP account or Kindle delivery has been tested yet.

## Reset and reproduce

```powershell
.\scripts\stop.ps1
.\scripts\reset.ps1 -WhatIf
.\scripts\reset.ps1
```

Default reset deletes all generated exports, snapshots, logs, token, and runtime
state, preserving original documents, local config, tools, packages, and build.
`-IncludeDependencies` also clears `node_modules` and `dist`; rerun setup afterward.
Source-overlap and redirected-root checks run before deletion. See the
[operations guide](docs/OPERATIONS.md) for recreation, diagnostics and macOS notes.

## Implementation and limits

- TypeScript HTTP service and plain browser UI, with Pandoc, Mermaid CLI API,
  Puppeteer/Chromium, and Nodemailer. No cloud backend, database, React, or LaTeX.
- Source files are read-only. Jobs snapshot referenced raster assets, check hashes,
  and publish artifacts only after conversion succeeds. Generated data can contain
  document copies and is ignored by Git; retain/delete it deliberately.
- Canonical source containment permits iCloud root reparse points while blocking
  escaped files and redirected output folders. Raw HTML is escaped, descriptive
  metadata is whitelisted, and browser/diagram external resource loads are blocked.
- PNG/JPEG/GIF/WebP inside the configured source are supported, including relative
  parent-folder references within that root. Remote images and SVG are rejected.
  Mermaid config directives/external image nodes are not supported initially.
- One conversion at a time; 20 pending jobs, 10 files per batch, 2 MiB Markdown,
  100 raster references, 20 diagrams, 25 MiB total embedded images (including
  repeated references), and a two-minute conversion limit.
- Outputs remain until reset; at most 1,000 retained jobs, with 200 shown in history.
  Failed/cancelled jobs can retain private working snapshots. Back up wanted
  exports before reset. Wide/tall diagrams may require zoom on the Scribe.
- Windows x64 bootstrap and Windows PowerShell 5.1/PowerShell 7 are verified.
  macOS execution, EPUBCheck, and actual Scribe delivery/notes remain unverified.

The original disposable experiment remains available via `scripts/proof.ps1`,
`npm run proof`, or `scripts/start.ps1 -Proof`. Legacy `start -Files ...` remains
one-shot proof mode; use the web UI to select files for the service.

Project records: [status](docs/STATUS.md), [progress](docs/PROGRESS.md),
[handoff](HANDOFF.md), [decisions](docs/DECISIONS.md), and
[conversion experiment findings](docs/conversion-proof.md).

Source is published to the [GitHub repository](https://github.com/a-tsygankov/kindle-md-svc).
Use `main` for integrated changes and pull requests for follow-ups. Local
configuration and generated files stay untracked.

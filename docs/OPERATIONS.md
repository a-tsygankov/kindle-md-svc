# Host operations

## Current commands

The default start command now launches the persistent web publisher. The original
conversion proof is an explicit mode. All commands resolve their own repository
location, and local settings stay in ignored `config.local.json`.

| Command | Behavior |
| --- | --- |
| `scripts/setup.ps1` | Provision pinned portable tools, locked packages/browser, build, initialize/preserve config, run doctor |
| `scripts/configure.ps1` | Update source, listener, tool overrides, and SMTP settings; never accept a password value |
| `scripts/start.ps1` | Build and start the service; wait for HTTP readiness |
| `scripts/start.ps1 -Open` | Start/open the service with token login; reopen it if already running |
| `scripts/open.ps1` | Open the running service without printing its token |
| `scripts/status.ps1` | Show mode, process state, URL, log path, and private token-file path (never the token value) |
| `scripts/stop.ps1` | Graceful shutdown, then bounded termination of the owned tree if necessary |
| `scripts/doctor.ps1` | Check source, tools, browser, build, latest run, and email configuration availability |
| `scripts/test.ps1` | Build and run all proof, host, service, local-SMTP, and browser tests |
| `scripts/reset.ps1 -WhatIf` | List validated reset targets without deleting anything |
| `scripts/reset.ps1` | Clear exports/runtime state, preserving source/config/tools/packages/build |
| `scripts/reset.ps1 -IncludeDependencies` | Also clear packages and build; rerun setup |
| `scripts/proof.ps1` | Run synthetic fixtures in the foreground |
| `scripts/start.ps1 -Proof` | Run the finite proof in the background |

## New Windows host

Transfer source, `package-lock.json`, `toolchain.json`, `tsconfig.json`, `assets/`,
`public/`, `src/`, `scripts/`, and `spike/` first. The implementation is integrated
on local `main` but has not been pushed; the empty remote alone does not yet
reproduce these files. Use the committed local source until it is published.

```powershell
.\scripts\setup.ps1 -SourceDir '<locally synced source folder>'
.\scripts\start.ps1 -Open
```

Bootstrap targets Windows x64 and works under Windows PowerShell 5.1 or PowerShell
7. It downloads checksum-pinned Node/Pandoc, uses `npm ci`, explicitly provisions
Puppeteer's matching Chrome, and builds TypeScript. No admin installation,
permanent PATH/execution-policy change, firewall rule, or OS service registration
is performed. It needs network access and space for tools/browser/packages.

Existing config is preserved and receives defaulted service fields. Use
`-SkipToolDownloads` to use existing portable/system tools; `-RepairTools`
re-extracts verified Node/Pandoc archives. Source-overlap checks run before tool
writes, including junction aliases, even before Node has been installed. Setup,
build and reset refuse an active managed or direct service.

Re-running setup is supported. It can replace dependencies; do not run it during
a foreground proof. If local policy blocks script execution, use a process
permitted by that policy rather than changing machine-wide policy for this app.

## Configuring the host

```powershell
.\scripts\configure.ps1 -SourceDir '<new source folder>'
.\scripts\configure.ps1 -ListenHost 127.0.0.1 -Port 8787
.\scripts\configure.ps1 -Show
.\scripts\configure.ps1 -PandocPath '<optional executable path>'
.\scripts\configure.ps1 -BrowserPath '<optional Chrome path>'
.\scripts\configure.ps1 -ClearSource
```

Source folders must exist. The synced root may be an iCloud reparse point; selected
files/resources must resolve inside it. Defaults/template are in
`config.example.json`. Malformed/unsupported config is refused rather than
replaced; partial SMTP updates preserve other settings. Restart for changes to
settings/environment; there is no live configuration reload.

`PANDOC_BIN` and `BROWSER_EXECUTABLE` environment overrides take precedence over
JSON. Tools otherwise discover local portable executables. The browser cache is
`.tools/puppeteer`, unless `PUPPETEER_CACHE_DIR` is explicitly overridden. Setup
provisions the repository cache; provision a separate override cache yourself.

## Authentication and phone access

The service generates `.state/access-token` on first startup. Only this file
contains the token; routine status/logs do not. `-Open` uses a URL fragment for
local login, which is not sent to the server and is removed from browser history
by the UI. The browser uses an HttpOnly SameSite=Strict session cookie afterward.
Sessions expire after 24 hours or a service restart. Reset rotates the token.

Default listener: `127.0.0.1:8787`. For a phone on a trusted LAN:

```powershell
.\scripts\stop.ps1
.\scripts\configure.ps1 -ListenHost 0.0.0.0
.\scripts\start.ps1
```

Browse to the laptop's LAN IP and configured port; enter the private token from
the host. Use an IP address rather than an arbitrary hostname. Allow Node on the
private Windows firewall network if required. The laptop must remain awake and
source/image files must be downloaded locally. LAN HTTP is not encrypted; use
only a trusted network, or provide an external HTTPS layer for remote exposure.
Return to local-only binding with `-ListenHost 127.0.0.1` and restart.

Private library/job/download/preview routes require auth. Host and Origin are
checked. Previews use script-disabled iframe/CSP sandboxing and embedded assets.
Source Markdown/metadata cannot execute scripts or supply filters/includes.

## Jobs and delivery

Browse folders, filter filenames, select up to 10 files, choose EPUB/PDF, and
convert. Each file has an isolated job ID, so duplicate basenames are safe. Preview
is self-contained HTML; download is the chosen format. Failed/cancelled jobs do
not expose partial artifacts. Source/resource changes during conversion fail
rather than silently mix versions. Originals are never rewritten.

One conversion runs at a time. Queue limit is 20; source limit 2 MiB; per-raster
limit 10 MiB; up to 100 raster references and 20 diagrams; embedded image budget
25 MiB including repeated references; timeout two minutes. External/SVG images and
Mermaid config directives/external image nodes are initially unsupported. Relative
image paths may traverse parent folders only while remaining inside source.

Email remains disabled until configured. Example (substitute provider values):

```powershell
.\scripts\stop.ps1
.\scripts\configure.ps1 -SmtpHost '<SMTP host>' -SmtpPort 587 `
  -SmtpSecurity starttls -SmtpFrom '<approved sender>' -KindleEmail '<Kindle email>' `
  -SmtpUser '<SMTP username>' -EnableEmail
$env:KINDLE_SMTP_PASSWORD = '<provider app password>'
.\scripts\start.ps1 -Open
```

Use `-SmtpPasswordEnv '<environment variable name>'` to change the variable name;
there is no password-value CLI field. TLS is required except explicitly selected
loopback-only `none` mode for local testing. Port 465 normally uses `tls`; 587
normally uses `starttls`. No SMTP credentials or Kindle address are supplied by
default. `-DisableEmail` disables future service runs after restart.

The sender must be approved in Amazon personal-document settings. The browser
cannot override the configured recipient or SMTP options. A 20 MiB attachment cap
is conservative; JSON can set `smtp.maxAttachmentBytes` from 1 KiB to 30 MiB. Your
provider may have a lower cap. Downloads can instead use Amazon Send to Kindle.

A successful SMTP result means submitted, not delivered. Repeated clicks are
blocked once submitting/submitted; create a new export if intentionally resending
an already submitted document. A failure or interrupted submission is unconfirmed:
check your library/inbox before explicit retry. There are no automatic resends.

## Runtime state and shutdown

`.state/run.json` tracks the managed supervisor and URL. `.state/logs/<run-id>.log`
contains service lifecycle output, not tokens or document contents. The standalone
service lock prevents another instance on the same repository. Windows launches
the supervisor through a hidden independent process to avoid PowerShell 5 output
handle inheritance holding start open. Stop uses run-specific cancellation and
only live owned children, never an arbitrary persisted PID.

Stop first requests graceful shutdown: close listener, cancel queued/running work,
and finish bounded in-flight delivery where possible. After seven seconds the
supervisor can terminate its owned tree. Restart marks interrupted conversions
and unconfirmed submissions; it never silently resumes an email.

Status can be starting/running/stopping/completed/failed/stopped or stale.
Completed applies to proof jobs; service exit without a stop request is failure.
After laptop wake, allow heartbeat recovery before diagnosing stale state. Inspect
logs/processes for a genuinely stale supervisor. It cannot authorize arbitrary
process killing. A dead-owner operation lock can be recovered by reset; a live
owner needs inspection.

## Reset / recreation / retention

```powershell
.\scripts\stop.ps1
.\scripts\reset.ps1 -WhatIf
.\scripts\reset.ps1
```

Default deletion: **all** `output/` and `.state/`, including exports, snapshots,
history, logs, token and cookies' server state. Preserved: source documents,
`config.local.json`, `.tools/`, `node_modules/`, `dist/`, code and documentation.
Back up wanted outputs/logs first. Failed jobs may retain private snapshots.

```powershell
.\scripts\reset.ps1 -IncludeDependencies -DryRun
.\scripts\reset.ps1 -IncludeDependencies
.\scripts\setup.ps1 -SkipToolDownloads
```

Dependency reset also clears `dist/`; normal start builds when dependencies exist.
All fixed reset targets are preflighted before deletion; junctions/source overlaps
are refused. No `git clean` or arbitrary user-configured recursive deletion occurs.
Full `.tools` removal requires explicit `node scripts/host.mjs reset --dependencies
--tools` from supported Node outside `.tools/` (preview with `--dry-run` first).
The utility refuses to delete the runtime it is executing. Repair normally uses
`setup -RepairTools` instead.

There is no automatic job expiry: retain up to 1,000 jobs and show the latest 200
in the UI. Use deliberate backup/reset for retention. The existing ignored host
recreation test copy remains in `tmp/` because earlier automatic approval review
blocked its cleanup; do not retry that deletion through another mechanism.

## Verification and macOS

```powershell
.\scripts\stop.ps1
.\scripts\test.ps1
.\scripts\doctor.ps1
.\scripts\proof.ps1
python spike/verify_outputs.py
```

Test builds and runs original proof/host checks plus service conversion, local
SMTP capture, HTTP/auth, restart/cancel, and a real phone-width browser. No private
iCloud documents or real email accounts are used. PDF inspection requires PyMuPDF
(or `uv run --with pymupdf python spike/verify_outputs.py`). Actual Kindle import,
handwriting and EPUBCheck remain separate, unverified checks.

On macOS (unverified), install supported Node LTS/Pandoc, set
`PUPPETEER_CACHE_DIR="$PWD/.tools/puppeteer"`, run `npm ci`,
`node node_modules/puppeteer/install.mjs`, `npm run build`, then configure/start:

```sh
npm run configure -- --source="<synced source folder>"
npm start
npm run status
npm stop
```

Open the reported URL and enter the token from private state. POSIX process groups
are used there, but macOS execution/fonts have not been tested. Windows ZIP
bootstrap is not used on macOS. Transfer source/lockfile/manifest/docs, recreate
tools/packages/build, and configure the new host's paths rather than transferring
stale absolute paths or generated state. Credentials are supplied separately.

Maintain progress/status/decisions/handoff alongside script/config changes, using
Markdown and Mermaid where helpful, as required by `AGENTS.md`.

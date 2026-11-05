# Progress log

Append dated entries for meaningful work, decisions, commands/check outcomes,
failures, and next steps. Do not put secrets or private document contents here.

## 2026-11-04 - Requirements and tool assessment

- Read the prior chat and confirmed the existing repository was empty.
- User clarified Windows 11 first, later macOS; local iCloud source; multi-file
  selection; Mermaid; on-demand delivery to a first-generation Scribe; notes
  optional. A general local source folder must also work.
- Compared Node/TypeScript, Python, Java, Pandoc, Mermaid CLI, Chromium, Quarto,
  Calibre, and md-to-pdf. Recommended a small TypeScript orchestrator around
  existing tools instead of a Java service. Quarto was researched, not benchmarked.
- Confirmed the user's synced folder exists. Its actual path remains local data,
  not a committed application default.

## 2026-11-04 - Conversion proof

- User approved a conversion proof before the picker/delivery implementation.
- Downloaded checksum-verified portable Node 26.13.0 and Pandoc 3.13 into `.tools/`.
  Installed pinned Mermaid CLI 12.2.0 and Puppeteer 25.16.0 with a matching browser.
- Implemented a disposable CLI experiment and two synthetic fixtures. No private
  iCloud files were copied or changed; nothing was sent to Amazon or SMTP.
- Used Pandoc AST traversal to preserve nested literal fences. Embedded five
  diagram PNGs and one local PNG across two EPUBs and two PDFs.
- Found a low-resolution Mermaid viewport issue; regression test failed before
  fixing viewport/device scale. Full suite then passed: 4/4 tests.
- `python spike/verify_outputs.py`: both EPUB resource checks and PDF checks passed.
  Nine final PDF pages were rendered and visually reviewed. Extreme diagram aspect
  ratios remain a readability limitation and are reported for review.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- Recorded findings in `docs/conversion-proof.md`. Actual Scribe import and notes,
  EPUBCheck, macOS, picker, and SMTP remain unverified/unimplemented as applicable.

## 2026-11-04 - Host operations and durable records

- User requested all progress in docs/handoff and maintained utilities for new-host
  setup, configuration, start/stop, and reset.
- Added `AGENTS.md` working agreement, status/progress/decision/handoff structure,
  design, and implementation plan. Executing inline in the existing feature branch.
- Design choice: lifecycle manages only the finite conversion proof today. Future
  service changes must update the same scripts and documentation in the same change.
- Reset will preserve source and configuration by default, validate all targets
  before deletion, and require separate flags for dependencies and tools.
- Implemented shared Node config/tool discovery, diagnostics, finite job
  supervisor, status, cancellation, and safe managed-root reset. Added PowerShell
  setup/configure/doctor/start/status/stop/reset/test commands and updated the
  proof/npm entry points to share configuration. `toolchain.json` pins bootstrap
  versions/checksums; setup provisions `.tools/puppeteer` rather than Codex caches.
- The user's real source location is stored in ignored local config. No private
  documents were converted or sent. All lifecycle tests use synthetic files.
- Config/reset and lifecycle tests failed before implementation, then passed.
  Null-character config updates were separately reproduced/fixed without changing
  existing settings. Tests cover future/malformed schemas, spaces, containment,
  source/config preservation, dry-run, owned descendants, stale state, and refusal
  of concurrent start/reset.
- Fresh Windows PowerShell 5.1 setup in a source-only copy downloaded tools and
  packages/browser, converted a selected document, and passed reset checks.
  Dependency reset followed by setup recreated a working system while preserving
  config byte-for-byte and retaining source documents.
- Real Chrome cancellation exposed OS descendant termination diagnostics and a
  terminal-state acknowledgement race. Failures were recorded before fixes.
  The supervisor waits for its owned root to exit; stop allows its bounded
  acknowledgement window across transient stale reads. A deterministic regression
  failed first, then passed. Five additional real-Chromium stop checks passed.
- Independent read-only review found three source-protection gaps: setup overlap
  checks after bootstrap writes, generated state inside the source, and redirected
  runs/log subfolders. Added four failing regressions and fixed all findings.
  Bootstrap now resolves canonical Windows paths before tool/lock writes even
  without Node installed. Start validates roots and generated subfolders first.
- Final `npm test`: **20 passed, 0 failed/skipped**. All twenty tests also passed
  in the recreated host using Windows PowerShell 5.1. Root PowerShell 7 checks,
  doctor, and reset dry-run passed. All PowerShell scripts parse successfully.
- `scripts/proof.ps1` and `python spike/verify_outputs.py` passed after integration.
  npm setup/audit reported zero known vulnerabilities. Local config/tools/state
  are confirmed git-ignored, including interrupted config-write temp files.
- Docs/handoff updated. Cleanup of the verified disposable recreation copy was
  rejected by automatic approval review, with no specific reason beyond policy
  blocking. The ignored copy remains under `tmp/`, identified by ignored
  `tmp/host-validation.json`; process inspection found no test processes running.
  No alternate deletion method was attempted after the literal-path cleanup was
  also blocked. Original proof exports and source/config are retained.
- No commits/pushes were made. Picker/HTTP/SMTP, macOS execution, EPUBCheck, and
  actual Scribe reading/handwriting remain pending.

## 2026-11-04 - Documentation format preference

- User requested Markdown documentation/handoffs with Mermaid when needed.
- Recorded the rule in `AGENTS.md`, decisions, status, and handoff. Added an
  editable Mermaid diagram of the implemented conversion path; planned picker
  and delivery features remain explicitly separate from current behavior.
- Documentation-only update; application behavior and configuration unchanged.
- Verified the handoff diagram renders with the installed Mermaid/Chromium
  pipeline. No application tests were needed for this documentation-only change.

## 2026-11-04 - Publishing service implementation

- User authorized the next service stage. Reviewed handoff, repository rules,
  proof and host utilities. No managed run was active at the start.
- Saved service design and execution plan in Markdown. Continuing with TypeScript,
  plain browser UI, existing publishing engines, default localhost/token auth,
  selected-file jobs, and disabled-by-default fixed-recipient SMTP.
- Tests use synthetic libraries and a local SMTP capture fixture. No real email
  will be sent or private iCloud documents converted as part of verification.
- Implemented defaulted schema-1 service/SMTP configuration and strict validation;
  old config keeps source/tool values. Added TypeScript/Nodemailer and pinned
  development types/compiler, updating the lockfile. No source path/secrets were
  added to tracked defaults.
- Added source library, production snapshot converter, per-job subprocess, bounded
  persisted queue, token/session HTTP API, sandboxed preview, responsive picker,
  EPUB/PDF download, cancellation/recovery, and fixed-recipient SMTP submission.
- Real converter tests exposed Pandoc Raw AST nodes surviving the reader flag;
  explicitly escape Raw nodes and whitelist metadata. External/escaped assets,
  Mermaid config/images, active includes and resource overuse are rejected. Source
  hashes detect changes before atomic publication. Repeated images count against
  the embedded byte/reference budget; its regression failed before the limit fix.
- Local SMTP capture validated MIME, buffered attachment, fixed recipient and
  concurrent-click suppression. No actual SMTP account, Amazon service, or private
  iCloud conversion was involved. Submission is distinct from device delivery.
- Phone-width browser flow passed after preserving the preview sandbox and
  polling its inert document from the test host (its script callbacks cannot run).
  Desktop/mobile screenshots were inspected: no overflow, missing controls, or
  page-script errors. No sandbox permissions were weakened for testing.
- Independent read-only review found split UTF-8 body decoding and malformed saved
  job records. Treated as correctness issues because they reject valid filenames
  or break history. Both regressions failed first and pass after fixes. No review
  findings were deferred; macOS/real-device/provider checks remain explicit limits.
- Windows PowerShell 5.1 recreation installed packages/browser and built the new
  service. Its captured startup revealed inherited handles keeping the command
  waiting while HTTP was already healthy. Added a failing captured-start test and
  switched Windows launch to a hidden independent process with explicit child log
  handles; the command now returns promptly and readiness/stop checks pass.
- Concurrent job-state updates during shutdown exposed Windows EPERM rename
  collisions. A 60-write ordering regression reproduced the failure; per-file
  serialization and bounded transient retries now preserve valid ordered state.
- Final full suite via `scripts/test.ps1`: **38 passed, 0 failed/skipped**, including
  the original proof/host tests. TypeScript build passed. Synthetic recreated-host
  checks passed for setup/build, captured start, authenticated browse/convert/
  download, graceful stop, and reset preview. Source/config remained intact.
- Updated setup/configure/start/open/status/stop/doctor/reset/test behavior and
  Markdown documentation/handoff, with the implemented service Mermaid flow.
  The retained scratch copy was reused; no blocked cleanup action was retried.
- Actual Kindle import/handwriting, real SMTP-provider behavior, EPUBCheck, and
  macOS execution are still unverified. Source remains local/uncommitted/unpushed.
- Final checks: all PowerShell scripts parsed, npm audit reported zero
  vulnerabilities, and both current documentation Mermaid diagrams rendered.
  PowerShell 5.1 listener/SMTP configuration round-tripped in the synthetic copy,
  with email disabled again and no SMTP connection attempted there.
- Left the real host service running on the default loopback URL. Health returned
  200; anonymous library access returned 401. The user's source configuration is
  unchanged and real-host email remains disabled. Use `start.ps1 -Open` to open
  the running picker signed in without printing the token.

## 2026-11-04 - Initial repository integration

- User requested merging the work into the repository. Git inspection confirmed
  an unborn feature branch, no local main, and no heads on the configured remote.
- Integration initializes local `main` from the verified initial implementation
  commit; there is no existing main history requiring a merge commit.
- Stopped the service for build/test verification. Full pre-integration suite
  passed 38/38 with no failures/skips. Source candidates were checked against the
  actual local source path and token without printing either; no matches found.
- Only source, tests, static assets, manifests, and Markdown docs are included.
  Config, token/state, tools, packages, compiled output and scratch stay ignored.
- Integration is local only. No push, force update, scratch deletion, or private
  document conversion is part of this operation. Current commit is available via
  `git log -1`; service is restored after merged-tree verification.
- Initial source commit: `6d33437` (`feat: add local Markdown publishing service
  for Kindle Scribe`). Initialized local `main` at that commit and verified the
  integrated tree: **38/38 tests passed**, no failures/skips. Documentation records
  the integration, and the fully integrated temporary feature branch is removed.
- The empty remote has no main ref, so its stale local upstream association is
  cleared until an explicit publish. Local config/token/source remain excluded.

## 2026-11-04 - Phone LAN access

- User requested a phone link, preferably stable. Changed ignored host config
  from loopback to `0.0.0.0`, then restarted through maintained lifecycle scripts.
- Health and picker returned HTTP 200 through the active Wi-Fi LAN IP from the
  laptop. Existing Node inbound allow rules cover Public/Private profiles; no
  firewall changes were made. Actual phone connectivity remains unverified.
- Documented router DHCP reservation for stable IP bookmarks. Arbitrary hostnames
  remain rejected by the existing Host check. No tokens or host IP/MAC values
  were recorded in tracked docs; no private files converted or emails sent.

## 2026-11-04 - Generated document identity

- User requested filename-based titles and configurable service author, initially
  `AT`, with maintained scripts. Title now uses the filename without its final
  extension; both title and author override front matter in preview/EPUB/PDF.
- Added validated `author` configuration, default/example `AT`, CLI `--author`,
  PowerShell `-Author`, TypeScript config and background worker propagation.
  Existing setup preserves config and gains the default through config loading.
- Added pinned pdf-lib 1.17.1 to set embedded PDF title/author before publication.
  Chromium still renders the pages. npm install audit: zero vulnerabilities.
- New tests failed first for missing author default and incorrect EPUB/PDF
  metadata. Final full build/suite: **41 passed, 0 failed/skipped**. Checks inspect
  real EPUB package and PDF metadata with Unicode/ampersands; worker integration
  verifies a custom service author. Tests require no new external Python tools.
- Applied `AT` with the real PowerShell configure script, preserving source/LAN/
  SMTP settings. Configure script parsed successfully; git diff check passed.
  Existing exports retain old metadata; create new conversions after restart.
- Automatic approval review rejected a combined edit/verification command without
  a stated reason. Small explicit file patches and separate checks succeeded.
- Changes remain in the local main working tree; no push, real email submission,
  or private document conversion performed.

## 2026-11-04 - Picker sorting and Windows iCloud pin indicators

- User requested sorting and identifying folders configured for full local
  retention. Added natural-name, modified/created timestamp and file-size sorting
  in either direction. Directories remain first; optional pinned-folders-first
  precedes the chosen ordering. Missing values sort last; selections persist and
  browser sort preferences survive reload. Stale listing responses are discarded.
- Read Windows filesystem pin/unpin/recall flags through a bounded, metadata-only
  PowerShell adapter. Explicit pinned and pinned/pending icons distinguish offline
  storage intent from on-demand/download-needed states. Unknown on errors/macOS.
  No recursive audit, download, pin changes, or upload-completion claim.
- Actual iCloud root metadata showed three explicitly pinned directories. Only
  aggregate counts were inspected; no private contents or names recorded here.
- Tests failed first for missing sorting/status support and absent picker controls.
  Final build/full suite: **45 passed, 0 failed/skipped**. Real Windows metadata
  adapter test includes Unicode/punctuation names; phone browser test covers
  grouping, labels, order, persisted controls, retained selections and no overflow.
  `output/ui-sorting-mobile.png` was visually inspected. git diff check passed.
- Documented labels, timestamp/size semantics, provider limits and File Explorer
  pin workflow. Source remains read-only; no real email or private conversion.
  Changes stay in the local main working tree, uncommitted/unpushed.
- Restarted the real service with existing LAN/source/author settings. Authenticated
  LAN library request using modified-descending/pinned-first returned HTTP 200,
  all entries had timestamps, and directory status totals were 3 pinned/54 with
  no explicit pin. LAN health returned 200. No names or token printed by the check.

## 2026-11-04 - Publish, review and PR integration

- User authorized creating a PR, checking and merging. The GitHub repository was
  empty, so published the existing local main baseline `f847ac8` first; follow-up
  work is isolated on `codex/document-metadata-and-picker`, targeting main.
- Pre-publication scan checked all 67 source files against the actual configured
  source path and token; no matches, no config/runtime/generated roots included.
  Production dependency audit found zero vulnerabilities; all PowerShell scripts
  parsed and whitespace checks passed. Initial fresh full suite passed 45/45.
- Independent read-only review found one important navigation/sort race and no
  other critical/important findings. A delayed-folder browser regression failed
  before the fix. Sorting and refreshing now use the desired navigation target,
  reverting it to the displayed folder when the latest request fails.
- After the race fix, the full build/suite passed **45/45**, including the new
  delayed-navigation regression. No test failures or skips remain.
- Published commit `ee8c641` and created
  [PR #1](https://github.com/a-tsygankov/kindle-md-svc/pull/1). GitHub reported
  clean/mergeable with no hosted status checks configured. Reviewer independently
  repeated the delayed-navigation scenario and confirmed the fix; no remaining
  critical/important findings. User has authorized merge. The PR page records the
  authoritative merge result/SHA; synchronize main before the next development task.

## 2026-11-04 - Remember browser sign-in

- PR #1 merged as `9e38c42`. Synced main and verified 45 tests again; service
  restarted with LAN health 200 before this follow-up began.
- User requested remembering devices after entering the access token. Replaced
  ephemeral 24-hour sessions with 365-day persistent HttpOnly/SameSite cookies,
  renewed daily with use. Store only token-bound credential hashes/expiries in
  ignored `.state/device-sessions.json`; no access token in browser localStorage.
- Service/browser restarts preserve sign-in. Signout revokes one browser durably;
  reset or token rotation/restart invalidates all. Bound records to 200 and state
  size to 128 KiB; corrupt/redirected state fails closed. Old memory-only sessions
  cannot be migrated, so one new token login is needed after upgrading.
- Regression failed first for old cookie expiry; new tests cover durable login,
  renewal/expiry, individual revocation, token rotation, corruption and a real
  persisted browser profile reopened with the service. Full suite passed 49/49.
- Independent review found repeated token-fragment Open actions could exhaust the
  device cap. A failing reuse regression reproduced it. Token login now reuses a
  valid current credential; HTTP/unit tests check repeated login returns the same
  browser credential. Source/config/exports remain untouched.
- Final build and 49/49 tests passed after credential reuse; reviewer verified the
  fix with no remaining critical/important findings. Follow-up uses the same
  PR/check/merge workflow as PR #1. No host paths, tokens or device records enter Git.
- Published `0545de8` and opened
  [PR #2](https://github.com/a-tsygankov/kindle-md-svc/pull/2). GitHub reported
  clean/mergeable with no hosted checks. The PR page records final merge state/SHA;
  source/config and device credentials remain separate from tracked code.

## 2026-11-04 - Mail-to-Kindle configuration and iOS workflow decision

- PR #2 merged as `786577b`; main synchronized and 49 tests passed after merge.
- User requested one/multiple mail-to-kindle recipients and default-client email
  with converted document attached. Supplied personal address is saved only in
  ignored local configuration; never in tracked docs/templates/tests.
- Added `mailToKindle` JSON string/array normalization, default empty list, max20,
  case-insensitive deduplication preserving first order, invalid/header-injection
  rejection, repeated CLI `--mail-to-kindle`, PowerShell `-MailToKindle`, and clear
  options. New regression failed first, then passed. Full build/suite: 50/50 pass.
- User asked what iOS mail clients support. Verified mailto recipient/subject/body
  via Apple/RFC documentation; attachments are unsupported in standard mailto.
  Web Share can pass files only in a secure context and does not set recipient.
  Current phone URL is HTTP. Asked user to choose a portable download/manual-attach
  panel versus HTTPS sharing. Configuration work is complete; dependent UI work
  remains pending. No actual mail client was launched and no message was sent.

## 2026-11-04 - Investigate desktop Send to Kindle

- User asked whether installed laptop sharing tools could support a single send
  action. Read-only inventories found no Kindle desktop sender/reader in standard
  install registries, Store packages, Start apps, common folders, App Paths,
  Explorer SendTo/context handlers or printers on this Windows host. Other laptops
  were not inspected. Nonstandard portable installations cannot be ruled out.
- Amazon's overview confirms desktop/mobile/email/web submission and EPUB/PDF
  support. Its legacy PC page shows Explorer/printing integration. No documented
  official unattended CLI/API was found; current download pages were blocked by
  503/bot checks. No installed binary exists here for argument/UI testing.
- Recorded evidence and limits in `docs/delivery-options.md`. A future host
  launcher could open a generated export, but confirmation on the laptop may
  remain necessary; no automatic-submission promise is supported by this check.
- Existing SMTP backend is the practical unattended phone-action route once
  provider/sender credentials and Kindle approval are configured. No software
  installed, accounts accessed, confirmation clicked, or message submitted.

## 2026-11-04 - Investigate sleep and propose bounded active window

- User deferred delivery-tool decisions and requested verification of apparent
  sleep prevention plus a reasonable approximately 30-minute service activity policy.
- Read-only powercfg query found active High performance plan: AC sleep Never,
  battery sleep 10 minutes, hibernation timeout disabled. Host supports connected
  S0 Modern Standby rather than S3. No power settings were changed.
- Active-power-request/wake-timer diagnostics require elevation and were unavailable
  in this session; no claim that all blockers are ruled out. No explicit power
  prevention calls found in service code; no conversion children running now.
- Identified unnecessary idle activity: supervisor writes every 200 ms and web
  clients poll every 1.5 seconds. Recorded proposal in `docs/power-management.md`:
  quiet listener, 30-minute meaningful-activity lease, bounded active-job protection,
  no renewal from polling/background tabs, lower heartbeat I/O, manual-sleep respect.
- Complete 30-minute idle exit is an optional tradeoff because the phone cannot
  restart a stopped listener without a host launcher. No lifecycle/power policy
  code implemented; delivery workflow remains deferred and no email was sent.

## 2026-11-04 - Desktop Markdown review and browser uploads

- User requested desktop visibility to read generated Markdown and convert it,
  explicitly including uploads/drag-and-drop from arbitrary Mac/Windows paths.
  Kept earlier recipient config/research changes intact on codex/desktop-workspace.
- Added bounded authenticated upload store/API, retained listing, and inert source
  read API. UTF-8 Markdown and raster files are copied atomically to managed output;
  safe portable paths, canonical roots, encoding and byte/count limits enforced.
  Folder picker preserves relative images; originals/cloud source stay unchanged.
- Explicit library/upload job source is persisted; conversion workers use the
  upload batch as resource root. Existing jobs remain compatible. Uploaded files
  work without configuring iCloud/sourceDir.
- Added wide desktop browser/reader, source wrap and Read/Convert, file/folder
  pickers, drop area, source switch, responsive cards and phone stacking. Internal
  upload UUIDs are omitted from user-facing selected names/job paths.
- Regression tests failed first for missing upload/source API and Read controls.
  Final build/full suite passed **57/57**, with real Mermaid/image EPUB uploads,
  source safety, portable-path/encoding/size rejection, retained imports, standalone
  conversion without sourceDir, body larger than ordinary JSON limit, real desktop
  file picker and synthetic drag/drop. Desktop/mobile screenshots inspected.
- Independent read-only review found no actionable critical/important issues.
  Deferred mail-client UI/sleep decisions remain deferred; no real messages or
  private user documents were submitted/converted. Normal reset covers upload
  copies, and recreation scripts/default local-source behavior remain compatible.
- Published `ed2469d` and opened
  [PR #3](https://github.com/a-tsygankov/kindle-md-svc/pull/3). Publish scan covered
  all 75 source files with no actual source path/token/personal recipient included;
  PowerShell parse and staged whitespace checks passed. No hosted CI configured.
  The PR records the authoritative integration state/SHA.

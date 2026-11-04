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

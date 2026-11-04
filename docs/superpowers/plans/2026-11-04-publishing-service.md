# Publishing Service Implementation Plan

> Execute inline with superpowers:executing-plans and TDD. The user authorized
> implementation of the documented next service stage. Keep progress/handoff current.

**Goal:** A usable authenticated local file picker with rendered preview, EPUB/PDF
downloads, and opt-in fixed-recipient SMTP.

**Architecture:** TypeScript service, plain browser UI, per-job conversion worker,
and persisted bounded queue. Reuse publishing tools, not the disposable proof's
unbounded interface. Keep existing Node/PowerShell operations as the entry points.

**Spec:** ../specs/2026-11-04-publishing-service-design.md

## Constraints / review focus

- Sources remain read-only; all generated files live in validated managed roots.
- Old config remains readable; paths/secrets never enter committed defaults/logs.
- Root reparse points work; escaped resources and redirected output subfolders fail.
- Preview and PDF cannot fetch remote resources or execute source-provided scripts.
- SMTP is explicit, fixed-recipient, duplicate-safe, and reports submission only.

## Tasks

1. [x] Add defaulted server/SMTP config validation and TypeScript build/test setup.
   Write tests for migration, malformed/unsafe settings, and config preservation.
   Files: `scripts/host-lib.mjs`, `src/config.ts`, `tsconfig*.json`, config example.
2. [x] Implement source library, safe snapshot conversion, and worker. Write real
   Pandoc/Chromium tests for normal Markdown/Mermaid, nested assets, escape/remote
   rejection, source changes, and artifact publication.
   Files: `src/library.ts`, `src/converter.ts`, `src/convert-worker.ts`, `src/process.ts`.
3. [x] Add persisted job queue and SMTP submission. Test queue bounds, owned-child
   cancellation, restart recovery, real local SMTP attachment/MIME, and duplicates.
   Files: `src/jobs.ts`, `src/delivery.ts`, relevant tests.
4. [x] Add HTTP auth/library/job/download/preview endpoints and responsive picker.
   Test auth, origin/host validation, request limits, source privacy, and the full
   UI flow with a real mobile-width browser against a synthetic library.
   Files: `src/server.ts`, `src/http.ts`, `src/ui.ts`, `public/index.html`, `public/style.css`.
5. [x] Integrate service readiness, start/stop/status, configuration and doctor;
   retain explicit proof mode. Update setup/build and run full host/service tests.
6. [x] Review final changes, fix important findings with regressions, update
   operations/status/progress/decisions/handoff with actual evidence and limits.

No push/deployment or real SMTP submission is part of verification. Existing ignored
recreation scratch is preserved: prior automatic review blocked its cleanup.

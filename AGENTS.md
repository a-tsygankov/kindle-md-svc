# Project working agreement

- Read `HANDOFF.md`, `docs/STATUS.md`, and the latest `docs/PROGRESS.md` entries
  before making changes. Treat repository documents as the durable task record.
- Keep `docs/STATUS.md` current, append meaningful work and verification evidence
  to `docs/PROGRESS.md`, and update `HANDOFF.md` before finishing each work session.
  Record failed checks, limitations, decisions, and the next concrete steps.
- Update `docs/DECISIONS.md` when changing a significant technical decision.
- Write project documentation and handoffs as Markdown (`.md`). Use fenced
  `mermaid` diagrams when they clarify architecture, workflows, dependencies,
  or state transitions; keep simple instructions in prose or lists. Maintain
  diagram source alongside the text, label planned versus implemented behavior,
  and do not replace editable diagrams with screenshots.
- Keep setup/start/status/stop/configuration/doctor/reset utilities, their tests,
  `config.example.json`, and `docs/OPERATIONS.md` aligned with actual behavior.
  When the real service replaces the conversion proof, update all lifecycle
  scripts in that same change. Never present the proof runner as the web service.
- Windows 11 is the verified target. Keep core code cross-platform and explicitly
  record which macOS paths are untested. Avoid hard-coded host or user paths.
- Keep credentials and local paths out of tracked configuration and handoff
  files. Use ignored `config.local.json` and environment variables. Never put
  SMTP passwords, access tokens, or private document contents into logs or docs.
- Sources are read-only. Generated files stay outside the configured source.
  Reset must never delete source documents, local configuration, or code. Check
  canonical targets and reject junctions/symlinks before recursive removal.
- Use real integration checks for conversions and process lifecycle. Verify reset
  in an isolated test repository, not by deleting the user's working outputs.
- Do not claim Kindle delivery/annotation support verified until a real import
  has been checked. SMTP acceptance means submitted, not delivered.

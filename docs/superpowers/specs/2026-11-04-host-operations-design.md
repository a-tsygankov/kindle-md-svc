# Host operations and durable progress

The user requires durable progress/handoff files and maintained utilities for
recreating, running, stopping, diagnosing, configuring, and resetting the system
on a new host. Current software is a conversion proof, not a document web service.

Use cross-platform Node utilities with Windows PowerShell entry points, and a
Windows x64 portable-tool bootstrap. This builds on the existing Node/Pandoc
proof. Pure PowerShell-only management would be less reusable on macOS; adding
an OS service manager now would add deployment complexity before a service exists.

Keep local settings in ignored `config.local.json`; track only the schema example.
Configure a local source root and optional tool executable paths. Source is
optional for synthetic fixtures; selected files require an existing source root
and real-path containment. Never select all iCloud documents automatically.

Setup installs pinned local Node/Pandoc and locked npm dependencies, provisions
the matching Puppeteer browser, and preserves configuration. Start runs an
explicit finite background proof job, with logs and per-run outputs; no files
selected means synthetic fixtures. A small supervisor tracks its owned child,
accepts a run-specific cancellation file, and records completed/failed/stopped
states. Stop never kills arbitrary stored PIDs. On Windows it terminates only
the live child tree it spawned; on POSIX the child's own process group. One
managed run is allowed at a time. Stale state must not authorize killing anything.

Reset is limited to fixed generated roots `output/` and `.state/`; dependencies
and tools require explicit options. Preserve local configuration and source
files. Before deleting anything, preflight all targets, reject redirected roots,
and reject overlap with the configured canonical source folder. A dry run lists
targets. Reset refuses an active run; the user can stop it first.

Track current state in `docs/STATUS.md`, history in `docs/PROGRESS.md`, decisions
in `docs/DECISIONS.md`, operations in `docs/OPERATIONS.md`, and resumable context in
`HANDOFF.md`. `AGENTS.md` requires updating these as part of every future change.

Verify config, invalid paths, dry-run/reset preservation, symlink/junction
rejection, live-process ownership, lifecycle completion/cancellation, repeated
start, and portable setup using isolated fixtures. Keep macOS execution marked
unverified. Do not send email or import private documents while testing.

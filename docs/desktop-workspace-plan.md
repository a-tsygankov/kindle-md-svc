# Desktop Markdown workspace and browser uploads

2026-11-04. User requested desktop visibility, reading generated Markdown before
conversion, and explicitly selected uploads/drag-and-drop from arbitrary Mac or
Windows folders in addition to the existing synced source.

## Design and choices

- Keep the existing browser/server stack. Wider desktop file browser and source
  reader side by side; published jobs below. Phone layout stacks the same controls.
- Read source Markdown as inert text before conversion; existing sandboxed rendered
  preview remains available after conversion, including Mermaid diagrams.
- Authenticated upload imports copied Markdown/raster assets into managed output,
  never the synced source. A folder picker preserves relative asset paths. File
  selection/drag-and-drop handles individual files; dragged directories are rejected
  with guidance to use the folder picker. No ZIP unpacking or arbitrary host paths.
- Upload batches: up to 10 Markdown files, 100 raster assets, 30 MiB total; each
  Markdown <=2 MiB and image <=10 MiB. Retain at most 100 batches until normal reset.
- Persist source kind per job so library and uploaded documents use explicit roots.
  Existing jobs remain library jobs. Safe portable paths, canonical containment,
  root checks, bounded decoding and atomic batch publication prevent traversal.
- The service host remains Windows-verified; browsers on Mac/Windows send the same
  upload payload. Native macOS service execution remains separately unverified.

## Implementation and verification

1. Add upload store and regression tests for quotas, portable paths, atomic failure,
   retained listing, asset layout, and redirected roots.
2. Add authenticated upload/list/source APIs and source-kind job conversion; test
   real uploaded EPUB with Mermaid and images, plus existing-library source reads.
3. Add desktop reader, upload controls/drop zone, per-document Read/Convert actions,
   source-mode isolation, and responsive layout. Browser tests cover file picker,
   simulated drag/drop, source review, conversion and phone/desktop overflow.
4. Run full suite, inspect desktop/mobile screenshots, request independent review,
   update operations/status/handoff, then restart the real service. Deferred mail
   UI and proposed sleep policy remain deferred; preserve their existing config/docs.

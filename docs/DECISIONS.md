# Technical decisions

| Date | Decision | Reason / consequence |
| --- | --- | --- |
| 2026-11-04 | Markdown docs/handoffs, Mermaid where useful | User preference; editable diagrams clarify complex workflows without adding diagrams to simple instructions. |
| 2026-11-04 | Use Node/TypeScript orchestration, Pandoc, Mermaid CLI, Chromium | Reuse publishing tools; Java adds another runtime without removing them. Production service still pending. |
| 2026-11-04 | EPUB reading default; PDF optional | Reflowable reading versus fixed diagrams and direct pen markup through Send to Kindle. Device validation pending. |
| 2026-11-04 | Parse Markdown through the Pandoc AST | Preserve nested fences; avoid brittle regex-based extraction. |
| 2026-11-04 | Render diagrams to high-resolution PNG, reuse a browser | Portable embedded images; explicit viewport fixes low resolution. Extreme aspect ratios still need zoom. |
| 2026-11-04 | Keep the experiment labeled as a proof | It has no picker, SMTP, or production job system. Do not imply otherwise. |
| 2026-11-04 | Store host settings in ignored JSON | No host paths or credentials in committed defaults; portable recreation. |
| 2026-11-04 | Node host utilities with PowerShell entry points | Reuse core logic for later macOS support; verified Windows setup first. |
| 2026-11-04 | Fixed managed reset roots, source/config preserved | Safe repeatable cleanup; reject redirected or overlapping targets before deletion. |
| 2026-11-04 | Stop through an owned supervisor | Cancellation request identifies one run; never kill a process solely from a persisted PID. |
| 2026-11-04 | Canonical bootstrap checks before Node exists | Windows directory handles resolve source junction aliases before setup writes tools or lock files. |
| 2026-11-04 | Validate generated subfolders as well as roots | An ordinary output root can contain a redirected runs directory; reject it before writing. |
| 2026-11-04 | Retain tools on normal reset | Fast recreation without removing the running runtime. Full tool removal requires explicit opt-in from external Node. |
| 2026-11-04 | Persistent TypeScript service, plain browser UI | Implement the approved picker/download/SMTP stage without React, a database, or another publishing engine. |
| 2026-11-04 | Separate production converter from disposable proof | Snapshot/validate resources, escape Raw AST nodes, isolate browser requests, enforce budgets and publish artifacts only after success. |
| 2026-11-04 | Token/session auth even on localhost | Private file access is authenticated; LAN binding is explicit. Token values never enter routine logs/status. |
| 2026-11-04 | Fixed-recipient TLS SMTP with explicit retry | Prevent arbitrary relaying and duplicate submissions; uncertainty never triggers automatic resend or a delivered claim. |
| 2026-11-04 | Windows hidden independent supervisor | PowerShell 5 captured native output otherwise stayed attached while the background service ran; reproduced in a real regression. |
| 2026-11-04 | Ordered atomic JSON state updates | Concurrent Windows renames caused EPERM and state-order hazards; serialize per file with bounded transient retries. |
| 2026-11-04 | Manual generated-job retention | Keep up to 1,000 jobs, show latest 200; explicit backup/reset instead of automatic export deletion. |
| 2026-11-04 | Service controls document identity | Filename stem is the title; configured author defaults to AT and overrides front matter in preview/EPUB/PDF. Use pinned pdf-lib to set PDF metadata before atomic publication; see [PDFDocument API](https://pdf-lib.js.org/docs/api/classes/pdfdocument). |
| 2026-11-04 | Report Windows pin intent without claiming sync completion | Batch-read visible-folder filesystem attributes through a bounded PowerShell adapter; no content reads, recursion, or sync changes. Missing/unsupported metadata remains unknown. Server sorts entries; browser remembers preferences. |
| 2026-11-04 | Remember browsers with revocable persistent cookies | 365-day HttpOnly/SameSite credential, renewed daily with use; persist token-bound hashes in ignored state. Reuse browser credentials on token login. Signout revokes one browser; reset/token rotation revokes all. No access token in localStorage. |

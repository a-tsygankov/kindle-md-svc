# Conversion proof findings - 2026-11-04

## Scope

The user approved proving local Markdown/Mermaid conversion before building the
picker and delivery service. This is a disposable experiment. No iCloud documents
were copied, modified, or published, and no email or Amazon operation occurred.

## Tool choices proved on Windows

| Responsibility | Tool | Observed result |
| --- | --- | --- |
| Parse Markdown | Pandoc 3.13, GFM plus YAML metadata and footnotes | Structured AST preserves nested fences and ordinary code |
| Render Mermaid | Mermaid CLI package 12.2.0, rendering API | Flowchart, sequence, state, and ER diagrams rendered into PNGs |
| EPUB | Pandoc EPUB3 writer | Embedded resources, metadata, spine, and navigation pass local structural checks |
| HTML preview | Pandoc HTML5 writer | Images and CSS embedded in one portable HTML file |
| PDF | Puppeteer 25.16.0 with managed Chrome 156.0.8078.47 | Selectable prose, clickable links, embedded diagrams and local image |
| Runtime | Portable Node 26.13.0 LTS | No Java, Maven, LaTeX, or database required |

A single Chromium process handles diagrams and PDFs. The browser is provisioned
by Puppeteer rather than relying on Codex's cached browsers or a system path.
Node/Pandoc portable archives were downloaded from their publishers and verified
against publisher-provided SHA-256 values. They live in ignored `.tools/`.

## Outputs

One local run, excluding browser startup, measured:

| Fixture | Diagrams | Other images | EPUB | PDF | PDF pages | Conversion time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Reading sample | 2 | 1 | 373,534 bytes | 474,400 bytes | 5 | 2.50 seconds |
| Diagram stress | 3 | 0 | 518,756 bytes | 656,271 bytes | 4 | 3.42 seconds |

These are sample timings on this laptop, not a performance guarantee. Both PDFs
use a 153 x 204 mm page with 12 pt body text, grayscale diagrams, and margins for
small handwritten marks. That 3:4 aspect ratio suits the original Scribe's
portrait display. It does not imply pixel-exact device rendering after Amazon
conversion.

## Checks performed

- Four automated tests ran with real Pandoc and Chromium: the two complete
  fixtures, plain Markdown, malformed Mermaid, and local-image handling.
- Both EPUB ZIPs were inspected independently for the uncompressed mimetype,
  package references, navigation, spine, XHTML, embedded images, and no scripts.
- Both PDFs were inspected for pages, embedded images, selectable text, working
  link annotations, Unicode text, and text blocks inside page bounds.
- All nine final PDF pages were rendered and visually reviewed. No clipped
  tables, code, or missing images were observed. Extreme-aspect diagrams have
  small labels at page width; this is a recorded limitation, not a successful
  readability check.
- A low-resolution Mermaid rendering issue was reproduced with a failing test
  and corrected by setting the viewport and device scale explicitly. The final
  tall diagram is 1778 x 4800 pixels; the wide diagram is 3168 x 282 pixels.
- Input SHA-256 values were checked after conversion: the fixtures were unchanged.
- `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities.

## Findings that affect the service

1. Use the Pandoc AST rather than matching code fences with regular expressions.
   A fenced example about Mermaid must remain code, not become a diagram.
2. Reuse a browser process; the official Mermaid package exposes a rendering API,
   so the application does not need one browser subprocess per diagram.
3. Preserve high-resolution PNGs and flag extreme aspect ratios. More pixels help
   zooming but do not enlarge labels when a very wide diagram is fitted to a page.
   Do not silently rewrite diagram direction or split diagram content.
4. EPUB should remain the reading default. PDF preserves layout and allows direct
   pen markup after an appropriate Send to Kindle import. These are complementary
   outputs, not interchangeable annotation experiences.
5. Use a selected document's stable input snapshot and an isolated output job
   directory. The proof hashes inputs but does not implement a complete snapshot,
   cache, job lifecycle, or atomic publication protocol.
6. Enforce source-root and resource-root containment after resolving real paths.
   Windows iCloud roots can be reparse points; blanket rejection of all reparse
   points would exclude the user's legitimate root.

## Remaining validation

- Real Send to Kindle import of the sample EPUB and PDF onto the user's Scribe.
- Actual reading comfort, diagram zoom behavior, handwriting, and note export.
- EPUBCheck conformance (local packaging checks are narrower).
- macOS execution and font differences.
- SMTP configuration and delivery; acceptance must be called "submitted", not
  "delivered to Kindle".

## Recommended service design

Proceed with a small TypeScript orchestrator around the proven tools. Python is
still viable but would introduce a second service runtime alongside Node-based
Mermaid. Java/Spring adds another runtime without removing the conversion tools.
Quarto remains a viable integrated publishing alternative but was not installed
or benchmarked in this proof.

Keep the initial UI focused on file multi-selection, rendered preview, EPUB/PDF
choice, download, and explicit SMTP submission. The source root is user
configuration, with the real local iCloud location kept out of committed defaults.
No filesystem watcher or continuous publishing is required for on-demand use.
The host needs to be awake and reachable for phone access. Bind locally by
default; require an access token and origin checks for LAN use.

The next implementation needs independent source-library, conversion, job, and
delivery boundaries, bounded conversion concurrency, image/resource validation,
no source-provided executable filters, and cleanup/retention for generated files.
Credentials belong in environment variables or ignored local configuration.

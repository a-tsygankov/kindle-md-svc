---
title: Technical Diagrams on E-Ink
lang: en-US
---

# A diagram compatibility check

This sample checks several diagram families and a deliberately wide layout.
Wide diagrams retain all their content, but their labels may need zooming on a
fixed-width display. Automatic layout cannot make every diagram readable at once.

## Wide flowchart

```mermaid
flowchart LR
    A[Write Markdown] --> B[Sync iCloud Drive] --> C[Select files]
    C --> D[Render diagrams] --> E[Build EPUB or PDF] --> F[Send to Kindle]
```

## State transitions

```mermaid
stateDiagram-v2
    [*] --> Selected
    Selected --> Converting
    Converting --> Ready
    Converting --> Failed
    Failed --> Selected: Retry
    Ready --> Downloaded
    Ready --> Submitted
    Submitted --> [*]
    Downloaded --> [*]
```

## Structured data

```mermaid
erDiagram
    DOCUMENT ||--o{ ASSET : references
    DOCUMENT ||--o{ EXPORT : produces
    EXPORT ||--o{ DELIVERY : submits
    DOCUMENT {
        string title
        string relativePath
    }
    EXPORT {
        string format
        string checksum
    }
```

## A nested fence must remain source code

The following is an example *about* Mermaid. It must stay literal text, rather
than being converted into a sixth diagram.

````markdown
```mermaid
flowchart LR
    Example --> Documentation
```
````

## Another kind of code

```python
def delivery_status(smtp_accepted: bool) -> str:
    # SMTP acceptance does not prove that Amazon delivered it.
    return "submitted" if smtp_accepted else "failed"
```

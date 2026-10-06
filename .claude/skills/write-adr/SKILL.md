---
name: write-adr
description: Record an architecture decision as an ADR in docs/decisions/. Use when choosing or changing a library, service, data model approach, or cross-cutting pattern.
---

Write an ADR when the choice is hard to reverse, affects several modules, or someone would reasonably ask "why did we do it this way?".

1. Pick the next number in `docs/decisions/` (`NNNN-short-title.md`).
2. Use this format, keep it under one page:

```
# NNNN: Title

Status: Proposed | Accepted | Superseded by NNNN

## Decision
## Rationale
## Consequences
```

3. Do not edit accepted ADRs; supersede them with a new one and update the old status line.
4. Reference the ADR from the relevant `docs/` file rather than copying its content.

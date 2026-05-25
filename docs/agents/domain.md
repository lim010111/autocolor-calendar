# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — points at the cross-cutting glossary (root `CONTEXT.md`) and any per-module `CONTEXT.md` files. Read the entries relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- Per-module ADRs, if/when added, live at `<module>/docs/adr/`.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure (multi-context)

```
/
├── CONTEXT-MAP.md                ← entry point — lists every CONTEXT.md
├── CONTEXT.md                    ← cross-cutting glossary (Rule / Keyword / Example / Classifier / Instant Feedback)
├── docs/adr/                     ← system-wide ADRs (0001-…, 0002-…)
├── src/
│   ├── CONTEXT.md                ← (lazy) Worker-side domain language
│   └── docs/adr/                 ← (lazy) Worker-scoped ADRs
├── gas/
│   └── CONTEXT.md                ← (lazy) Add-on UI domain language
└── drizzle/
    └── CONTEXT.md                ← (lazy) schema/data domain language
```

Items marked "(lazy)" are created on demand by `/grill-with-docs`; their absence is not a problem.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids (see the "Flagged ambiguities" section).

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0004 (embedding kNN classifier) — but worth reopening because…_

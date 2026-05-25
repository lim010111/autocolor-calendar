# CONTEXT map

Entry point for domain language across this repo. Skills (`improve-codebase-architecture`, `diagnose`, `tdd`, `grill-with-docs`) read this first to find the right glossary for the area they're working in.

## Contexts

| Scope          | CONTEXT.md                   | Notes                                                                       |
| -------------- | ---------------------------- | --------------------------------------------------------------------------- |
| Cross-cutting  | [`CONTEXT.md`](./CONTEXT.md) | Domain glossary: Rule / Keyword / Example / Classifier / Instant Feedback   |
| Worker backend | `src/CONTEXT.md`             | _Not yet written — create lazily via `/grill-with-docs`_                    |
| GAS Add-on UI  | `gas/CONTEXT.md`             | _Not yet written — create lazily via `/grill-with-docs`_                    |
| Schema / data  | `drizzle/CONTEXT.md`         | _Not yet written — create lazily via `/grill-with-docs`_                    |

System-wide ADRs live at [`docs/adr/`](./docs/adr/). Per-module ADRs, if/when added, live at `<module>/docs/adr/`.

Operational rules per module are in each module's `CLAUDE.md` — those govern *how to work*; the `CONTEXT.md` files govern *what things are called*.

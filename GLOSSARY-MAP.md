# CONTEXT map

Entry point for domain language across this repo. Skills (`improve-codebase-architecture`, `diagnose`, `tdd`, `grill-with-docs`) read this first to find the right glossary for the area they're working in.

## Contexts

| Scope          | GLOSSARY.md                   | Notes                                                                       |
| -------------- | ---------------------------- | --------------------------------------------------------------------------- |
| Cross-cutting  | [`GLOSSARY.md`](./GLOSSARY.md) | Domain glossary: Rule / Keyword / Example / Classifier / Instant Feedback   |
| Worker backend | `src/GLOSSARY.md`             | _Not yet written — create lazily via `/grill-with-docs`_                    |
| GAS Add-on UI  | `gas/GLOSSARY.md`             | _Not yet written — create lazily via `/grill-with-docs`_                    |
| Schema / data  | `drizzle/GLOSSARY.md`         | _Not yet written — create lazily via `/grill-with-docs`_                    |

System-wide ADRs live at [`docs/adr/`](./docs/adr/). Per-module ADRs, if/when added, live at `<module>/docs/adr/`.

Operational rules per module are in each module's `CLAUDE.md` — those govern *how to work*; the `GLOSSARY.md` files govern *what things are called*.

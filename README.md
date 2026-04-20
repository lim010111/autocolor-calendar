# AutoColor for Calendar

**AutoColor for Calendar** automatically assigns colors to Google Calendar events based on user-defined semantic rules or contextual analysis. It is a multi-tenant SaaS application for the Google Workspace Marketplace that leverages a Serverless backend (Cloudflare Workers) and a 2-stage classification engine (Rule → LLM) with mandatory PII redaction before any LLM call.

## Repository layout

- `docs/`: Architectural documentation, UI plans, and guidelines.
- `gas/`: Source code for the Google Workspace Add-on (UI).
- `src/`: Source code for the Cloudflare Workers backend (E2E processing).

## Start here

1. Read `docs/project-overview.md` for a comprehensive overview of the application and its architecture.
2. Read `docs/architecture-guidelines.md` for the core architectural rules, sync flows, and Add-on constraints.
3. See `gas/README.md` for setting up the frontend Google Workspace Add-on.

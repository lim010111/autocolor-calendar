# Project Overview

**AutoColor for Calendar** automatically assigns colors to Google Calendar events based on user-defined semantic rules or contextual analysis. The project is structured in two main stages:

- **Stage 1 (Current MVP):** A single-user Google Apps Script deployment. It uses deterministic keyword matching (rules) to color events. It relies on Calendar triggers and incremental sync. Source code is located in the `gas/` directory.
- **Stage 2 (Planned SaaS):** A broader multi-tenant SaaS application meant for the Google Workspace Marketplace. It introduces a Serverless backend (Cloudflare Workers) to handle external OAuth, centralized sync logic, Supabase for DB/Auth, and a 3-stage hybrid classification engine (Rule -> Embedding -> LLM) for advanced contextual category matching.

## Core Technologies

- **Stage 1:** Google Apps Script (JavaScript), Google Calendar API (Advanced Service).
- **Stage 2 (Backend):** TypeScript, Cloudflare Workers, Supabase (PostgreSQL, Auth, Vector), Drizzle ORM, small LLMs (e.g., Gemini API).

## Directory Structure

- `gas/`: Contains the Stage 1 Google Apps Script MVP files (`appsscript.json`, `config.js`, `sync.js`, etc.).
- `docs/`: Contains architectural documentation, such as `architecture-stage1.md`.
- `plans/`: Contains detailed architecture and implementation plans, such as `stage2-architecture-update.md`.
- `TODO.md`: Tracks the ongoing transition from Stage 1 to Stage 2 and upcoming features.
- `wrangler.toml`: Cloudflare Workers project configuration for the Stage 2 backend.
- `src/`: Source code for the Stage 2 Cloudflare Workers backend.
- `.gemini/`: Gemini CLI specific configurations, hooks, and agents.
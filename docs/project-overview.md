# Project Overview

**AutoColor for Calendar** automatically assigns colors to Google Calendar events based on user-defined semantic rules or contextual analysis. The project is structured as a multi-tenant SaaS application for the Google Workspace Marketplace. It features an End-to-End (E2E) AI service requiring backend connection for all users.

## Architecture

- **Google Workspace Add-on (UI):** A Google Apps Script (GAS) deployment using `CardService` to provide the onboarding and configuration UI within Google Calendar. It delegates all syncing and AI processing to the backend. Source code is located in the `gas/` directory.
- **Serverless Backend:** Cloudflare Workers handle external OAuth, centralized sync logic via Webhooks (Push Notification), Supabase for DB/Auth, and a 3-stage hybrid classification engine (Rule -> Embedding -> LLM) for advanced contextual category matching.

## Core Technologies

- **Frontend (Add-on UI):** Google Apps Script (JavaScript), `CardService`.
- **Backend:** TypeScript, Cloudflare Workers, Supabase (PostgreSQL, Auth, Vector), Drizzle ORM, small LLMs (e.g., Gemini API).

## Directory Structure

- `gas/`: Contains the Google Apps Script Add-on UI and backend connection setup.
- `docs/`: Contains architectural documentation.
- `plans/`: Contains detailed architecture and implementation plans.
- `TODO.md`: Tracks ongoing tasks and features.
- `wrangler.toml`: Cloudflare Workers project configuration for the backend.
- `src/`: Source code for the Cloudflare Workers backend.
- `.gemini/`: Gemini CLI specific configurations, hooks, and agents.

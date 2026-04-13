# Web UI (Frontend) Context

## Development & Usage

This directory (`web/`) contains the source code for the external Web UI, which is used for configuring complex event coloring rules and viewing analytics (Stage 2).

- **Framework:** Vite + React 18+ (TypeScript) SPA.
- **Styling & UI:** Tailwind CSS + shadcn/ui.
- **State Management & Data Fetching:** React Query (`@tanstack/react-query`).
- **Architecture (BFF):** Backend for Frontend. The browser must **NOT** access Supabase or the database directly. All API calls must be routed through the Stage 2 Cloudflare Workers API.
- **Authentication:** Server-side Cookie based (Auth code exchange). Do not use Magic Links or URL tokens.
- **Commands:**
  - `npm install` (or `pnpm install`)
  - `npm run dev` to start the local development server.
  - `npm run build` to create a production build.

## Conventions & Guidelines
- **Component Design:** Use functional components and hooks. Separate business logic into custom hooks or utility functions.
- **Typing:** Follow strict TypeScript typing.
- **UI Libraries:** 
  - Use `shadcn/ui` + `Tailwind CSS` for basic components (buttons, modals, forms).
  - Use `@tanstack/react-table` for data grids (Rules Management).
  - Use `Recharts` for data visualization (Analytics Dashboard).
- **Security:** Do not log or expose PII (Calendar event details). Ensure auth flows rely on HttpOnly Secure SameSite cookies provided by the backend API.
- **Implementation Strategy:** Prioritize stability. Implement complex features (like DND or CSV imports) in a phased approach (v1 -> v2) rather than all at once.

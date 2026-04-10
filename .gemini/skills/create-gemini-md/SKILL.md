---
name: create-gemini-md
description: Create or update GEMINI.md files following best practices for lazy loading, concise references, and directory-specific scoping. Use when asked to create or update GEMINI.md.
---

# Create GEMINI.md

This skill guides the creation of `GEMINI.md` files to ensure they are optimized for Gemini CLI's context window. Follow these guidelines closely when writing or updating `GEMINI.md` files.

## Core Rules

### 1. Lazy Loading via References (Just-in-Time Context)
Do not put all details in a single `GEMINI.md` file. Use one-line references to point to external files so they are only loaded when needed.

- **Bad**: Putting all API endpoints, DB schemas, or detailed rules directly in `GEMINI.md`.
- **Good**: 
  ```markdown
  ## 프로젝트 문서
  - API 스펙: @docs/api-spec.md
  - DB 스키마: @docs/db-schema.md
  - 인증 설계: @docs/auth.md
  - 코딩 컨벤션: @docs/conventions.md
  ```
- **Context Efficiency**: Keep the context window lean. Move domain-specific knowledge or infrequent workflows into subdirectory files rather than the root file.

### 2. Directory-Specific Scoping (Hierarchical Structure)
Create `GEMINI.md` in specific subdirectories (e.g., `src/auth/GEMINI.md`, `src/payments/GEMINI.md`) instead of a giant root file. 
- Gemini automatically scans for and loads context files in the current directory and its ancestors only when needed.
- This prevents context bloat because Gemini only reads the file when working in that specific directory.
- Use a Global file for cross-project preferences and a Root file for repository-specific rules, then scope down from there.

### 3. High Signal, Low Noise
Treat these files like code—regularly prune redundant instructions.

**Include (High Signal)**:
- Non-obvious Bash commands (build, test, lint).
- Unique code styles (e.g., "Use ES modules, not CommonJS").
- Project architecture and common pitfalls.
- Repo etiquette (branch naming, PR conventions).
- Test runner preferences and specific flags.

**Exclude (Noise)**:
- Standard language rules the AI already knows.
- Self-evident practices (e.g., "Write clean code").
- Detailed API docs (provide a URL link instead).
- Frequently changing info that will quickly rot.
- Long tutorials or verbose explanations.

### 4. Formatting Guidelines
- **Human-Readable Markdown**: Use standard Markdown headers and lists for clarity.
- **Emphasis for Compliance**: Use strong language like **"IMPORTANT"** or **"YOU MUST"** to ensure the AI prioritizes critical instructions.
- **Conciseness**: Keep instructions brief and directly actionable.

## Workflow

1. **Analyze**: Review the project structure and the user's specific request.
2. **Locate**: Determine the most appropriate directory for the new or updated `GEMINI.md` (root vs. specific subdirectory).
3. **Reference**: Identify existing documentation that should be referenced (using `@path/to/file.md` syntax) rather than copied into the `GEMINI.md`.
4. **Draft/Update**: Write the `GEMINI.md` content following the core rules above. Ensure it is concise and explicitly outlines necessary constraints.

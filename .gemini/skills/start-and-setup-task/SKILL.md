---
name: start-and-setup-task
description: Automates starting a new task by reading TODO.md, creating a git branch, drafting a plan, and setting up necessary directories and GEMINI.md files. Use when you need to start a new feature or task from the TODO list that requires planning and architectural setup.
---

# Start and Setup Task Pipeline

## Purpose
This skill orchestrates a complete start-to-setup pipeline for new tasks. It combines the functionality of `create-task-branch` with automated planning and project structure setup. 

## Workflow

Follow these steps precisely:

### 1. Select Task & Create Branch
1. Use `read_file` to read the contents of `TODO.md` located in the project root.
2. Identify pending tasks (`- [ ]`).
3. Use the `ask_user` tool (with `type: 'choice'`) to let the user select a task.
4. Generate a branch name from the selected task (e.g., lowercase, hyphens, english translation, prefixed with `feature/`, `docs/`, `fix/`, etc.).
5. Run `git status` to ensure a clean working tree. If clean, run `git checkout -b <branch_name>`.

### 2. Task Planning & Architecture Setup
1. **Analyze the Task:** Consider the task's scope and how it fits into the current project architecture. Decide if it requires a new top-level directory (e.g., `web/`, `api/`) or just modifications to existing ones.
2. **Draft a Plan:** 
   - Write a comprehensive implementation plan detailing the architecture, tech stack, and step-by-step implementation.
   - Save this plan as `docs/<branch_name>-plan.md`.
3. **Setup Structure & GEMINI.md:**
   - If a new directory is needed, create it via shell command (`mkdir -p <dir>`).
   - Create a `GEMINI.md` inside that directory with context-specific rules (lazy loading principle).
   - Update the root `GEMINI.md` to reference the newly created file (e.g., `- New Module: @<dir>/GEMINI.md`).

### 3. Verification
1. Output a final summary confirming the branch name, the created plan file path, and any project structure changes made.

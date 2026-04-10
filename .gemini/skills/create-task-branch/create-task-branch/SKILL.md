---
name: create-task-branch
description: Reads TODO.md to find pending tasks, helps the user select one, and creates a git branch for developing that specific task. Use when asked to start a task from TODO.md or create a branch for a TODO.
---
# Create Task Branch

## Purpose
This skill automates the process of starting a new task by reading `TODO.md`, selecting an incomplete task, and creating an appropriate git branch for it.

## Workflow

1. **Read TODO.md**
   Use `read_file` to read the contents of `TODO.md` located in the project root.
   Look for pending tasks marked with `- [ ]`.

2. **Select a Task**
   Identify the list of available pending tasks.
   Use the `ask_user` tool (with `type: 'choice'`) to present the available tasks to the user so they can select exactly one task to work on. 
   If there is only one task available, you may ask for simple confirmation instead.

3. **Generate a Branch Name**
   Convert the selected task's description into a suitable branch name.
   - Use lowercase letters, numbers, and hyphens.
   - Prefix with the type of task if obvious (e.g., `feature/`, `fix/`, `docs/`, `setup/`), or just use the task description.
   - Translate Korean into English for the branch name.
   - Example: `- [ ] PRD 및 시스템 아키텍처(SaaS 확장 모델) 최종 리뷰` -> `docs/prd-system-architecture-review`
   - Example: `- [ ] Add-on UI (CardService) 개발` -> `feature/addon-ui-cardservice`

4. **Create the Branch**
   Run `git status` to make sure the working tree is clean. If not, warn the user.
   Run `git checkout -b <branch_name>` using the `run_shell_command` tool.
   Output a success message indicating the branch was created and the user is ready to start development on that task.

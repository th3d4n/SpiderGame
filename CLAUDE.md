# Claude Code Instructions

CRITICAL WORKFLOW RULES:
- Always work directly in the main working directory
- Never create or use git worktrees
- Write all files to ./src/ directly
- After writing any file, verify it exists in the main directory with: ls [filepath]
- Do not use git commands — the developer handles all commits manually

## Launch Command
Always start Claude Code with:
  claude --no-worktree

This prevents files being written to .claude/worktrees/ instead of the main directory.

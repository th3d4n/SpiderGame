# NoLegs — Claude Code Project Rules

## CRITICAL: NO WORKTREES EVER
- NEVER create a git worktree
- NEVER use git worktree commands
- ALWAYS work directly in the main project directory
- Before writing ANY file run: pwd
- If pwd shows .claude/worktrees in the path, run: cd /d/dmorgan/Documents/GitHub/SpiderGame
- After writing each file verify with: ls src/[subfolder]/[filename]
- Do not run git commands — developer commits manually

## If Claude Code tries to use a worktree
Immediately stop and change directory to the main project root before proceeding.

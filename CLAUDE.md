# NoLegs — Claude Code Project Rules

## CRITICAL: File Writing Rules
- NEVER use git worktrees (never run git worktree commands)
- NEVER use the --worktree flag
- Write ALL files directly to the current working directory
- After writing any file verify it exists with: ls [filepath]
- Do not run any git commands — developer handles all commits manually

## Launch
Start Claude Code simply with:
  claude
Never with: claude --worktree or claude -w

## Project
- Game: "No Leg Left to Stand On" (NoLegs)
- Stack: Phaser 3 + TypeScript + Vite
- Repo: github.com/th3d4n/SpiderGame
- Live: playnoleg.th3dan.com

## Technical Rules
1. No unused variables — Cloudflare strict TS fails the build
2. Never name a property 'body' in any class extending Phaser Container
3. New scenes must be added to the scene array in main.ts
4. Player state passed between scenes via Phaser registry
5. Physics body accessed as: this.pb = this.body as Phaser.Physics.Arcade.Body

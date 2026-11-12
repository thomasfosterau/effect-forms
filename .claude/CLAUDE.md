# Claude Code

@../AGENTS.md
@../CONTRIBUTING.md
@../README.md

The imports above are the project conventions every agent follows. This file adds only what is specific to Claude Code sessions.

## Hooks

`.claude/settings.json` registers three hooks:

- **SessionStart** (`.claude/hooks/session-start.sh`, on `startup` and `resume`) installs the global Vite+ CLI at the catalog's `vite-plus` pin with the official installer (npm-provenance and SHA-512 checked; it needs `vite.plus` and `viteplus.dev` on the environment's allowlist), links `vp` and `vpx` into `~/.local/bin` for non-interactive shells (the CLI lives under `$VP_HOME` when set, as in the Vite+ container image, else `~/.local/share/vite-plus`), runs `vp install --frozen-lockfile`, repairs a broken bare `node`, and builds the packages on a clean checkout. The global `vp` delegates to each checkout's own `vite-plus`, worktrees included. Everything else goes through Vite+: `vp exec fallow …`, `vp exec changeset …`, and `vpx <file>.ts` for scripts (`tsx` is installed only because docgen spawns it). Nothing else is put on PATH. If the installer can't run, `vp` falls back to this checkout's `node_modules` copy. The hook hydrates no secrets: none are needed, and nothing here can publish.
- **PreToolUse** (`.claude/hooks/fallow-gate.sh`, on Bash) blocks `git commit` / `git push` when `fallow audit --base origin/trunk` (run through `vp exec fallow`) fails. It reads the coverage map on disk, so run `vp run test:coverage` first.
- **PostToolUse** (on Write / Edit / MultiEdit) runs `vp fmt --write` on every `.ts` / `.tsx` / `.js` / `.jsx` / `.mjs` / `.cjs` / `.css` / `.json` / `.md` file you edit, so expect formatter rewrites rather than hand-formatting.

## Settings

`.claude/settings.json` also enables the official `typescript-lsp`, `code-review`, `github`, `claude-md-management`, `commit-commands`, `pr-review-toolkit` and `code-simplifier` plugins.

## Worktrees

Worktrees go under `.claude/worktrees/<name>`, one path component deep. The fallow gate audits only this checkout and those worktrees. For a commit in any other tree it runs none of that tree's tooling and skips the audit with a notice.

## What a session can't do

Every gate in AGENTS.md's Verification list runs in a session; `pnpm audit` needs the network. Only publishing can't, because it runs from the release workflow's npm OIDC trusted publishing in the protected `release` environment.

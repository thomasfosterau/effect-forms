#!/usr/bin/env bash
#
# Provision a checkout for NON-INTERACTIVE use.
#
# Run by the Claude Code SessionStart hook (`.claude/settings.json`). Copied
# from the consuming applications via effect-drizzle-ext, the library
# reference; the `gardeneria #NNN` citations below name the issues there that
# are the evidence behind a decision, not tickets in this tracker.
#
# ## Vite+ first
#
# Vite+ (`vp`) is the one tool this script guarantees; everything else is
# reached through it. The global CLI is installed at exactly the `vite-plus`
# version pinned in `pnpm-workspace.yaml`'s catalog, using the official
# installer, which takes the release from the npm registry, refuses a package
# without npm provenance and checks its SHA-512 `dist.integrity`. It installs
# under `~/.local/share/vite-plus` and touches no shell profile, so `vp` and
# `vpx` are then linked into `~/.local/bin`, a directory already on PATH in
# this image and writable by the session user. `~/.bashrc` puts the toolchain
# on PATH only below Debian's interactive guard, so a non-interactive shell
# (an agent's tool call, a git hook) never sees it; an `export` here cannot
# reach the caller's later shells, but a symlink to the real binary can.
#
# From there:
#
# - `vp install --frozen-lockfile` installs the dependencies.
# - The global `vp` delegates development commands to the project-local
#   `vite-plus`, including inside `.claude/worktrees/*`, so each checkout runs
#   its own pinned toolchain (and its own vitest: two physical copies of one
#   vitest corrupt its suite collector, and every describe() then throws
#   `Cannot read properties of undefined (reading 'config')`, gardeneria
#   #1663) without a shim.
# - Project tools run through Vite+: `vp exec fallow …` for fallow (the commit
#   gate does the same), `vp exec changeset …` for Changesets, `vpx <file>.ts`
#   for TypeScript scripts. `tsx` stays installed only because
#   `@effect/docgen` spawns it itself. Nothing else is put on PATH: no shim
#   walks a directory tree, and nothing runs a `node_modules/.bin` the session
#   did not install.
#
# Earlier versions of this hook symlinked `tsx`, `fallow` and `changeset` into
# `~/.local/bin` and wrote a `vp` re-exec shim there that walked up from $PWD;
# those are removed or replaced when found (only ones this hook, or its
# `scripts/setup-dev-env.sh` predecessor, made: a symlink into a
# `node_modules`, or a file carrying a generator marker).
#
# If the installer cannot run (no network to vite.plus / viteplus.dev, or the
# catalog pin cannot be read), `vp` falls back to a one-line re-exec of this
# project's own `node_modules/vite-plus/bin/vp`, and the hook says so.
#
# ## Node, and why this repairs rather than clobbers
#
# `~/.vite-plus/bin/node` is a shim pointing at the `vp` launcher, which
# resolves a Node version and installs it under `~/.vite-plus/js_runtime`. That
# directory is `root:root` from image build while the session user is `vp`, so
# when the resolved version drifts past the cached one the shim fails:
#
#     vp: Failed to install Node 24.19.0: Permission denied (os error 13)
#
# Anything routed through `vp` still works; bare `node` does not — which breaks
# the pre-commit hook repo-wide, because `vp staged` shells out to it (gardeneria #1462).
# There is no root in a session, so the directory cannot be chowned here.
#
# This script therefore *tests* `node --version` and only replaces the shim
# when it is already broken, pointing it at a real cached binary. A working
# shim is left alone, so `vp env use` keeps functioning wherever it functions
# today. The repair is deliberately conditional: unconditionally replacing a
# working shim would trade one breakage for another.
#
# ## Secrets
#
# This hook hydrates NO secrets, and this repository needs none: every gate
# in AGENTS.md "Verification" runs offline against the lockfile (`pnpm audit`
# aside, which needs the network). Publishing is the release workflow's job
# and uses npm OIDC trusted publishing (PUBLISHING.md), so there is no token to
# hydrate anywhere.
#
# ## Contract
#
# Idempotent, and never fatal. Every failure path logs and continues, because
# the SessionStart hook must not block a session and a half-provisioned
# container is more useful than a container that refused to start. Callers
# that want hard failure should check the tools themselves afterwards.
#
# Untrusted-content note: the only value read from the repository is the
# `vite-plus` catalog version, and it is used only when it is a plain
# `MAJOR.MINOR.PATCH`. It takes no input from issue or PR bodies, or anything
# an agent could have been persuaded to write earlier in a session. Do not add
# other such input without revisiting this note — it runs on every session
# start and container create.

set -uo pipefail

log() { printf '[session-start] %s\n' "$1" >&2; }

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
LOCAL_BIN="${HOME:-/home/vp}/.local/bin"

VP_GLOBAL_BIN="${HOME:-/home/vp}/.local/share/vite-plus/bin"
# Earlier versions wrote the `vp` shim with this marker plus a suffix, so a
# fixed-string match on the prefix recognises those too; the legacy marker is
# the one the hook's `scripts/setup-dev-env.sh` predecessor wrote.
SHIM_MARKER="# generated-by: .claude/hooks/session-start.sh"
SHIM_MARKER_LEGACY="# generated-by: scripts/setup-dev-env.sh"

mkdir -p "$LOCAL_BIN" 2>/dev/null || log "cannot create $LOCAL_BIN; continuing"

# True when $1 is a file one of this hook's versions generated.
is_generated() {
  grep -qF "$SHIM_MARKER" "$1" 2>/dev/null || grep -qF "$SHIM_MARKER_LEGACY" "$1" 2>/dev/null
}

# Replace $dest with a symlink to $src unless $dest is a real file this hook
# did not make (something deliberately installed it).
link_to() {
  src="$1"
  dest="$2"
  if [ -e "$dest" ] && [ ! -L "$dest" ] && ! is_generated "$dest"; then
    return 0
  fi
  ln -sfn "$src" "$dest" 2>/dev/null || log "could not link $(basename "$dest")"
}

# Remove a PATH entry an earlier version of this hook created.
remove_old_link() {
  dest="$LOCAL_BIN/$1"
  if [ -L "$dest" ]; then
    case "$(readlink "$dest")" in
      */node_modules/*) rm -f "$dest" 2>/dev/null && log "removed old $1 link" ;;
    esac
  elif [ -f "$dest" ] && is_generated "$dest"; then
    rm -f "$dest" 2>/dev/null && log "removed old $1 shim"
  fi
}

# ── 1. Vite+ at the catalog pin ──────────────────────────────────────────────
VP_PIN="$(sed -nE 's/^  vite-plus: "?([0-9]+\.[0-9]+\.[0-9]+)"?$/\1/p' "$PROJECT_DIR/pnpm-workspace.yaml" 2>/dev/null | head -1)"
VP_HAVE="$("$VP_GLOBAL_BIN/vp" --version 2>/dev/null | sed -nE '1s/^vp v([0-9.]+).*$/\1/p')"
if [ -z "$VP_PIN" ]; then
  log "could not read the vite-plus catalog pin; not installing Vite+"
elif [ "$VP_HAVE" != "$VP_PIN" ]; then
  log "installing Vite+ $VP_PIN (have: ${VP_HAVE:-none})…"
  if command -v curl >/dev/null 2>&1 \
    && curl -fsSL https://vite.plus | VP_VERSION="$VP_PIN" bash >/dev/null 2>&1; then
    log "Vite+ $VP_PIN installed"
  else
    log "Vite+ installer failed (is vite.plus / viteplus.dev reachable?); continuing"
  fi
fi

for tool in tsx fallow changeset; do
  remove_old_link "$tool"
done
if [ -x "$VP_GLOBAL_BIN/vp" ]; then
  link_to "$VP_GLOBAL_BIN/vp" "$LOCAL_BIN/vp"
  link_to "$VP_GLOBAL_BIN/vpx" "$LOCAL_BIN/vpx"
else
  # Fallback: the project's own pinned copy, by its fixed path.
  log "global Vite+ unavailable; \`vp\` runs $PROJECT_DIR's node_modules copy"
  for name in vp vpx; do
    dest="$LOCAL_BIN/$name"
    if [ -e "$dest" ] && [ ! -L "$dest" ] && ! is_generated "$dest"; then
      continue
    fi
    target="$PROJECT_DIR/node_modules/vite-plus/bin/$name"
    [ "$name" = vpx ] && target="$PROJECT_DIR/node_modules/.bin/vpx"
    printf '#!/usr/bin/env bash\n%s (%s fallback)\nexec "%s" "$@"\n' \
      "$SHIM_MARKER" "$name" "$target" >"$dest.tmp" \
      && chmod +x "$dest.tmp" && mv -f "$dest.tmp" "$dest" \
      || { rm -f "$dest.tmp" 2>/dev/null; log "could not write the $name fallback"; }
  done
fi

# ── 2. Bare `node` (gardeneria #1462) ───────────────────────────────────────────────────
# Only repair a shim that is already failing — see the header for why this is
# conditional. `command -v node` is not enough: the shim exists and resolves,
# then dies on use, so the version call is the real test.
if ! node --version >/dev/null 2>&1; then
  VP_BIN_DIR="${VP_HOME:-${HOME:-/home/vp}/.vite-plus}/bin"
  # Newest cached runtime wins; `sort -V` so 24.9 does not beat 24.18.
  REAL_NODE="$(
    find "${VP_HOME:-${HOME:-/home/vp}/.vite-plus}/js_runtime/node" \
      -maxdepth 3 -type f -name node -perm -u+x 2>/dev/null | sort -V | tail -1
  )"
  if [ -n "$REAL_NODE" ]; then
    log "bare \`node\` is broken; pointing it at $REAL_NODE"
    # The shim lives in a vp-owned directory even though the runtime cache
    # beneath it is root-owned, so this needs no privileges.
    ln -sfn "$REAL_NODE" "$VP_BIN_DIR/node" 2>/dev/null \
      || link_to "$REAL_NODE" "$LOCAL_BIN/node"
  else
    log "bare \`node\` is broken and no cached runtime was found; \`vp\`-routed commands still work"
  fi
fi

# ── 3. Dependencies ──────────────────────────────────────────────────────────
# Unconditional, not only when node_modules is absent: a prebaked container can
# carry a tree built from an OLDER lockfile, and stale dependencies masquerade
# as `trunk` breakage. `--frozen-lockfile` is a sub-second no-op when in sync.
# `vp install` uses the pnpm `packageManager` pins. The fallback `vp` points
# into node_modules, which may not exist yet, so only the global CLI installs;
# without it, pnpm does (via corepack when available, else the one on PATH).
if [ -f "$PROJECT_DIR/pnpm-lock.yaml" ]; then
  log "syncing dependencies against the lockfile…"
  if [ -x "$VP_GLOBAL_BIN/vp" ]; then
    (cd "$PROJECT_DIR" && "$VP_GLOBAL_BIN/vp" install --frozen-lockfile >/dev/null 2>&1) \
      || log "dependency install failed; continuing"
  elif command -v corepack >/dev/null 2>&1; then
    (cd "$PROJECT_DIR" && corepack pnpm install --frozen-lockfile >/dev/null 2>&1) \
      || (cd "$PROJECT_DIR" && pnpm install --frozen-lockfile >/dev/null 2>&1) \
      || log "dependency install failed; continuing"
  else
    (cd "$PROJECT_DIR" && pnpm install --frozen-lockfile >/dev/null 2>&1) \
      || log "dependency install failed; continuing"
  fi
fi

# ── 4. First-checkout build ──────────────────────────────────────────────────
# `packages/svelte` resolves `@thomasfosterau/effect-forms` through its
# `exports`, which point at `dist/` (AGENTS.md: build before checking or
# testing on a clean checkout). The task cache makes this a no-op afterwards.
if [ ! -d "$PROJECT_DIR/packages/forms/dist" ] && [ -x "$PROJECT_DIR/node_modules/.bin/vp" ]; then
  log "building the packages for a clean checkout…"
  (cd "$PROJECT_DIR" && ./node_modules/.bin/vp run -r build >/dev/null 2>&1) \
    || log "initial build failed; continuing"
fi

exit 0

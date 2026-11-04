#!/usr/bin/env bash
# Milo Kit: VS Code theme + restyled Claude Code + Milo's Scroll notifications.
#
# Install or update:  curl -fsSL https://raw.githubusercontent.com/jaafarkhraizat/milo-kit/main/install.sh | bash
# Uninstall:          curl -fsSL https://raw.githubusercontent.com/jaafarkhraizat/milo-kit/main/install.sh | bash -s -- uninstall
#
# Options (env): MILO_EDITOR=code|code-insiders|cursor|codium   MILO_INITIALS=AB   MILO_SKIP=theme,scroll,fonts
set -euo pipefail

REPO="${MILO_KIT_REPO:-jaafarkhraizat/milo-kit}"
BRANCH="${MILO_KIT_BRANCH:-main}"
MODE="${1:-install}"

echo "Milo Kit: $MODE"

# ── Kit files: use this folder when run from a clone, otherwise download ─────
SELF="${BASH_SOURCE[0]:-}"
if [ -n "$SELF" ] && [ -f "$(dirname "$SELF")/lib/install.js" ]; then
  KIT="$(cd "$(dirname "$SELF")" && pwd)"
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$TMP"
  KIT="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
fi

# ── Editor CLI ───────────────────────────────────────────────────────────────
find_cli() {
  for c in ${MILO_EDITOR:-code code-insiders cursor codium}; do
    command -v "$c" >/dev/null 2>&1 && { command -v "$c"; return; }
  done
  for c in "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
           "/Applications/Cursor.app/Contents/Resources/app/bin/cursor"; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
}
CLI="$(find_cli || true)"
if [ -z "$CLI" ] && [ "$MODE" != uninstall ]; then
  echo "  x VS Code not found. Install it, then in VS Code run \"Shell Command: Install 'code' command in PATH\" and try again."
  exit 1
fi

# ── Node runtime: system node, or the one built into VS Code ─────────────────
if command -v node >/dev/null 2>&1; then
  NODE=(node)
else
  APP_ROOT="$(cd "$(dirname "$(readlink -f "$CLI" 2>/dev/null || echo "$CLI")")/../../.." 2>/dev/null && pwd || true)"
  for e in "$APP_ROOT/MacOS/Code" "$APP_ROOT/MacOS/Electron" "$APP_ROOT/MacOS/Cursor" /usr/share/code/code /usr/share/cursor/cursor; do
    [ -x "$e" ] && { NODE=(env ELECTRON_RUN_AS_NODE=1 "$e"); break; }
  done
fi
if [ -z "${NODE+x}" ]; then
  echo "  x Need Node.js (https://nodejs.org) or VS Code to run the installer."
  exit 1
fi

# ── Name for the chat avatar (first install only) ────────────────────────────
NAME=""
if [ "$MODE" = install ] && [ -z "${MILO_INITIALS:-}" ] && [ ! -f "$HOME/.milo-kit/state.json" ]; then
  DEFAULT="$(git config --global user.name 2>/dev/null || id -F 2>/dev/null || whoami)"
  if [ -r /dev/tty ]; then
    printf "  Your name, for the chat avatar [%s]: " "$DEFAULT"
    read -r NAME </dev/tty || true
  fi
  NAME="${NAME:-$DEFAULT}"
fi

MILO_KIT="$KIT" MILO_CLI="$CLI" MILO_NAME="$NAME" "${NODE[@]}" "$KIT/lib/install.js" "$MODE"

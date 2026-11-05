#!/usr/bin/env bash
# Milo Kit: VS Code theme + restyled Claude Code + Milo's Scroll notifications.
#
# Install or update:  curl -fsSL https://raw.githubusercontent.com/jaafarkhraizat/milo-kit/main/install.sh | bash
# Uninstall:          curl -fsSL https://raw.githubusercontent.com/jaafarkhraizat/milo-kit/main/install.sh | bash -s -- uninstall
#
# Options (env): MILO_EDITOR=code|code-insiders|cursor|codium   MILO_INITIALS=AB   MILO_SKIP=theme,scroll,fonts,usage
#                MILO_ASK=1 (ask the setup questions again on an update)
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

# ── Setup questions (first install, or MILO_ASK=1). Enter keeps the default. ─
ask() { # ask "Question" default -> answer in REPLY
  printf "  %s " "$1"
  REPLY=""
  read -r REPLY </dev/tty || true
  REPLY="${REPLY:-$2}"
}
yn() { case "$1" in [Nn]*) echo n ;; *) echo y ;; esac; }
if [ "$MODE" = install ] && [ -r /dev/tty ] && { [ ! -f "$HOME/.milo-kit/state.json" ] || [ "${MILO_ASK:-}" = 1 ]; }; then
  echo
  echo "  How do you want to set up?"
  echo "    1  Everything, kit defaults (recommended)"
  echo "    2  Let me choose"
  ask "›" 1
  if [ "$REPLY" = 2 ]; then
    echo
    ask "Accent color   1 Blue  2 Orange  3 Green  4 Purple  5 Pink  [1]:" 1
    case "$REPLY" in 2) A=orange ;; 3) A=green ;; 4) A=purple ;; 5) A=pink ;; *) A=blue ;; esac
    ask "Theme          1 Milo  2 Ember  3 Moss  4 Ink  [1]:" 1
    case "$REPLY" in 2) P=ember ;; 3) P=moss ;; 4) P=ink ;; *) P=milo ;; esac
    export MILO_SETUP_PRESET="$P" MILO_SETUP_ACCENT="$A"
    case ",${MILO_SKIP:-}," in *,fonts,*) ;; *)
      ask "Install fonts (Geist, Geist Mono)?         [Y/n]:" y
      [ "$(yn "$REPLY")" = n ] && MILO_SKIP="${MILO_SKIP:+$MILO_SKIP,}fonts" ;;
    esac
    ask "Milo's Scroll desktop notifications?       [Y/n]:" y; export MILO_SETUP_SCROLL="$(yn "$REPLY")"
    ask "Usage summary after each reply?            [Y/n]:" y; export MILO_SETUP_USAGE="$(yn "$REPLY")"
    ask "Chat extras (map, pinned prompt, badges)?  [Y/n]:" y; export MILO_SETUP_CHAT="$(yn "$REPLY")"
  fi
  export MILO_SKIP="${MILO_SKIP:-}"
fi

MILO_KIT="$KIT" MILO_CLI="$CLI" MILO_NAME="$NAME" "${NODE[@]}" "$KIT/lib/install.js" "$MODE"

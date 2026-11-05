#!/usr/bin/env bash
# Maintainer only. Syncs the kit from your live settings and pushes it to GitHub.
# Usage: scripts/publish.sh "commit message"
set -euo pipefail

KIT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="jaafarkhraizat/milo-kit"
WORK="$KIT/../../Temp/milo-kit-publish"
MSG="${1:-Update kit}"

node "$KIT/scripts/sync-from-live.js"

if [ ! -d "$WORK/.git" ]; then
  mkdir -p "$(dirname "$WORK")"
  gh repo clone "$REPO" "$WORK"
fi
git -C "$WORK" pull --ff-only --quiet || true

# .!* = partial-copy temp files (iCloud / Finder); *.bak = local backups. Never publish either.
# docs/ = internal design notes. Never published.
node "$KIT/scripts/build-extension.js"
rsync -a --delete --exclude .git --exclude .DS_Store --exclude '.!*' --exclude '*.bak' --exclude /docs/ "$KIT/" "$WORK/"
# last guard: nothing personal or machine-specific goes public
if grep -rIl -E "/Users/|Archive Zero|iCloud Drive|jaafarkhraizat@|sk-ant-|ghp_" "$WORK" --exclude-dir=.git --exclude=publish.sh --exclude=sync-from-live.js; then
  echo "Refusing to publish: personal data in the files above." >&2
  exit 1
fi
git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "Nothing changed."
  exit 0
fi
git -C "$WORK" commit -q -m "$MSG"
git -C "$WORK" push -q origin HEAD:main
echo "Published: https://github.com/$REPO"

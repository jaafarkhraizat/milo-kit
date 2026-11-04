#!/bin/sh
# Milo's Scroll: Claude Code hook. Reads the hook JSON on stdin and shows Milo's overlay. macOS only.
# Test without Claude: scroll.sh test complete|question|permission|idle|limit
[ "$(uname)" = Darwin ] || exit 0
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "$1" = test ]; then
  input="{\"test\":\"${2:-complete}\"}"
else
  input=$(cat)
fi

# Stack below scrolls already on screen.
slot=$(pgrep -f "$DIR/overlay.js" | wc -l | tr -d ' ')
bundle="${__CFBundleIdentifier:-}"
[ -z "$bundle" ] && [ "$TERM_PROGRAM" = vscode ] && bundle=com.microsoft.VSCode

# Hook JSON goes over stdin, not argv: argv is visible to every local user in `ps`, and Stop hooks carry Claude's last message.
printf '%s' "$input" | nohup osascript -l JavaScript "$DIR/overlay.js" - "$slot" "$bundle" "$DIR" >/dev/null 2>&1 &
exit 0

---
name: scroll
description: Control Milo's Scroll, the desktop overlay that announces when Claude finishes, asks a question, needs permission, sits idle, or compacts. Use when the user wants to turn the scroll on or off, test it, move it, or change how long it stays.
---

# Milo's Scroll

Milo's Scroll shows a frosted-glass card with Milo and a court phrase when Claude Code needs attention. Green means news. Orange means Claude needs an answer. Click the card to jump back to the editor. macOS only.

Files live in `~/.claude/milos-scroll/`:

| File | Role |
|---|---|
| `config.json` | Settings (below) |
| `scroll.sh` | Hook entry point |
| `overlay.js` | The card. Edit the `PHRASES` table at the top to change wording |
| `milo.png` | Milo |

## Settings (`config.json`)

| Key | Values | Default |
|---|---|---|
| `enabled` | `true` / `false` | `true` |
| `position` | `top-center`, `top-left`, `top-right`, `bottom-center`, `bottom-left`, `bottom-right` | `top-center` |
| `seconds` | Seconds on screen. `0` keeps it until clicked | `4` |
| `all_screens` | `true` shows on every display, `false` only where the mouse is | `true` |

## What to do

Read `~/.claude/milos-scroll/config.json`, change only the keys the user asked for, write it back as JSON, and confirm the change in one line. Changes apply to the next announcement. No restart.

- "scroll off" / "mute scroll": `enabled: false`
- "scroll on": `enabled: true`
- "move the scroll to the bottom right": `position: "bottom-right"`
- "keep it longer": raise `seconds`
- "test scroll" or "show me the scroll": run `~/.claude/milos-scroll/scroll.sh test complete` (or `question`, `permission`, `idle`, `limit`)

## When it speaks

| Claude Code event | Scroll type | Color |
|---|---|---|
| `Stop` | complete | green |
| `Notification` with `elicitation_dialog` | question | orange |
| `PermissionRequest` | permission | orange |
| `Notification` with `idle_prompt` (not within 1 h of a complete) | idle | green |
| `PreCompact` | limit | green |

# Milo Kit

A dark VS Code theme with a restyled Claude Code, plus Milo's Scroll: a desktop card that tells you when Claude is done or needs you.

## Install or update

```sh
curl -fsSL https://raw.githubusercontent.com/jaafarkhraizat/milo-kit/main/install.sh | bash
```

Run the same command again to update. Your own settings stay; only the kit's settings are replaced.

Then, in VS Code: Command Palette > **Custom UI Style: Reload**. VS Code restarts. If it says the install "appears to be corrupt", choose **Don't show again**. Custom UI Style causes that warning.

## What you get

**Theme**
- Theme Mix colors with darker side bars, pill tabs and rounded floating panels
- Geist and Geist Mono type, RemixIcon product icons, Symbols file icons
- Status bar shows only your Claude usage, yellow at 80%, red at 90%

**Claude Code**
- Green accent, colored headings, links and inline code, color chips for hex values
- Your initials beside your messages, Claude's avatar beside replies
- Cleaner sessions panel: account and usage in one card, a clear "New session" button
- Milo on the empty chat screen
- Tab icons that show state: idle, working, done, needs you

**Milo's Scroll** (macOS)
- A frosted card with Milo and a short court phrase when Claude finishes, asks a question, needs permission, sits idle, or compacts
- Green for news, orange when Claude needs an answer. Click it to jump back to VS Code
- No sound
- Ask Claude to change it with `/scroll`: turn it off, move it, keep it on screen longer, or test it

## Options

Set before `bash`, for example `curl ... | MILO_SKIP=scroll bash`.

| Variable | Use |
|---|---|
| `MILO_EDITOR` | `code` (default), `code-insiders`, `cursor` or `codium` |
| `MILO_INITIALS` | Avatar initials. Default: from your name, asked on first install |
| `MILO_SKIP` | Comma list of `theme`, `scroll`, `fonts` to leave out |

## Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/jaafarkhraizat/milo-kit/main/install.sh | bash -s -- uninstall
```

Then Command Palette > **Custom UI Style: Rollback**. Uninstall restores the settings you had before the first install and removes Milo's Scroll.

## Notes

- Needs VS Code (or Insiders, Cursor, VSCodium) and Claude Code. Uses your Node.js if you have it, otherwise the one inside VS Code.
- Claude Code updates can rename the classes and code the kit styles. The installer skips any Claude Code patch that no longer matches and tells you. Run the install again after a Claude Code update.
- Tested on macOS. Linux should work for the theme. Milo's Scroll is macOS only. Windows is not supported.

## Credits

[Theme Mix](https://marketplace.visualstudio.com/items?itemName=tal7aouy.theme), [Symbols](https://marketplace.visualstudio.com/items?itemName=miguelsolorio.symbols), [Custom UI Style](https://marketplace.visualstudio.com/items?itemName=subframe7536.custom-ui-style), [Claude Usage Bar](https://marketplace.visualstudio.com/items?itemName=harshagarwal1012.claude-usage-bar), [RemixIcon](https://github.com/Remix-Design/RemixIcon) (Apache-2.0), [Geist](https://github.com/vercel/geist-font), [jsonc-parser](https://github.com/microsoft/node-jsonc-parser) (MIT).

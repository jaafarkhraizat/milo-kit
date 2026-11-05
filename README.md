<div align="center">

# Milo Kit

A dark VS Code theme with a restyled Claude Code, plus **Milo's Scroll**:<br>
a desktop card that tells you when Claude is done or needs you.

**macOS** · VS Code, Insiders, Cursor or VSCodium · Claude Code

[Install](#install) · [Update](#update) · [What you get](#what-you-get) · [Settings](#settings) · [Options](#options) · [Uninstall](#uninstall) · [Troubleshooting](#troubleshooting)

</div>

---

## Install

**1. Run this in Terminal**

```sh
curl -fsSL https://raw.githubusercontent.com/jaafarkhraizat/milo-kit/main/install.sh | bash
```

On first install it asks for your name (your initials become the chat avatar), then how to set up:

- **Everything** (press Enter): the kit as designed.
- **Let me choose**: pick an accent color and a theme, and say yes or no to fonts, Milo's Scroll, the usage summary and the chat extras.

You can change all of it later in **Milo Kit settings** (see [Settings](#settings)).

**2. Reload VS Code**

Open the Command Palette (`Cmd+Shift+P`) and run **Custom UI Style: Reload**. VS Code restarts with the kit applied.

> [!NOTE]
> If VS Code says your installation "appears to be corrupt", choose **Don't show again**. Custom UI Style causes this warning. Nothing is broken.

<details>
<summary><b>What the installer changes on your machine</b></summary>

<br>

| Part | What happens |
|---|---|
| Extensions | Installs Theme Mix, Symbols, Custom UI Style, Claude Code, Claude Usage Bar, the bundled RemixIcon product icons and Milo Kit settings |
| Your choices | Saved in `~/.milo-kit/config.json`, with a copy of the kit's helper files in `~/.milo-kit/kit/` |
| Fonts | Installs Geist and Geist Mono if you don't have them |
| VS Code settings | Merges the kit's settings into yours. Your other settings stay as they are |
| Backup | Saves your original settings before the first install, so uninstall can restore them |
| Milo's Scroll | Adds the notification card and the Claude Code hooks that trigger it |
| Usage summary | Adds a hook that sums up your Claude Code usage from local history after each reply |

</details>

---

## Update

> [!IMPORTANT]
> **Updates don't install themselves.** The installer copies the kit once and never checks GitHub again. When a new version comes out, your VS Code keeps the version you installed until you update it yourself.

To update, do the same two steps as the install:

1. Run the install command again:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/jaafarkhraizat/milo-kit/main/install.sh | bash
   ```

2. In VS Code, run **Custom UI Style: Reload** from the Command Palette.

Your own settings, your avatar initials and everything you chose in Milo Kit settings stay. To answer the setup questions again, put `MILO_ASK=1` before `bash`.

**When to update**

- When the kit has a new version. See the [commit history](https://github.com/jaafarkhraizat/milo-kit/commits/main).
- After every **Claude Code update**. Claude Code updates can rename the parts the kit restyles. Running the install again brings those parts back.

---

## What you get

### Theme

- Theme Mix colors with darker side bars, pill tabs and rounded floating panels
- Geist and Geist Mono type, RemixIcon product icons, Symbols file icons
- Status bar shows only your Claude usage: yellow at 80%, red at 90%

### Claude Code

<details open>
<summary><b>Look</b></summary>

<br>

- Blue accent, colored headings, links and inline code, color chips for hex values
- Your initials beside your messages, Claude's avatar beside replies
- Cleaner sessions panel: account and usage in one card, a clear **New session** button
- Milo on the empty chat screen
- Tab icons that show state: idle, working, done, needs you
- Small previews of images Claude reads, right under the "Read file.png" line

</details>

<details open>
<summary><b>Chat header</b></summary>

<br>

- Your usage, with only Bookmarks and the chat map on the right
- Tokens spent in the chat, a small number left of Bookmarks. Hover for input, output and cache figures
- MCP servers used in the chat, as overlapping logo avatars. Hover one for its calls and tools. Logos ship with the kit, so nothing is fetched
- A tasks badge. Click it for task and agent details

</details>

<details open>
<summary><b>Working in the chat</b></summary>

<br>

- **Chat map:** a minimap of the whole conversation, opened from the header. Click or drag to move, hover a blue bar to preview a prompt
- **Pinned prompt:** your last prompt pins to the top only while you scroll up
- **Expand:** click a long message to open it in full
- **Queued messages:** messages you send while Claude works show in the chat, greyed, with Edit and Delete until Claude takes them
- **Agents chip** in the message box. Click it for task and agent details
- **Rename:** right-click a Claude tab to rename the session

</details>

### Milo's Scroll

- A frosted card with Milo and a short court phrase when Claude finishes, asks a question, needs permission, sits idle, or compacts
- Blue for news, orange when Claude needs an answer. Click it to jump back to VS Code
- No sound
- Change it in Milo Kit settings, or by asking Claude with `/scroll`: turn it off, move it, keep it on screen longer, or test it

---

## Settings

Open the **"..."** menu at the top right of any editor and choose **Milo Kit settings**. The Command Palette has it too.

| Section | What you can change |
|---|---|
| Look | Presets (Milo, Ember, Moss, Ink), accent, backgrounds, text colors, corners |
| Icons and fonts | Interface icons, file icons (any pack you have installed), interface and code fonts, code size |
| Chat features | Each extra on or off: avatars and initials, Milo, tab icons, image previews, token count, MCP avatars, tasks, chat map, pinned prompt, expand, queued messages, rename |
| Milo's Scroll | On or off, which events show it, position, how long it stays, a soft chime, a test card |
| Status bar | Usage only, which limit, progress bar, when it turns yellow and red, the usage summary |

The preview on the right updates as you choose. **Save** applies your changes. Color, corner and feature changes reload VS Code; the rest applies right away. **Reset to defaults** brings back the kit as designed.

---

## Options

Set options before `bash`:

```sh
curl -fsSL https://raw.githubusercontent.com/jaafarkhraizat/milo-kit/main/install.sh | MILO_SKIP=scroll bash
```

| Variable | What it does | Values |
|---|---|---|
| `MILO_EDITOR` | Which editor to install into | `code` (default), `code-insiders`, `cursor`, `codium` |
| `MILO_INITIALS` | Avatar initials, skips the name question | Up to 3 letters, e.g. `AB` |
| `MILO_SKIP` | Parts to leave out, comma separated | `theme`, `scroll`, `fonts`, `usage` |
| `MILO_ASK` | Ask the setup questions again on an update | `1` |

---

## Uninstall

**1. Run this in Terminal**

```sh
curl -fsSL https://raw.githubusercontent.com/jaafarkhraizat/milo-kit/main/install.sh | bash -s -- uninstall
```

**2. Roll back VS Code**

Open the Command Palette and run **Custom UI Style: Rollback**, then restart VS Code.

This restores the settings you had before the first install and removes Milo's Scroll and the usage summary.

---

## Troubleshooting

<details>
<summary><b>Nothing changed after installing</b></summary>

<br>

Run **Custom UI Style: Reload** from the Command Palette. The kit only shows after VS Code restarts.

</details>

<details>
<summary><b>Some Claude Code styling stopped working</b></summary>

<br>

Claude Code probably updated. Run the install command again, then **Custom UI Style: Reload**. If a part still doesn't match the new Claude Code, the installer skips it and tells you which one.

</details>

<details>
<summary><b>"VS Code not found"</b></summary>

<br>

In VS Code, open the Command Palette and run **Shell Command: Install 'code' command in PATH**. Then run the installer again.

</details>

<details>
<summary><b>"Need Node.js"</b></summary>

<br>

The installer uses your Node.js, or the one inside VS Code. If it can't find either, install Node.js from [nodejs.org](https://nodejs.org) and try again.

</details>

---

## Requirements

- VS Code, VS Code Insiders, Cursor or VSCodium, with Claude Code
- macOS. Linux should work for the theme. Milo's Scroll is macOS only. Windows is not supported

## Credits

[Theme Mix](https://marketplace.visualstudio.com/items?itemName=tal7aouy.theme) · [Symbols](https://marketplace.visualstudio.com/items?itemName=miguelsolorio.symbols) · [Custom UI Style](https://marketplace.visualstudio.com/items?itemName=subframe7536.custom-ui-style) · [Claude Usage Bar](https://marketplace.visualstudio.com/items?itemName=harshagarwal1012.claude-usage-bar) · [RemixIcon](https://github.com/Remix-Design/RemixIcon) (Apache-2.0) · [Geist](https://github.com/vercel/geist-font) · [jsonc-parser](https://github.com/microsoft/node-jsonc-parser) (MIT)

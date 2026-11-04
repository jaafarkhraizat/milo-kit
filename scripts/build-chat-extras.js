#!/usr/bin/env node
// Maintainer only. Writes src/chat-extras.js + its styles + the tab rename menu into your live VS Code settings.
// Usage: node scripts/build-chat-extras.js [path/to/settings.json]
// Safe to re-run: the script is kept between /*mk-chat*/ markers and rules are replaced by selector.

const fs = require('fs');
const os = require('os');
const path = require('path');
const jsonc = require('../lib/vendor/jsonc-parser/main.js');

const file = process.argv[2] || path.join(os.homedir(), 'Library/Application Support/Code/User/settings.json');
const FMT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } };
const EXT = 'custom-ui-style.extensions.config';
const WV = 'custom-ui-style.webview.stylesheet';
let text = fs.readFileSync(file, 'utf8');
const data = () => jsonc.parse(text, [], { allowTrailingComma: true });
const set = (keyPath, value) => { text = jsonc.applyEdits(text, jsonc.modify(text, keyPath, value, FMT)); };

// ── 1. chat script into the webview/index.js patch ──
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'chat-extras.js'), 'utf8');
if (src.includes('$')) throw new Error('src/chat-extras.js must not contain "$" (it is a String.replace replacement)');
const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').trim();
const block = `/*mk-chat*/${code}/*/mk-chat*/`;
const patches = data()[EXT]['anthropic.claude-code'];
const wi = patches.findIndex((p) => p.filePath === 'webview/index.js');
if (wi < 0) throw new Error('webview/index.js patch not found');
let rep = patches[wi].replace.replace(/\/\*mk-chat\*\/[\s\S]*?\/\*\/mk-chat\*\//, '');
set([EXT, 'anthropic.claude-code', wi, 'replace'], rep + block);

// ── 2. "Rename Session Tab" on the tab right-click menu (package.json patch) ──
const menu = '"editor/title/context": [{ "command": "claude-vscode.renameSessionTab", "when": "activeWebviewPanelId == \'claudeVSCodePanel\'", "group": "1_claude" }],\n"editor/title": [';
const pi = data()[EXT]['anthropic.claude-code'].findIndex((p) => p.filePath === 'package.json');
const pkgPatch = { filePath: 'package.json', find: '"editor/title": [', replace: menu };
set([EXT, 'anthropic.claude-code', pi < 0 ? data()[EXT]['anthropic.claude-code'].length : pi], pkgPatch);

// ── 2b. ONE patch per file ──
// Custom UI Style applies every entry to the untouched backup and writes the file, so a second entry for the
// same file wipes the first. Patches for one file are merged into a single regex here.
const unwrap = (f) => { const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(f); if (!m) throw new Error('regex find expected: ' + f.slice(0, 60)); return m[1]; };
const groupsIn = (src) => new RegExp(src + '|').exec('').length - 1;
// renumber backreferences (\N) and replacement refs ($N) at or above `from` by `by`
const shiftFind = (src, by, from = 1) => src.replace(/\\([1-9]\d*)/g, (all, n) => (Number(n) >= from ? '\\' + (Number(n) + by) : all));
const shiftRep = (rep, by, from = 1) => rep.replace(/\$([1-9]\d?)/g, (all, n) => (Number(n) >= from ? '$' + (Number(n) + by) : all));

// a) send button reports Claude's busy state (data-mk-busy): folded into the big webview patch, inside the
//    lazy gap that spans the send button (the gap right before the "statuses.length+" block).
const BUSY_SRC = 'className:([\\w$]+)\\.sendButton,"data-permission-mode":([\\w$]+),"aria-label":([\\w$]+),onClick:\\(([\\w$]+)\\)=>\\{if\\(([\\w$]+)\\.busy\\.value';
const BUSY_REP = 'className:$1.sendButton,"data-permission-mode":$2,"data-mk-busy":(window.__mkS=$5,$5.busy.value?"1":"0"),"aria-label":$3,onClick:($4)=>{if($5.busy.value';
{
  let list = data()[EXT]['anthropic.claude-code'];
  list = list.filter((p) => !(p.filePath === 'webview/index.js' && p.find.includes('sendButton') && !p.find.includes('signOut')));
  const big = list.find((p) => p.filePath === 'webview/index.js');
  if (!big.find.includes('\\.sendButton')) {
    const src = unwrap(big.find);
    const GAP = 14; // ([\s\S]*?) between the accountRow block and the statuses block
    const gaps = [...src.matchAll(/\(\[\\s\\S\]\*\?\)/g)];
    // find the GAP-th capture group's text position
    let count = 0, at = -1;
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '\\') { i++; continue; }
      if (src[i] === '(' && src[i + 1] !== '?') { count++; if (count === GAP) { at = i; break; } }
    }
    if (at < 0 || !src.startsWith('([\\s\\S]*?)', at) || !gaps.length) throw new Error('gap group not found');
    const add = groupsIn(BUSY_SRC) + 1; // busy groups + the new trailing gap
    const head = src.slice(0, at), tail = src.slice(at + '([\\s\\S]*?)'.length);
    const merged = head + '([\\s\\S]*?)' + shiftFind(BUSY_SRC, GAP) + '([\\s\\S]*?)' + shiftFind(tail, add, GAP + 1);
    let rep = shiftRep(big.replace, add, GAP + 1);
    rep = rep.replace('$' + GAP, () => '$' + GAP + shiftRep(BUSY_REP, GAP) + '$' + (GAP + add));
    big.find = '/' + merged + '/';
    big.replace = rep;
  }
  // the send button also hands its session to the page script (window.__mkS) for the agents chip and tasks badge
  big.replace = big.replace.replace(/"data-mk-busy":\$(\d+)\.busy\.value\?"1":"0"/, (all, n) => '"data-mk-busy":(window.__mkS=$' + n + ',$' + n + '.busy.value?"1":"0")');
  // b) extension.js: chain all entries in file order (each must match once, no overlap)
  const ext = list.filter((p) => p.filePath === 'extension.js');
  if (ext.length > 1) {
    let src = '', rep = '', n = 0;
    ext.forEach((p, i) => {
      const s = unwrap(p.find), g = groupsIn(s);
      if (i > 0) { n++; src += '([\\s\\S]*?)'; rep += '$' + n; }
      src += shiftFind(s, n); rep += shiftRep(p.replace, n); n += g;
    });
    list = list.filter((p) => p.filePath !== 'extension.js');
    list.unshift({ filePath: 'extension.js', find: '/' + src + '/', replace: rep });
  }
  const files = list.map((p) => p.filePath);
  if (new Set(files).size !== files.length) throw new Error('still more than one patch for a file: ' + files.join(', '));
  set([EXT, 'anthropic.claude-code'], list);
}

// ── 3. styles ──
const rules = {
  // your message bubble: tight bottom-left corner next to the avatar
  '[class^="userMessage_"], [class*=" userMessage_"]': { 'border-radius': '16px 16px 16px 6px !important' },
  // header: usage on the left, no title, only Bookmarks + Chat map on the right
  '[class*="header_"] > [class*="titleGroup_"]': { 'display': 'none !important' },
  '[class*="header_"]:has(> .ccUsage) > button[aria-label="Session history"], [class*="header_"]:has(> .ccUsage) > button[aria-label="New session"], [class*="header_"]:has(> .ccUsage) > button[aria-label="Learn Claude Code"]': { 'display': 'none !important' },
  '.ccUsage': { 'margin': '0 8px 0 4px' },
  // chat map toggle: matches Claude's header icon buttons (28 px, ghost hover); lit only on hover, keyboard focus or open
  '.mkMapToggle': {
    'display': 'inline-grid', 'place-items': 'center', 'flex': 'none', 'width': '28px', 'height': '28px', 'padding': '0', 'margin': '0',
    'appearance': 'none', 'border': '0', 'border-radius': '8px', 'background': 'transparent', 'color': 'var(--app-secondary-foreground)',
    'cursor': 'pointer', 'outline': 'none', 'transition': 'background 120ms cubic-bezier(.4, 0, .2, 1), color 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkMapToggle > svg': { 'display': 'block' },
  '.mkMapToggle:hover': { 'background': 'var(--app-ghost-button-hover-background)', 'color': 'var(--app-primary-foreground)' },
  '.mkMapToggle:focus:not(:focus-visible):not(:hover)': { 'background': 'transparent', 'color': 'var(--app-secondary-foreground)' },
  '.mkMapToggle:focus-visible': { 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' },
  '.mkMapToggle[aria-pressed="true"]': { 'color': '#82a9f5 !important', 'background': 'rgba(63, 116, 224, 0.16) !important', 'border-radius': '8px' },
  // tokens spent in this chat, left of Bookmarks: small, muted, brightens on hover for the breakdown tooltip
  '.mkTokens': {
    'display': 'inline-flex', 'align-items': 'center', 'flex': 'none', 'margin-right': '2px', 'padding': '0 2px',
    'font': "400 10.5px/1 'Geist Mono', 'JetBrains Mono', Menlo, monospace", 'font-variant-numeric': 'tabular-nums', 'letter-spacing': '0.01em',
    'color': '#5f6571', 'cursor': 'default', 'user-select': 'none', 'white-space': 'nowrap', 'transition': 'color 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkTokens:empty': { 'display': 'none' },
  // MCP servers used in this chat: overlapping 20 px logo avatars. Each later one is masked with a crescent where
  // the previous overlaps (previous centre sits at -4 px; 10 px radius + 2 px gap = 12 px cut), so no ring colour is needed.
  '.mkMcp': { 'display': 'inline-flex', 'align-items': 'center', 'flex': 'none', 'margin': '0 4px', 'padding': '0 2px' },
  '.mkMcp[hidden]': { 'display': 'none !important' },
  '.mkMcpAv': {
    'position': 'relative', 'display': 'inline-grid', 'place-items': 'center', 'flex': 'none', 'width': '20px', 'height': '20px', 'border-radius': '50%',
    'box-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, 0.14)', 'font': "600 10px/1 Geist, sans-serif", 'cursor': 'default', 'user-select': 'none',
    'animation': 'mkFade 160ms cubic-bezier(.2, .8, .2, 1)', 'transition': 'filter 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkMcpAv + .mkMcpAv': {
    'margin-left': '-6px',
    '-webkit-mask': 'radial-gradient(circle 12px at -4px 50%, transparent 11.5px, #000 12px)',
    'mask': 'radial-gradient(circle 12px at -4px 50%, transparent 11.5px, #000 12px)',
  },
  '.mkMcpAv:hover': { 'filter': 'brightness(1.15)' },
  '.mkMcpAv > svg': { 'display': 'block' },
  // overflow count: a pill that grows with "+N" (the crescent on its left only depends on the circle before it)
  '.mkMcpMore': {
    'width': 'auto', 'min-width': '20px', 'padding': '0 5px 0 8px', 'border-radius': '999px', 'box-sizing': 'border-box',
    'background': 'rgba(255, 255, 255, 0.08) !important', 'color': '#9aa3b2 !important', 'font': "500 9.5px/1 'Geist Mono', Menlo, monospace",
  },
  '.mkTokens:hover': { 'color': '#8b919c' },
  // prompt reveal: pinned only while you scroll up
  'html[data-mk-reveal] [class*="message_"][class*="stickyHeader_"]': {
    'position': 'sticky !important', 'top': '0', 'background-image': 'linear-gradient(to bottom, var(--app-primary-background) calc(100% - 14px), transparent) !important',
  },
  // Slides down from behind the chat's top edge, fully opaque (no fade, so chat text never shows through it).
  // Transitions, not keyframes: a reversal mid-flight continues from where the bubble is instead of restarting.
  // "pre" = parked above the edge (no transition) for one style flush; "in" eases out to rest; "out" eases in back up.
  'html[data-mk-reveal] [data-mk-stuck]': { 'will-change': 'transform' },
  'html[data-mk-reveal="pre"] [data-mk-stuck]': { 'transform': 'translate3d(0, -100%, 0)', 'transition': 'none' },
  'html[data-mk-reveal="in"] [data-mk-stuck]': { 'transform': 'translate3d(0, 0, 0)', 'transition': 'transform 240ms cubic-bezier(.2, .8, .2, 1)' },
  'html[data-mk-reveal="out"] [data-mk-stuck]': { 'transform': 'translate3d(0, -100%, 0)', 'transition': 'transform 160ms cubic-bezier(.4, 0, 1, 1)' },
  // click a collapsed message to expand it
  '[class*="expandableContainer_"]:has([class*="collapsed_"]) [class*="content_"]': { 'cursor': 'pointer' },
  // held messages (sent while Claude is busy): in place like a sent bubble, lighter, dashed edge, Edit / Delete
  '.mkHeld': { 'display': 'flex', 'flex-direction': 'column', 'align-items': 'flex-start', 'gap': '4px', 'margin': '14px 0 4px', 'padding-left': '30px', 'animation': 'mkFade 160ms cubic-bezier(.2, .8, .2, 1)' },
  '.mkHeldRow': { 'position': 'relative', 'max-width': '100%' },
  '.mkHeldAv': {
    'position': 'absolute', 'left': '-29px', 'bottom': '0', 'width': '22px', 'height': '22px', 'border-radius': '50%', 'font': '600 9px/22px Geist, sans-serif',
    'font-style': 'normal', 'text-align': 'center', 'letter-spacing': '0.02em', 'color': 'rgba(255, 255, 255, 0.8)', 'background': 'rgba(63, 116, 224, 0.38)',
  },
  '.mkHeldBubble': {
    'max-width': '100%', 'box-sizing': 'border-box', 'padding': '9px 14px', 'border-radius': '16px 16px 16px 6px', 'white-space': 'pre-wrap', 'word-break': 'break-word',
    'background': 'rgba(130, 169, 245, 0.07)', 'border': '1px dashed rgba(130, 169, 245, 0.32)', 'color': '#b4bfd2',
  },
  '.mkHeld[data-state="editing"] .mkHeldRow': { 'width': '100%' },
  '.mkHeld[data-state="editing"] .mkHeldBubble': { 'width': '100%', 'padding': '4px', 'border-style': 'solid', 'border-color': 'rgba(130, 169, 245, 0.55)', 'background': 'rgba(63, 116, 224, 0.08)' },
  '.mkHeld textarea': {
    'display': 'block', 'width': '100%', 'box-sizing': 'border-box', 'resize': 'none', 'padding': '6px 10px', 'border': '0', 'border-radius': '12px',
    'background': 'transparent', 'color': '#eceef2', 'font': 'inherit', 'line-height': '1.5', 'outline': 'none',
  },
  '.mkHeldMeta': { 'display': 'flex', 'align-items': 'center', 'gap': '2px', 'padding-left': '6px', 'font': '500 11px/22px Geist, sans-serif', 'color': '#6f7785' },
  '.mkHeldMeta > span': { 'margin-right': '6px' },
  '.mkHeld[data-state="sent"] .mkHeldMeta > span::before': { 'content': "''", 'display': 'inline-block', 'width': '6px', 'height': '6px', 'margin-right': '6px', 'border-radius': '50%', 'background': '#82a9f5', 'vertical-align': '1px', 'animation': 'mkPulse 1.6s cubic-bezier(.4, 0, .2, 1) infinite' },
  '.mkHeldMeta > button': {
    'width': '22px', 'height': '22px', 'padding': '0', 'display': 'grid', 'place-items': 'center', 'border': '0', 'border-radius': '8px',
    'background': 'transparent', 'color': '#8b919c', 'cursor': 'pointer', 'transition': 'background 120ms, color 120ms',
  },
  '.mkHeldMeta > button:hover': { 'background': 'var(--mk-glass-hover)', 'color': '#eceef2' },
  '.mkHeldMeta > button:focus-visible': { 'outline': 'none', 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' },
  // agents chip (message box), tasks badge (header), details panel
  '[class*="agentsPill_"]': { 'display': 'none !important' },
  '.mkAgents, .mkTasks': {
    'display': 'inline-flex', 'align-items': 'center', 'gap': '6px', 'flex': 'none', 'cursor': 'pointer', 'border-radius': '999px',
    'border': '1px solid var(--mk-edge)', 'background': 'var(--mk-glass)', 'color': '#c8ccd4', 'box-shadow': 'var(--mk-hi)',
    'font': '500 12px/1 Geist, sans-serif', 'transition': 'background 120ms, color 120ms, border-color 120ms',
  },
  '.mkAgents': {
    'height': '24px', 'padding': '0 8px 0 6px', 'gap': '5px', 'margin-right': '4px',
    'font-family': 'inherit', 'font-size': '0.85em', 'font-weight': '400', 'line-height': '1', 'color': 'var(--app-secondary-foreground, #8b919c)',
  },
  '.mkAgents > svg': { 'width': '13px', 'height': '13px' },
  '.mkAgents > i': { 'width': '5px', 'height': '5px', 'border-radius': '50%', 'background': '#5f6571', 'flex': 'none' },
  '.mkTasks': { 'display': 'inline-flex !important', 'width': 'auto !important', 'flex-direction': 'row !important', 'white-space': 'nowrap', 'height': '22px', 'padding': '0 9px 0 7px', 'margin': '0 4px', 'font-size': '11px', 'color': '#9aa3b2', 'background': 'transparent' },
  '.mkTasks[hidden], .mkPanel[hidden]': { 'display': 'none !important' },
  '.mkAgents:disabled, .mkTasks:disabled': { 'cursor': 'default', 'color': '#5f6571 !important', 'background': 'transparent !important', 'border-color': 'rgba(255, 255, 255, 0.05) !important' },
  '.mkAgents:disabled > svg, .mkTasks:disabled > svg': { 'opacity': '0.6' },
  '.mkAgents:not(:disabled):hover, .mkTasks:not(:disabled):hover': { 'background': 'var(--mk-glass-hover)', 'color': '#eceef2' },
  '.mkAgents:focus-visible, .mkTasks:focus-visible, .mkPanel button:focus-visible': { 'outline': 'none', 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' },
  '.mkAgents[data-state="working"] > i': { 'background': '#82a9f5', 'animation': 'mkPulse 1.6s cubic-bezier(.4, 0, .2, 1) infinite' },
  '.mkAgents[data-state="waiting"] > i': { 'background': '#e5c07b' },
  '.mkAgents[data-state="working"], .mkTasks[data-state="working"]': { 'color': '#cfe0ff', 'border-color': 'rgba(130, 169, 245, 0.3)' },
  '.mkAgents[data-state="waiting"], .mkTasks[data-state="waiting"]': { 'color': '#f0d9a8', 'border-color': 'rgba(229, 192, 123, 0.35)' },
  '.mkPanel': {
    'position': 'fixed', 'z-index': '60', 'max-height': '64vh', 'overflow': 'auto', 'box-sizing': 'border-box', 'padding': '0',
    'border-radius': '12px', 'background': 'var(--mk-glass-float)', 'border': '1px solid var(--mk-edge-strong)',
    'box-shadow': 'var(--mk-hi), var(--mk-shadow-lg)', 'backdrop-filter': 'var(--mk-blur)', '-webkit-backdrop-filter': 'var(--mk-blur)',
    'color': '#c8ccd4', 'font': '12px/1.45 Geist, sans-serif', 'animation': 'mkRise 180ms cubic-bezier(.2, .8, .2, 1)',
  },
  '.mkPanel header': { 'padding': '14px 14px 12px', 'border-bottom': '1px solid rgba(255, 255, 255, 0.06)' },
  '.mkPHead': { 'display': 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'gap': '10px' },
  '.mkPHead strong': { 'font-size': '13px', 'font-weight': '600', 'color': '#eceef2', 'letter-spacing': '-0.005em' },
  '.mkProgress': { 'display': 'flex', 'justify-content': 'space-between', 'margin-top': '12px', 'font-size': '11px', 'color': '#8b919c' },
  '.mkProgress em': { 'font-style': 'normal', 'font-family': "'Geist Mono', 'JetBrains Mono', Menlo, monospace", 'color': '#c8ccd4' },
  '.mkBar': { 'height': '4px', 'margin-top': '6px', 'border-radius': '999px', 'background': 'rgba(255, 255, 255, 0.07)', 'overflow': 'hidden' },
  '.mkBar > i': { 'display': 'block', 'height': '100%', 'border-radius': '999px', 'background': '#3f74e0', 'transition': 'width 320ms cubic-bezier(.4, 0, .2, 1)' },
  '.mkPanel section': { 'padding': '10px 6px 6px' },
  '.mkPanel section + section': { 'border-top': '1px solid rgba(255, 255, 255, 0.05)' },
  '.mkPanel h4': { 'display': 'flex', 'align-items': 'baseline', 'justify-content': 'space-between', 'margin': '0 8px 4px', 'font-size': '11px', 'font-weight': '500', 'letter-spacing': '0.04em', 'text-transform': 'uppercase', 'color': '#6f7785' },
  '.mkPanel h4 small': { 'font-size': '11px', 'letter-spacing': '0', 'text-transform': 'none', 'color': '#6f7785' },
  '.mkPanel ul': { 'list-style': 'none', 'margin': '0', 'padding': '0', 'display': 'flex', 'flex-direction': 'column', 'gap': '1px' },
  '.mkPanel li': { 'display': 'flex', 'align-items': 'center', 'gap': '10px', 'min-height': '30px', 'padding': '5px 8px', 'border-radius': '8px', 'transition': 'background 120ms' },
  '.mkPanel li:hover': { 'background': 'var(--mk-glass-hover)' },
  '.mkPanel li > span:not(.mkAv), .mkPanel li > div > span': { 'flex': '1', 'min-width': '0', 'overflow': 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', 'color': '#dfe3ea' },
  '.mkTasksList li[data-state="in_progress"]': { 'background': 'rgba(63, 116, 224, 0.10)' },
  '.mkTasksList li[data-state="in_progress"] > span': { 'color': '#ffffff', 'font-weight': '500' },
  '.mkTasksList li[data-state="completed"] > span': { 'color': '#7c8492' },
  '.mkTasksList li > small': { 'flex': 'none', 'font-size': '11px', 'font-weight': '500', 'color': '#82a9f5' },
  '.mkTick': { 'position': 'relative', 'flex': 'none', 'width': '14px', 'height': '14px', 'box-sizing': 'border-box', 'border-radius': '50%', 'border': '1.5px solid #4b5263' },
  '.mkTick[data-state="in_progress"]': { 'border-color': 'rgba(130, 169, 245, 0.25)', 'border-top-color': '#82a9f5', 'animation': 'mkSpin 900ms linear infinite' },
  '.mkTick[data-state="completed"]': { 'border': '0', 'background': 'rgba(63, 116, 224, 0.22)' },
  '.mkTick[data-state="completed"]::after': { 'content': "''", 'position': 'absolute', 'inset': '0', 'background-color': '#82a9f5', '-webkit-mask': "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z'/%3E%3C/svg%3E\") center / 10px 10px no-repeat", 'mask': "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z'/%3E%3C/svg%3E\") center / 10px 10px no-repeat" },
  '.mkAgentList li > div': { 'flex': '1', 'min-width': '0', 'display': 'flex', 'flex-direction': 'column', 'gap': '1px' },
  '.mkAgentList li > div > small': { 'font-size': '11px', 'color': '#7c8492', 'overflow': 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' },
  '.mkAgentList time': { 'font-family': "'Geist Mono', 'JetBrains Mono', Menlo, monospace", 'font-variant-numeric': 'tabular-nums' },
  '.mkAv': { 'flex': 'none', 'display': 'grid', 'place-items': 'center', 'width': '26px', 'height': '26px', 'border-radius': '8px', 'background': 'rgba(255, 255, 255, 0.05)', 'color': '#7c8492', 'box-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, 0.06)' },
  '.mkAv[data-state="working"], .mkAv[data-state="running"]': { 'background': 'rgba(63, 116, 224, 0.16)', 'color': '#82a9f5', 'box-shadow': 'inset 0 0 0 1px rgba(130, 169, 245, 0.22)' },
  '.mkAv[data-state="waiting"]': { 'background': 'rgba(229, 192, 123, 0.14)', 'color': '#e5c07b', 'box-shadow': 'inset 0 0 0 1px rgba(229, 192, 123, 0.25)' },
  '.mkAv[data-state="failed"]': { 'background': 'rgba(224, 108, 117, 0.14)', 'color': '#e06c75' },
  '.mkState': { 'flex': 'none', 'height': '20px', 'padding': '0 8px', 'border-radius': '999px', 'font': '500 11px/20px Geist, sans-serif', 'background': 'rgba(255, 255, 255, 0.06)', 'color': '#8b919c', 'white-space': 'nowrap' },
  '.mkState[data-state="working"], .mkState[data-state="running"]': { 'background': 'rgba(63, 116, 224, 0.16)', 'color': '#9dbbf7' },
  '.mkState[data-state="waiting"]': { 'background': 'rgba(229, 192, 123, 0.16)', 'color': '#e5c07b' },
  '.mkState[data-state="failed"]': { 'background': 'rgba(224, 108, 117, 0.16)', 'color': '#e06c75' },
  '.mkPanel .mkEmpty': { 'margin': '0', 'padding': '16px 14px 18px', 'color': '#8b919c', 'line-height': '1.5' },
  '.mkPanel footer': { 'display': 'flex', 'justify-content': 'flex-end', 'padding': '10px 12px', 'border-top': '1px solid rgba(255, 255, 255, 0.06)' },
  '.mkPanel footer button': {
    'height': '26px', 'padding': '0 12px', 'border-radius': '8px', 'border': '1px solid var(--mk-edge-strong)', 'background': 'var(--mk-glass)',
    'color': '#d6e3ff', 'font': '500 12px/24px Geist, sans-serif', 'cursor': 'pointer', 'transition': 'background 120ms, color 120ms',
  },
  '.mkPanel footer button:hover': { 'background': 'rgba(63, 116, 224, 0.22)', 'color': '#ffffff' },
  '.mkPanel button:focus-visible': { 'outline': 'none', 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' },
  // image previews under "Read file.png"
  '.mkThumb': {
    'display': 'block', 'margin': '6px 0 4px', 'padding': '0', 'max-width': '168px', 'border-radius': '8px', 'overflow': 'hidden', 'cursor': 'zoom-in',
    'border': '1px solid var(--mk-edge)', 'background': 'repeating-conic-gradient(rgba(255, 255, 255, 0.04) 0 25%, transparent 0 50%) 0 0 / 12px 12px',
    'box-shadow': 'var(--mk-shadow-sm)', 'transition': 'border-color 120ms, box-shadow 120ms', 'animation': 'mkFade 200ms cubic-bezier(.2, .8, .2, 1)',
  },
  '.mkThumb:hover': { 'border-color': 'rgba(130, 169, 245, 0.45)', 'box-shadow': 'var(--mk-shadow-sm), 0 0 0 3px rgba(63, 116, 224, 0.12)' },
  '.mkThumb:focus-visible': { 'outline': 'none', 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' },
  '.mkThumb img': { 'display': 'block', 'max-width': '168px', 'max-height': '96px', 'width': 'auto', 'height': 'auto', 'object-fit': 'contain' },
  // chat map (overlay: floats over the chat, never pushes it)
  '.mkMap': {
    'position': 'absolute', 'top': '12px', 'right': '12px', 'bottom': '120px', 'width': '76px', 'z-index': '5', 'box-sizing': 'border-box',
    'border-radius': '10px', 'background': 'var(--mk-glass-float)', 'border': '1px solid var(--mk-edge-strong)',
    'box-shadow': 'var(--mk-hi), var(--mk-shadow-lg)', 'backdrop-filter': 'var(--mk-blur)', '-webkit-backdrop-filter': 'var(--mk-blur)',
    'cursor': 'pointer', 'user-select': 'none', 'touch-action': 'none', 'animation': 'mkIn 180ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkMap[hidden], .mkMapTip[hidden]': { 'display': 'none !important' },
  '.mkMapTrack': { 'position': 'absolute', 'inset': '6px', 'overflow': 'hidden', 'border-radius': '6px' },
  '.mkMapTrack > i': { 'position': 'absolute', 'display': 'block', 'border-radius': '2px' },
  '.mkMapTrack > i.a': { 'left': '6px', 'right': '8px', 'background': 'repeating-linear-gradient(to bottom, rgba(255, 255, 255, 0.22) 0 1px, transparent 1px 3px)' },
  '.mkMapTrack > i.t': { 'left': '6px', 'right': '22px', 'background': 'rgba(255, 255, 255, 0.10)' },
  '.mkMapTrack > i.u': { 'left': '0', 'right': '0', 'background': '#3f74e0', 'box-shadow': '0 0 0 1px rgba(130, 169, 245, 0.35)' },
  '.mkMapView': {
    'position': 'absolute', 'left': '3px', 'right': '3px', 'border-radius': '4px', 'pointer-events': 'none',
    'background': 'rgba(255, 255, 255, 0.07)', 'box-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, 0.16)', 'transition': 'top 60ms linear',
  },
  '.mkMapTip': {
    'position': 'absolute', 'right': 'calc(100% + 10px)', 'width': '240px', 'padding': '8px 12px', 'box-sizing': 'border-box',
    'transform': 'translateY(-50%)', 'border-radius': '12px', 'background': 'var(--mk-glass-float)', 'border': '1px solid var(--mk-edge-strong)',
    'box-shadow': 'var(--mk-hi), var(--mk-shadow-lg)', 'backdrop-filter': 'var(--mk-blur)', '-webkit-backdrop-filter': 'var(--mk-blur)',
    'color': '#e6e9ef', 'font': '12px/1.45 Geist, sans-serif', 'pointer-events': 'none',
    'display': '-webkit-box', '-webkit-line-clamp': '4', '-webkit-box-orient': 'vertical', 'overflow': 'hidden',
  },
};
const existing = data()[WV];
// the build owns every .mk* rule: stale ones are removed, current ones replaced whole (never merged)
const owned = (sel) => /^(\.mk|html\[data-mk)/.test(sel);
for (const sel of Object.keys(existing)) if (owned(sel) && !(sel in rules)) set([WV, sel], undefined);
for (const [sel, props] of Object.entries(rules)) set([WV, sel], owned(sel) ? props : { ...(existing[sel] || {}), ...props });

const errors = [];
jsonc.parse(text, errors, { allowTrailingComma: true });
if (errors.length) throw new Error('invalid settings after build');
fs.writeFileSync(file, text);
console.log(`chat extras: ${code.length} chars, ${Object.keys(rules).length} style rules, tab rename menu`);

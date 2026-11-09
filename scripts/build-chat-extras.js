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
// split the top-level ([\s\S]*?) gap that comes right before `before` into gap + ins + gap (find and replace)
function foldIntoGap(p, before, insSrc, insRep) {
  const GAP = '([\\s\\S]*?)', src = unwrap(p.find), at = src.indexOf(GAP + before);
  if (at < 0) throw new Error('gap not found before ' + before);
  const n = groupsIn(src.slice(0, at)) + 1, add = groupsIn(insSrc) + 1;
  p.find = '/' + src.slice(0, at) + GAP + shiftFind(insSrc, n) + GAP + shiftFind(src.slice(at + GAP.length), add, n + 1) + '/';
  const rep = shiftRep(p.replace, add, n + 1), ref = new RegExp('\\$' + n + '(?!\\d)');
  if (!ref.test(rep)) throw new Error('gap $' + n + ' missing from replace');
  p.replace = rep.replace(ref, () => '$' + n + shiftRep(insRep, n) + '$' + (n + add));
}

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
  // d) the chat pane's half of the dashboard handoff (see c): an "open Account & usage" message with mk set fires a
  //    "mk-dash" event for chat-extras instead of opening Claude's dialog. It sits in the gap after signOut().
  if (!big.find.includes('open_account_usage_dialog')) {
    foldIntoGap(big, 'function ([\\w$]+)\\(\\{label:',
      'initialPrompt:([\\w$]+)\\.request\\.initialPrompt\\}\\)([\\s\\S]{0,300}?)case"open_account_usage_dialog":',
      'initialPrompt:$1.request.initialPrompt})$2case"open_account_usage_dialog":if($1.request.mk){window.dispatchEvent(new CustomEvent("mk-dash"));break}');
  }
  // c) usage dashboard handoff: the sessions sidebar sends {type:"open_account_usage", mk:1} (chat-extras section 8);
  //    the extension keeps mk and adds it to the "open_account_usage_dialog" message it sends the chat pane, which
  //    then opens the dashboard instead of Claude's dialog. The request side comes before the tab-icon patch in the
  //    file (chained below); the message side sits inside that patch's last gap, so it is folded in there.
  if (!list.some((p) => p.filePath === 'extension.js' && p.find.includes('open_account_usage'))) {
    const DASH_IN = {
      filePath: 'extension.js',
      find: '/([\\w$]+)\\.request\\.fileDiffs\\)([\\s\\S]{0,400}?)case"open_account_usage":return await this\\.onOpenAccountUsage\\?\\.\\(\\)/',
      replace: '$1.request.fileDiffs)$2case"open_account_usage":return globalThis.__mkDash=$1.request.mk,await this.onOpenAccountUsage?.()',
    };
    const tab = list.find((p) => p.filePath === 'extension.js' && p.find.includes('panelTab\\.iconPath'));
    if (!tab) throw new Error('tab-icon extension.js patch not found');
    foldIntoGap(tab, '(onDidChangeViewState', 'request:\\{type:"open_account_usage_dialog"\\}', 'request:{type:"open_account_usage_dialog",mk:globalThis.__mkDash}');
    list.splice(list.indexOf(tab), 0, DASH_IN);
  }
  // e) the handoff also carries skill actions (chat-extras section 15): mk is "skill:<text>", passed on as the
  //    event's detail. Older builds fired the event without it.
  big.replace = big.replace.replace(/if\(\$(\d+)\.request\.mk\)\{window\.dispatchEvent\(new CustomEvent\("mk-dash"\)\)/,
    (all, n) => 'if($' + n + '.request.mk){window.dispatchEvent(new CustomEvent("mk-dash",{detail:$' + n + '.request.mk}))');
  if (!/new CustomEvent\("mk-dash",\{detail:/.test(big.replace)) throw new Error('mk-dash detail patch not applied');
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
  // Claude's chat header is a flex row with no align-items, so fixed-height kit pills (tasks, MCP) sat at the top
  '[class*="header_"]:has(> .ccUsage)': { 'align-items': 'center' },
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
  // tokens spent in this chat: a quiet pill with an amber coin, centred in the header's free space (auto margins push
  // the dashboard / Bookmarks / map group to the right edge). Read-only; hover shows the breakdown tooltip.
  '.mkTokens': {
    'display': 'inline-flex', 'align-items': 'center', 'gap': '5px', 'flex': 'none', 'align-self': 'center', 'margin': '0 auto', 'height': '22px',
    'padding': '0 9px 0 7px', 'box-sizing': 'border-box', 'border-radius': '999px', 'background': 'rgba(255, 255, 255, 0.035)',
    'box-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, 0.06)', 'font': "500 11px/1 'Geist Mono', 'JetBrains Mono', Menlo, monospace",
    'font-variant-numeric': 'tabular-nums', 'letter-spacing': '0.01em', 'color': '#aab2bf', 'cursor': 'default', 'user-select': 'none', 'white-space': 'nowrap',
    'transition': 'background 120ms cubic-bezier(.4, 0, .2, 1), color 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkTokens > svg': { 'display': 'block', 'flex': 'none', 'color': '#e5c07b' },
  '.mkTokens > b': { 'font-weight': '500' },
  '.mkTokens[hidden]': { 'display': 'none !important' },
  '.mkTokens[hidden] + *': { 'margin-left': 'auto' },
  // usage dashboard: icon button in the "Account & usage" header, left of Claude's "View details" arrow (same 28 px
  // ghost shape); it takes the arrow's auto margin so both sit together on the right
  '.mkDashBtn': {
    'display': 'inline-grid', 'place-items': 'center', 'flex': 'none', 'width': '28px', 'height': '28px', 'padding': '0', 'margin': '0',
    'appearance': 'none', 'border': '0', 'border-radius': '8px', 'background': 'transparent', 'color': 'var(--app-secondary-foreground)',
    'cursor': 'pointer', 'outline': 'none', 'transition': 'background 120ms cubic-bezier(.4, 0, .2, 1), color 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkDashBtn > svg': { 'display': 'block', 'width': '16px', 'height': '16px' },
  '[class*="sectionHeader_"] > .mkDashBtn': { 'margin-left': 'auto' },
  '[class*="sectionHeader_"] > .mkDashBtn + [class*="sectionLink_"]': { 'margin-left': '2px !important' },
  '.mkDashBtn:hover': { 'background': 'var(--app-ghost-button-hover-background)', 'color': 'var(--app-primary-foreground)' },
  '.mkDashBtn:focus:not(:focus-visible):not(:hover)': { 'background': 'transparent', 'color': 'var(--app-secondary-foreground)' },
  '.mkDashBtn:focus-visible': { 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' },
  '.mkDashBtn[aria-pressed="true"]': { 'color': '#82a9f5 !important', 'background': 'rgba(63, 116, 224, 0.16) !important' },
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
  '.mkSpace': {
    'display': 'inline-grid', 'place-items': 'center', 'flex': 'none', 'width': '28px', 'height': '28px', 'padding': '0', 'margin': '0',
    'appearance': 'none', 'border': '0', 'border-radius': '8px', 'background': 'transparent', 'color': 'var(--app-secondary-foreground)',
    'cursor': 'pointer', 'outline': 'none', 'transition': 'background 120ms cubic-bezier(.4, 0, .2, 1), color 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkSpace > svg': { 'display': 'block' },
  '.mkSpace:hover': { 'background': 'var(--app-ghost-button-hover-background)', 'color': 'var(--app-primary-foreground)' },
  '.mkSpace:focus:not(:focus-visible):not(:hover)': { 'background': 'transparent', 'color': 'var(--app-secondary-foreground)' },
  '.mkSpace:focus-visible': { 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' },
  '.mkTokens:hover': { 'background': 'rgba(255, 255, 255, 0.06)', 'color': '#dfe3ea' },
  // prompt reveal: pinned only while you scroll up
  'html[data-mk-reveal] [class*="message_"][class*="stickyHeader_"]': {
    'position': 'sticky !important', 'top': '0', 'background-image': 'linear-gradient(to bottom, var(--sticky-bg, var(--app-primary-background)) calc(100% - 14px), transparent) !important',
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
// ── 3b. text types: one look per kind of thing Claude writes (chat-extras section 10 sets the data-mk-* attributes) ──
// Icons: RemixIcon (Apache-2.0) vendored in lib/remix, embedded as CSS masks so they take the type's colour.
const icon = (name) => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'lib', 'remix', name + '.svg'), 'utf8').trim();
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};
const mask = (name, size = 'contain') => ({ '-webkit-mask': `${icon(name)} center / ${size} no-repeat`, 'mask': `${icon(name)} center / ${size} no-repeat` });
const MONO = "'Geist Mono', 'JetBrains Mono', Menlo, monospace";
const MD = '[data-mk-md]';
const C = `${MD} code[data-mk-t=`;
const chip = (fg, bg, border) => ({ 'color': fg, 'background': bg, 'box-shadow': border ? `inset 0 0 0 1px ${border}` : 'none' });
const typeRules = {
  // ── inline code chips: shared shape (the :where keeps type rules stronger than the base) ──
  [`${MD} :where(code)[data-mk-t]`]: {
    'font-family': MONO, 'font-size': '0.86em', 'font-weight': '500', 'padding': '1px 6px', 'border-radius': '6px',
    'font-variant-numeric': 'tabular-nums', 'letter-spacing': '0', '-webkit-box-decoration-break': 'clone', 'box-decoration-break': 'clone',
  },
  [`${MD} :where(code)[data-mk-t]::before`]: {
    'content': "''", 'display': 'inline-block', 'width': '0.95em', 'height': '0.95em', 'margin-right': '0.4em', 'vertical-align': '-0.14em', 'background': 'currentColor',
  },
  // skill: light orange, bold, lightning
  [`${C}"skill"]`]: { ...chip('#f7bd84', 'rgba(240, 150, 70, 0.13)', 'rgba(240, 150, 70, 0.24)'), 'font-family': 'inherit', 'font-size': '0.9em', 'font-weight': '700', 'padding': '1px 7px 1px 5px', 'white-space': 'nowrap' },
  [`${C}"skill"]::before`]: { ...mask('flashlight-fill'), 'background': '#f59f4c', 'margin-right': '0.25em' },
  // commands: terminal look (shell lines and built-in slash commands)
  [`${C}"cmd"]`]: { ...chip('#d7dbe2', '#1a1d23', 'rgba(255, 255, 255, 0.09)') },
  [`${C}"cmd"]::before`]: { ...mask('terminal-box-line'), 'background': '#7fc79a' },
  // keyboard shortcuts: key caps
  [`${C}"key"]`]: {
    ...chip('#e6e9ef', 'linear-gradient(#323843, #2a2f38)', 'rgba(255, 255, 255, 0.10)'), 'font-family': 'inherit', 'font-size': '0.8em', 'font-weight': '600',
    'padding': '1px 7px', 'border-radius': '5px', 'box-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, 0.10), inset 0 -2px 0 rgba(0, 0, 0, 0.35)', 'white-space': 'nowrap',
  },
  [`${C}"key"]::before, ${C}"num"]::before`]: { 'display': 'none' },
  // colours: neutral chip, the swatch carries the colour
  [`${C}"color"]`]: { ...chip('#dfe3ea', 'rgba(255, 255, 255, 0.05)', 'rgba(255, 255, 255, 0.08)'), 'white-space': 'nowrap' },
  [`${C}"color"]::before`]: { 'width': '0.9em', 'height': '0.9em', 'border-radius': '4px', 'background': 'var(--hx, transparent)', 'box-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, 0.28)', 'vertical-align': '-0.12em' },
  // CSS variables / tokens
  [`${C}"var"]`]: { ...chip('#cfaef7', 'rgba(180, 140, 240, 0.11)', 'rgba(180, 140, 240, 0.20)') },
  [`${C}"var"]::before`]: { ...mask('braces-line') },
  // time, date, duration: cyan, mono, own icon each
  [`${C}"time"], ${C}"date"], ${C}"dur"]`]: { ...chip('#86d8ec', 'rgba(86, 182, 214, 0.11)', 'rgba(86, 182, 214, 0.22)'), 'font-weight': '600', 'white-space': 'nowrap' },
  [`${C}"time"]::before`]: { ...mask('time-line'), 'margin-right': '0.2em' },
  [`${C}"date"]::before`]: { ...mask('calendar-line'), 'margin-right': '0.2em' },
  [`${C}"dur"]::before`]: { ...mask('timer-line'), 'margin-right': '0.2em' },
  // status words: pill with a dot
  [`${C}"status"]`]: { 'font-family': 'inherit', 'font-size': '0.8em', 'font-weight': '600', 'padding': '1px 8px 1px 7px', 'border-radius': '999px', 'white-space': 'nowrap', 'text-transform': 'capitalize' },
  [`${C}"status"]::before`]: { 'width': '0.45em', 'height': '0.45em', 'border-radius': '50%', 'margin-right': '0.45em', 'vertical-align': '0.1em' },
  [`${C}"status"][data-mk-v="good"]`]: chip('#a8d48a', 'rgba(152, 195, 121, 0.13)', 'rgba(152, 195, 121, 0.26)'),
  [`${C}"status"][data-mk-v="bad"]`]: chip('#f19aa1', 'rgba(224, 108, 117, 0.14)', 'rgba(224, 108, 117, 0.28)'),
  [`${C}"status"][data-mk-v="warn"]`]: chip('#ecca8a', 'rgba(229, 192, 123, 0.13)', 'rgba(229, 192, 123, 0.26)'),
  [`${C}"status"][data-mk-v="info"]`]: chip('#9dbbf7', 'rgba(63, 116, 224, 0.15)', 'rgba(130, 169, 245, 0.26)'),
  // numbers and measures: bright mono; signed deltas tinted
  [`${C}"num"]`]: { ...chip('#eceef2', 'rgba(255, 255, 255, 0.06)'), 'font-weight': '600', 'white-space': 'nowrap' },
  [`${C}"num"][data-mk-v="up"]`]: chip('#a8d48a', 'rgba(152, 195, 121, 0.12)'),
  [`${C}"num"][data-mk-v="down"]`]: chip('#f19aa1', 'rgba(224, 108, 117, 0.12)'),
  // commit hashes and ticket ids
  [`${C}"hash"]`]: { ...chip('#a3abb9', 'rgba(255, 255, 255, 0.04)', 'rgba(255, 255, 255, 0.07)'), 'white-space': 'nowrap' },
  [`${C}"hash"]::before`]: { ...mask('git-commit-line') },
  [`${C}"id"]`]: { ...chip('#9dbbf7', 'rgba(63, 116, 224, 0.10)', 'rgba(130, 169, 245, 0.18)'), 'white-space': 'nowrap' },
  [`${C}"id"]::before`]: { ...mask('hashtag'), 'width': '0.8em', 'margin-right': '0.25em' },
  // agents and MCP tools
  [`${C}"agent"]`]: { ...chip('#f4add0', 'rgba(240, 140, 190, 0.11)', 'rgba(240, 140, 190, 0.22)'), 'font-family': 'inherit', 'font-weight': '600', 'white-space': 'nowrap' },
  [`${C}"agent"]::before`]: { ...mask('robot-2-line') },
  [`${C}"mcp"]`]: { ...chip('#7fd8c8', 'rgba(80, 200, 180, 0.10)', 'rgba(80, 200, 180, 0.20)') },
  [`${C}"mcp"]::before`]: { ...mask('plug-line') },
  [`${C}"url"]`]: chip('#8dbaff', 'rgba(110, 168, 254, 0.08)', 'rgba(110, 168, 254, 0.18)'),
  [`${C}"url"]::before`]: { ...mask('link') },
  // files and folders: soft blue chip with a file icon
  [`${C}"file"]`]: { ...chip('#d6deeb', 'rgba(130, 169, 245, 0.08)', 'rgba(130, 169, 245, 0.16)'), 'overflow-wrap': 'anywhere' },
  [`${C}"file"]::before`]: { ...mask('file-3-line'), 'background': '#82a9f5' },
  [`${C}"file"][data-mk-v="dir"]::before`]: { ...mask('folder-3-line'), 'background': '#82a9f5' },

  // ── links ──
  [`${MD} a`]: { 'text-decoration': 'none', 'border-radius': '4px', 'transition': 'color 120ms cubic-bezier(.4, 0, .2, 1), background 120ms cubic-bezier(.4, 0, .2, 1)' },
  [`${MD} a:hover`]: { 'text-decoration': 'underline', 'text-underline-offset': '3px', 'text-decoration-thickness': '1px' },
  // web links: trailing arrow
  [`${MD} a[href^="http"]::after`]: { 'content': "''", 'display': 'inline-block', 'width': '0.8em', 'height': '0.8em', 'margin-left': '0.15em', 'vertical-align': '-0.05em', 'background': 'currentColor', 'opacity': '0.7', ...mask('arrow-right-up-line') },
  [`${MD} a[href*="github.com"]::before`]: { 'content': "''", 'display': 'inline-block', 'width': '0.95em', 'height': '0.95em', 'margin-right': '0.3em', 'vertical-align': '-0.13em', 'background': 'currentColor', ...mask('github-fill') },
  // file links: mono chip with a file-code icon (anything that is not web, mail or an anchor)
  [`${MD} a:not([href^="http"]):not([href^="mailto:"]):not([href^="#"])`]: {
    'font-family': MONO, 'font-size': '0.86em', 'font-weight': '500', 'padding': '1px 6px', 'background': 'rgba(110, 168, 254, 0.09)',
    'box-shadow': 'inset 0 0 0 1px rgba(110, 168, 254, 0.18)', 'border-radius': '6px', 'overflow-wrap': 'anywhere', '-webkit-box-decoration-break': 'clone', 'box-decoration-break': 'clone',
  },
  [`${MD} a:not([href^="http"]):not([href^="mailto:"]):not([href^="#"]):hover`]: { 'background': 'rgba(110, 168, 254, 0.16)' },
  [`${MD} a:not([href^="http"]):not([href^="mailto:"]):not([href^="#"])::before`]: { 'content': "''", 'display': 'inline-block', 'width': '0.95em', 'height': '0.95em', 'margin-right': '0.35em', 'vertical-align': '-0.14em', 'background': 'currentColor', ...mask('file-code-line') },

  // ── reading rhythm: light-on-dark body gets more leading and a hair of tracking; prose capped at ~72 characters
  //    per line; space above a heading is about 3x the space below it, so each heading belongs to what follows ──
  // transition: a bubble arriving or leaving (section 13) eases its padding and fades its fill instead of snapping
  [MD]: {
    'line-height': '1.62', 'letter-spacing': '0.006em', 'font-kerning': 'normal',
    'transition': 'padding 180ms cubic-bezier(.4, 0, .2, 1), background-color 240ms cubic-bezier(.4, 0, .2, 1), box-shadow 240ms cubic-bezier(.4, 0, .2, 1)',
  },
  [`${MD} :is(p, ul, ol, h1, h2, h3, h4, h5, h6, blockquote)`]: { 'max-width': '72ch' },
  [`${MD} :is(p, li)`]: { 'text-wrap': 'pretty' },
  [`${MD} :is(h1, h2, h3, h4)`]: { 'text-wrap': 'balance', 'line-height': '1.3' },
  [`${MD} h1`]: { 'color': '#f2f4f8', 'font-size': '1.32em', 'font-weight': '650', 'letter-spacing': '-0.012em', 'margin': '1.4em 0 0.45em' },
  [`${MD} h2`]: { 'display': 'flex', 'align-items': 'center', 'gap': '12px', 'color': '#eceef2', 'font-size': '1.12em', 'font-weight': '600', 'letter-spacing': '-0.005em', 'margin': '1.6em 0 0.5em' },
  [`${MD} h2::after`]: { 'content': "''", 'flex': '1', 'min-width': '24px', 'height': '1px', 'background': 'rgba(255, 255, 255, 0.07)' },
  [`${MD} h3`]: { 'color': '#9dbbf7', 'font-size': '1em', 'font-weight': '600', 'margin': '1.35em 0 0.3em' },
  [`${MD} h4, ${MD} h5, ${MD} h6`]: { 'color': '#c8ccd4', 'font-size': '0.95em', 'font-weight': '600', 'margin': '1.1em 0 0.25em' },
  [`${MD} :is(h1, h2, h3, h4):first-child`]: { 'margin-top': '0.1em' },

  // ── final reply bubble (chat-extras section 13): static, no motion. Same shape as your bubble (tight bottom-left
  //    corner next to the avatar), tinted with a whisper of Claude's clay instead of blue. Hugs short replies. ──
  [`${MD}[data-mk-bubble]`]: {
    'display': 'block', 'width': 'fit-content', 'max-width': '100%', 'box-sizing': 'border-box', 'padding': '12px 16px 13px',
    'border-radius': '16px 16px 16px 6px', 'background': 'color-mix(in srgb, #d97757 5.5%, var(--app-primary-background, #21252c))',
    'box-shadow': 'inset 0 0 0 1px rgba(217, 119, 87, 0.15)',
  },
  // forming (Claude still writing a tool-free reply): the bubble's exact shape, fill and hairline transparent.
  // When the turn ends the attribute drops and the fill fades in around text that has not moved.
  [`${MD}[data-mk-bubble][data-mk-forming]`]: { 'background-color': 'transparent', 'box-shadow': 'inset 0 0 0 1px rgba(217, 119, 87, 0)' },
  // last block leaves room for the copy / bookmark buttons in the bottom-right corner
  [`${MD}[data-mk-bubble] > :last-child`]: { 'padding-right': '56px' },
  // the row hugs the bubble, so its right edge is the bubble's right edge
  // (grid: see the copy / bookmark note below)
  '[data-mk-bubble-row]': {
    'width': 'fit-content', 'max-width': '100%', 'box-sizing': 'border-box', 'padding-bottom': '8px !important',
    'display': 'grid !important', 'grid-template-columns': 'minmax(0, auto) 0', 'align-items': 'start', 'justify-items': 'start',
  },
  // avatar at the bubble's bottom-left (was top-left)
  // (specific enough to beat the kit's avatar rule, which also uses !important)
  '[data-mk-bubble-row][class*="timelineMessage_"]:not(:has(+ [class*="timelineMessage_"]))::before': { 'top': 'auto !important', 'bottom': 'var(--mk-av-bottom, 8px) !important' },
  // Claude's copy / bookmark row: sits in the bubble's bottom-right corner, pins to the bottom of the chat while a
  // long reply passes (so your pinned prompt at the top never covers it) and stops at the bubble's start. The row becomes a two-column grid: content in
  // column 1, the actions alone in a zero-width column 2 spanning every row. That takes no layout space, and the
  // sticky box is bounded by the bubble's full height (its grid area), so it never slides past the bubble.
  // A bubble-coloured backing keeps the icons readable while they float over text.
  '[data-mk-bubble-row] > :not([data-message-actions])': { 'grid-column': '1' },
  '[data-mk-bubble-row] > [data-message-actions]': {
    'grid-column': '2', 'grid-row': '1 / span 40', 'justify-self': 'end', 'align-self': 'end',
    // z-index 1: under your pinned prompt (Claude's sticky header is z-index 2), never on top of it.
    // Placed by chat-extras placeActs() via --mk-act-y: 8px inside the bubble's bottom, never lower than 12px above
    // the message box, never above the bubble's top. translateY only: no layout change, no feedback.
    'position': 'relative', 'z-index': '1', 'height': 'auto', 'transform': 'translateY(var(--mk-act-y, 0px))',
    'display': 'flex', 'align-items': 'center', 'gap': '0', 'margin': '0 8px 0 0', 'padding': '2px',
    // raised: a hairline + soft shadow so the pill reads as floating over the text it covers, not as clipped text
    'border-radius': '9px', 'background': 'color-mix(in srgb, #d97757 5.5%, color-mix(in srgb, #fff 4%, var(--app-primary-background, #21252c)))',
    'box-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 6px 16px -6px rgba(0, 0, 0, 0.55)',
    // hidden until the bubble is hovered (or a button has keyboard focus); always laid out, so they appear in place
    'opacity': '0', 'transition': 'opacity 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  // hover and keyboard focus both show the pill at once (no delay: Jaafar wants it immediate)
  '[data-mk-bubble-row]:hover > [data-message-actions]': { 'opacity': '1' },
  '[data-mk-bubble-row]:focus-within > [data-message-actions]': { 'opacity': '1' },
  // Claude ships a solid copy icon next to an outline bookmark; both are redrawn as matching RemixIcon line glyphs
  // (inner svg hidden). Shown only while the bubble is hovered. Copied = green check, bookmarked = filled blue.
  '[data-mk-bubble-row] > [data-message-actions] > button': {
    'width': '23px', 'height': '24px', 'min-width': '0', 'padding': '0', 'margin': '0', 'display': 'grid', 'place-items': 'center',
    'border': '0 !important', 'border-radius': '7px', 'background': 'transparent !important', 'box-shadow': 'none', 'opacity': '1 !important',
    'color': '#6f7785', 'cursor': 'pointer', 'transition': 'background-color 120ms cubic-bezier(.4, 0, .2, 1), color 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '[data-mk-bubble-row]:hover > [data-message-actions] > button': { 'color': '#9aa3b2' },
  '[data-mk-bubble-row] > [data-message-actions] > button:hover': { 'background': 'rgba(255, 255, 255, 0.07) !important', 'color': '#eceef2' },
  '[data-mk-bubble-row] > [data-message-actions] > button:focus-visible': { 'outline': 'none', 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' },
  '[data-mk-bubble-row] > [data-message-actions] > :is(button[aria-label^="Copy"], [class*="bookmarkButton_"]) > svg': { 'display': 'none' },
  '[data-mk-bubble-row] > [data-message-actions] > :is(button[aria-label^="Copy"], [class*="bookmarkButton_"])::before': {
    'content': "''", 'width': '15px', 'height': '15px', 'background': 'currentColor',
  },
  '[data-mk-bubble-row] > [data-message-actions] > button[aria-label^="Copy"]::before': mask('file-copy-line'),
  '[data-mk-bubble-row] > [data-message-actions] > button[aria-label^="Copy"]:has(path[d^="M16.704"])': { 'color': '#98c379 !important' },
  '[data-mk-bubble-row] > [data-message-actions] > button[aria-label^="Copy"]:has(path[d^="M16.704"])::before': mask('check-line'),
  '[data-mk-bubble-row] > [data-message-actions] > [class*="bookmarkButton_"]::before': mask('bookmark-line'),
  '[data-mk-bubble-row] > [data-message-actions] > [class*="bookmarked_"]': { 'color': '#82a9f5 !important' },
  '[data-mk-bubble-row] > [data-message-actions] > [class*="bookmarked_"]::before': mask('bookmark-fill'),

  // ── quotes and replies (chat-extras section 14) ──
  // Reply in Claude's bubble row: same 23 px ghost button as copy / bookmark (the row's `> button` rules), reply glyph
  '[data-mk-bubble-row] > [data-message-actions] > .mkReply::before': { 'content': "''", 'width': '15px', 'height': '15px', 'background': 'currentColor', ...mask('reply-line') },
  // Your bubble's actions: Claude's "Message actions" holder (data-mk-uacts, set by syncReplies) becomes the same
  // raised pill as Claude's copy / bookmark row: Reply + Message actions as 23 px ghost buttons with RemixIcon line
  // glyphs (Claude's own svg hidden). Sits 8px inside the bubble's bottom-right corner like Claude's pill, but never
  // follows the scroll. The holder is the container's child, not the bubble's: syncReplies measures the bubble's
  // edges into --mk-ub-r / --mk-ub-b. Shown on hover, keyboard focus or while its menu is open. z-index 1: under the pinned prompt.
  '[data-mk-uacts]': {
    'position': 'absolute !important', 'top': 'auto !important', 'right': 'calc(var(--mk-ub-r, 0px) + 8px) !important', 'bottom': 'calc(var(--mk-ub-b, 0px) + 8px) !important', 'z-index': '1 !important',
    'display': 'flex', 'align-items': 'center', 'gap': '0', 'padding': '2px', 'border-radius': '9px',
    'background': 'color-mix(in srgb, #fff 4%, var(--app-primary-background, #21252c))',
    'box-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 6px 16px -6px rgba(0, 0, 0, 0.55)',
    'opacity': '0', 'transition': 'opacity 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '[class*="userMessageContainer_"]:hover > [data-mk-uacts]': { 'opacity': '1' },
  '[data-mk-uacts]:is(:focus-within, :has([aria-expanded="true"]))': { 'opacity': '1' },
  '[data-mk-uacts] > button': {
    'width': '23px', 'height': '24px', 'min-width': '0', 'padding': '0', 'margin': '0', 'display': 'grid', 'place-items': 'center',
    'border': '0 !important', 'border-radius': '7px !important', 'background': 'transparent !important', 'box-shadow': 'none', 'opacity': '1 !important',
    'transform': 'none !important', 'color': '#6f7785', 'cursor': 'pointer',
    'transition': 'background-color 120ms cubic-bezier(.4, 0, .2, 1), color 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '[data-mk-uacts]:hover > button, [class*="userMessageContainer_"]:hover > [data-mk-uacts] > button': { 'color': '#9aa3b2' },
  '[data-mk-uacts] > button:is(:hover, [aria-expanded="true"])': { 'background': 'rgba(255, 255, 255, 0.07) !important', 'color': '#eceef2' },
  '[data-mk-uacts] > button:focus-visible': { 'outline': 'none', 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' },
  '[data-mk-uacts] > button[title="Message actions"] > svg': { 'display': 'none' },
  '[data-mk-uacts] > button::before': { 'content': "''", 'width': '15px', 'height': '15px', 'background': 'currentColor' },
  '[data-mk-uacts] > button[title="Message actions"]::before': mask('more-line'),
  '[data-mk-uacts] > .mkReply::before': mask('reply-line'),
  // no Claude holder (held or read-only messages): Reply alone, in the same pill shape
  '.mkReply[data-solo]': {
    'position': 'absolute', 'right': 'calc(var(--mk-ub-r, 0px) + 8px)', 'bottom': 'calc(var(--mk-ub-b, 0px) + 8px)', 'z-index': '1', 'width': '27px', 'height': '28px', 'padding': '0', 'margin': '0',
    'display': 'grid', 'place-items': 'center', 'appearance': 'none', 'border': '0', 'border-radius': '9px', 'cursor': 'pointer', 'color': '#9aa3b2',
    'background': 'color-mix(in srgb, #fff 4%, var(--app-primary-background, #21252c))',
    'box-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 6px 16px -6px rgba(0, 0, 0, 0.55)',
    'opacity': '0', 'transition': 'opacity 120ms cubic-bezier(.4, 0, .2, 1), color 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '[class*="userMessageContainer_"]:hover > .mkReply[data-solo]': { 'opacity': '1' },
  '.mkReply[data-solo]:is(:hover, :focus-visible)': { 'opacity': '1' },
  '.mkReply[data-solo]:hover': { 'color': '#eceef2' },
  '.mkReply[data-solo]:focus-visible': { 'outline': 'none', 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' },
  '.mkReply[data-solo]::before': { 'content': "''", 'width': '15px', 'height': '15px', 'background': 'currentColor', ...mask('reply-line') },
  // "Add to chat" over a text selection: floating glass pill, rises in when it appears
  '.mkQuoteBtn': {
    'position': 'fixed', 'z-index': '70', 'display': 'inline-flex', 'align-items': 'center', 'gap': '6px', 'height': '28px', 'padding': '0 11px 0 9px', 'margin': '0',
    'appearance': 'none', 'border': '1px solid var(--mk-edge-strong)', 'border-radius': '999px', 'background': 'var(--mk-glass-float)',
    'box-shadow': 'var(--mk-hi), var(--mk-shadow-sm)', 'color': '#dfe3ea', 'font': '500 12px/1 Geist, sans-serif', 'white-space': 'nowrap', 'cursor': 'pointer',
    'animation': 'mkRise 160ms cubic-bezier(.2, .8, .2, 1)', 'transition': 'background-color 120ms cubic-bezier(.4, 0, .2, 1), color 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkQuoteBtn[hidden]': { 'display': 'none !important' },
  '.mkQuoteBtn > i': { 'flex': 'none', 'width': '14px', 'height': '14px', 'background': '#82a9f5', ...mask('chat-quote-line') },
  // hover to add (files, images): same pill, file or image glyph
  '.mkQuoteBtn[data-kind="file"] > i': mask('file-3-line'),
  '.mkQuoteBtn[data-kind="image"] > i': mask('image-line'),
  '.mkQuoteBtn:hover': { 'background': 'color-mix(in srgb, #fff 6%, var(--mk-glass-float))', 'color': '#eceef2' },
  '.mkQuoteBtn:focus-visible': { 'outline': 'none', 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' },
  // quote attachment pills (message box and sent messages): Claude's file pill with a quote glyph and a blue tint.
  // --pill-bg also feeds the pill's remove-button fade, so the fade matches the tint.
  '[data-mk-quote]': { '--pill-bg': 'color-mix(in srgb, #3f74e0 14%, var(--app-input-background, #21252c))', 'border-color': 'rgba(130, 169, 245, 0.28) !important' },
  '[data-mk-quote] > [class*="icon_"]': { 'display': 'none' },
  '[data-mk-quote]::before': { 'content': "''", 'flex': 'none', 'width': '12px', 'height': '12px', 'background': '#82a9f5', ...mask('double-quotes-l') },

  // ── body: paragraphs, emphasis, lists, rules ──
  [`${MD} p`]: { 'margin-top': '0', 'margin-bottom': '0.8em' },
  [`${MD} :is(p, ul, ol, blockquote, table):last-child`]: { 'margin-bottom': '0' },
  [`${MD} em`]: { 'color': '#c8ccd4' },
  [`${MD} :is(ul, ol)`]: { 'padding-inline-start': '1.4em', 'margin': '0.3em 0 0.9em' },
  [`${MD} li`]: { 'margin': '0.32em 0', 'padding-left': '3px' },
  [`${MD} li > :is(ul, ol)`]: { 'margin': '0.2em 0 0.3em' },
  [`${MD} li > p`]: { 'margin-bottom': '0.3em' },
  [`${MD} ul > li::marker`]: { 'color': '#5f6571' },
  [`${MD} ol > li::marker`]: { 'color': '#82a9f5', 'font-family': MONO, 'font-size': '0.85em', 'font-weight': '600' },
  [`${MD} li:has(> input[type="checkbox"])`]: { 'list-style': 'none', 'margin-left': '-1.2em' },
  [`${MD} li > input[type="checkbox"]`]: {
    'appearance': 'none', '-webkit-appearance': 'none', 'width': '14px', 'height': '14px', 'margin': '0 7px 0 0', 'vertical-align': '-2px',
    'border-radius': '4px', 'box-shadow': 'inset 0 0 0 1.5px #4b5263', 'background': 'transparent',
  },
  [`${MD} li > input[type="checkbox"]:checked`]: {
    'box-shadow': 'none', 'background': "#3f74e0 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z'/%3E%3C/svg%3E\") center / 11px no-repeat",
  },
  [`${MD} li:has(> input:checked)`]: { 'color': '#8b919c' },
  [`${MD} hr`]: { 'border': '0', 'height': '1px', 'background': 'rgba(255, 255, 255, 0.08)', 'margin': '1.6em 0' },

  // ── tables: hairline card, quiet uppercase header, mono right-aligned numbers ──
  [`${MD} table`]: {
    'display': 'block', 'width': 'fit-content', 'max-width': '100%', 'overflow-x': 'auto', 'margin': '0.6em 0 1em', 'border-collapse': 'separate', 'border-spacing': '0',
    'border': '1px solid rgba(255, 255, 255, 0.08)', 'border-radius': '10px', 'line-height': '1.45',
  },
  [`${MD} th`]: {
    'padding': '8px 14px', 'border': '0', 'border-bottom': '1px solid rgba(255, 255, 255, 0.08)', 'background': 'rgba(255, 255, 255, 0.035)', 'text-align': 'left',
    'color': '#9aa3b2', 'font-size': '0.88em', 'font-weight': '600', 'white-space': 'nowrap',
  },
  [`${MD} td`]: { 'padding': '8px 14px', 'border': '0', 'border-top': '1px solid rgba(255, 255, 255, 0.05)', 'vertical-align': 'top' },
  [`${MD} tbody tr:first-child td`]: { 'border-top': '0' },
  [`${MD} tbody tr:hover td`]: { 'background': 'rgba(255, 255, 255, 0.025)' },
  [`${MD} td:first-child`]: { 'color': '#eceef2', 'font-weight': '500' },
  [`${MD} th[data-mk-num]`]: { 'text-align': 'right' },
  [`${MD} td[data-mk-num]`]: { 'font-family': MONO, 'font-size': '0.9em', 'font-variant-numeric': 'tabular-nums', 'text-align': 'right', 'white-space': 'nowrap' },

  // ── code blocks: language label ──
  [`${MD} [data-mk-lang]`]: { 'position': 'relative' },
  [`${MD} [data-mk-lang]::before`]: {
    'content': 'attr(data-mk-lang)', 'position': 'absolute', 'top': '8px', 'left': '12px', 'z-index': '1', 'pointer-events': 'none',
    'font': `500 10.5px/1 ${MONO}`, 'color': '#6f7785',
  },
  [`${MD} [data-mk-lang] > pre`]: { 'padding-top': '26px !important' },

  // ── callouts: blockquote that opens with a bold title (> **Summary**) becomes a tinted card ──
  [`${MD} blockquote`]: { 'margin': '1em 0', 'padding': '0' },
  [`${MD} blockquote[data-mk-callout]:not([data-mk-callout="quote"])`]: {
    'position': 'relative', 'padding': '11px 16px 12px 42px', 'border-radius': '12px', 'color': '#d4d9e2', 'line-height': '1.55',
    'background': 'color-mix(in srgb, var(--mk-c) 7%, transparent)', 'box-shadow': 'inset 0 0 0 1px color-mix(in srgb, var(--mk-c) 22%, transparent)',
  },
  [`${MD} blockquote[data-mk-callout]:not([data-mk-callout="quote"])::before`]: {
    'content': "''", 'position': 'absolute', 'left': '15px', 'top': '13px', 'width': '16px', 'height': '16px', 'background': 'var(--mk-c)',
    '-webkit-mask': 'var(--mk-i) center / contain no-repeat', 'mask': 'var(--mk-i) center / contain no-repeat',
  },
  [`${MD} blockquote[data-mk-callout] > p:first-child > strong:first-child`]: {
    'color': 'var(--mk-c)', 'font-weight': '600',
  },
  [`${MD} blockquote[data-mk-callout] > p`]: { 'margin-bottom': '0.5em' },
  [`${MD} blockquote[data-mk-callout] > :last-child`]: { 'margin-bottom': '0' },
  [`${MD} blockquote[data-mk-callout] > :first-child`]: { 'margin-top': '0' },
  [`${MD} blockquote[data-mk-callout] :is(ul, ol)`]: { 'padding-inline-start': '1.2em' },
  [`${MD} blockquote[data-mk-callout="summary"]`]: { '--mk-c': '#82a9f5', '--mk-i': icon('list-check-3') },
  [`${MD} blockquote[data-mk-callout="note"]`]: { '--mk-c': '#7dd3e8', '--mk-i': icon('information-line') },
  [`${MD} blockquote[data-mk-callout="tip"]`]: { '--mk-c': '#98c379', '--mk-i': icon('lightbulb-line') },
  [`${MD} blockquote[data-mk-callout="warn"]`]: { '--mk-c': '#e5c07b', '--mk-i': icon('alert-line') },
  [`${MD} blockquote[data-mk-callout="risk"]`]: { '--mk-c': '#ef8a92', '--mk-i': icon('error-warning-line') },
  [`${MD} blockquote[data-mk-callout="decision"]`]: { '--mk-c': '#c9a6f5', '--mk-i': icon('scales-3-line') },
  [`${MD} blockquote[data-mk-callout="next"]`]: { '--mk-c': '#82a9f5', '--mk-i': icon('arrow-right-circle-line') },
  [`${MD} blockquote[data-mk-callout="done"]`]: { '--mk-c': '#98c379', '--mk-i': icon('checkbox-circle-line') },
  [`${MD} blockquote[data-mk-callout="design"]`]: { '--mk-c': '#f0a0c8', '--mk-i': icon('palette-line') },
  [`${MD} blockquote[data-mk-callout="question"]`]: { '--mk-c': '#f5b77a', '--mk-i': icon('question-line') },
  [`${MD} blockquote[data-mk-callout="insight"]`]: { '--mk-c': '#c9a6f5', '--mk-i': icon('sparkling-line') },
  // quote: no card, serif italic with a large quote mark and a quiet attribution line
  [`${MD} blockquote[data-mk-callout="quote"]`]: {
    '--mk-c': '#8b919c', 'position': 'relative', 'padding': '2px 0 2px 34px', 'color': '#dfe3ea',
    'font-family': "'Newsreader', 'Iowan Old Style', Georgia, serif", 'font-style': 'italic', 'font-size': '1.06em', 'line-height': '1.5',
  },
  [`${MD} blockquote[data-mk-callout="quote"]::before`]: { 'content': "''", 'position': 'absolute', 'left': '4px', 'top': '3px', 'width': '20px', 'height': '20px', 'background': '#5f6571', ...mask('double-quotes-l') },
  [`${MD} blockquote[data-mk-callout="quote"] > p[data-mk-cite]`]: { 'display': 'flex', 'align-items': 'center', 'gap': '8px', 'margin-top': '6px', 'font-family': 'inherit', 'font-style': 'normal', 'font-size': '0.8em', 'color': '#8b919c' },
  [`${MD} blockquote[data-mk-callout="quote"] > p[data-mk-cite]::before`]: { 'content': "''", 'width': '14px', 'height': '1px', 'background': '#5f6571' },
  [`${MD} blockquote[data-mk-callout="quote"] > p[data-mk-cite] em`]: { 'font-family': 'Geist, sans-serif', 'font-style': 'normal', 'color': '#8b919c' },

  // ── Claude's own "★ Insight" lines and Skill tool rows ──
  [`${MD} [class*="insightHeader_"]`]: { 'color': '#c9a6f5 !important', 'font-weight': '600', 'letter-spacing': '0.02em' },
  [`${MD} [class*="insightFooter_"]`]: { 'opacity': '0.3' },
  '[data-mk-skill]': { 'display': 'inline-flex', 'align-items': 'center', 'gap': '4px', 'color': '#f7bd84 !important', 'font-weight': '700 !important' },
  '[data-mk-skill]::before': { 'content': "''", 'width': '12px', 'height': '12px', 'background': '#f59f4c', ...mask('flashlight-fill') },
  '[data-mk-skill] + *': { 'color': '#f7bd84 !important', 'font-weight': '600' },
};
Object.assign(rules, typeRules);

// ── 3c. usage dashboard (chat-extras section 11), opened from the token count ──
// Chart colours were checked with the dataviz validator on the dark surface: first try #5b8def, rework #b8812c.
const U_OK = '#5b8def', U_RE = '#b8812c';
const U_MONO = "'Geist Mono', 'JetBrains Mono', Menlo, monospace";
const U_CARD = { 'border-radius': '12px', 'background': 'rgba(255, 255, 255, 0.025)', 'border': '1px solid var(--mk-edge)' };
const U_EYEBROW = { 'font': '500 10.5px/1.2 Geist, sans-serif', 'letter-spacing': '0.06em', 'text-transform': 'uppercase', 'color': '#6f7785' };
const U_FOCUS = { 'outline': 'none', 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' };
const usageRules = {
  '.mkUsage': {
    'position': 'fixed', 'z-index': '70', 'overflow': 'auto', 'overscroll-behavior': 'contain', 'box-sizing': 'border-box',
    'border-radius': '16px', 'background': 'var(--mk-glass-float)', 'border': '1px solid var(--mk-edge-strong)',
    'box-shadow': 'var(--mk-hi), var(--mk-shadow-lg)', 'color': '#c8ccd4', 'font': '12px/1.45 Geist, sans-serif',
    'animation': 'mkRise 240ms cubic-bezier(.2, .8, .2, 1)', 'scrollbar-width': 'thin',
  },
  '.mkUsage[hidden], .mkUTip[hidden]': { 'display': 'none !important' },
  '.mkUsage button': { 'font-family': 'inherit' },
  '.mkUsage button:focus-visible': U_FOCUS,
  '.mkUsage b': { 'font-weight': '500' },
  // header: title + freshness, range switch, close; stays put while the body scrolls
  '.mkUHead': {
    'position': 'sticky', 'top': '0', 'z-index': '3', 'display': 'flex', 'align-items': 'center', 'gap': '10px',
    'padding': '14px 12px 12px 16px', 'background': 'var(--mk-glass-float)', 'border-bottom': '1px solid rgba(255, 255, 255, 0.06)',
  },
  '.mkUHead > div:first-child': { 'flex': '1', 'min-width': '0', 'display': 'flex', 'flex-direction': 'column', 'gap': '2px' },
  '.mkUHead > div:first-child > *': { 'overflow': 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' },
  '.mkUHead strong': { 'font-size': '14px', 'font-weight': '600', 'color': '#eceef2', 'letter-spacing': '-0.01em' },
  '.mkUHead small': { 'font-size': '11px', 'color': '#6f7785' },
  '.mkUSeg': { 'flex': 'none', 'display': 'inline-flex', 'gap': '2px', 'padding': '2px', 'border-radius': '10px', 'background': 'rgba(255, 255, 255, 0.04)', 'box-shadow': 'inset 0 0 0 1px var(--mk-edge)' },
  '.mkUSeg button': {
    'appearance': 'none', 'border': '0', 'height': '24px', 'min-width': '30px', 'padding': '0 7px', 'border-radius': '8px', 'background': 'transparent',
    'color': '#8b919c', 'font': `500 11px/24px ${U_MONO}`, 'cursor': 'pointer', 'transition': 'background 120ms cubic-bezier(.4, 0, .2, 1), color 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkUSeg button:hover': { 'color': '#dfe3ea', 'background': 'var(--mk-glass-hover)' },
  '.mkUSeg button[aria-selected="true"]': { 'color': '#d6e3ff', 'background': 'rgba(63, 116, 224, 0.22)', 'box-shadow': 'inset 0 0 0 1px rgba(130, 169, 245, 0.28)' },
  '.mkUClose': {
    'flex': 'none', 'appearance': 'none', 'border': '0', 'display': 'grid', 'place-items': 'center', 'width': '28px', 'height': '28px', 'padding': '0', 'border-radius': '8px',
    'background': 'transparent', 'color': '#8b919c', 'cursor': 'pointer', 'transition': 'background 120ms, color 120ms',
  },
  '.mkUClose:hover': { 'background': 'var(--mk-glass-hover)', 'color': '#eceef2' },
  '.mkUExpand': {
    'flex': 'none', 'appearance': 'none', 'border': '0', 'display': 'grid', 'place-items': 'center', 'width': '28px', 'height': '28px', 'padding': '0', 'margin-right': '-6px',
    'border-radius': '8px', 'background': 'transparent', 'color': '#8b919c', 'cursor': 'pointer', 'transition': 'background 120ms, color 120ms',
  },
  '.mkUExpand:hover': { 'background': 'var(--mk-glass-hover)', 'color': '#eceef2' },
  // page mode: fills the Claude panel; solid canvas (no glass), content centred at a readable width
  '.mkUsage[data-page]': {
    'inset': '0', 'width': 'auto', 'max-height': 'none', 'z-index': '80', 'border': '0', 'border-radius': '0', 'box-shadow': 'none',
    'background': 'var(--app-primary-background, #21252c)', 'animation': 'mkFade 180ms cubic-bezier(.2, .8, .2, 1)',
  },
  '.mkUsage[data-page] .mkUHead': {
    'background': 'var(--app-primary-background, #21252c)', 'padding': '14px max(16px, calc((100% - 1040px) / 2 + 20px)) 14px max(20px, calc((100% - 1040px) / 2 + 24px))',
  },
  '.mkUsage[data-page] .mkUHead strong': { 'font-size': '16px' },
  '.mkUsage[data-page] .mkUBody, .mkUsage[data-page] > .mkUEmpty': { 'box-sizing': 'border-box', 'max-width': '1040px', 'margin': '0 auto', 'padding': '20px 20px 40px', 'gap': '14px' },
  '.mkUsage[data-page] .mkUKpis': { 'grid-template-columns': 'repeat(auto-fit, minmax(170px, 1fr))', 'gap': '10px' },
  '.mkUsage[data-page] .mkUSplit': { 'grid-template-columns': 'repeat(auto-fit, minmax(340px, 1fr))', 'gap': '14px' },
  '.mkUBody': { 'position': 'relative', 'display': 'flex', 'flex-direction': 'column', 'gap': '10px', 'padding': '12px' },
  '.mkUEmpty': { 'margin': '0', 'padding': '32px 20px 36px', 'text-align': 'center', 'color': '#8b919c', 'line-height': '1.55' },
  // KPI tiles
  '.mkUKpis': { 'display': 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(138px, 1fr))', 'gap': '8px' },
  '.mkUKpi': { ...U_CARD, 'display': 'flex', 'flex-direction': 'column', 'gap': '6px', 'min-width': '0', 'padding': '12px 14px', 'background': 'rgba(255, 255, 255, 0.035)', 'box-shadow': 'var(--mk-hi)' },
  '.mkUKpi > span': U_EYEBROW,
  '.mkUKpiV': { 'display': 'flex', 'align-items': 'center', 'gap': '8px', 'min-width': '0' },
  '.mkUKpiV > b': { 'font': '500 22px/1.1 Geist, sans-serif', 'letter-spacing': '-0.02em', 'color': '#f2f4f7', 'font-variant-numeric': 'tabular-nums' },
  '.mkUKpi > small': { 'display': 'flex', 'align-items': 'center', 'gap': '6px', 'min-width': '0', 'font-size': '11px', 'color': '#8b919c', 'white-space': 'nowrap', 'overflow': 'hidden', 'text-overflow': 'ellipsis' },
  '.mkUD': { 'flex': 'none', 'font': `500 10.5px/16px ${U_MONO}`, 'font-style': 'normal', 'padding': '0 5px', 'border-radius': '999px', 'background': 'rgba(255, 255, 255, 0.06)', 'color': '#9aa3b2' },
  '.mkUD[data-t="good"]': { 'background': 'rgba(152, 195, 121, 0.14)', 'color': '#a8d08d' },
  '.mkUD[data-t="bad"]': { 'background': 'rgba(224, 108, 117, 0.15)', 'color': '#ef8a92' },
  // cards
  '.mkUCard': { ...U_CARD, 'min-width': '0', 'padding': '12px 14px 14px' },
  '.mkUCard h4': { ...U_EYEBROW, 'display': 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'gap': '8px', 'margin': '0 0 10px' },
  '.mkUCard h4 small': { 'font': `500 10.5px/1 ${U_MONO}`, 'letter-spacing': '0', 'color': '#5f6571' },
  '.mkULegend': { 'display': 'inline-flex', 'align-items': 'center', 'gap': '6px', 'font': '400 11px/1 Geist, sans-serif', 'letter-spacing': '0', 'text-transform': 'none', 'color': '#8b919c' },
  '.mkULegend i': { 'display': 'inline-block', 'width': '8px', 'height': '8px', 'border-radius': '2px', 'margin-left': '6px' },
  '.mkUsage i.ok': { 'background': U_OK },
  '.mkUsage i.re': { 'background': U_RE },
  '.mkUSplit': { 'display': 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(280px, 1fr))', 'gap': '10px' },
  // daily bars: recessive grid with values on the right, 2 px gap between stacked segments, rounded top only
  '.mkUChart': { 'position': 'relative', 'padding-right': '40px' },
  '.mkUGrid': { 'position': 'absolute', 'top': '0', 'left': '0', 'right': '0', 'height': '128px', 'display': 'flex', 'flex-direction': 'column', 'justify-content': 'space-between', 'pointer-events': 'none' },
  '.mkUGrid > span': { 'position': 'relative', 'height': '0', 'border-top': '1px dashed rgba(255, 255, 255, 0.07)' },
  '.mkUGrid > span:last-child': { 'border-top-style': 'solid', 'border-top-color': 'rgba(255, 255, 255, 0.12)' },
  '.mkUGrid > span::after': { 'content': 'attr(data-v)', 'position': 'absolute', 'right': '0', 'top': '-6px', 'font': `400 10px/1 ${U_MONO}`, 'color': '#5f6571' },
  '.mkUBars': { 'position': 'relative', 'height': '128px', 'display': 'flex', 'align-items': 'stretch', 'justify-content': 'space-between', 'gap': 'clamp(1px, calc(160px / var(--n)), 8px)' },
  '.mkUBar': { 'position': 'relative', 'flex': '1 1 0', 'max-width': '24px', 'display': 'flex', 'flex-direction': 'column', 'justify-content': 'flex-end', 'gap': '2px' },
  '.mkUBar::before': { 'content': "''", 'position': 'absolute', 'top': '0', 'bottom': '0', 'left': '-3px', 'right': '-3px', 'border-radius': '4px', 'transition': 'background 120ms' },
  '.mkUBar[data-on]::before': { 'background': 'rgba(255, 255, 255, 0.05)' },
  '.mkUBar > i': { 'position': 'relative', 'display': 'block', 'min-height': '2px', 'border-radius': '0' },
  '.mkUBar > i:first-child': { 'border-radius': '4px 4px 0 0' },
  '.mkUX': { 'display': 'flex', 'justify-content': 'space-between', 'margin-top': '8px', 'font': `400 10px/1 ${U_MONO}`, 'color': '#5f6571' },
  '.mkUTip': {
    'position': 'absolute', 'z-index': '5', 'min-width': '160px', 'box-sizing': 'border-box', 'padding': '8px 10px', 'border-radius': '10px',
    'background': '#1f232b', 'border': '1px solid var(--mk-edge-strong)', 'box-shadow': 'var(--mk-shadow-lg)', 'pointer-events': 'none',
    'font': '11px/1.6 Geist, sans-serif', 'color': '#c8ccd4', 'animation': 'mkFade 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkUTip strong': { 'display': 'block', 'margin-bottom': '4px', 'font-size': '11.5px', 'font-weight': '600', 'color': '#eceef2' },
  '.mkUTip div': { 'display': 'flex', 'align-items': 'center', 'gap': '6px' },
  '.mkUTip div span': { 'flex': '1', 'color': '#8b919c' },
  '.mkUTip div b': { 'font-family': U_MONO, 'color': '#dfe3ea', 'font-variant-numeric': 'tabular-nums' },
  '.mkUTip i': { 'width': '7px', 'height': '7px', 'border-radius': '2px' },
  // what stands out
  '.mkUInsights ul': { 'list-style': 'none', 'margin': '0', 'padding': '0', 'display': 'flex', 'flex-direction': 'column', 'gap': '6px' },
  '.mkUInsights li': { 'position': 'relative', 'padding': '8px 10px 8px 26px', 'border-radius': '8px', 'background': 'rgba(255, 255, 255, 0.03)', 'color': '#c8ccd4', 'line-height': '1.5' },
  '.mkUInsights li::before': { 'content': "''", 'position': 'absolute', 'left': '11px', 'top': '14px', 'width': '6px', 'height': '6px', 'border-radius': '50%', 'background': '#82a9f5' },
  '.mkUInsights li[data-t="warn"]::before': { 'background': '#e5c07b' },
  '.mkUInsights li[data-t="tip"]::before': { 'background': '#98c379' },
  '.mkUInsights li b': { 'color': '#eceef2', 'font-weight': '600' },
  // ranked lists (projects, kinds of work, chats, files)
  '.mkUList': { 'list-style': 'none', 'margin': '0 -8px', 'padding': '0', 'display': 'flex', 'flex-direction': 'column', 'gap': '2px' },
  '.mkUList li': { 'display': 'flex', 'align-items': 'flex-start', 'gap': '10px', 'padding': '7px 8px', 'border-radius': '8px', 'transition': 'background 120ms' },
  '.mkUList li:hover': { 'background': 'var(--mk-glass-hover)' },
  '.mkUIco': { 'flex': 'none', 'display': 'grid', 'place-items': 'center', 'width': '26px', 'height': '26px', 'margin-top': '1px', 'border-radius': '8px', 'background': 'rgba(255, 255, 255, 0.05)', 'color': '#9aa3b2', 'box-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, 0.06)' },
  '.mkURow': { 'flex': '1', 'min-width': '0', 'display': 'flex', 'flex-direction': 'column', 'gap': '5px' },
  '.mkURowTop': { 'display': 'flex', 'align-items': 'baseline', 'justify-content': 'space-between', 'gap': '10px' },
  '.mkURowTop > span': { 'min-width': '0', 'overflow': 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', 'font-size': '12.5px', 'font-weight': '500', 'color': '#dfe3ea' },
  '.mkURowTop > b': { 'flex': 'none', 'font': `500 12px/1 ${U_MONO}`, 'color': '#eceef2', 'font-variant-numeric': 'tabular-nums' },
  '.mkUMeter': { 'display': 'flex', 'gap': '2px', 'height': '4px', 'border-radius': '999px', 'background': 'rgba(255, 255, 255, 0.06)', 'overflow': 'hidden' },
  '.mkUMeter > i': { 'display': 'block', 'height': '100%', 'border-radius': '999px', 'transition': 'width 320ms cubic-bezier(.4, 0, .2, 1)' },
  '.mkURowSub': { 'display': 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'gap': '8px', 'font-size': '11px', 'color': '#7c8492' },
  '.mkURowSub > span': { 'min-width': '0', 'overflow': 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' },
  '.mkURowSub > em': { 'flex': 'none', 'font': `500 10.5px/16px ${U_MONO}`, 'font-style': 'normal', 'padding': '0 6px', 'border-radius': '999px', 'background': 'rgba(255, 255, 255, 0.05)', 'color': '#9aa3b2' },
  '.mkURowSub > em[data-t="warn"]': { 'background': 'rgba(184, 129, 44, 0.16)', 'color': '#e0b46a' },
  '.mkURowSub > em[data-t="bad"]': { 'background': 'rgba(224, 108, 117, 0.15)', 'color': '#ef8a92' },
  '.mkUMore': { 'margin': '6px 0 0', 'font-size': '11px', 'color': '#6f7785' },
  '.mkUFriction': { 'display': 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(76px, 1fr))', 'gap': '6px' },
  '.mkUFriction > div': { 'display': 'flex', 'flex-direction': 'column', 'gap': '2px', 'padding': '8px 10px', 'border-radius': '8px', 'background': 'rgba(255, 255, 255, 0.03)' },
  '.mkUFriction b': { 'font': '500 16px/1.2 Geist, sans-serif', 'color': '#eceef2', 'font-variant-numeric': 'tabular-nums' },
  '.mkUFriction span': { 'font-size': '10.5px', 'color': '#7c8492' },
  // Skills section (chat-extras section 15): header borrowed from Claude's, card like the account card
  '.mkSkHead': { 'flex-shrink': '0' },
  '.mkSkHead > .mkSkCount': {
    'margin-left': 'auto', 'padding': '0 7px', 'height': '18px', 'display': 'inline-flex', 'align-items': 'center', 'border-radius': '999px',
    'background': 'rgba(255, 255, 255, 0.05)', 'color': 'var(--mk-fg-faint)', 'font': "500 10.5px/1 'Geist Mono', 'JetBrains Mono', Menlo, monospace",
    'font-variant-numeric': 'tabular-nums',
  },
  '.mkSkHead > .mkSkCount:empty': { 'display': 'none' },
  '.mkSkBody': {
    'display': 'flex', 'flex-direction': 'column', 'flex-shrink': '0', 'max-height': 'min(60vh, 480px)', 'overflow': 'hidden',
    'background': 'var(--mk-glass)', 'border': '1px solid var(--mk-edge)', 'border-radius': 'var(--mk-r-16)',
    'box-shadow': 'var(--mk-hi), var(--mk-shadow-sm)', 'backdrop-filter': 'var(--mk-blur)', '-webkit-backdrop-filter': 'var(--mk-blur)',
  },
  '.mkSkBody[hidden]': { 'display': 'none !important' },
  '.mkSkSearch': {
    'display': 'flex', 'align-items': 'center', 'gap': '8px', 'flex': 'none', 'height': '40px', 'padding': '0 12px',
    'border-bottom': '1px solid rgba(255, 255, 255, 0.06)', 'color': 'var(--mk-fg-faint)', 'cursor': 'text',
  },
  '.mkSkSearch > svg': { 'flex': 'none' },
  '.mkSkSearch > input': {
    'flex': '1', 'min-width': '0', 'height': '100%', 'padding': '0', 'border': '0', 'outline': 'none', 'background': 'transparent',
    'color': 'var(--mk-fg)', 'font': 'inherit', 'font-size': '12.5px',
  },
  '.mkSkSearch > input::placeholder': { 'color': 'var(--mk-fg-faint)' },
  '.mkSkSearch:focus-within': { 'color': 'var(--mk-accent-soft)' },
  '.mkSkList': { 'flex': '1', 'min-height': '0', 'overflow-y': 'auto', 'padding': '4px 6px 6px', 'scrollbar-width': 'thin' },
  '.mkSkGroup': {
    'display': 'flex', 'align-items': 'center', 'gap': '6px', 'height': '28px', 'padding': '0 8px', 'margin-top': '4px',
    'font-size': '11px', 'font-weight': '500', 'letter-spacing': '0.04em', 'text-transform': 'uppercase', 'color': 'var(--mk-fg-faint)',
  },
  '.mkSkGroup > em': { 'font-style': 'normal', 'font-family': "'Geist Mono', 'JetBrains Mono', Menlo, monospace", 'letter-spacing': '0' },
  '.mkSkItem': { 'border-radius': 'var(--mk-r-10)', 'transition': 'background 120ms cubic-bezier(.4, 0, .2, 1)' },
  '.mkSkItem[data-open]': { 'background': 'rgba(255, 255, 255, 0.04)', 'box-shadow': 'inset 0 0 0 1px rgba(255, 255, 255, 0.05)', 'margin': '2px 0' },
  '.mkSkRow': {
    'display': 'flex', 'align-items': 'center', 'gap': '10px', 'width': '100%', 'height': '34px', 'padding': '0 8px 0 10px',
    'appearance': 'none', 'border': '0', 'border-radius': 'var(--mk-r-10)', 'background': 'transparent', 'color': 'var(--mk-fg-body)',
    'font': 'inherit', 'text-align': 'left', 'cursor': 'pointer', 'outline': 'none', 'transition': 'background 120ms cubic-bezier(.4, 0, .2, 1), color 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkSkRow:hover': { 'background': 'var(--mk-glass-hover)', 'color': 'var(--mk-fg)' },
  '.mkSkItem[data-open] > .mkSkRow': { 'color': 'var(--mk-fg)' },
  '.mkSkItem[data-open] > .mkSkRow:hover': { 'background': 'transparent' },
  '.mkSkRow:focus-visible, .mkSkAct:focus-visible': { 'box-shadow': '0 0 0 2px rgba(130, 169, 245, 0.5)' },
  '.mkSkBolt': { 'flex': 'none', 'display': 'grid', 'place-items': 'center', 'width': '15px', 'color': '#f59f4c' },
  '.mkSkName': {
    'flex': '1', 'min-width': '0', 'overflow': 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
    'font': "500 12px/1 'Geist Mono', 'JetBrains Mono', Menlo, monospace",
  },
  '.mkSkN': {
    'flex': 'none', 'font': "500 10.5px/16px 'Geist Mono', 'JetBrains Mono', Menlo, monospace", 'font-style': 'normal', 'padding': '0 6px',
    'border-radius': '999px', 'background': 'rgba(255, 255, 255, 0.05)', 'color': 'var(--mk-fg-faint)', 'font-variant-numeric': 'tabular-nums',
  },
  '.mkSkChev': { 'flex': 'none', 'display': 'grid', 'place-items': 'center', 'color': 'var(--mk-fg-faint)', 'transition': 'transform 180ms cubic-bezier(.4, 0, .2, 1)' },
  '.mkSkItem[data-open] .mkSkChev': { 'transform': 'rotate(90deg)' },
  '.mkSkDetail': { 'padding': '0 6px 6px', 'animation': 'mkFade 180ms cubic-bezier(.4, 0, .2, 1)' },
  '.mkSkDesc': { 'margin': '0 4px 8px 29px', 'font-size': '11.5px', 'line-height': '1.5', 'color': 'var(--mk-fg-muted)' },
  '.mkSkActs': { 'list-style': 'none', 'margin': '0', 'padding': '0', 'display': 'flex', 'flex-direction': 'column', 'gap': '2px' },
  '.mkSkAct': {
    'display': 'flex', 'align-items': 'center', 'gap': '10px', 'width': '100%', 'padding': '7px 8px 7px 29px', 'appearance': 'none', 'border': '0',
    'border-radius': 'var(--mk-r-8)', 'background': 'transparent', 'color': 'var(--mk-fg-body)', 'font': 'inherit', 'text-align': 'left',
    'cursor': 'pointer', 'outline': 'none', 'transition': 'background 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkSkAct:hover': { 'background': 'var(--mk-glass-hover)' },
  '.mkSkActTx': { 'flex': '1', 'min-width': '0', 'display': 'flex', 'flex-direction': 'column', 'gap': '2px' },
  '.mkSkActTx > b': { 'font-size': '12.5px', 'font-weight': '500', 'color': 'var(--mk-fg)' },
  '.mkSkActTx > small': { 'font-size': '11px', 'line-height': '1.4', 'color': 'var(--mk-fg-faint)' },
  '.mkSkAdd': {
    'flex': 'none', 'display': 'grid', 'place-items': 'center', 'width': '24px', 'height': '24px', 'border-radius': '7px',
    'color': 'var(--mk-fg-faint)', 'transition': 'background 120ms cubic-bezier(.4, 0, .2, 1), color 120ms cubic-bezier(.4, 0, .2, 1)',
  },
  '.mkSkAct:hover > .mkSkAdd': { 'background': 'color-mix(in srgb, var(--mk-accent) 16%, transparent)', 'color': 'var(--mk-accent-soft)' },
  '.mkSkAct[data-added] > .mkSkAdd': { 'background': 'rgba(76, 175, 122, 0.16)', 'color': '#6fcf97' },
  '.mkSkEmpty': { 'margin': '0', 'padding': '14px 10px', 'font-size': '11.5px', 'line-height': '1.5', 'color': 'var(--mk-fg-faint)' },
  '.mkSkEmpty > code': { 'font-family': "'Geist Mono', 'JetBrains Mono', Menlo, monospace", 'font-size': '11px', 'color': 'var(--mk-fg-muted)' },
  '.mkUNote': { 'margin': '10px 0 0', 'font-size': '11px', 'line-height': '1.5', 'color': '#7c8492' },
  '.mkUFoot': { 'margin': '2px 2px 0', 'font-size': '10.5px', 'line-height': '1.5', 'color': '#5f6571' },
};
Object.assign(rules, usageRules);

const existing = data()[WV];
// the build owns every .mk* / [data-mk*] rule: stale ones are removed, current ones replaced whole (never merged)
const owned = (sel) => /^(\.mk|html\[data-mk|\[data-mk)/.test(sel);
for (const sel of Object.keys(existing)) if (owned(sel) && !(sel in rules)) set([WV, sel], undefined);
for (const [sel, props] of Object.entries(rules)) set([WV, sel], owned(sel) ? props : { ...(existing[sel] || {}), ...props });

const errors = [];
jsonc.parse(text, errors, { allowTrailingComma: true });
if (errors.length) throw new Error('invalid settings after build');
fs.writeFileSync(file, text);
console.log(`chat extras: ${code.length} chars, ${Object.keys(rules).length} style rules, tab rename menu`);

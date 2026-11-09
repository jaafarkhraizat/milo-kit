// Milo Kit apply: turns the user's choices (~/.milo-kit/config.json) into settings.
// Shared by the installer (lib/install.js) and the Milo Kit settings extension, so both give the same result.
//
// It edits in place: only the values it controls (root CSS variables, a few settings keys, feature switches,
// Milo's Scroll config, Claude Code hooks). It never re-merges the full kit settings; that is the installer's job.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const jsonc = require('./vendor/jsonc-parser/main.js');

const HOME = os.homedir();
const KIT_HOME = path.join(HOME, '.milo-kit');
const CONFIG_FILE = path.join(KIT_HOME, 'config.json');
const STATE_FILE = path.join(KIT_HOME, 'state.json');
const KIT_COPY = path.join(KIT_HOME, 'kit');
const SCROLL_DIR = path.join(HOME, '.claude', 'milos-scroll');
const USAGE_DIR = path.join(HOME, '.claude', 'milo-usage');
const CLAUDE_SETTINGS = path.join(HOME, '.claude', 'settings.json');
const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } };

const WV = 'custom-ui-style.webview.stylesheet';
const WB = 'custom-ui-style.stylesheet';
const EXT = 'custom-ui-style.extensions.config';
const COLORS = 'workbench.colorCustomizations';
const THEME = '[Theme Mix]';

// ── Choices ──────────────────────────────────────────────────────────────────
const PRESETS = {
  milo: { label: 'Milo', note: 'Default', accent: '#3f74e0', editor: '#1d2025', side: '#111316', card: '#1a1d22', text: '#eceef2', muted: '#8b919c' },
  ember: { label: 'Ember', note: 'Warm dark', accent: '#e0773f', editor: '#161210', side: '#110e0c', card: '#1d1815', text: '#f2ebe6', muted: '#9c918b' },
  moss: { label: 'Moss', note: 'Green dark', accent: '#4caf7a', editor: '#101411', side: '#0c0f0d', card: '#151b17', text: '#e8efe9', muted: '#8b9c90' },
  ink: { label: 'Ink', note: 'True black', accent: '#a78bfa', editor: '#050505', side: '#000000', card: '#0f0f0f', text: '#fafafa', muted: '#8a8a8a' },
};
// The colors the kit's stylesheets and Theme Mix were drawn in. Hand-picked shades (palette, SHADES) and the
// Theme Mix keys the settings ship belong to these values, so color math compares against them, not a preset.
const NATIVE = { accent: '#3f74e0', editor: '#282c34', side: '#15171b', card: '#21252c', text: '#eceef2', muted: '#8b919c' };
const SWATCHES = { blue: '#3f74e0', orange: '#e0773f', green: '#4caf7a', purple: '#a78bfa', pink: '#e06c9a' };
const ROLES = ['accent', 'editor', 'side', 'card', 'text', 'muted'];
const FEATURES = ['avatars', 'milo', 'tabIcons', 'thumbs', 'tokens', 'mcp', 'tasks', 'map', 'pin', 'expand', 'queue', 'rename', 'skills'];
const SCROLL_TYPES = ['complete', 'question', 'permission', 'idle', 'limit'];
const CORNERS = { sharp: 0.5, soft: 1, round: 1.5 };
const UI_FONTS = {
  Geist: "Geist, 'Inter Variable', -apple-system, sans-serif",
  Inter: "Inter, 'Inter Variable', -apple-system, sans-serif",
  'SF Pro': "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
  'System default': '-apple-system, BlinkMacSystemFont, sans-serif',
};
const CODE_FONTS = ['Geist Mono', 'JetBrains Mono', 'SF Mono', 'Menlo'];
const codeStack = (f) => [...new Set([f, 'JetBrains Mono', 'Menlo'])].map((n) => (n.includes(' ') ? `'${n}'` : n)).join(', ') + ', monospace';

const DEFAULTS = {
  preset: 'milo',
  colors: { ...PRESETS.milo },
  corners: 'soft',
  icons: { product: 'remix-product-icons', file: 'symbols' },
  appIcon: 'stock',
  fonts: { ui: 'Geist', code: 'Geist Mono', size: 14 },
  initials: '',
  // me: text (initials) | image. agent: claude (the kit's spark) | text | image. Images are small data: URLs
  // (the settings tab crops and shrinks them), written straight into the avatar rules.
  // agentPreset: file name in ~/.milo-kit/avatars the agent image came from ('' = uploaded), for the settings grid.
  // profiles: your avatar per VS Code profile, { [profile name]: { email, title, me, meImage } }. email is the
  // profile's Claude account (picks the chat rules), title its window title (picks the title bar rule). Windows
  // that match no profile use me / meImage above.
  avatar: { me: 'text', meImage: '', agent: 'claude', agentText: 'C', agentImage: '', agentPreset: '', profiles: {} },
  features: Object.fromEntries(FEATURES.map((f) => [f, true])),
  scroll: { enabled: true, events: [...SCROLL_TYPES], only_when_away: true, all_screens: true, position: 'top-center', seconds: 4, sound: 'off' },
  status: { usageOnly: true, show: 'both', progressBar: true, yellow: 80, red: 90, summary: true },
  // Space button: a header button in the chat that opens a web page (an artifact, a dashboard). openOnStartup opens it when VS Code starts.
  space: { enabled: false, label: '', url: '', openOnStartup: false },
};
delete DEFAULTS.colors.label;
delete DEFAULTS.colors.note;

const clone = (o) => JSON.parse(JSON.stringify(o));
function merge(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = merge(out[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
const loadState = () => readJson(STATE_FILE, {});
const saveState = (s) => writeJson(STATE_FILE, s);

// settingsPath (optional): read the current avatar initials from settings when nothing is saved yet.
function loadConfig(settingsPath, appPath = DEFAULT_APP) {
  const raw = readJson(CONFIG_FILE, {});
  const cfg = merge(DEFAULTS, raw);
  // Configs from before the app icon option: keep a Milo icon that is already on the app.
  if (!raw.appIcon && process.platform === 'darwin' && fs.existsSync(path.join(appPath, 'Icon\r'))) cfg.appIcon = 'milo';
  if (!cfg.initials) cfg.initials = loadState().initials || initialsFromSettings(settingsPath) || 'ME';
  // Milo's Scroll's own config wins: the /scroll skill edits it directly.
  const live = readJson(path.join(SCROLL_DIR, 'config.json'), null);
  if (live) for (const k of Object.keys(DEFAULTS.scroll)) if (k in live) cfg.scroll[k] = live[k];
  return cfg;
}
function initialsFromSettings(settingsPath) {
  try {
    const data = jsonc.parse(fs.readFileSync(settingsPath, 'utf8'), [], { allowTrailingComma: true });
    const m = /^'([^']{1,3})'$/.exec(String(((data[WV] || {})[USER_AVATAR] || {}).content || ''));
    return m ? m[1] : '';
  } catch (e) { return ''; }
}
function saveConfig(cfg) { writeJson(CONFIG_FILE, cfg); }

// Avatar images: base64 data: URLs only (nothing that could close the CSS url('...')), at most ~200 KB.
const AVATAR_IMG = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const AVATAR_MAX = 200000;

// Space button URL: http(s) only, no characters that could break out of the patched script ($ is special in a patch replacement).
const SPACE_URL = /^https?:\/\/[^\s"'\\$<>`]{1,500}$/;

// Check and clean a config that came from the settings tab or the installer.
function normalize(input) {
  const cfg = merge(DEFAULTS, input);
  const hex = /^#[0-9a-f]{6}$/i;
  for (const r of ROLES) if (!hex.test(String(cfg.colors[r]))) cfg.colors[r] = DEFAULTS.colors[r];
  for (const r of ROLES) cfg.colors[r] = cfg.colors[r].toLowerCase();
  if (!CORNERS[cfg.corners]) cfg.corners = 'soft';
  if (!['milo', 'stock'].includes(cfg.appIcon)) cfg.appIcon = 'stock';
  if (!UI_FONTS[cfg.fonts.ui]) cfg.fonts.ui = 'Geist';
  if (!CODE_FONTS.includes(cfg.fonts.code)) cfg.fonts.code = 'Geist Mono';
  cfg.fonts.size = Math.min(20, Math.max(11, parseInt(cfg.fonts.size, 10) || 14));
  cfg.initials = String(cfg.initials || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3).toUpperCase() || 'ME';
  const av = cfg.avatar;
  const img = (v) => (typeof v === 'string' && v.length <= AVATAR_MAX && AVATAR_IMG.test(v) ? v : '');
  av.meImage = img(av.meImage);
  av.agentImage = img(av.agentImage);
  if (!['text', 'image'].includes(av.me) || (av.me === 'image' && !av.meImage)) av.me = 'text';
  if (!['claude', 'text', 'image'].includes(av.agent) || (av.agent === 'image' && !av.agentImage)) av.agent = 'claude';
  av.agentPreset = av.agent === 'image' ? String(av.agentPreset || '').replace(/[^\w.\- ]/g, '').slice(0, 80) : '';
  av.agentText = String(av.agentText || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3).toUpperCase() || 'C';
  // profile names, emails and titles end up inside CSS selectors: nothing that could close a string or rule
  const profiles = {};
  for (const [name, pr] of Object.entries(av.profiles || {})) {
    const n = String(name).replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 40);
    if (!n || !pr || typeof pr !== 'object') continue;
    const meImage = img(pr.meImage);
    profiles[n] = {
      email: /^[\w.+-]{1,64}@[\w-]+(\.[\w-]+)+$/.test(String(pr.email || '')) ? String(pr.email).toLowerCase() : '',
      title: String(pr.title || '').replace(/["'\\<>{}\n\r]/g, '').trim().slice(0, 80),
      me: pr.me === 'image' && meImage ? 'image' : 'text',
      meImage,
    };
  }
  av.profiles = profiles;
  for (const k of Object.keys(av)) if (!(k in DEFAULTS.avatar)) delete av[k];
  for (const f of FEATURES) cfg.features[f] = cfg.features[f] !== false;
  cfg.scroll.events = (cfg.scroll.events || []).filter((e) => SCROLL_TYPES.includes(e));
  cfg.scroll.seconds = Math.max(0, Math.min(120, Number(cfg.scroll.seconds) || 0));
  if (!['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'].includes(cfg.scroll.position)) cfg.scroll.position = 'top-center';
  if (!['off', 'chime'].includes(cfg.scroll.sound)) cfg.scroll.sound = 'off';
  if (!['session', 'weekly', 'both'].includes(cfg.status.show)) cfg.status.show = 'both';
  cfg.status.yellow = [70, 80, 90].includes(+cfg.status.yellow) ? +cfg.status.yellow : 80;
  cfg.status.red = [85, 90, 95].includes(+cfg.status.red) ? +cfg.status.red : 90;
  if (cfg.status.red <= cfg.status.yellow) cfg.status.red = cfg.status.yellow === 90 ? 95 : 90;
  const sp = cfg.space;
  sp.url = typeof sp.url === 'string' && SPACE_URL.test(sp.url.trim()) ? sp.url.trim() : '';
  sp.label = String(sp.label || '').replace(/[\u0000-\u001f"'\\$<>`]/g, '').trim().slice(0, 30);
  sp.enabled = sp.enabled === true && !!sp.url;
  sp.openOnStartup = sp.openOnStartup === true && !!sp.url;
  return cfg;
}

// ── Color math ───────────────────────────────────────────────────────────────
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hexOf = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = rgbOf(a), y = rgbOf(b); return hexOf(x.map((v, i) => v + (y[i] - v) * t)); };
const rgbSpace = (h) => `rgb(${rgbOf(h).join(' ')})`;

// Derived shades. When the inputs are the kit defaults, the kit's original hand-picked values are used.
function palette(c) {
  const d = NATIVE;
  const same = (...roles) => roles.every((r) => c[r] === d[r]);
  const pick = (roles, original, derive) => (same(...roles) ? original : derive());
  return {
    accent: c.accent,
    accentStrong: pick(['accent'], '#2f5ab8', () => mix(c.accent, '#000000', 0.25)),
    accentHover: pick(['accent'], '#5084ea', () => mix(c.accent, '#ffffff', 0.12)),
    accentSoft: pick(['accent'], '#82a9f5', () => mix(c.accent, '#ffffff', 0.4)),
    accentSofter: pick(['accent'], '#9dbbf7', () => mix(c.accent, '#ffffff', 0.55)),
    link: pick(['accent'], '#6ea8fe', () => mix(c.accent, '#ffffff', 0.3)),
    text: c.text,
    textBody: pick(['text', 'muted'], '#c8ccd4', () => mix(c.text, c.muted, 0.45)),
    muted: c.muted,
    faint: pick(['muted', 'card'], '#5f6571', () => mix(c.muted, c.card, 0.45)),
    editor: c.editor,
    side: c.side,
    card: c.card,
    strip: pick(['side', 'card'], '#1b1e23', () => mix(c.side, c.card, 0.5)),
    hover: pick(['side', 'card'], '#1f2228', () => mix(c.side, c.card, 0.75)),
    gap: pick(['side'], '#181825', () => mix(c.side, '#000000', 0.15)),
  };
}

// ── Stylesheet tokens ────────────────────────────────────────────────────────
// Hard-coded kit colors become CSS variables, so one value at the root recolors everything.
// Idempotent: once a color is a variable it no longer matches. Variable values are written as rgb(r g b),
// a form the patterns below never match.
const COLOR_TOKENS = [
  ['3f74e0', '63\\s*,\\s*116\\s*,\\s*224', 'accent'],
  ['2f5ab8', null, 'accent-strong'],
  ['5084ea', null, 'accent-hover'],
  ['82a9f5', '130\\s*,\\s*169\\s*,\\s*245', 'accent-soft'],
  ['9dbbf7', null, 'accent-softer'],
  ['6ea8fe', '110\\s*,\\s*168\\s*,\\s*254', 'link'],
  ['eceef2', null, 'fg'],
  ['c8ccd4', null, 'fg-body'],
  ['8b919c', null, 'fg-muted'],
  ['5f6571', null, 'fg-faint'],
  ['21252c', null, 'card'],
  ['181825', null, 'gap'],
];
// In-between kit colors (text greys, chip and tooltip fills, accent tints). Each sits on a ladder of palette
// colors; with the kit palette it keeps its hand-picked value, with any other palette it is mixed from the two
// ladder colors it sits between, at the same ratio. [hex, token, ladder]
const LADDERS = {
  fg: { roles: ['text', 'muted', 'card'], steps: ['#ffffff', 'text', 'textBody', 'muted', 'faint', 'card', '#000000'] },
  accent: { roles: ['accent'], steps: ['#ffffff', 'accentSofter', 'accentSoft', 'link', 'accentHover', 'accent', 'accentStrong', '#000000'] },
};
const SHADES = [
  ['f2f4f8', 'fg-hi', 'fg'], ['f2f4f7', 'fg-hi', 'fg'], ['f2ede6', 'fg-bold', 'fg'], ['e8e1d6', 'fg-msg', 'fg'],
  ['e6e9ef', 'fg-2', 'fg'], ['dfe3ea', 'fg-3', 'fg'], ['d7dbe2', 'fg-4', 'fg'], ['d6deeb', 'fg-5', 'fg'], ['d4d9e2', 'fg-6', 'fg'],
  ['b4bfd2', 'fg-7', 'fg'], ['aab2bf', 'fg-8', 'fg'], ['a3abb9', 'fg-9', 'fg'], ['9aa3b2', 'fg-10', 'fg'],
  ['7c8492', 'fg-11', 'fg'], ['6f7785', 'fg-12', 'fg'], ['4b5263', 'line', 'fg'],
  ['323843', 'card-hi', 'fg'], ['2a2f38', 'card-hi-2', 'fg'], ['1f232b', 'card-low', 'fg'], ['1a1d23', 'card-low-2', 'fg'],
  ['d6e3ff', 'accent-pale', 'accent'], ['cfe0ff', 'accent-pale-2', 'accent'], ['a5c8ff', 'link-hi', 'accent'],
  ['8dbaff', 'link-2', 'accent'], ['5f90ee', 'accent-top', 'accent'], ['3463c7', 'accent-press', 'accent'],
];
// The palette value for each shade token (written to html:root next to --mk-card and friends).
function shadeValues(c, p) {
  const d = palette(NATIVE);
  const at = (pal, s) => (s.startsWith('#') ? s : pal[s]);
  const dist = (a, b) => rgbOf(a).reduce((s, v, i) => s + (v - rgbOf(b)[i]) ** 2, 0);
  const out = {};
  for (const [hex, name, lad] of SHADES) {
    if (out[name]) continue;
    const { roles, steps } = LADDERS[lad];
    if (roles.every((r) => c[r] === NATIVE[r])) { out[name] = '#' + hex; continue; }
    // the ladder segment closest to the kit value, and where on it the value sits
    let best = null;
    for (let i = 0; i < steps.length - 1; i++) {
      const a = rgbOf(at(d, steps[i])), b = rgbOf(at(d, steps[i + 1])), x = rgbOf('#' + hex);
      const ab = b.map((v, k) => v - a[k]), len = ab.reduce((s, v) => s + v * v, 0) || 1;
      const t = Math.max(0, Math.min(1, x.reduce((s, v, k) => s + (v - a[k]) * ab[k], 0) / len));
      const e = dist('#' + hex, hexOf(a.map((v, k) => v + ab[k] * t)));
      if (!best || e < best.e) best = { i, t, e };
    }
    out[name] = mix(at(p, steps[best.i]), at(p, steps[best.i + 1]), best.t);
  }
  return out;
}
const pct = (n) => `${Math.round(n * 1000) / 10}%`;
function tokenizeColors(css) {
  for (const [hex, rgba, name] of [...COLOR_TOKENS, ...SHADES.map(([h, n]) => [h, null, n])]) {
    css = css.replace(new RegExp(`#${hex}([0-9a-f]{2})?(?![0-9a-f])`, 'gi'), (all, a) =>
      a ? `color-mix(in srgb, var(--mk-${name}) ${pct(parseInt(a, 16) / 255)}, transparent)` : `var(--mk-${name})`);
    if (rgba) {
      css = css.replace(new RegExp(`rgba\\(\\s*${rgba}\\s*,\\s*([\\d.]+)\\s*\\)`, 'g'), (all, a) =>
        `color-mix(in srgb, var(--mk-${name}) ${pct(parseFloat(a))}, transparent)`);
    }
  }
  return css;
}
// Corner radii (px values 3 to 24) become --mk-r-N, scaled by the corners choice.
function tokenizeRadii(css) {
  const swap = (v) => v.replace(/(^|[\s(])(\d+)px/g, (all, pre, n) => (n >= 3 && n <= 24 ? `${pre}var(--mk-r-${n})` : all));
  css = css.replace(/("(?:border-radius|--corner-radius-[a-z]+|--app-list-border-radius)"\s*:\s*")([^"]*)"/g, (all, k, v) => `${k}${swap(v)}"`);
  css = css.replace(/(round\s+)(\d+)px/g, (all, pre, n) => (n >= 3 && n <= 24 ? `${pre}var(--mk-r-${n})` : all));
  return css;
}
// Rewrites the text of one top-level key's value, leaving comments and every other key alone.
function rewriteValue(text, key, fn) {
  const tree = jsonc.parseTree(text, [], { allowTrailingComma: true });
  const node = tree && jsonc.findNodeAtLocation(tree, [key]);
  if (!node) return text;
  const before = text.slice(node.offset, node.offset + node.length);
  const after = fn(before);
  return after === before ? text : text.slice(0, node.offset) + after + text.slice(node.offset + node.length);
}

// ── Hand edits ───────────────────────────────────────────────────────────────
// After every write the kit records a fingerprint of each settings value ("leaf") in state.base. A leaf whose
// value no longer matches its fingerprint was changed by hand, and kit updates and saves leave it alone.
// Leaves: plain keys are one leaf; extension patches are one leaf per extension; stylesheets and color
// customizations are one leaf per property (selector > property, theme > color).
const LEAF_DEPTH = { [EXT]: 2, [WV]: 3, [WB]: 3, [COLORS]: 3 };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fingerprint = (v) => (v === undefined ? '-' : require('crypto').createHash('sha1').update(JSON.stringify(v)).digest('base64').slice(0, 12));
const leafKey = (p) => JSON.stringify(p.slice(0, LEAF_DEPTH[p[0]] || 1));
// Map of leaf key -> [path, value] for a parsed settings object.
function leavesOf(data) {
  const out = new Map();
  const walk = (v, p) => {
    if (p.length && (p.length >= (LEAF_DEPTH[p[0]] || 1) || !isObj(v))) { out.set(JSON.stringify(p), [p, v]); return; }
    for (const [k, x] of Object.entries(v || {})) walk(x, [...p, k]);
  };
  walk(data, []);
  return out;
}
const valueAt = (data, p) => p.reduce((o, k) => (isObj(o) || Array.isArray(o) ? o[k] : undefined), data);
// Leaves changed by hand since the last record: Map of leaf key -> path. No record yet means nothing is known.
function handEdits(data, base) {
  const out = new Map();
  if (!base || !Object.keys(base).length) return out;
  for (const [k, [p, v]] of leavesOf(data)) if (fingerprint(v) !== (base[k] || '-')) out.set(k, p);
  for (const k of Object.keys(base)) if (!out.has(k) && base[k] !== '-' && valueAt(data, JSON.parse(k)) === undefined) out.set(k, JSON.parse(k));
  return out;
}
// New record after a write. Hand-edited leaves keep their old fingerprint, so they stay hand-edited.
function recordBase(data, base, hand) {
  const out = {};
  for (const [k, [, v]] of leavesOf(data)) out[k] = fingerprint(v);
  for (const k of hand.keys()) { if (base && k in base) out[k] = base[k]; else delete out[k]; }
  return out;
}

// ── Feature switches ─────────────────────────────────────────────────────────
const USER_AVATAR = '[class*="userMessageContainer_"] > [class*="userMessageContainer_"]:not([class*="userMessageContainer_"] ~ [class*="userMessageContainer_"])::before';
const ACCOUNT_AVATAR = '[class*="accountUsageBody_"] [class*="section_"]:has(> [class*="accountInfo_"]) [class*="accountRow_"]::before';
// Claude's avatar: the newest block of each reply. CLAUDE_SPARK is the kit's own drawing (the "Claude" choice).
// Per profile: the chat knows its Claude account from the auth status Claude Code writes on #root; the window
// knows its title from workbench/profile-mark.js (data-mk-title on <html>).
const PROFILE_CHAT = (email) => `html:has(#root[data-initial-auth-status*="${email}"])`;
const PROFILE_TITLE = (title) => `html[data-mk-title="${title}"]`;
const TITLE_AVATAR = '.monaco-workbench .part.titlebar .window-title::before';
const AGENT_AVATAR = '[class*="timelineMessage_"]:not(:has(+ [class*="timelineMessage_"]))::before';
const CLAUDE_SPARK = "url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%2212%22%20r%3D%2212%22%20fill%3D%22%23d97757%22%2F%3E%3Cg%20stroke%3D%22%23fff%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%3E%3Cline%20x1%3D%2212.00%22%20y1%3D%229.80%22%20x2%3D%2212.00%22%20y2%3D%224.80%22%2F%3E%3Cline%20x1%3D%2213.29%22%20y1%3D%2210.22%22%20x2%3D%2215.29%22%20y2%3D%227.47%22%2F%3E%3Cline%20x1%3D%2214.09%22%20y1%3D%2211.32%22%20x2%3D%2218.85%22%20y2%3D%229.78%22%2F%3E%3Cline%20x1%3D%2214.09%22%20y1%3D%2212.68%22%20x2%3D%2217.33%22%20y2%3D%2213.73%22%2F%3E%3Cline%20x1%3D%2213.29%22%20y1%3D%2213.78%22%20x2%3D%2216.23%22%20y2%3D%2217.82%22%2F%3E%3Cline%20x1%3D%2212.00%22%20y1%3D%2214.20%22%20x2%3D%2212.00%22%20y2%3D%2217.60%22%2F%3E%3Cline%20x1%3D%2210.71%22%20y1%3D%2213.78%22%20x2%3D%227.77%22%20y2%3D%2217.82%22%2F%3E%3Cline%20x1%3D%229.91%22%20y1%3D%2212.68%22%20x2%3D%226.67%22%20y2%3D%2213.73%22%2F%3E%3Cline%20x1%3D%229.91%22%20y1%3D%2211.32%22%20x2%3D%225.15%22%20y2%3D%229.78%22%2F%3E%3Cline%20x1%3D%2210.71%22%20y1%3D%2210.22%22%20x2%3D%228.71%22%20y2%3D%227.47%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E') center / cover no-repeat !important";
const MILO_EMPTY = '[class^="container_"]:has(> [class^="messageContainer_"])';
// Features that only hide what the kit drew. The chat script tags <html data-mk-off="..."> from the list.
const GATES = {
  map: ['.mkMap', '.mkMapToggle'],
  tokens: ['.mkTokens', '.mkDashBtn'],
  mcp: ['.mkMcp'],
  tasks: ['.mkTasks', '.mkAgents'],
  thumbs: ['.mkThumb'],
  avatars: [USER_AVATAR],
  milo: [`${MILO_EMPTY}::before`],
};
// Milo Kit settings opens as a popup: VS Code draws each webview as a fixed layer anchored to its editor
// (.webview-overlay-content inside a clipping root). These rules re-pin the settings layer to the window centre
// over a dimmed backdrop, only while it is visible. Without Custom UI Style it stays a normal editor tab.
const POPUP_IFRAME = 'iframe[src*="extensionId=local.milo-kit-settings"]';
const POPUP_VISIBLE = '.webview-overlay-content:not([style*="visibility: hidden"])';
const POPUP_LAYER = `${POPUP_VISIBLE}:has(${POPUP_IFRAME})`;
const POPUP_ROOT = `div:has(> ${POPUP_VISIBLE} ${POPUP_IFRAME})`; // :has() cannot nest, so the root uses a descendant match
const POPUP_RULES = {
  [POPUP_ROOT]: {
    position: 'fixed !important', top: '0 !important', left: '0 !important', right: '0 !important', bottom: '0 !important',
    width: 'auto !important', height: 'auto !important', 'clip-path': 'none !important', 'z-index': '2550 !important',
  },
  [`${POPUP_ROOT}::before`]: {
    content: "''", position: 'absolute', inset: '0', background: 'rgba(8, 10, 14, 0.55)', 'pointer-events': 'auto',
  },
  [POPUP_LAYER]: {
    top: '50% !important', left: '50% !important', transform: 'translate(-50%, -50%)',
    width: 'min(1180px, calc(100vw - 80px)) !important', height: 'min(820px, calc(100vh - 80px)) !important',
    'border-radius': '16px', border: '1px solid rgba(255, 255, 255, 0.09)',
    'box-shadow': '0 32px 80px -24px rgba(0, 0, 0, 0.75), 0 4px 12px rgba(0, 0, 0, 0.35)', 'z-index': '1 !important',
  },
};
const USAGE_ONLY ='.monaco-workbench .part.statusbar .statusbar-item:not([id="harshagarwal1012.claude-usage-bar" i])';
const RENAME_PATCH = (p) => p && p.filePath === 'package.json' && p.find === '"editor/title": [';
const TAB_ICON_PATCH = (p) => p && p.filePath === 'extension.js' && String(p.find).includes('hasPendingPermissions');
const CHAT_PATCH = (p) => p && p.filePath === 'webview/index.js' && String(p.replace).includes('/*mk-chat*/');
const USAGE_BAR = 'harshagarwal1012.claude-usage-bar';

function usageSelectors(lo, hi) {
  const sel = [];
  for (let n = lo; n < hi && n < 100; n++) sel.push(`[style*="width: ${n}"]`);
  if (hi > 100) sel.push('[style*="width: 100"]');
  return sel;
}
function usageRules(yellow, red) {
  const fill = (s) => s.map((x) => `[class*="usageFill_"]${x}`).join(', ');
  const ys = usageSelectors(yellow, red), rs = usageSelectors(red, 101);
  return {
    [fill(ys)]: { 'background-color': '#e5c07b !important' },
    [fill(rs)]: { 'background-color': '#e06c75 !important' },
    [`[class*="usageBarContainer_"]:has(${fill(ys)}) [class*="usagePercent_"]`]: { color: '#e5c07b !important' },
    [`[class*="usageBarContainer_"]:has(${fill(rs)}) [class*="usagePercent_"]`]: { color: '#e06c75 !important' },
  };
}

// ── Workbench colors ─────────────────────────────────────────────────────────
// [roles it depends on, keys, value]. Keys go back to what they were when their roles return to the defaults.
const WB_ROLES = [
  [['side'], ['sideBar.background', 'sideBar.border', 'sideBarSectionHeader.background', 'sideBarSectionHeader.border', 'auxiliaryBar.background', 'auxiliaryBar.border', 'activityBar.background', 'statusBar.background', 'statusBar.border', 'statusBar.noFolderBackground'], (p) => p.side],
  [['side', 'card'], ['titleBar.activeBackground', 'titleBar.inactiveBackground', 'titleBar.border', 'editorGroupHeader.tabsBackground', 'editorGroupHeader.tabsBorder', 'editorGroupHeader.border', 'tab.border', 'tab.inactiveBackground', 'tab.unfocusedInactiveBackground'], (p) => p.strip],
  [['side', 'card'], ['tab.hoverBackground', 'tab.unfocusedHoverBackground'], (p) => p.hover],
  [['card'], ['tab.activeBackground', 'tab.unfocusedActiveBackground', 'quickInput.background', 'editorWidget.background', 'editorSuggestWidget.background', 'editorHoverWidget.background', 'notifications.background', 'menu.background', 'input.background', 'dropdown.background'], (p) => p.card],
  [['editor'], ['editor.background', 'editorGutter.background', 'panel.background', 'terminal.background'], (p) => p.editor],
  [['text'], ['foreground', 'tab.activeForeground', 'activityBar.foreground', 'list.activeSelectionForeground'], (p) => p.text],
  [['text', 'muted'], ['editor.foreground', 'input.foreground', 'menu.foreground', 'sideBar.foreground', 'tab.unfocusedActiveForeground', 'tab.hoverForeground', 'editorLineNumber.activeForeground'], (p) => p.textBody],
  [['muted'], ['descriptionForeground', 'tab.inactiveForeground', 'titleBar.activeForeground', 'statusBar.foreground'], (p) => p.muted],
  [['muted', 'card'], ['tab.unfocusedInactiveForeground', 'editorLineNumber.foreground'], (p) => p.faint],
  // Theme Mix's own slate greys that would otherwise show through a new palette
  [['card'], ['list.hoverBackground', 'editor.lineHighlightBackground'], (p) => mix(p.card, '#ffffff', 0.05)],
  [['card'], ['panel.border'], (p) => mix(p.card, '#ffffff', 0.12)],
  [['card'], ['dropdown.border'], (p) => p.card],
  [['side'], ['editorGroup.border'], (p) => p.gap],
  [['muted', 'card'], ['scrollbarSlider.background'], (p) => mix(p.muted, p.card, 0.5) + '60'],
  [['accent'], ['button.background', 'badge.background', 'activityBarBadge.background', 'progressBar.background', 'activityBarTop.activeBorder', 'tab.modifiedBorder'], (p) => p.accent],
  [['accent'], ['button.hoverBackground'], (p) => p.accentHover],
  [['accent'], ['focusBorder'], (p) => p.accent + '80'],
  [['accent'], ['list.activeSelectionBackground'], (p) => p.accent + '26'],
  [['accent'], ['list.inactiveSelectionBackground'], (p) => p.accent + '14'],
  [['accent'], ['editor.selectionBackground'], (p) => p.accent + '33'],
  [['accent'], ['quickInputList.focusBackground', 'menu.selectionBackground'], (p) => p.accent + '2e'],
  [['accent'], ['textLink.foreground'], (p) => p.link],
  [['accent'], ['editorCursor.foreground', 'list.highlightForeground'], (p) => p.accentSoft],
];

// ── Editor paths ─────────────────────────────────────────────────────────────
const EDITORS = {
  code: { home: '.vscode', user: 'Code' },
  'code-insiders': { home: '.vscode-insiders', user: 'Code - Insiders' },
  cursor: { home: '.cursor', user: 'Cursor' },
  codium: { home: '.vscode-oss', user: 'VSCodium' },
};
function editorPaths(name) {
  const e = EDITORS[name] || EDITORS.code;
  const userDir = process.platform === 'darwin'
    ? path.join(HOME, 'Library/Application Support', e.user, 'User')
    : process.platform === 'win32' ? path.join(process.env.APPDATA || '', e.user, 'User') : path.join(HOME, '.config', e.user, 'User');
  return { editorHome: path.join(HOME, e.home), userDir, settingsPath: path.join(userDir, 'settings.json') };
}

// ── Small file helpers ───────────────────────────────────────────────────────
function readJsonc(file, fallback) {
  if (!fs.existsSync(file)) return { text: fallback, data: jsonc.parse(fallback) };
  const text = fs.readFileSync(file, 'utf8');
  const errors = [];
  const data = jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length || typeof data !== 'object' || data === null) throw new Error(`${file} has a syntax error. Fix it and try again.`);
  return { text, data };
}
const setKey = (text, keyPath, value, opts) => jsonc.applyEdits(text, jsonc.modify(text, keyPath, value, { ...FORMAT, ...opts }));

// ── Claude Code hooks: Milo's Scroll and the usage summary ───────────────────
const SCROLL_EVENTS = ['Stop', 'Notification', 'PermissionRequest', 'PreCompact'];
function editClaudeHooks(add) {
  let { text, data } = readJsonc(CLAUDE_SETTINGS, '{}\n');
  const hooks = data.hooks || {};
  const cmd = `"${path.join(SCROLL_DIR, 'scroll.sh')}"`;
  for (const event of SCROLL_EVENTS) {
    const groups = (hooks[event] || [])
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('milos-scroll/scroll.sh')) }))
      .filter((g) => g.hooks.length);
    if (add) groups.push({ matcher: '', hooks: [{ type: 'command', command: cmd, async: true, timeout: 10 }] });
    text = setKey(text, ['hooks', event], groups.length ? groups : undefined);
  }
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS, text);
}
const hasNode = () => { try { execFileSync('node', ['--version'], { stdio: 'ignore' }); return true; } catch (e) { return false; } };
function editUsageHook(add) {
  const script = path.join(USAGE_DIR, 'aggregate.js');
  const cmd = hasNode() ? `node "${script}"` : `ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${script}"`;
  let { text, data } = readJsonc(CLAUDE_SETTINGS, '{}\n');
  const groups = ((data.hooks || {}).Stop || [])
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('milo-usage/aggregate.js')) }))
    .filter((g) => g.hooks.length);
  if (add) groups.push({ matcher: '', hooks: [{ type: 'command', command: cmd, async: true, timeout: 120 }] });
  text = setKey(text, ['hooks', 'Stop'], groups.length ? groups : undefined);
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS, text);
}
function hookPresent(marker) {
  try { return fs.readFileSync(CLAUDE_SETTINGS, 'utf8').includes(marker); } catch (e) { return false; }
}

function installScrollFiles(kitDir) {
  const src = path.join(kitDir, 'scroll');
  if (!fs.existsSync(path.join(src, 'overlay.js'))) throw new Error("Milo's Scroll files are missing. Run the Milo Kit installer again.");
  fs.mkdirSync(SCROLL_DIR, { recursive: true });
  for (const f of ['scroll.sh', 'overlay.js', 'milo.png']) fs.copyFileSync(path.join(src, f), path.join(SCROLL_DIR, f));
  fs.chmodSync(path.join(SCROLL_DIR, 'scroll.sh'), 0o755);
  const skillDir = path.join(HOME, '.claude', 'skills', 'scroll');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(path.join(src, 'SKILL.md'), path.join(skillDir, 'SKILL.md'));
  editClaudeHooks(true);
}
function removeScroll() {
  if (fs.existsSync(CLAUDE_SETTINGS)) editClaudeHooks(false);
  fs.rmSync(SCROLL_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(HOME, '.claude', 'skills', 'scroll'), { recursive: true, force: true });
}
function installUsageFiles(kitDir, firstRun) {
  const src = path.join(kitDir, 'usage', 'aggregate.js');
  if (!fs.existsSync(src)) throw new Error('Usage summary files are missing. Run the Milo Kit installer again.');
  fs.mkdirSync(USAGE_DIR, { recursive: true });
  const script = path.join(USAGE_DIR, 'aggregate.js');
  fs.copyFileSync(src, script);
  editUsageHook(true);
  if (firstRun) {
    try { execFileSync(hasNode() ? 'node' : process.execPath, [script], { stdio: 'ignore', timeout: 600000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }); } catch (e) { /* written after the next reply */ }
  }
}
function removeUsage() {
  if (fs.existsSync(CLAUDE_SETTINGS)) editUsageHook(false);
  fs.rmSync(USAGE_DIR, { recursive: true, force: true });
}

// Copies what apply needs later (from the settings tab) to ~/.milo-kit/kit/, so parts skipped at install can be
// turned on later without the installer.
function copyKitRuntime(kitDir) {
  if (path.resolve(kitDir) === path.resolve(KIT_COPY)) return;
  fs.rmSync(KIT_COPY, { recursive: true, force: true });
  const files = ['lib/apply.js', 'lib/skills.js', 'lib/skill-actions.js', 'lib/vendor', 'scroll', 'usage', 'workbench', 'package.json', 'extension/media/app-icon-milo.svg'];
  for (const f of files) {
    const from = path.join(kitDir, f);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(KIT_COPY, f), { recursive: true });
  }
}

// ── App icon (macOS) ─────────────────────────────────────────────────────────
// Milo on a squircle in the accent color, with the VS Code icon as a badge. The badge is read from the user's
// own app at save time, so the kit never ships Microsoft's logo. A launch agent puts the icon back after a
// VS Code update resets it.
const DEFAULT_APP = '/Applications/Visual Studio Code.app';
const ICON_DIR = path.join(HOME, 'Library', 'Application Support', 'Milo Icon');
const ICON_LABEL = 'com.milo.vscode-icon';
const ICON_PLIST = path.join(HOME, 'Library', 'LaunchAgents', ICON_LABEL + '.plist');
function appIconColors(accent) {
  if (accent === NATIVE.accent) return ['#4a80ec', '#2f5bc0'];
  return [mix(accent, '#ffffff', 0.07), mix(accent, '#000000', 0.2)];
}
const ICON_JXA = [
  "ObjC.import('AppKit');",
  'function shadow(y, blur, r, g, b, a) { var s = $.NSShadow.alloc.init; s.shadowOffset = $.NSMakeSize(0, y); s.shadowBlurRadius = blur; s.shadowColor = $.NSColor.colorWithSRGBRedGreenBlueAlpha(r, g, b, a); s.set; }',
  'function run(a) {', // a: art svg, app, out png
  '  var S = 1024, art = $.NSImage.alloc.initWithContentsOfFile(a[0]);',
  "  var badge = $.NSImage.alloc.initWithContentsOfFile(a[1] + '/Contents/Resources/Code.icns');",
  "  if (!art || art.isNil()) throw 'The icon art did not load';",
  '  var rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, S, S, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);',
  '  $.NSGraphicsContext.saveGraphicsState;',
  '  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));',
  '  shadow(-10, 24, 0, 0, 0, 0.3);',
  '  art.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, S, S), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1);',
  '  if (badge && !badge.isNil()) {',
  '    shadow(-10, 36, 8 / 255, 20 / 255, 60 / 255, 0.45);',
  '    badge.drawInRectFromRectOperationFraction($.NSMakeRect(660, 84, 280, 280), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1);',
  '  }',
  '  $.NSGraphicsContext.restoreGraphicsState;',
  '  rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).writeToFileAtomically(a[2], true);',
  "  if (!$.NSWorkspace.sharedWorkspace.setIconForFileOptions($.NSImage.alloc.initWithContentsOfFile(a[2]), a[1], 0)) throw 'macOS did not accept the icon';",
  '}',
].join('\n');
const ICON_CLEAR_JXA = "ObjC.import('AppKit'); function run(a) { $.NSWorkspace.sharedWorkspace.setIconForFileOptions($(), a[0], 0); }";
// What the launch agent runs: set the saved icon again when an update removed it.
const iconAgentScript = (app) => `#!/bin/bash
# Milo Kit: puts the Milo app icon back after a VS Code update resets it. Written by Milo Kit settings.
APP=${JSON.stringify(app)}
PNG="$(dirname "$0")/milo-icon.png"
[ -d "$APP" ] && [ -f "$PNG" ] || exit 0
[ -f "$APP/Icon"$'\\r' ] && exit 0
# an update keeps writing the bundle for a while and would wipe the icon again: wait until it is quiet
sleep 5
for i in $(seq 60); do [ -z "$(find "$APP/Contents" -maxdepth 2 -mtime -30s 2>/dev/null | head -1)" ] && break; sleep 10; done
osascript -l JavaScript - "$PNG" "$APP" >/dev/null <<'JXA'
ObjC.import('AppKit');
function run(a) { $.NSWorkspace.sharedWorkspace.setIconForFileOptions($.NSImage.alloc.initWithContentsOfFile(a[0]), a[1], 0); }
JXA
touch "$APP"; killall Dock 2>/dev/null || true
`;
const iconPlist = (script, app) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${ICON_LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>${script}</string></array>
  <key>WatchPaths</key><array><string>${app}</string><string>${app}/Contents</string><string>${app}/Contents/Info.plist</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
</dict></plist>
`;
function iconArt(kitDir) {
  const tries = [
    path.join(kitDir, 'extension', 'media', 'app-icon-milo.svg'),
    path.join(__dirname, '..', 'media', 'app-icon-milo.svg'), // inside the settings extension
    path.join(__dirname, '..', 'extension', 'media', 'app-icon-milo.svg'), // inside the kit
  ];
  const f = tries.find((t) => fs.existsSync(t));
  if (!f) throw new Error('The Milo app icon files are missing. Run the Milo Kit installer again.');
  return fs.readFileSync(f, 'utf8');
}
function refreshDock(app) {
  try { const now = new Date(); fs.utimesSync(app, now, now); } catch (e) { /* the Dock still updates on its next launch */ }
  try { execFileSync('killall', ['Dock'], { stdio: 'ignore' }); } catch (e) { /* not running */ }
}
function setAgent(on, app) {
  const uid = process.getuid();
  try { execFileSync('launchctl', ['bootout', `gui/${uid}/${ICON_LABEL}`], { stdio: 'ignore' }); } catch (e) { /* not loaded */ }
  if (!on) { fs.rmSync(ICON_PLIST, { force: true }); return; }
  const script = path.join(ICON_DIR, 'milo-icon.sh');
  fs.writeFileSync(script, iconAgentScript(app), { mode: 0o755 });
  fs.mkdirSync(path.dirname(ICON_PLIST), { recursive: true });
  fs.writeFileSync(ICON_PLIST, iconPlist(script, app));
  try { execFileSync('launchctl', ['bootstrap', `gui/${uid}`, ICON_PLIST], { stdio: 'ignore' }); } catch (e) { /* icon is set; only the re-apply after updates is missing */ }
}
// Puts the saved icon back when an update removed it. Must run from inside the editor: macOS App Management
// lets the editor change its own bundle, but the call returns false from a launch agent. Returns true if it set it.
function restoreAppIcon(app = DEFAULT_APP) {
  const png = path.join(ICON_DIR, 'milo-icon.png');
  if (process.platform !== 'darwin' || loadConfig().appIcon !== 'milo') return false;
  if (!fs.existsSync(app) || !fs.existsSync(png) || fs.existsSync(path.join(app, 'Icon\r'))) return false;
  const jxa = "ObjC.import('AppKit'); function run(a) { return $.NSWorkspace.sharedWorkspace.setIconForFileOptions($.NSImage.alloc.initWithContentsOfFile(a[0]), a[1], 0); }";
  const ok = execFileSync('osascript', ['-l', 'JavaScript', '-', png, app], { input: jxa, encoding: 'utf8' }).trim() === 'true';
  if (ok) refreshDock(app);
  return ok;
}
function applyAppIcon(cfg, state, app, kitDir) {
  if (!fs.existsSync(app)) return;
  const set = fs.existsSync(path.join(app, 'Icon\r'));
  const want = cfg.appIcon === 'milo' ? `milo:${cfg.colors.accent}` : null;
  if (want && (state.appIcon !== want || !set)) {
    const [top, bottom] = appIconColors(cfg.colors.accent);
    const inner = iconArt(kitDir).replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">'
      + `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>`
      + '<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#g)"/>'
      + `<g transform="translate(162 205) scale(${700 / 1399}) translate(24 24)">${inner}</g></svg>`;
    fs.mkdirSync(ICON_DIR, { recursive: true });
    const svgFile = path.join(ICON_DIR, 'milo-icon.svg');
    fs.writeFileSync(svgFile, svg);
    execFileSync('osascript', ['-l', 'JavaScript', '-', svgFile, app, path.join(ICON_DIR, 'milo-icon.png')], { input: ICON_JXA, stdio: ['pipe', 'ignore', 'pipe'] });
    fs.rmSync(path.join(ICON_DIR, 'milo-vscode.icns'), { force: true }); // icon from before the settings option
    setAgent(true, app);
    refreshDock(app);
    state.appIcon = want;
  } else if (!want && (state.appIcon || fs.existsSync(ICON_DIR))) {
    setAgent(false, app);
    if (set) execFileSync('osascript', ['-l', 'JavaScript', '-', app], { input: ICON_CLEAR_JXA, stdio: ['pipe', 'ignore', 'pipe'] });
    fs.rmSync(ICON_DIR, { recursive: true, force: true });
    refreshDock(app);
    state.appIcon = null;
  }
}

// ── Apply ────────────────────────────────────────────────────────────────────
// ctx: { settingsPath, userDir, editorHome, kitDir }. Returns { reload } (true when Custom UI Style must reload).
function apply(input, ctx = {}) {
  const cfg = normalize(input);
  const paths = { ...editorPaths('code'), ...ctx };
  const kitDir = ctx.kitDir || KIT_COPY;
  const state = loadState();
  let reload = false;

  // 1. VS Code settings (only when the kit's theme part is installed)
  if (fs.existsSync(paths.settingsPath)) {
    const start = readJsonc(paths.settingsPath, '{}\n').text;
    // rename tabs needs the window script next to the editor
    const script = path.join(paths.editorHome, 'milo-kit', 'tab-rename.js');
    const scriptSrc = path.join(kitDir, 'workbench', 'tab-rename.js');
    if (cfg.features.rename && !fs.existsSync(script) && fs.existsSync(scriptSrc)) {
      fs.mkdirSync(path.dirname(script), { recursive: true });
      fs.copyFileSync(scriptSrc, script);
    }
    const profileScript = path.join(paths.editorHome, 'milo-kit', 'profile-mark.js');
    const profileSrc = path.join(kitDir, 'workbench', 'profile-mark.js');
    if (fs.existsSync(profileSrc)) {
      fs.mkdirSync(path.dirname(profileScript), { recursive: true });
      fs.copyFileSync(profileSrc, profileScript);
    }
    const pScript = fs.existsSync(profileScript) ? profileScript : null;
    const out = applyText(start, cfg, state, fs.existsSync(script) ? script : null, pScript);
    const text = out.text;
    reload = out.reload;
    if (text !== start) {
      fs.copyFileSync(paths.settingsPath, paths.settingsPath + '.milo-kit-last.bak');
      fs.writeFileSync(paths.settingsPath, text);
    }
    if (out.themed && (fs.existsSync(path.join(paths.userDir, 'keybindings.json')) || cfg.features.rename)) editKeybinding(paths.userDir, cfg.features.rename);
    // the other profiles' settings get the avatar rules too (see syncAvatarText)
    for (const f of allSettingsFiles(paths.userDir)) {
      if (path.resolve(f) === path.resolve(paths.settingsPath)) continue;
      try {
        const before = fs.readFileSync(f, 'utf8');
        const after = syncAvatarText(before, cfg, pScript);
        const errors = [];
        jsonc.parse(after, errors, { allowTrailingComma: true });
        if (after !== before && !errors.length) {
          fs.copyFileSync(f, f + '.milo-kit-last.bak');
          fs.writeFileSync(f, after);
        }
      } catch (e) { /* that profile keeps its old avatars until it is saved from */ }
    }
  }

  // 2. Milo's Scroll
  if (process.platform === 'darwin') {
    const installed = fs.existsSync(path.join(SCROLL_DIR, 'overlay.js'));
    if (cfg.scroll.enabled && !installed) installScrollFiles(kitDir);
    if (cfg.scroll.enabled && installed && !hookPresent('milos-scroll/scroll.sh')) editClaudeHooks(true);
    if (fs.existsSync(SCROLL_DIR)) {
      const file = path.join(SCROLL_DIR, 'config.json');
      const { enabled, events, only_when_away, all_screens, position, seconds, sound } = cfg.scroll;
      writeJson(file, { ...readJson(file, {}), enabled, events, only_when_away, all_screens, position, seconds, sound });
    }
  }

  // 3. App icon
  if (process.platform === 'darwin') applyAppIcon(cfg, state, paths.appPath || DEFAULT_APP, kitDir);

  // 4. Usage summary hook
  const usageOn = hookPresent('milo-usage/aggregate.js');
  if (cfg.status.summary && !usageOn) installUsageFiles(kitDir, true);
  if (!cfg.status.summary && usageOn) removeUsage();

  saveConfig(cfg);
  saveState({ ...loadState(), ...state, initials: cfg.initials, applied: new Date().toISOString() });
  return { reload, config: cfg };
}

// The settings part of apply, on text: no files touched. state.stash and state.usageThresholds are updated in place.
// renameScript: absolute path of tab-rename.js when rename is on (null leaves the import out).
// profileScript: absolute path of profile-mark.js (null leaves it out), needed for the title bar avatar.
function applyText(text, input, state, renameScript, profileScript = null) {
  const cfg = normalize(input);
  state.stash = state.stash || {};
  const stash = state.stash;
  stash.wb = stash.wb || {};
  stash.rules = stash.rules || {};
  let reload = false;
  let data = jsonc.parse(text, [], { allowTrailingComma: true }) || {};
  const themed = !!(data[WV] || data[EXT] || data[WB]);
  // Leaves changed by hand since the kit's last write are left alone (see "Hand edits" above).
  const hand = handEdits(data, state.base);
  const put = (t, keyPath, value, opts) => (hand.has(leafKey(keyPath)) ? t : setKey(t, keyPath, value, opts));
  {
    if (themed) {
      const uiBefore = JSON.stringify([data[WV], data[WB], data[EXT], data['custom-ui-style.external.imports'], data['custom-ui-style.font.sansSerif'], data['custom-ui-style.font.monospace']]);
      const p = palette(cfg.colors);
      const scale = CORNERS[cfg.corners];

      // a. webview (Claude Code chat): colors and radii to variables, then the variable values
      if (data[WV]) {
        text = rewriteValue(text, WV, (v) => tokenizeRadii(tokenizeColors(v)));
        data = jsonc.parse(text, [], { allowTrailingComma: true });
        const vars = {
          '--mk-accent': p.accent, '--mk-accent-strong': p.accentStrong, '--mk-accent-hover': p.accentHover,
          '--mk-accent-soft': p.accentSoft, '--mk-accent-softer': p.accentSofter, '--mk-link': p.link,
          '--mk-fg': p.text, '--mk-fg-body': p.textBody, '--mk-fg-muted': p.muted, '--mk-fg-faint': p.faint,
          '--mk-card': p.card, '--mk-gap': p.gap,
        };
        for (const [k, v] of Object.entries(shadeValues(cfg.colors, p))) vars[`--mk-${k}`] = v;
        const radii = new Set((JSON.stringify(data[WV]).match(/--mk-r-(\d+)/g) || []).map((m) => +m.slice(7)));
        for (const n of radii) vars[`--mk-r-${n}`] = `${Math.max(2, Math.round(n * scale))}px`;
        for (const [k, v] of Object.entries(vars)) text = put(text, [WV, 'html:root', k], v.startsWith('#') ? rgbSpace(v) : v);

        // avatars: yours (chat + account card) and Claude's
        for (const [k, v] of avatarEdits(cfg)) if (data[WV][k[0]]) text = put(text, [WV, ...k], v);
        text = putProfileRules(text, WV, profileRules(cfg).wv, put);

        // feature gates: present always, active only for features listed in data-mk-off
        for (const [f, sels] of Object.entries(GATES)) {
          text = put(text, [WV, sels.map((s) => `html[data-mk-off~="${f}"] ${s}`).join(', ')], { display: 'none !important' });
        }
        text = put(text, [WV, `html[data-mk-off~="milo"] ${MILO_EMPTY} > svg`], { display: 'revert !important' });

        // usage bar thresholds in the chat (rewritten only when they differ from the kit's, or did before)
        const custom = cfg.status.yellow !== 80 || cfg.status.red !== 90;
        if (custom || state.usageThresholds) {
          data = jsonc.parse(text, [], { allowTrailingComma: true });
          for (const k of Object.keys(data[WV])) if (k.includes('usageFill_') && k.includes('[style*="width:')) text = put(text, [WV, k], undefined);
          for (const [k, v] of Object.entries(usageRules(cfg.status.yellow, cfg.status.red))) text = put(text, [WV, k], v);
          state.usageThresholds = custom;
        }
      }

      // b. workbench stylesheet: gap color and radii
      if (data[WB]) {
        text = rewriteValue(text, WB, (v) => tokenizeRadii(tokenizeColors(v)));
        data = jsonc.parse(text, [], { allowTrailingComma: true });
        const radii = new Set((JSON.stringify(data[WB]).match(/--mk-r-(\d+)/g) || []).map((m) => +m.slice(7)));
        text = put(text, [WB, 'body', '--mk-gap'], rgbSpace(p.gap));
        for (const n of radii) text = put(text, [WB, 'body', `--mk-r-${n}`], `${Math.max(2, Math.round(n * scale))}px`);
        // status bar: usage only
        text = stashRule(text, [WB, USAGE_ONLY], cfg.status.usageOnly, 'usageOnly', stash);
        // the settings popup (older versions of these rules are removed first)
        for (const k of Object.keys(jsonc.parse(text, [], { allowTrailingComma: true })[WB])) {
          if (k.includes('local.milo-kit-settings') && !(k in POPUP_RULES)) text = put(text, [WB, k], undefined);
        }
        for (const [k, v] of Object.entries(POPUP_RULES)) text = put(text, [WB, k], v);
        text = putProfileRules(text, WB, profileRules(cfg).wb, put);
      }

      // c. workbench colors (Theme Mix)
      data = jsonc.parse(text, [], { allowTrailingComma: true });
      const theme = ((data[COLORS] || {})[THEME]) || {};
      for (const [roles, keys, value] of WB_ROLES) {
        const changed = roles.some((r) => cfg.colors[r] !== NATIVE[r]);
        for (const key of keys) {
          if (changed) {
            if (!(key in stash.wb)) stash.wb[key] = key in theme ? theme[key] : null;
            text = put(text, [COLORS, THEME, key], value(p));
          } else if (key in stash.wb) {
            text = put(text, [COLORS, THEME, key], stash.wb[key] === null ? undefined : stash.wb[key]);
            delete stash.wb[key];
          }
        }
      }

      // d. patches: chat feature list, tab icons, rename menu, usage bar thresholds
      if (data[EXT] && data[EXT]['anthropic.claude-code']) {
        data = jsonc.parse(text, [], { allowTrailingComma: true });
        const list = data[EXT]['anthropic.claude-code'];
        const off = FEATURES.filter((f) => !cfg.features[f]);
        const ci = list.findIndex(CHAT_PATCH);
        if (ci >= 0) {
          const space = cfg.space && cfg.space.enabled && cfg.space.url ? { label: cfg.space.label || 'Open', url: cfg.space.url } : null;
          const prelude = `/*mk-off*/;(function(){var o=${JSON.stringify(off)};window.__mkOff=o;window.__mkSpace=${JSON.stringify(space)};try{document.documentElement.setAttribute("data-mk-off",o.join(" "))}catch(e){}})();/*/mk-off*/`;
          const rep = list[ci].replace.replace(/\/\*mk-off\*\/[\s\S]*?\/\*\/mk-off\*\//, '');
          const at = rep.indexOf('/*mk-chat*/');
          const next = rep.slice(0, at) + prelude + rep.slice(at);
          if (next !== list[ci].replace) text = put(text, [EXT, 'anthropic.claude-code', ci, 'replace'], next);
        }
        text = stashPatch(text, TAB_ICON_PATCH, cfg.features.tabIcons, 'tabIcons', stash);
        text = stashPatch(text, RENAME_PATCH, cfg.features.rename, 'renameMenu', stash);
      }
      if (data[EXT] && data[EXT][USAGE_BAR]) {
        const def = cfg.status.yellow === 80 && cfg.status.red === 90;
        const patch = def
          ? { filePath: 'out/extension.js', find: '/else if \\(maxPct >= 70\\)/', replace: 'else if (maxPct >= 80)' }
          : { filePath: 'out/extension.js', find: '/maxPct >= 90\\)([\\s\\S]*?)else if \\(maxPct >= 70\\)/', replace: `maxPct >= ${cfg.status.red})$1else if (maxPct >= ${cfg.status.yellow})` };
        text = put(text, [EXT, USAGE_BAR], [patch]);
      }

      // e. rename tabs: the window script import (the F2 key is set by apply)
      data = jsonc.parse(text, [], { allowTrailingComma: true });
      text = putImports(text, cfg, renameScript, profileScript, put);

      // f. plain settings: icons, fonts, usage bar
      text = put(text, ['workbench.productIconTheme'], cfg.icons.product === 'Default' ? undefined : cfg.icons.product);
      text = put(text, ['workbench.iconTheme'], cfg.icons.file === 'none' ? null : cfg.icons.file);
      text = put(text, ['custom-ui-style.font.sansSerif'], UI_FONTS[cfg.fonts.ui]);
      for (const k of ['editor.fontFamily', 'terminal.integrated.fontFamily', 'custom-ui-style.font.monospace']) text = put(text, [k], codeStack(cfg.fonts.code));
      text = put(text, ['editor.fontSize'], cfg.fonts.size);
      text = put(text, ['terminal.integrated.fontSize'], cfg.fonts.size - 1);
      text = put(text, ['claudeUsageBar.displayMode'], cfg.status.show);
      text = put(text, ['claudeUsageBar.showProgressBar'], cfg.status.progressBar);

      data = jsonc.parse(text, [], { allowTrailingComma: true });
      reload = JSON.stringify([data[WV], data[WB], data[EXT], data['custom-ui-style.external.imports'], data['custom-ui-style.font.sansSerif'], data['custom-ui-style.font.monospace']]) !== uiBefore;
    }

  }
  const errors = [];
  const written = jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error('Saving produced invalid settings. Nothing was written.');
  state.base = recordBase(written || {}, state.base, hand);
  return { text, reload, themed };
}

// [[selector, property], value] pairs for the avatar rules. Every property either mode touches is set (or removed)
// in both modes, so switching back and forth always lands on the same rule.
function avatarEdits(cfg) {
  const av = cfg.avatar;
  const photo = (url) => `url('${url}') center / cover no-repeat`;
  const out = [];
  // yours: text keeps the kit's accent fill, an image fills the circle
  const mine = av.me === 'image';
  out.push([[USER_AVATAR, 'content'], mine ? "''" : `'${cfg.initials}'`]);
  out.push([[USER_AVATAR, 'background'], mine ? photo(av.meImage) : 'var(--mk-accent)']);
  out.push([[ACCOUNT_AVATAR, 'content'], mine ? "''" : `'${cfg.initials}'`]);
  out.push([[ACCOUNT_AVATAR, 'background'], mine ? photo(av.meImage) : 'linear-gradient(180deg, var(--mk-accent-hover), var(--mk-accent))']);
  // Claude's: the kit's spark, an image, or text on Claude's clay
  const t = av.agent === 'text';
  out.push([[AGENT_AVATAR, 'background'], av.agent === 'image' ? photo(av.agentImage) + ' !important' : t ? '#d97757 !important' : CLAUDE_SPARK]);
  out.push([[AGENT_AVATAR, 'content'], t ? `'${av.agentText}' !important` : undefined]);
  out.push([[AGENT_AVATAR, 'color'], t ? '#ffffff !important' : undefined]);
  out.push([[AGENT_AVATAR, 'font'], t ? '600 9px/22px Geist, sans-serif !important' : undefined]);
  out.push([[AGENT_AVATAR, 'text-align'], t ? 'center !important' : undefined]);
  out.push([[AGENT_AVATAR, 'letter-spacing'], t ? '0.02em !important' : undefined]);
  out.push([[AGENT_AVATAR, 'border-radius'], av.agent === 'claude' ? undefined : '50% !important']);
  return out;
}

// The window scripts Custom UI Style loads: tab-rename.js (rename tabs) and profile-mark.js (profile avatars).
function putImports(text, cfg, renameScript, profileScript, put = setKey) {
  const data = jsonc.parse(text, [], { allowTrailingComma: true });
  const has = 'custom-ui-style.external.imports' in data;
  const imports = (data['custom-ui-style.external.imports'] || []).filter((u) => !/milo-kit\/(tab-rename|profile-mark)\.js$/.test(u));
  const url = (f) => 'file://' + f.replace(/\\/g, '/');
  if (cfg.features.rename && renameScript) imports.push(url(renameScript));
  if (profileScript && Object.values(cfg.avatar.profiles).some((p) => p.title)) imports.push(url(profileScript));
  if (!has && !imports.length) return text;
  return put(text, ['custom-ui-style.external.imports'], imports.length ? imports : undefined);
}

// Rules for your avatar in each profile: { wv: chat rules, wb: title bar rules }, selector -> declarations.
// They outrank the shared avatar rules (the :has() and attribute add specificity), so the shared ones stay as
// the fallback for windows that match no profile.
function profileRules(cfg) {
  const photo = (url) => `url('${url}') center / cover no-repeat`;
  const wv = {};
  const wb = {};
  for (const p of Object.values(cfg.avatar.profiles)) {
    const mine = p.me === 'image';
    const content = mine ? "''" : `'${cfg.initials}'`;
    if (p.email) {
      const at = PROFILE_CHAT(p.email);
      wv[`${at} ${USER_AVATAR}`] = { content: `${content} !important`, background: `${mine ? photo(p.meImage) : 'var(--mk-accent)'} !important` };
      wv[`${at} ${ACCOUNT_AVATAR}`] = { content: `${content} !important`, background: `${mine ? photo(p.meImage) : 'linear-gradient(180deg, var(--mk-accent-hover), var(--mk-accent))'} !important` };
    }
    if (p.title) {
      wb[`${PROFILE_TITLE(p.title)} ${TITLE_AVATAR}`] = {
        content: content, display: 'inline-block', width: '16px', height: '16px', 'flex-shrink': '0', 'margin-right': '6px',
        'vertical-align': '-3px', 'border-radius': '50%', background: mine ? photo(p.meImage) : cfg.colors.accent,
        color: '#ffffff', font: '600 7px/16px Geist, sans-serif', 'text-align': 'center', 'letter-spacing': '0.02em',
      };
    }
  }
  return { wv, wb };
}
// Replaces every profile rule in the stylesheet at key (WV or WB) with rules.
function putProfileRules(text, key, rules, put = setKey) {
  const sheet = jsonc.parse(text, [], { allowTrailingComma: true })[key] || {};
  const prefix = key === WV ? PROFILE_CHAT('').split('*=')[0] : PROFILE_TITLE('').split('=')[0];
  for (const k of Object.keys(sheet)) if (k.startsWith(prefix) && !(k in rules)) text = put(text, [key, k], undefined);
  for (const [k, v] of Object.entries(rules)) text = put(text, [key, k], v);
  return text;
}
// Custom UI Style patches one stylesheet for every window, from the settings of whichever window reloads it.
// So every profile's settings carry every profile's avatar, plus the shared avatar rules.
function syncAvatarText(text, input, profileScript) {
  const cfg = normalize(input);
  const data = jsonc.parse(text, [], { allowTrailingComma: true }) || {};
  const rules = profileRules(cfg);
  if (data[WV]) {
    for (const [k, v] of avatarEdits(cfg)) if (data[WV][k[0]]) text = setKey(text, [WV, ...k], v);
    text = putProfileRules(text, WV, rules.wv);
  }
  if (data[WB]) text = putProfileRules(text, WB, rules.wb);
  if (data[WV] || data[WB] || data[EXT]) {
    const cur = jsonc.parse(text, [], { allowTrailingComma: true })['custom-ui-style.external.imports'] || [];
    const rename = cur.find((u) => /milo-kit\/tab-rename\.js$/.test(u));
    text = putImports(text, { ...cfg, features: { ...cfg.features, rename: !!rename } }, rename ? rename.replace(/^file:\/\//, '') : null, profileScript);
  }
  return text;
}
// Every settings file of the editor: the default profile's and each profile's (User/profiles/<id>/settings.json).
function allSettingsFiles(userDir) {
  const out = [path.join(userDir, 'settings.json')];
  try {
    for (const d of fs.readdirSync(path.join(userDir, 'profiles'))) out.push(path.join(userDir, 'profiles', d, 'settings.json'));
  } catch (e) { /* no profiles */ }
  return out.filter((f) => fs.existsSync(f));
}

// For scripts/sync-from-live.js: the maintainer's live settings with every choice back at the kit defaults,
// so personal picks never ship. Uses (but never saves) the maintainer's stash to restore original theme colors.
function resetText(text, initials) {
  const state = clone(loadState());
  delete state.base; // a reset to defaults overrides hand edits too, so personal picks never ship
  return applyText(text, { ...DEFAULTS, initials }, state, null).text;
}

// Removes a key while off (kept in the stash), puts it back when on.
function stashRule(text, keyPath, on, name, stash) {
  const data = jsonc.parse(text, [], { allowTrailingComma: true });
  const parent = keyPath.slice(0, -1).reduce((o, k) => (o || {})[k], data) || {};
  const key = keyPath[keyPath.length - 1];
  if (!on && key in parent) { stash.rules[name] = parent[key]; return setKey(text, keyPath, undefined); }
  if (on && !(key in parent) && stash.rules[name] !== undefined) { const v = stash.rules[name]; delete stash.rules[name]; return setKey(text, keyPath, v); }
  return text;
}
function stashPatch(text, match, on, name, stash) {
  const data = jsonc.parse(text, [], { allowTrailingComma: true });
  const list = data[EXT]['anthropic.claude-code'];
  const i = list.findIndex(match);
  if (!on && i >= 0) { stash.rules[name] = list[i]; return setKey(text, [EXT, 'anthropic.claude-code', i], undefined); }
  if (on && i < 0 && stash.rules[name]) { const v = stash.rules[name]; delete stash.rules[name]; return setKey(text, [EXT, 'anthropic.claude-code', list.length], v, { isArrayInsertion: true }); }
  return text;
}

function editKeybinding(userDir, add) {
  const file = path.join(userDir, 'keybindings.json');
  let { text, data } = readJsonc(file, '[]\n');
  const list = Array.isArray(data) ? data : [];
  const idx = list.findIndex((k) => k && k.command === 'claude-vscode.renameSessionTab' && k.key === 'f2');
  if (add && idx < 0) text = setKey(text, [list.length], { key: 'f2', command: 'claude-vscode.renameSessionTab', when: "activeWebviewPanelId == 'claudeVSCodePanel'" }, { isArrayInsertion: true });
  else if (!add && idx >= 0) text = setKey(text, [idx], undefined);
  else return;
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(file, text);
}

module.exports = {
  PRESETS, SWATCHES, DEFAULTS, FEATURES, SCROLL_TYPES, UI_FONTS, CODE_FONTS, CONFIG_FILE, STATE_FILE, KIT_COPY, SCROLL_DIR,
  loadConfig, saveConfig, normalize, apply, applyText, resetText, palette, editorPaths, copyKitRuntime, editKeybinding,
  installScrollFiles, removeScroll, installUsageFiles, removeUsage, readJsonc, setKey, loadState, saveState,
  tokenizeColors, tokenizeRadii, POPUP_RULES, appIconColors, DEFAULT_APP, restoreAppIcon, syncAvatarText, profileRules,
};

// Milo Kit installer. Run through install.sh, which finds a Node runtime and the editor CLI.
// Safe to re-run: every run updates to the current kit and keeps the user's own settings.
//
// env: MILO_KIT (kit folder), MILO_CLI (editor CLI), MILO_NAME (name for the avatar),
//      MILO_INITIALS (skip derivation), MILO_SKIP (comma list: theme,scroll,fonts,usage)
//      MILO_SETUP_* (answers from install.sh's setup questions: ACCENT, PRESET, SCROLL, USAGE, CHAT as y/n or a name)
// argv: install | uninstall

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const jsonc = require('./vendor/jsonc-parser/main.js');
const kitApply = require('./apply.js');

const HOME = os.homedir();
const KIT = process.env.MILO_KIT || path.join(__dirname, '..');
const CLI = process.env.MILO_CLI || 'code';
const SKIP = (process.env.MILO_SKIP || '').split(',').map((s) => s.trim());
const MAC = process.platform === 'darwin';
const STATE_FILE = path.join(HOME, '.milo-kit', 'state.json');

const say = (msg) => console.log(`  ${msg}`);
const step = (msg) => console.log(`\n» ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);

// ── Editor paths ───────────────────────────────────────────────────────────
const EDITORS = {
  code: { home: '.vscode', user: 'Code' },
  'code-insiders': { home: '.vscode-insiders', user: 'Code - Insiders' },
  cursor: { home: '.cursor', user: 'Cursor' },
  codium: { home: '.vscode-oss', user: 'VSCodium' },
};
const editor = EDITORS[path.basename(CLI)] || EDITORS.code;
const editorHome = path.join(HOME, editor.home);
const extensionsDir = path.join(editorHome, 'extensions');
const userDir = MAC
  ? path.join(HOME, 'Library/Application Support', editor.user, 'User')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', editor.user, 'User')
    : path.join(HOME, '.config', editor.user, 'User');
const settingsPath = path.join(userDir, 'settings.json');

// ── Helpers ────────────────────────────────────────────────────────────────
const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } };

function readJsonc(file, fallback) {
  if (!fs.existsSync(file)) return { text: fallback, data: jsonc.parse(fallback) };
  const text = fs.readFileSync(file, 'utf8');
  const errors = [];
  const data = jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length || typeof data !== 'object' || data === null) {
    throw new Error(`${file} has a syntax error. Fix it and run again.`);
  }
  return { text, data };
}

function setKey(text, keyPath, value) {
  return jsonc.applyEdits(text, jsonc.modify(text, keyPath, value, FORMAT));
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

function deriveInitials(name) {
  const parts = String(name || '').split(/[\s-]+/).filter((p) => /\p{L}/u.test(p));
  if (!parts.length) return 'ME';
  const first = [...parts[0]].find((c) => /\p{L}/u.test(c));
  const last = parts.length > 1 ? [...parts[parts.length - 1]].find((c) => /\p{L}/u.test(c)) : '';
  return (first + last).toUpperCase();
}

function run(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return null; }
}

// Custom UI Style patch strings look like "/pattern/flags".
function patchRegex(find) {
  const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(find);
  return m ? new RegExp(m[1], m[2]) : null;
}

// ── 1. Extensions ──────────────────────────────────────────────────────────
function installExtensions() {
  step('Extensions');
  const vsix = path.join(KIT, 'remix-product-icons', 'remix-product-icons-1.0.0.vsix');
  const ids = [
    'tal7aouy.theme',                      // Theme Mix colors
    'miguelsolorio.symbols',               // file icons
    'subframe7536.custom-ui-style',        // CSS + patch injection
    'anthropic.claude-code',               // Claude Code
    'harshagarwal1012.claude-usage-bar',   // usage in the status bar
  ];
  const settingsVsix = fs.readdirSync(path.join(KIT, 'extension')).filter((f) => f.endsWith('.vsix')).map((f) => path.join(KIT, 'extension', f))[0];
  for (const id of [...ids, vsix, settingsVsix].filter(Boolean)) {
    const label = id === vsix ? 'remix-product-icons (bundled)' : id === settingsVsix ? 'Milo Kit settings (bundled)' : id;
    const out = run(CLI, ['--install-extension', id, '--force']);
    out === null ? warn(`could not install ${label}. Install it from the Extensions view.`) : say(label);
  }
}

// ── 2. Fonts ───────────────────────────────────────────────────────────────
function installFonts() {
  step('Fonts (Geist, Geist Mono)');
  const have = (MAC && fs.existsSync(path.join(HOME, 'Library/Fonts')) &&
    fs.readdirSync(path.join(HOME, 'Library/Fonts')).some((f) => /geist/i.test(f))) ||
    /geist/i.test(run('fc-list', []) || '');
  if (have) return say('already installed');
  if (MAC && run('brew', ['--version'])) {
    run('brew', ['install', '--cask', 'font-geist', 'font-geist-mono']) !== null
      ? say('installed with Homebrew')
      : warn('Homebrew install failed. Get them from https://github.com/vercel/geist-font/releases');
  } else {
    warn('install Geist and Geist Mono from https://github.com/vercel/geist-font/releases (the theme falls back without them)');
  }
}

// ── 3. Tab icons ───────────────────────────────────────────────────────────
function installTabIcons() {
  step('Claude tab icons');
  const dest = path.join(editorHome, 'claude-tab-icons');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(path.join(KIT, 'claude-tab-icons'))) {
    fs.copyFileSync(path.join(KIT, 'claude-tab-icons', f), path.join(dest, f));
  }
  say(dest.replace(HOME, '~'));
}

// Drop patches whose target code is gone in the installed extension version.
function checkPatches(config) {
  for (const [extId, patches] of Object.entries(config)) {
    const dir = fs.existsSync(extensionsDir) &&
      fs.readdirSync(extensionsDir).filter((d) => d.toLowerCase().startsWith(extId.toLowerCase() + '-')).sort().pop();
    if (!dir) { warn(`${extId} not found, its patches are kept for when it is installed`); continue; }
    // Patches run in order on the untouched file (Custom UI Style keeps it as *.custom-ui-style.js).
    const sources = {};
    config[extId] = patches.filter((p) => {
      const file = path.join(extensionsDir, dir, p.filePath);
      const parsed = path.parse(file);
      const pristine = path.join(parsed.dir, `${parsed.name}.custom-ui-style${parsed.ext}`);
      const src = fs.existsSync(pristine) ? pristine : file;
      if (!(src in sources)) sources[src] = fs.existsSync(src) ? fs.readFileSync(src, 'utf8') : '';
      const re = patchRegex(p.find) || p.find; // Custom UI Style treats a find without /slashes/ as plain text
      const ok = typeof re === 'string' ? sources[src].includes(re) : re.test(sources[src]);
      if (ok) sources[src] = sources[src].replace(re, p.replace);
      else warn(`${extId}: a patch for ${p.filePath} does not match this version, skipped`);
      return ok;
    });
  }
  return config;
}

// ── 4. VS Code settings ────────────────────────────────────────────────────
// Kit-owned top-level keys are replaced. Shared objects are merged entry by entry,
// and entries the kit added on a previous run are removed if the kit dropped them.
const MERGED = ['workbench.colorCustomizations', 'custom-ui-style.stylesheet',
  'custom-ui-style.webview.stylesheet', 'custom-ui-style.extensions.config'];

function mergeSettings(initials) {
  step(`VS Code settings (${settingsPath.replace(HOME, '~')})`);
  const state = loadState();
  const owned = state.settings || {};

  let kitText = fs.readFileSync(path.join(KIT, 'settings.jsonc'), 'utf8');
  kitText = kitText.split('{{INITIALS}}').join(initials);
  const kit = jsonc.parse(kitText, [], { allowTrailingComma: true });
  kit['custom-ui-style.extensions.config'] = checkPatches(kit['custom-ui-style.extensions.config'] || {});

  fs.mkdirSync(userDir, { recursive: true });
  let { text, data } = readJsonc(settingsPath, '{}\n');
  const firstBackup = settingsPath + '.pre-milo-kit.bak';
  if (fs.existsSync(settingsPath) && !fs.existsSync(firstBackup)) {
    fs.copyFileSync(settingsPath, firstBackup);
    say(`backup: ${firstBackup.replace(HOME, '~')}`);
  }
  if (fs.existsSync(settingsPath)) fs.copyFileSync(settingsPath, settingsPath + '.milo-kit-last.bak');

  // Keys the kit set before but no longer ships: remove.
  for (const key of owned.keys || []) {
    if (!(key in kit) && key in data) text = setKey(text, [key], undefined);
  }

  const newOwned = { keys: Object.keys(kit), entries: {} };
  for (const [key, value] of Object.entries(kit)) {
    if (!MERGED.includes(key)) {
      text = setKey(text, [key], value);
      continue;
    }
    const mine = { ...(data[key] || {}) };
    for (const entry of (owned.entries || {})[key] || []) delete mine[entry];
    text = setKey(text, [key], { ...mine, ...value });
    newOwned.entries[key] = Object.keys(value);
  }

  const errors = [];
  jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error('merge produced invalid settings, nothing written');
  fs.writeFileSync(settingsPath, text);
  saveState({ ...state, settings: newOwned, initials, updated: new Date().toISOString() });

  // Double-click a Claude tab to rename it: a small script loaded into the VS Code window + F2 binding.
  const scriptDir = path.join(editorHome, 'milo-kit');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.copyFileSync(path.join(KIT, 'workbench', 'tab-rename.js'), path.join(scriptDir, 'tab-rename.js'));
  const importUrl = 'file://' + path.join(scriptDir, 'tab-rename.js').replace(/\\/g, '/');
  let st = fs.readFileSync(settingsPath, 'utf8');
  const imports = (jsonc.parse(st, [], { allowTrailingComma: true })['custom-ui-style.external.imports'] || []).filter((u) => !/milo-kit\/tab-rename\.js$/.test(u));
  st = setKey(st, ['custom-ui-style.external.imports'], [...imports, importUrl]);
  fs.writeFileSync(settingsPath, st);
  editKeybinding(true);

  // The kit patches Claude Code's package.json (tab menu). VS Code caches extension manifests; drop the cache so it re-reads them.
  const cacheDir = path.join(userDir, '..', 'CachedProfilesData');
  if (fs.existsSync(cacheDir)) {
    for (const profile of fs.readdirSync(cacheDir)) {
      const dir = path.join(cacheDir, profile);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) if (/^extensions\.user.*\.cache$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
    }
  }
  say(`merged ${newOwned.keys.length} settings, avatar initials: ${initials}`);
}

// F2 renames the active Claude Code tab (also what a double-click on the tab sends)
function editKeybinding(add) {
  const file = path.join(userDir, 'keybindings.json');
  let { text, data } = readJsonc(file, '[]\n');
  const list = Array.isArray(data) ? data : [];
  const idx = list.findIndex((k) => k && k.command === 'claude-vscode.renameSessionTab' && k.key === 'f2');
  if (add && idx < 0) text = jsonc.applyEdits(text, jsonc.modify(text, [list.length], { key: 'f2', command: 'claude-vscode.renameSessionTab', when: "activeWebviewPanelId == 'claudeVSCodePanel'" }, { ...FORMAT, isArrayInsertion: true }));
  else if (!add && idx >= 0) text = jsonc.applyEdits(text, jsonc.modify(text, [idx], undefined, FORMAT));
  else return;
  fs.writeFileSync(file, text);
}

// ── 5. Milo's Scroll (Claude Code notifications, macOS) ────────────────────
const SCROLL_DIR = path.join(HOME, '.claude', 'milos-scroll');
const SCROLL_CMD = `"${path.join(SCROLL_DIR, 'scroll.sh')}"`;
const SCROLL_EVENTS = ['Stop', 'Notification', 'PermissionRequest', 'PreCompact'];
const claudeSettings = path.join(HOME, '.claude', 'settings.json');

function editClaudeHooks(add) {
  let { text, data } = readJsonc(claudeSettings, '{}\n');
  const hooks = data.hooks || {};
  for (const event of SCROLL_EVENTS) {
    const groups = (hooks[event] || [])
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('milos-scroll/scroll.sh')) }))
      .filter((g) => g.hooks.length);
    if (add) groups.push({ matcher: '', hooks: [{ type: 'command', command: SCROLL_CMD, async: true, timeout: 10 }] });
    text = setKey(text, ['hooks', event], groups.length ? groups : undefined);
  }
  fs.mkdirSync(path.dirname(claudeSettings), { recursive: true });
  fs.writeFileSync(claudeSettings, text);
}

function installScroll() {
  step("Milo's Scroll (Claude Code notifications)");
  if (!MAC) return say('macOS only, skipped');
  const src = path.join(KIT, 'scroll');
  fs.mkdirSync(SCROLL_DIR, { recursive: true });
  for (const f of ['scroll.sh', 'overlay.js', 'milo.png']) fs.copyFileSync(path.join(src, f), path.join(SCROLL_DIR, f));
  fs.chmodSync(path.join(SCROLL_DIR, 'scroll.sh'), 0o755);
  const skillDir = path.join(HOME, '.claude', 'skills', 'scroll');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(path.join(src, 'SKILL.md'), path.join(skillDir, 'SKILL.md'));
  editClaudeHooks(true);
  say(`${SCROLL_DIR.replace(HOME, '~')}, /scroll skill, hooks: ${SCROLL_EVENTS.join(', ')}`);
}

function uninstallScroll() {
  step("Removing Milo's Scroll");
  if (fs.existsSync(claudeSettings)) editClaudeHooks(false);
  fs.rmSync(SCROLL_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(HOME, '.claude', 'skills', 'scroll'), { recursive: true, force: true });
  say('hooks, files and /scroll skill removed');
}

// ── 6. Usage dashboard data (click the token count in the chat header) ────
// aggregate.js reads ~/.claude/projects after each Claude reply (async Stop hook) and writes the summary the
// dashboard loads. Runs on the system node, or on the editor's own runtime when node is missing.
const USAGE_DIR = path.join(HOME, '.claude', 'milo-usage');
const USAGE_SCRIPT = path.join(USAGE_DIR, 'aggregate.js');
const hasNode = () => { try { execFileSync('node', ['--version'], { stdio: 'ignore' }); return true; } catch (e) { return false; } };
const usageCmd = () => (hasNode() ? `node "${USAGE_SCRIPT}"` : `ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${USAGE_SCRIPT}"`);
function editUsageHook(add) {
  let { text, data } = readJsonc(claudeSettings, '{}\n');
  const groups = ((data.hooks || {}).Stop || [])
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes('milo-usage/aggregate.js')) }))
    .filter((g) => g.hooks.length);
  if (add) groups.push({ matcher: '', hooks: [{ type: 'command', command: usageCmd(), async: true, timeout: 120 }] });
  text = setKey(text, ['hooks', 'Stop'], groups.length ? groups : undefined);
  fs.mkdirSync(path.dirname(claudeSettings), { recursive: true });
  fs.writeFileSync(claudeSettings, text);
}
function installUsage() {
  step('Usage dashboard');
  fs.mkdirSync(USAGE_DIR, { recursive: true });
  fs.copyFileSync(path.join(KIT, 'usage', 'aggregate.js'), USAGE_SCRIPT);
  editUsageHook(true);
  try {
    execFileSync(hasNode() ? 'node' : process.execPath, [USAGE_SCRIPT], { stdio: 'ignore', timeout: 600000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    say('first summary written');
  } catch (e) { warn("first summary failed; it is written after Claude's next reply"); }
  say(`${USAGE_DIR.replace(HOME, '~')}, Stop hook`);
}
function uninstallUsage() {
  step('Removing usage dashboard data');
  if (fs.existsSync(claudeSettings)) editUsageHook(false);
  fs.rmSync(USAGE_DIR, { recursive: true, force: true });
  say('hook and summary removed');
}

// ── Main ───────────────────────────────────────────────────────────────────
function main() {
  const mode = process.argv[2] || 'install';
  if (mode === 'uninstall') {
    uninstallScroll();
    uninstallUsage();
    step('Milo Kit settings extension');
    run(CLI, ['--uninstall-extension', 'local.milo-kit-settings']) === null ? say('not installed') : say('removed');
    const backup = settingsPath + '.pre-milo-kit.bak';
    step('VS Code settings');
    if (fs.existsSync(backup)) {
      fs.copyFileSync(settingsPath, settingsPath + '.milo-kit-last.bak');
      fs.copyFileSync(backup, settingsPath);
      say(`restored ${backup.replace(HOME, '~')}`);
    } else warn('no pre-install backup found, settings left as they are');
    if (fs.existsSync(path.join(userDir, 'keybindings.json'))) editKeybinding(false);
    fs.rmSync(path.join(editorHome, 'milo-kit'), { recursive: true, force: true });
    fs.rmSync(path.join(HOME, '.milo-kit'), { recursive: true, force: true });
    console.log('\nLast step: Command Palette > "Custom UI Style: Rollback", then restart VS Code.');
    return;
  }

  // Letters and digits only, so the value is safe inside the CSS string inside the JSON string.
  const initials = (process.env.MILO_INITIALS || loadState().initials || deriveInitials(process.env.MILO_NAME))
    .replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3) || 'ME';

  // Choices: kept from earlier runs, then the setup answers, then MILO_SKIP.
  const cfg = setupChoices(kitApply.loadConfig(), initials);
  kitApply.copyKitRuntime(KIT);

  if (!SKIP.includes('theme')) {
    installExtensions();
    if (!SKIP.includes('fonts')) installFonts();
    installTabIcons();
    mergeSettings(initials);
    // The merge put the kit's own values back, so nothing is stashed any more.
    kitApply.saveState({ ...loadState(), stash: { wb: {}, rules: {} }, usageThresholds: false });
  }
  if (cfg.scroll.enabled) installScroll();
  if (cfg.status.summary) installUsage();

  step('Your choices');
  const result = kitApply.apply(cfg, { settingsPath, userDir, editorHome, kitDir: KIT });
  const c = result.config;
  const preset = (kitApply.PRESETS[c.preset] || {}).label || 'Custom';
  say(`look: ${preset}, accent ${c.colors.accent}`);
  say(`Milo's Scroll: ${c.scroll.enabled ? 'on' : 'off'}, usage summary: ${c.status.summary ? 'on' : 'off'}, chat features: ${Object.values(c.features).filter(Boolean).length} of ${Object.keys(c.features).length} on`);

  console.log(`
Done. Last step, in VS Code:
  Command Palette > "Custom UI Style: Reload"  (VS Code restarts)
  If it warns the install "appears to be corrupt", choose "Don't show again". Custom UI Style causes that.
Change any of this later: "..." menu in the editor > Milo Kit settings.
Update any time by running the same install command again. Your choices stay.`);
}

// Answers from install.sh (first install, or MILO_ASK=1). Missing answers keep the current choice.
function setupChoices(cfg, initials) {
  const env = process.env;
  const yes = (v) => !/^n/i.test(String(v));
  cfg.initials = initials;
  if (env.MILO_SETUP_PRESET && kitApply.PRESETS[env.MILO_SETUP_PRESET]) {
    const { label, note, ...colors } = kitApply.PRESETS[env.MILO_SETUP_PRESET];
    cfg.colors = colors;
    cfg.preset = env.MILO_SETUP_PRESET;
  }
  if (env.MILO_SETUP_ACCENT && kitApply.SWATCHES[env.MILO_SETUP_ACCENT]) cfg.colors.accent = kitApply.SWATCHES[env.MILO_SETUP_ACCENT];
  if (env.MILO_SETUP_SCROLL) cfg.scroll.enabled = yes(env.MILO_SETUP_SCROLL);
  if (env.MILO_SETUP_USAGE) cfg.status.summary = yes(env.MILO_SETUP_USAGE);
  if (env.MILO_SETUP_CHAT) for (const f of kitApply.FEATURES) cfg.features[f] = yes(env.MILO_SETUP_CHAT);
  if (SKIP.includes('scroll')) cfg.scroll.enabled = false;
  if (SKIP.includes('usage')) cfg.status.summary = false;
  return cfg;
}

// Run only when started as a script (install.sh), never when another file requires this one.
if (require.main === module) {
  try { main(); } catch (e) { console.error(`\n  x ${e.message}`); process.exit(1); }
}

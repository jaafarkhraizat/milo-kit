// Milo Kit settings: the "..." menu item and the settings tab.
// The tab edits ~/.milo-kit/config.json. Saving runs the same apply step the installer uses (lib/apply.js).

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

let panel = null;

// The installer keeps the current apply module in ~/.milo-kit/kit. The copy bundled here is the fallback.
function loadApply() {
  const kitCopy = path.join(os.homedir(), '.milo-kit', 'kit', 'lib', 'apply.js');
  const file = fs.existsSync(kitCopy) ? kitCopy : path.join(__dirname, 'lib', 'apply.js');
  delete require.cache[require.resolve(file)];
  return require(file);
}

function contextPaths(context) {
  const userDir = path.dirname(path.dirname(context.globalStorageUri.fsPath));
  const editorHome = path.dirname(path.dirname(context.extensionPath));
  // appRoot is <Editor>.app/Contents/Resources/app on macOS
  const appPath = path.resolve(vscode.env.appRoot, '..', '..', '..');
  const profile = activeProfile(userDir);
  return { userDir, editorHome, settingsPath: profile ? profile.settingsPath : path.join(userDir, 'settings.json'), appPath, profile };
}

// The VS Code profile of this window, or null for the default profile. VS Code has no API for it: the
// workspace's profile comes from globalStorage/storage.json (profileAssociations), the name from userDataProfiles.
// email: the profile's Claude account (CLAUDE_CONFIG_DIR in claudeCode.environmentVariables, else ~/.claude.json).
// title: the profile's window.title when it is plain text (the title bar avatar matches on it).
function activeProfile(userDir) {
  try {
    const store = JSON.parse(fs.readFileSync(path.join(userDir, 'globalStorage', 'storage.json'), 'utf8'));
    const ws = vscode.workspace.workspaceFile || (vscode.workspace.workspaceFolders || [])[0]?.uri;
    const loc = ws && ((store.profileAssociations || {}).workspaces || {})[ws.toString()];
    const prof = loc && (store.userDataProfiles || []).find((p) => p.location === loc);
    if (!prof) return null;
    const settingsPath = path.join(userDir, 'profiles', loc, 'settings.json');
    if (!fs.existsSync(settingsPath)) return null;
    const env = vscode.workspace.getConfiguration('claudeCode').get('environmentVariables');
    const dir = (Array.isArray(env) ? env : []).find((e) => e && e.name === 'CLAUDE_CONFIG_DIR');
    const claudeJson = dir && dir.value ? path.join(dir.value, '.claude.json') : path.join(os.homedir(), '.claude.json');
    let email = '';
    try { email = (JSON.parse(fs.readFileSync(claudeJson, 'utf8')).oauthAccount || {}).emailAddress || ''; } catch { /* not signed in */ }
    const title = String(vscode.workspace.getConfiguration('window').get('title') || '');
    return { name: prof.name, settingsPath, email, title: title.includes('${') ? '' : title };
  } catch { return null; }
}

// The settings tab edits avatar.me / meImage. In a profile window those are the profile's own: swapped in
// for the page, and back into avatar.profiles on save, so the shared avatar and other profiles stay as they are.
function toPage(cfg, profile) {
  const out = JSON.parse(JSON.stringify(cfg));
  const own = profile && cfg.avatar.profiles[profile.name];
  if (own) Object.assign(out.avatar, { me: own.me, meImage: own.meImage });
  return out;
}
function fromPage(cfg, profile, stored) {
  const out = JSON.parse(JSON.stringify(cfg));
  out.avatar.profiles = { ...stored.avatar.profiles };
  if (!profile) return out;
  out.avatar.profiles[profile.name] = { email: profile.email, title: profile.title, me: cfg.avatar.me, meImage: cfg.avatar.meImage };
  Object.assign(out.avatar, { me: stored.avatar.me, meImage: stored.avatar.meImage });
  return out;
}

// The app icon cards: Milo art from media, and a small PNG of the editor's own icon (webviews can't show .icns).
// The PNG goes to the page inline as a data: URI. A webview URI into globalStorage loaded as a broken image.
function appIconPreviews(context, web, media) {
  const { appPath } = contextPaths(context);
  const out = { milo: web.asWebviewUri(vscode.Uri.joinPath(media, 'app-icon-milo.svg')).toString(), stock: '' };
  if (process.platform !== 'darwin') return out;
  const dir = context.globalStorageUri.fsPath;
  try {
    const icns = path.join(appPath, 'Contents', 'Resources', 'Code.icns');
    // The icns mtime in the name regenerates the PNG after a VS Code update.
    const name = `stock-app-icon-${Math.round(fs.statSync(icns).mtimeMs)}.png`;
    const png = path.join(dir, name);
    if (!fs.existsSync(png)) {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) if (/^stock-app-icon.*\.png$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
      require('child_process').execFileSync('sips', ['-s', 'format', 'png', '-Z', '128', icns, '--out', png], { stdio: 'ignore' });
    }
    out.stock = `data:image/png;base64,${fs.readFileSync(png).toString('base64')}`;
  } catch { /* the card shows its name only */ }
  return out;
}

// Preset images for Claude's avatar: every image in ~/.milo-kit/avatars (sorted by name). The label is an SVG's
// <title>, else the file name without a leading number. The kit ships none; drop files in to add your own.
const AVATAR_TYPES = { svg: 'svg+xml', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', gif: 'gif' };
function avatarPresets() {
  const dir = path.join(os.homedir(), '.milo-kit', 'avatars');
  let names = [];
  try { names = fs.readdirSync(dir).sort(); } catch { return []; }
  const out = [];
  for (const f of names) {
    const ext = path.extname(f).slice(1).toLowerCase();
    if (!AVATAR_TYPES[ext]) continue;
    try {
      const buf = fs.readFileSync(path.join(dir, f));
      if (buf.length > 2 * 1024 * 1024) continue;
      const title = ext === 'svg' && /<title>([^<]{1,60})<\/title>/.exec(buf.toString('utf8'));
      const label = title ? title[1] : path.basename(f, '.' + ext).replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ');
      out.push({ id: f, label, data: `data:image/${AVATAR_TYPES[ext]};base64,${buf.toString('base64')}` });
    } catch { /* skip unreadable files */ }
  }
  return out;
}

// Sample icons shown on each pack's card: activity bar icons for interface packs, common files for file packs.
const PRODUCT_SAMPLES = ['files', 'search', 'source-control', 'debug-alt', 'extensions', 'settings-gear'];
const FILE_SAMPLES = [['folder'], ['ts', 'typescript'], ['js', 'javascript'], ['json', 'json'], ['md', 'markdown'], ['css', 'css']];
// Codicon code points for the same icons. VS Code ships the font, not a theme file, for its default pack.
const CODICON = { files: 60144, search: 60013, 'source-control': 60008, 'debug-alt': 60305, extensions: 60134, 'settings-gear': 60241 };

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')); }
}
const glyph = (s) => (s.startsWith('\\') ? String.fromCodePoint(parseInt(s.slice(1), 16)) : s);

// Reads one icon theme file and returns { fonts, icons } the webview can draw.
function themeSamples(file, kind, key, toUri) {
  const j = readJson(file);
  const dir = path.dirname(file);
  const fonts = {};
  for (const f of j.fonts || []) {
    const src = f.src && f.src[0];
    if (src) fonts[f.id] = { family: `mk-${key}-${f.id}`.replace(/[^\w-]/g, '_'), url: toUri(path.resolve(dir, src.path)) };
  }
  const first = (j.fonts || [])[0];
  const defs = j.iconDefinitions || {};
  const draw = (id) => {
    const d = id && defs[id];
    if (!d) return null;
    if (d.iconPath) return { src: toUri(path.resolve(dir, d.iconPath)), mask: !!j.usesCurrentColor };
    const f = d.fontCharacter && fonts[d.fontId || (first && first.id)];
    return f ? { ch: glyph(d.fontCharacter), family: f.family, color: d.fontColor || '' } : null;
  };
  const ids = kind === 'product'
    ? PRODUCT_SAMPLES
    : FILE_SAMPLES.map(([ext, lang]) => (lang ? (j.fileExtensions || {})[ext] || (j.languageIds || {})[lang] || j.file : j.folder));
  return { fonts: Object.values(fonts), icons: ids.map(draw).filter(Boolean) };
}

function themeChoices(toUri) {
  const product = [{ id: 'remix-product-icons', label: 'RemixIcon', note: 'Kit default, line style' }, { id: 'Default', label: 'VS Code default', note: 'Codicons' }];
  const file = [{ id: 'symbols', label: 'Symbols', note: 'Kit default' }, { id: 'vs-seti', label: 'Seti', note: 'VS Code built in' }, { id: 'none', label: 'None', note: 'Names only' }];
  const files = {};
  for (const ext of vscode.extensions.all) {
    const c = (ext.packageJSON && ext.packageJSON.contributes) || {};
    for (const t of c.productIconThemes || []) {
      files['product:' + t.id] = path.join(ext.extensionPath, t.path);
      if (!product.some((p) => p.id === t.id)) product.push({ id: t.id, label: t.label || t.id, note: 'Installed' });
    }
    for (const t of c.iconThemes || []) {
      files['file:' + t.id] = path.join(ext.extensionPath, t.path);
      if (!file.some((p) => p.id === t.id)) file.push({ id: t.id, label: t.label || t.id, note: ext.packageJSON.builtin || ext.id.startsWith('vscode.') ? 'VS Code built in' : 'Installed' });
    }
  }
  const fill = (list, kind) => list.forEach((t, i) => {
    t.fonts = []; t.icons = [];
    try {
      if (kind === 'product' && t.id === 'Default') {
        const family = 'mk-codicon';
        t.fonts = [{ family, url: toUri(path.join(vscode.env.appRoot, 'out', 'media', 'codicon.ttf')) }];
        t.icons = PRODUCT_SAMPLES.map((k) => ({ ch: String.fromCodePoint(CODICON[k]), family, color: '' }));
      } else if (files[kind + ':' + t.id]) {
        Object.assign(t, themeSamples(files[kind + ':' + t.id], kind, kind + i, toUri));
      }
    } catch { /* a pack we can't read just shows its name */ }
  });
  fill(product, 'product');
  fill(file, 'file');
  return { product, file };
}

// The webview may only load files under these folders: our media, VS Code's own, and every icon pack.
function resourceRoots(media, context) {
  const roots = [media, vscode.Uri.file(vscode.env.appRoot), context.globalStorageUri];
  for (const ext of vscode.extensions.all) {
    const c = (ext.packageJSON && ext.packageJSON.contributes) || {};
    if ((c.productIconThemes || []).length || (c.iconThemes || []).length) roots.push(ext.extensionUri);
  }
  return roots;
}

// Waits until VS Code's settings cache holds what apply wrote for the keys Custom UI Style patches from.
const UI_KEYS = [
  'custom-ui-style.webview.stylesheet', 'custom-ui-style.stylesheet', 'custom-ui-style.extensions.config',
  'custom-ui-style.external.imports', 'custom-ui-style.font.sansSerif', 'custom-ui-style.font.monospace',
];
async function settingsLoaded(A, settingsPath, ms = 8000) {
  const want = A.readJsonc(settingsPath, '{}\n').data;
  const same = () => UI_KEYS.every((k) => {
    const got = vscode.workspace.getConfiguration().inspect(k);
    return JSON.stringify(got && got.globalValue) === JSON.stringify(want[k]);
  });
  for (const end = Date.now() + ms; !same();) {
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

function open(context) {
  if (panel) { panel.reveal(); return; }
  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  panel = vscode.window.createWebviewPanel('miloKitSettings', 'Milo Kit settings', vscode.ViewColumn.Active, {
    enableScripts: true, retainContextWhenHidden: true, localResourceRoots: resourceRoots(media, context),
  });
  panel.iconPath = vscode.Uri.joinPath(media, 'icon.svg');
  panel.onDidDispose(() => { panel = null; });

  const web = panel.webview;
  const uri = (f) => web.asWebviewUri(vscode.Uri.joinPath(media, f)).toString();
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  web.html = fs.readFileSync(path.join(context.extensionPath, 'media', 'index.html'), 'utf8')
    .replace(/{{csp}}/g, web.cspSource)
    .replace(/{{nonce}}/g, nonce)
    .replace('{{style}}', uri('style.css'))
    .replace(/{{milo}}/g, uri('milo.png'))
    .replace('{{script}}', uri('main.js'));

  web.onDidReceiveMessage(async (msg) => {
    try {
      const A = loadApply();
      if (msg.type === 'init') {
        const ctx = contextPaths(context);
        web.postMessage({
          type: 'init',
          config: toPage(A.loadConfig(ctx.settingsPath, ctx.appPath), ctx.profile),
          profile: ctx.profile && ctx.profile.name,
          defaults: A.DEFAULTS,
          presets: A.PRESETS,
          swatches: A.SWATCHES,
          themes: themeChoices((f) => web.asWebviewUri(vscode.Uri.file(f)).toString()),
          mac: process.platform === 'darwin',
          appIcon: appIconPreviews(context, web, media),
          scrollInstalled: fs.existsSync(path.join(A.SCROLL_DIR, 'overlay.js')),
          avatarPresets: avatarPresets(),
          version: context.extension.packageJSON.version,
        });
      } else if (msg.type === 'save') {
        const ctx = contextPaths(context);
        const { settingsPath } = ctx;
        const stored = A.loadConfig(settingsPath, ctx.appPath);
        const result = A.apply(fromPage(msg.config, ctx.profile, stored), ctx);
        web.postMessage({ type: 'saved', config: toPage(result.config, ctx.profile) });
        if (result.reload && msg.reload !== false) {
          const cmds = await vscode.commands.getCommands(true);
          if (cmds.includes('custom-ui-style.reload')) {
            // Custom UI Style reads settings from VS Code's cache, which picks up the file a moment after we write it.
            // Reloading straight away patched the previous choice, so every save showed up one save late.
            if (!(await settingsLoaded(A, settingsPath))) {
              vscode.window.showWarningMessage('Milo Kit settings saved, but VS Code has not loaded them yet. Run "Custom UI Style: Reload" in a moment.');
              return;
            }
            await vscode.commands.executeCommand('custom-ui-style.reload');
          }
          else vscode.window.showInformationMessage('Milo Kit settings saved. Run "Custom UI Style: Reload" to see every change.');
        } else {
          vscode.window.setStatusBarMessage('Milo Kit settings saved', 3000);
        }
      } else if (msg.type === 'close') {
        if (msg.unsaved) {
          const pick = await vscode.window.showWarningMessage(`Close Milo Kit settings? You have ${msg.unsaved} unsaved ${msg.unsaved === 1 ? 'change' : 'changes'}.`, { modal: true }, 'Close without saving');
          if (pick !== 'Close without saving') return;
        }
        panel.dispose();
      } else if (msg.type === 'pickImage') {
        // The page crops and shrinks it: here we only read the file the person picks.
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false, openLabel: 'Use as avatar', title: msg.who === 'agent' ? "Claude's avatar" : 'Your avatar',
          filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
        });
        if (!picked || !picked.length) return;
        const file = picked[0].fsPath;
        if (fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('That image is over 20 MB. Pick a smaller one.');
        const ext = path.extname(file).slice(1).toLowerCase();
        const mime = { jpg: 'jpeg', svg: 'svg+xml' }[ext] || ext;
        web.postMessage({ type: 'image', who: msg.who, data: `data:image/${mime};base64,${fs.readFileSync(file).toString('base64')}` });
      } else if (msg.type === 'testScroll') {
        const sh = path.join(A.SCROLL_DIR, 'scroll.sh');
        if (!fs.existsSync(sh)) throw new Error("Milo's Scroll isn't installed. Turn it on and save first.");
        execFile(sh, ['test', msg.kind || 'complete'], () => {});
      }
    } catch (e) {
      web.postMessage({ type: 'error', message: e.message });
      vscode.window.showErrorMessage(`Milo Kit: ${e.message}`);
    }
  });
}

// The Space button's page (config.space in ~/.milo-kit/config.json). Opens in the default browser.
// Not tested: vscode's simpleBrowser as an in-editor panel, which needs a live VS Code (see README, Space button).
function spaceConfig() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.milo-kit', 'config.json'), 'utf8')).space || {};
    return /^https?:\/\//.test(s.url || '') ? s : null;
  } catch { return null; }
}
async function openSpace() {
  const s = spaceConfig();
  if (!s) { vscode.window.showInformationMessage('Milo Kit: set a Space URL in Milo Kit settings first.'); return; }
  await vscode.env.openExternal(vscode.Uri.parse(s.url));
}

// The Skills section in the sessions sidebar reads a list that lib/skills.js writes. Built here because this
// window knows its Claude account (CLAUDE_CONFIG_DIR) and its workspace folders; rebuilt when a skills folder changes.
function loadSkills() {
  const kitCopy = path.join(os.homedir(), '.milo-kit', 'kit', 'lib', 'skills.js');
  const file = fs.existsSync(kitCopy) ? kitCopy : path.join(__dirname, 'lib', 'skills.js');
  delete require.cache[require.resolve(file)];
  const actions = path.join(path.dirname(file), 'skill-actions.js');
  if (fs.existsSync(actions)) delete require.cache[require.resolve(actions)];
  return require(file);
}
function skillsContext() {
  const env = vscode.workspace.getConfiguration('claudeCode').get('environmentVariables');
  const dir = (Array.isArray(env) ? env : []).find((e) => e && e.name === 'CLAUDE_CONFIG_DIR');
  const configDir = dir && dir.value ? dir.value : path.join(os.homedir(), '.claude');
  const projects = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  return { configDir, projects };
}
function startSkills(context) {
  let timer = 0, watchers = [];
  const run = () => {
    try {
      const ctx = skillsContext();
      const skills = loadSkills();
      skills.build({ ...ctx, email: skills.emailFor(ctx.configDir) });
      watchers.forEach((w) => w.close());
      watchers = skills.watchDirs(ctx).filter((d) => fs.existsSync(d)).map((d) => {
        try { return fs.watch(d, { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(run, 1500); }); } catch (e) { return null; }
      }).filter(Boolean);
    } catch (e) { /* the sidebar keeps the last list */ }
  };
  setTimeout(run, 2000);
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(run));
  context.subscriptions.push({ dispose: () => watchers.forEach((w) => w.close()) });
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('miloKit.openSettings', () => open(context)));
  context.subscriptions.push(vscode.commands.registerCommand('miloKit.openSpace', openSpace));
  startSkills(context);
  // Once per VS Code start (activation happens once per window start, after startup finishes).
  const s = spaceConfig();
  if (s && s.enabled && s.openOnStartup) openSpace().catch(() => {});
  // A VS Code update resets the app icon; the first start after it puts Milo back.
  setTimeout(() => {
    try {
      const app = path.resolve(vscode.env.appRoot, '..', '..', '..');
      const restore = loadApply().restoreAppIcon;
      if (restore && app.endsWith('.app')) restore(app);
    } catch (e) { /* the icon stays stock until the next start */ }
  }, 3000);
}

function deactivate() {}

module.exports = { activate, deactivate };

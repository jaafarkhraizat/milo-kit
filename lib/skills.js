// Milo Kit: the skill list for the Skills section in Claude Code's sessions sidebar (chat-extras section 15).
// Run by the Milo Kit settings extension when VS Code starts and when a skills folder changes, or by hand:
//   node lib/skills.js [--config <CLAUDE_CONFIG_DIR>] [--project <folder>] [--email <account>]
//
// The sidebar's CSP blocks fetch but allows stylesheets from Claude Code's extension folder, so the list rides in
// one custom property (base64 JSON) in resources/mk-skills.css, the same way the usage dashboard gets its data.
// Each Claude account (VS Code profile) keeps its own entry, keyed by email; ~/.milo-kit/skills.json holds them all.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const STORE = path.join(HOME, '.milo-kit', 'skills.json');
const ACTIONS = (() => { try { return require('./skill-actions.js'); } catch (e) { return {}; } })();

// Skills that ship inside Claude Code itself (no SKILL.md on disk).
const BUILT_IN = [
  ['code-review', 'Reviews the current diff or a PR for bugs, at the effort level you pick.'],
  ['simplify', 'Cleans up changed code for reuse and simplicity, then applies the fixes.'],
  ['security-review', 'Security review of the pending changes on this branch.'],
  ['init', 'Writes a CLAUDE.md that documents this codebase.'],
  ['loop', 'Runs a prompt or command on a repeating interval.'],
  ['schedule', 'Creates and manages scheduled cloud agents.'],
  ['fewer-permission-prompts', 'Adds common read-only commands to your allowlist.'],
  ['update-config', 'Changes Claude Code settings: hooks, permissions, environment.'],
];

const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; } };

// frontmatter value, including folded (>, >-) and literal (|) blocks
function field(fm, key) {
  const lines = fm.split('\n');
  const i = lines.findIndex((l) => l.startsWith(key + ':'));
  if (i < 0) return '';
  let v = lines[i].slice(key.length + 1).trim();
  if (/^[>|][-+]?$/.test(v)) {
    const out = [];
    for (let j = i + 1; j < lines.length && (/^\s/.test(lines[j]) || !lines[j]); j++) out.push(lines[j].trim());
    v = out.join(' ');
  }
  return v.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
}

// first sentence or two, at most ~170 characters
function shorten(d) {
  if (d.length <= 170) return d;
  const cut = d.slice(0, 170);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.'));
  return end > 60 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

function readSkill(dir, folder) {
  const file = path.join(dir, folder, 'SKILL.md');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fm = m ? m[1] : '';
  return { name: field(fm, 'name') || folder, desc: shorten(field(fm, 'description')), hint: field(fm, 'argument-hint') };
}

function listDir(dir) {
  try { return fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort(); } catch (e) { return []; }
}

// actions: curated list, else the argument-hint's alternatives ("<prompt> | redesign <path>"), else one "Use"
function actionsFor(name, call, hint) {
  const own = ACTIONS[name];
  if (own) return own.map(([l, d, t]) => [l, d, t]);
  const out = [['Use', 'Start a message with this skill, then say what you need', call + ' ']];
  const alts = hint.replace(/^\[|\]$/g, '').split('|').map((s) => s.trim()).filter(Boolean);
  if (alts.length > 1) {
    for (const a of alts) {
      const word = a.replace(/<[^>]*>/g, '').trim();
      if (!word) continue;
      const rest = a.slice(word.length).trim();
      out.push([word.charAt(0).toUpperCase() + word.slice(1), rest ? 'Then add ' + rest.replace(/[<>]/g, '') : 'Runs ' + call + ' ' + word, call + ' ' + word + (rest ? ' ' : '')]);
    }
  }
  return out;
}

function skillEntry(info, call) {
  return { n: call, d: info.desc, a: actionsFor(info.name, call, info.hint) };
}

// enabled plugins: settings.json enabledPlugins + installed_plugins.json install paths
function pluginSkills(configDir) {
  const enabled = readJson(path.join(configDir, 'settings.json'), {}).enabledPlugins || {};
  const installed = readJson(path.join(configDir, 'plugins', 'installed_plugins.json'), {}).plugins || {};
  const out = [];
  for (const [id, on] of Object.entries(enabled)) {
    if (!on) continue;
    const inst = (installed[id] || [])[0];
    if (!inst || !inst.installPath) continue;
    const plugin = id.split('@')[0];
    const dir = path.join(inst.installPath, 'skills');
    for (const f of listDir(dir)) {
      const s = readSkill(dir, f);
      if (s) out.push(skillEntry(s, '/' + plugin + ':' + s.name));
    }
  }
  return out;
}

// claude.ai skills synced into <config>/skills/synced/<bucket>/<skill>
function syncedSkills(configDir) {
  const out = [];
  const root = path.join(configDir, 'skills', 'synced');
  for (const bucket of listDir(root)) {
    const dir = path.join(root, bucket);
    for (const f of listDir(dir)) {
      const s = readSkill(dir, f);
      if (s) out.push(skillEntry(s, '/' + s.name));
    }
  }
  return out;
}

function folderSkills(dir) {
  const out = [];
  for (const f of listDir(dir)) {
    if (f === 'synced') continue;
    const s = readSkill(dir, f);
    if (s) out.push(skillEntry(s, '/' + s.name));
  }
  return out;
}

function collect({ configDir, projects }) {
  const seen = new Set();
  const keep = (list) => list.filter((s) => (seen.has(s.n) ? false : (seen.add(s.n), true))).sort((a, b) => a.n.localeCompare(b.n));
  const groups = [];
  const add = (label, list) => { const l = keep(list); if (l.length) groups.push({ label, skills: l }); };
  add('Project', [].concat(...(projects || []).map((p) => folderSkills(path.join(p, '.claude', 'skills')))));
  add('Personal', folderSkills(path.join(configDir, 'skills')));
  add('Plugins', pluginSkills(configDir));
  add('claude.ai', syncedSkills(configDir));
  add('Built in', BUILT_IN.map(([n, d]) => skillEntry({ name: n, desc: d, hint: '' }, '/' + n)));
  return groups;
}

function writeCss(store) {
  const css = '.mkSkillsData{--mk-skills:"' + Buffer.from(JSON.stringify(store)).toString('base64') + '"}\n';
  let wrote = 0;
  for (const home of ['.vscode', '.vscode-insiders', '.cursor', '.vscode-oss']) {
    const ext = path.join(HOME, home, 'extensions');
    for (const n of listDir(ext)) {
      if (!n.startsWith('anthropic.claude-code-')) continue;
      const res = path.join(ext, n, 'resources');
      try { fs.mkdirSync(res, { recursive: true }); fs.writeFileSync(path.join(res, 'mk-skills.css'), css); wrote++; } catch (e) {}
    }
  }
  return wrote;
}

// configDir: the account's Claude config folder. projects: workspace folders. email: the account (the sidebar
// matches it against the email on the Account card); '' when unknown.
function build({ configDir, projects = [], email = '' } = {}) {
  configDir = configDir || process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
  const groups = collect({ configDir, projects });
  const store = readJson(STORE, { v: 1, accounts: {} });
  store.v = 1;
  store.accounts = store.accounts || {};
  store.accounts[email] = { at: Math.round(Date.now() / 1000), groups };
  try { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(store)); } catch (e) {}
  const wrote = writeCss(store);
  return { skills: groups.reduce((a, g) => a + g.skills.length, 0), groups: groups.length, wrote };
}

// the account email for a config folder (.claude.json sits inside it, or in ~ for the default ~/.claude)
function emailFor(configDir) {
  const inside = path.join(configDir, '.claude.json');
  const file = fs.existsSync(inside) ? inside : path.join(HOME, '.claude.json');
  return (readJson(file, {}).oauthAccount || {}).emailAddress || '';
}

// folders to watch so the list stays current
function watchDirs({ configDir, projects = [] }) {
  return [path.join(configDir, 'skills'), path.join(configDir, 'settings.json'), ...projects.map((p) => path.join(p, '.claude', 'skills'))];
}

module.exports = { build, collect, emailFor, watchDirs };

if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const configDir = flag('--config') || process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
  const projects = flag('--project') ? [flag('--project')] : [process.cwd()];
  const email = flag('--email') != null ? flag('--email') : emailFor(configDir);
  const r = build({ configDir, projects, email });
  console.log(`skills: ${r.skills} in ${r.groups} groups for ${email || '(no account)'}, ${r.wrote} extension(s)`);
}

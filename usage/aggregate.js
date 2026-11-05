#!/usr/bin/env node
// Milo Kit usage: reads Claude Code transcripts (~/.claude/projects/**/*.jsonl) and writes a compact summary
// the chat's Usage dashboard loads. Runs from a Stop hook (async), so it must stay fast: each transcript is
// parsed once and cached by size + mtime; only changed files are read again.
//
// The chat webview's CSP blocks fetch/XHR but allows stylesheets from the extension folder, so the summary is
// written as resources/mk-usage.css next to every installed Claude Code extension: one rule whose custom
// property holds the JSON, base64-encoded.
//
// Usage: node aggregate.js [--force] [--print]

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const HOME = os.homedir();
const PROJECTS = path.join(HOME, '.claude', 'projects');
const DIR = path.join(HOME, '.claude', 'milo-usage');
const CACHE = path.join(DIR, 'cache.json');
const LOCK = path.join(DIR, 'lock');
const OUT_JSON = path.join(DIR, 'usage.json');
const VERSION = 6; // bump when the per-file summary shape or rules change (drops the cache)
const FORCE = process.argv.includes('--force');
const PRINT = process.argv.includes('--print');

// ── Classification rules ────────────────────────────────────────────────────
const TYPES = [
  ['fix', /\b(fix(es|ed|ing)?|bugs?|broken|errors?|crash(es|ing)?|fail(s|ed|ing)?|issues?|not working|doesn'?t work|isn'?t working|glitch|regression|debug)\b/],
  ['design', /\b(design|ui|ux|layout|spacing|colou?rs?|fonts?|typography|figma|mock ?ups?|prototypes?|screens?|dashboards?|icons?|animations?|styles?|styling|css|visual|looks?|bubble|theme|polish)\b/],
  ['writing', /\b(write|rewrite|copy|emails?|message to|posts?|linkedin|drafts?|captions?|reply|cv|resume|cover letter|proposal)\b/],
  ['research', /\b(research|search|compare|look up|investigate|analy[sz]e|what is|what are|how does|how do|explain|why does|summari[sz]e|review)\b/],
  ['setup', /\b(install|set ?up|config(ure)?|settings?|hooks?|skills?|plugins?|mcp|permissions?|update|upgrade|organi[sz]e|clean ?up|move files?)\b/],
  ['build', /\b(build|create|add|implement|make|generate|new|feature|page|component|script|tool)\b/],
];
// a follow-up prompt that says the last attempt missed
const CORRECTION_START = /^(no\b|nope|not quite|wrong|still\b|again\b|undo|revert|that'?s not|this is not|this isn'?t|it'?s not|its not|doesn'?t|didn'?t|isn'?t|wasn'?t|why (is|did|does|are)|you (changed|broke|removed|forgot|missed|didn'?t|did not))/;
// feedback that asks to adjust the last result (normal in design work, but still a round trip)
const REVISION = /\b(too (light|dark|bright|big|small|fast|slow|much|little|harsh|busy|heavy|thin|thick|close|far|long|short|wide|narrow|tight|loose)|(a )?(bit|couple|little|few|slightly|tiny bit) (more|less|darker|lighter|bigger|smaller|higher|lower)|make (it|them|this|that|the [\w -]{1,30}) (more|less|smaller|bigger|nicer|smoother|faster|slower|darker|lighter|subtle|cleaner|thinner|thicker|wider|narrower)|instead of|should (be|remain|stay|look|not)|needs? to be|i (don'?t|do not|hate|dislike) (like )?(the|this|it|how)|not (nice|good|great|clear|visible|readable|aligned|centered)|looks (like|weird|wierd|bad|wrong|cheap|generic|flat|off)|feels (off|weird|wierd|wrong|heavy|cheap)|can'?t (see|read|skim)|hard to (see|read))\b/;
const CORRECTION_ANY = /\b(still (not|doesn'?t|don'?t|looks|broken|off|the same|happening|showing|there|wrong|missing|isn'?t)|not working|doesn'?t work|didn'?t work|isn'?t working|did not work|does not work|try again|same (issue|problem|error|thing|bug)|not what i (asked|wanted|meant)|broke|broken again|nothing changed|no change|you changed|looks off|is off|feels off|still off|not fixed|didn'?t fix|wrong again|missing|not (showing|visible|loading|updating|applied|there)|doesn'?t (show|load|appear|update|change)|disappeared|is gone|went away|unable to|still esit|still exist|looks like (shit|crap)|horseshit|ugly|terrible|needs fixing|fix this)\b/;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// ── Areas: which project a file belongs to ──────────────────────────────────
// folders whose children are projects (Work/<client>, Tools/<tool>, ~/Developer/<repo>)
const CONTAINERS = new Set(['Work', 'Tools', 'Career', 'Personal', 'Learning', 'Projects', 'projects', 'Clients', 'clients', 'Developer', 'repos', 'Repos', 'GitHub']);
const SKIP_DIRS = new Set(['Temp', 'tmp', 'temp', 'node_modules', 'archives', '.git']);
const DEBUG = process.env.MK_AREA_DEBUG;
function areaOf(p, cwd) {
  const a = areaOf0(p, cwd);
  if (DEBUG && a === DEBUG) console.log('area', a, '<-', p, '| cwd', cwd);
  return a;
}
// wrapper folders above a project (cloud drive, Desktop, My Files, then <project>)
const WRAPPERS = /^(iCloud[ ]Drive.*|Library|Mobile Documents|com~apple~CloudDocs|Desktop|Documents|Downloads|My Files|Dropbox|OneDrive.*|Google Drive)$/;
// sub-folders of a workspace that read better under their own name
const ALIASES = { System: 'Zero system', Cerebro: 'Cerebro', '.claude': 'Zero system', '.agents': 'Zero system' };
function areaOf0(p, cwd) {
  p = p.replace(/^~(?=\/)/, HOME);
  if (!p.startsWith('/')) p = path.join(cwd || HOME, p);
  if (/^\/(private\/)?(tmp|var\/folders)\//.test(p)) return null;
  if (p.startsWith(PROJECTS) || p.includes('/.claude/projects/')) return null;
  if (p.includes('/Library/Application Support/Code') || p.includes('/.vscode')) return 'VS Code setup';
  if (p.startsWith(HOME + '/.claude')) return 'Claude setup';
  if (!p.startsWith(HOME + '/')) return null;
  let segs = p.slice(HOME.length + 1).split('/').filter(Boolean);
  if (segs[0] === 'Library' && segs[1] !== 'Mobile Documents') return 'Mac setup';
  while (segs.length > 1 && WRAPPERS.test(segs[0])) segs = segs.slice(1);
  if (!segs.length || segs[0].startsWith('.')) return null;
  const ci = segs.findIndex((x) => CONTAINERS.has(x));
  if (ci >= 0) {
    const [, b, c] = segs.slice(ci);
    const n = segs.length - ci;
    if (!b || (n === 2 && /\.\w+$/.test(b))) return ci > 0 ? segs[ci - 1] : null;
    if (SKIP_DIRS.has(b)) return null;
    if (segs[ci] === 'Work' && c && n > 3 && !SKIP_DIRS.has(c)) return b + ' · ' + c;
    return b;
  }
  if (segs.length === 1) return /\.\w+$/.test(segs[0]) ? null : segs[0];
  if (SKIP_DIRS.has(segs[1])) return null;
  if (ALIASES[segs[1]]) return ALIASES[segs[1]];
  return segs[0];
}
const QUOTED = /"((?:~|\/Users|\/home|\.\.?)\/[^"\n]{2,300})"|'((?:~|\/Users|\/home)\/[^'\n]{2,300})'|(?:^|[\s=])((?:~|\/Users|\/home)\/[^\s"'|;&<>()]{2,300})/g;
function bashPaths(cmd) {
  const out = [];
  if (typeof cmd !== 'string') return out;
  let m;
  QUOTED.lastIndex = 0;
  while ((m = QUOTED.exec(cmd)) && out.length < 6) out.push(m[1] || m[2] || m[3]);
  return out;
}

// ── Prompt text ─────────────────────────────────────────────────────────────
function promptText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  if (content.some((b) => b && b.type === 'tool_result')) return null; // tool output, not a prompt
  return content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
}
function cleanPrompt(t) {
  return t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '').replace(/<command-name>([\s\S]*?)<\/command-name>/g, '$1')
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, ' $1').replace(/<[^>]{1,40}>/g, '').trim();
}
const isNoise = (t) => !t || /^(Caveat:|<local-command|\[Request interrupted|This session is being continued|Base directory for this skill|\[Workflow harness)/.test(t);
// background-task results and harness messages wake Claude up but are not prompts: they stay in the current turn
const isWake = (raw) => /<task-notification>|^\s*\[Workflow harness|^\s*<(bash-notification|agent-notification)/.test(raw);
function classify(t, edits) {
  const low = t.toLowerCase().slice(0, 600);
  for (const [k, re] of TYPES) if (re.test(low)) return k;
  return edits ? 'build' : 'chat';
}
const forMatch = (t) => t.replace(/https?:\/\/\S+/g, ' ').toLowerCase().trim().slice(0, 300);
const isCorrection = (t) => { const low = forMatch(t); return CORRECTION_START.test(low) || CORRECTION_ANY.test(low); };
const isRevision = (t) => REVISION.test(forMatch(t));
// "try now", "proceed", "push": carries on with the previous task
const isContinuation = (t) => t.length < 40 && !TYPES.some(([, re]) => re.test(forMatch(t)));

// ── One transcript ──────────────────────────────────────────────────────────
// Turn = one prompt and everything Claude did for it. Tokens are attributed to the turn that caused them.
async function parseFile(file, parentHint) {
  const s = {
    title: '', first: '', cwd: '', start: 0, end: 0, models: {}, costRuns: {}, apiErrors: 0, compactions: 0,
    interrupts: 0, linesAdded: 0, linesRemoved: 0, turns: [], edits: {}, tools: {},
  };
  const seenMsg = new Map(); // message id -> [turn, usage]
  let turn = null;
  const newTurn = (ts, text, kind) => {
    turn = { ts, text: text.slice(0, 160), kind, type: '', area: null, hints: {}, tok: [0, 0, 0, 0], prompts: kind === 'prompt' ? 1 : 0, corr: 0, rev: 0, cont: 0, errs: 0, edits: 0, tools: 0 };
    s.turns.push(turn);
  };
  const hint = (p, weight) => { const a = areaOf(p, s.cwd); if (a && turn) turn.hints[a] = (turn.hints[a] || 0) + weight; };

  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length < 20) continue;
    const head = line.slice(0, 120);
    if (head.startsWith('{"type":"api-request') || head.startsWith('{"type":"file-history') || head.startsWith('{"type":"attachment"')) continue;
    let tp = null;
    for (const t of ['assistant', 'user', 'cost-state', 'ai-title', 'system', 'summary']) {
      if (line.includes('"type":"' + t + '"')) { tp = t; break; }
    }
    if (!tp) continue;
    let d;
    try { d = JSON.parse(line); } catch (e) { continue; }
    if (d.type !== tp && !(tp === 'assistant' && d.type === 'assistant')) tp = d.type;
    const ts = d.timestamp ? Date.parse(d.timestamp) : 0;
    if (ts) { if (!s.start || ts < s.start) s.start = ts; if (ts > s.end) s.end = ts; }
    if (d.cwd && !s.cwd) s.cwd = d.cwd;

    if (tp === 'ai-title') { s.title = d.aiTitle || s.title; continue; }
    if (tp === 'summary' && d.summary && !s.title) { s.title = d.summary; continue; }
    if (tp === 'cost-state') {
      const k = String(d.startTime || 0);
      const prev = s.costRuns[k];
      if (!prev || d.totalCostUSD >= prev.c) s.costRuns[k] = { c: d.totalCostUSD || 0, a: d.totalLinesAdded || 0, r: d.totalLinesRemoved || 0 };
      continue;
    }
    if (tp === 'system') {
      if (d.subtype === 'api_error') s.apiErrors++;
      if (d.subtype === 'compact_boundary') s.compactions++;
      continue;
    }
    if (tp === 'user') {
      const m = d.message;
      if (!m) continue;
      if (d.isCompactSummary) continue;
      const content = m.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b && b.type === 'tool_result' && b.is_error && turn) turn.errs++;
          if (b && b.type === 'text' && typeof b.text === 'string' && b.text.startsWith('[Request interrupted')) s.interrupts++;
        }
      } else if (typeof content === 'string' && content.startsWith('[Request interrupted')) s.interrupts++;
      if (d.isMeta) continue;
      const raw = promptText(content);
      if (raw === null || isWake(raw)) continue;
      const t = cleanPrompt(raw);
      if (isNoise(t)) continue;
      const hadPrompt = s.turns.some((x) => x.kind === 'prompt');
      const corr = hadPrompt && isCorrection(t);
      const rev = hadPrompt && !corr && isRevision(t);
      const cont = hadPrompt && !corr && !rev && isContinuation(t);
      newTurn(ts, t, 'prompt');
      if (!s.first) s.first = t.slice(0, 160);
      turn.corr = corr ? 1 : 0;
      turn.rev = rev ? 1 : 0;
      turn.cont = cont ? 1 : 0;
      continue;
    }
    if (tp === 'assistant') {
      const m = d.message;
      if (!m || m.model === '<synthetic>') continue;
      if (!turn) newTurn(ts, parentHint ? 'Agent task' : '', parentHint ? 'agent' : 'resume');
      const id = m.id || d.uuid;
      let rec = seenMsg.get(id);
      if (!rec) { rec = [turn, [0, 0, 0, 0]]; seenMsg.set(id, rec); }
      const u = m.usage;
      if (u) {
        const v = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens, u.output_tokens].map((x) => Number(x) || 0);
        for (let i = 0; i < 4; i++) if (v[i] > rec[1][i]) rec[1][i] = v[i];
        if (m.model) rec[2] = m.model;
      }
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (!b || b.type !== 'tool_use' || !b.name) continue;
          const tt = rec[0];
          tt.tools++;
          const name = b.name.startsWith('mcp__') ? 'mcp:' + b.name.split('__')[1] : b.name;
          s.tools[name] = (s.tools[name] || 0) + 1;
          const inp = b.input || {};
          const fp = inp.file_path || inp.notebook_path;
          if (EDIT_TOOLS.has(b.name)) {
            tt.edits++;
            if (fp) { s.edits[fp] = (s.edits[fp] || 0) + 1; hint(fp, 3); }
          } else if (fp) hint(fp, 1);
          else if (inp.path) hint(inp.path, 1);
          else if (b.name === 'Bash') bashPaths(inp.command).forEach((p) => hint(p, 1));
        }
      }
    }
  }

  // fold message usage into turns
  for (const [, rec] of seenMsg) {
    const [t, v, model] = rec;
    for (let i = 0; i < 4; i++) t.tok[i] += v[i];
    if (model) {
      const mm = s.models[model] || (s.models[model] = [0, 0, 0, 0]);
      for (let i = 0; i < 4; i++) mm[i] += v[i];
      t.mdl = t.mdl || {};
      const tm = t.mdl[model] || (t.mdl[model] = [0, 0, 0, 0]);
      for (let i = 0; i < 4; i++) tm[i] += v[i];
    }
  }
  // areas: a turn's files decide its area; corrections and turns with no files inherit the previous one
  let prev = null;
  for (const t of s.turns) {
    const top = Object.entries(t.hints).sort((a, b) => b[1] - a[1])[0];
    const follow = prev && (t.corr || t.rev || t.cont);
    t.area = follow ? prev.area || (top && top[0]) : top ? top[0] : prev ? prev.area : null;
    t.type = follow ? prev.type : classify(t.text, t.edits);
    if (t.kind === 'agent') t.type = parentHint ? parentHint.type || classify(t.text, t.edits) : t.type;
    prev = t;
  }
  const fallback = (s.cwd && s.cwd !== HOME && areaOf0(s.cwd + '/x', s.cwd)) || 'General';
  const firstArea = (s.turns.find((t) => t.area) || {}).area || (parentHint && parentHint.area) || fallback;
  for (const t of s.turns) if (!t.area) t.area = firstArea;
  return s;
}

// ── Cost ────────────────────────────────────────────────────────────────────
// Claude Code records the session cost (cost-state). Spread it over turns by weighted tokens; sessions without
// it are estimated from rates learned on sessions that have it. Weights follow Anthropic's ratios
// (cache write 1.25x input, cache read 0.1x, output 5x).
const W = [1, 1.25, 0.1, 5];
const weigh = (v) => v[0] * W[0] + v[1] * W[1] + v[2] * W[2] + v[3] * W[3];
const family = (m) => (/opus/.test(m) ? 'opus' : /sonnet/.test(m) ? 'sonnet' : /haiku/.test(m) ? 'haiku' : 'other');

// ── Main ────────────────────────────────────────────────────────────────────
function listFiles() {
  const out = [];
  const walk = (dir, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 5) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl') && e.name !== 'journal.jsonl') out.push(p);
    }
  };
  walk(PROJECTS, 0);
  return out;
}
// <project>/<session>.jsonl, or <project>/<session>/subagents/(workflows/<wf>/)agent-*.jsonl
function sessionOf(file) {
  const rel = path.relative(PROJECTS, file).split(path.sep);
  if (rel.length === 2) return { sid: rel[1].replace(/\.jsonl$/, ''), sub: false };
  return { sid: rel[1], sub: true };
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  // one run at a time; a stale lock (crash) expires after 10 minutes
  try {
    const st = fs.statSync(LOCK);
    if (Date.now() - st.mtimeMs < 600000 && !FORCE) return;
  } catch (e) {}
  fs.writeFileSync(LOCK, String(process.pid));
  try {
    let cache = {};
    try { const c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); if (c.v === VERSION) cache = c.files || {}; } catch (e) {}
    const files = listFiles();
    // main transcripts first so subagents can inherit their parent's area and type
    files.sort((a, b) => Number(sessionOf(a).sub) - Number(sessionOf(b).sub));
    const fresh = {};
    let parsed = 0;
    const mains = {};
    for (const f of files) {
      let st;
      try { st = fs.statSync(f); } catch (e) { continue; }
      const key = st.size + ':' + Math.round(st.mtimeMs);
      const { sid, sub } = sessionOf(f);
      const c = cache[f];
      if (c && c.key === key && !FORCE) { fresh[f] = c; if (!sub) mains[sid] = c.s; continue; }
      let hintFrom = null;
      if (sub && mains[sid]) { const lt = mains[sid].turns; const t = lt[lt.length - 1]; hintFrom = t ? { area: t.area, type: t.type } : null; }
      const s = await parseFile(f, sub ? hintFrom || {} : null);
      parsed++;
      for (const t of s.turns) { delete t.hints; }
      fresh[f] = { key, s };
      if (!sub) mains[sid] = s;
    }
    fs.writeFileSync(CACHE, JSON.stringify({ v: VERSION, files: fresh }));

    // learn $ per weighted token by model family from sessions with a recorded cost
    const learn = {};
    const sessions = {};
    for (const [f, c] of Object.entries(fresh)) {
      const { sid, sub } = sessionOf(f);
      const proj = path.relative(PROJECTS, f).split(path.sep)[0];
      const S = sessions[sid] || (sessions[sid] = { sid, proj, files: [], main: null });
      if (sub) S.files.push(c.s); else S.main = c.s;
    }
    const recorded = (s) => Object.values(s.costRuns || {}).reduce((a, r) => a + r.c, 0);
    for (const S of Object.values(sessions)) {
      if (!S.main) continue;
      const cost = recorded(S.main);
      if (!cost) continue;
      const all = [S.main, ...S.files];
      const byFam = {};
      all.forEach((x) => Object.entries(x.models).forEach(([m, v]) => { byFam[family(m)] = (byFam[family(m)] || 0) + weigh(v); }));
      const fams = Object.keys(byFam);
      if (fams.length === 1) { const l = learn[fams[0]] || (learn[fams[0]] = [0, 0]); l[0] += cost; l[1] += byFam[fams[0]]; }
    }
    const DEFAULT_RATE = { opus: 5e-6, sonnet: 3e-6, haiku: 1e-6, other: 3e-6 };
    const rate = (fam) => (learn[fam] && learn[fam][1] > 1e6 ? learn[fam][0] / learn[fam][1] : DEFAULT_RATE[fam]);

    // output: one row per session, turns compressed to
// [ts, areaIdx, typeIdx, in, cacheWrite, cacheRead, out, cost, correction, toolErrors, edits, subagent, prompts, revision, promptText]
    const areas = [], types = [], models = {};
    const idx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
    const rows = [];
    const fileEdits = {};
    for (const S of Object.values(sessions)) {
      const main = S.main || { turns: [], models: {}, costRuns: {}, edits: {}, tools: {}, start: 0, end: 0 };
      const parts = [{ s: main, sub: 0 }, ...S.files.map((s) => ({ s, sub: 1 }))];
      const turns = [];
      parts.forEach(({ s, sub }) => s.turns.forEach((t) => turns.push({ t, sub })));
      if (!turns.length) continue;
      const est = (t) => Object.entries(t.mdl || {}).reduce((a, [m, v]) => a + weigh(v) * rate(family(m)), 0);
      const estTotal = turns.reduce((a, x) => a + est(x.t), 0);
      const rec = recorded(main);
      const scale = rec && estTotal ? rec / estTotal : 1;
      const tr = [];
      for (const { t, sub } of turns) {
        const tot = t.tok[0] + t.tok[1] + t.tok[2] + t.tok[3];
        if (!tot && !t.prompts) continue;
        tr.push([Math.round((t.ts || main.start || 0) / 1000), idx(areas, t.area), idx(types, t.type), t.tok[0], t.tok[1], t.tok[2], t.tok[3],
          Math.round(est(t) * scale * 1e5) / 1e5, t.corr, t.errs, t.edits, sub, t.prompts, t.rev || 0, t.text && t.kind === 'prompt' ? t.text.slice(0, 90) : '']);
      }
      parts.forEach(({ s }) => Object.entries(s.models).forEach(([m, v]) => {
        const k = m.replace(/-\d{8}$/, '').replace(/\[1m\]$/, '');
        const mm = models[k] || (models[k] = 0); models[k] = mm + v[0] + v[1] + v[2] + v[3];
      }));
      const edits = {};
      parts.forEach(({ s }) => Object.entries(s.edits || {}).forEach(([fp, n]) => { edits[fp] = (edits[fp] || 0) + n; }));
      const tools = {};
      parts.forEach(({ s }) => Object.entries(s.tools || {}).forEach(([k, n]) => { tools[k] = (tools[k] || 0) + n; }));
      const hot = Object.entries(edits).filter((e) => e[1] >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([fp, n]) => [fp.replace(HOME, '~'), n]);
      rows.push({
        id: S.sid, title: (main.title || main.first || 'Untitled').slice(0, 90), start: Math.round(main.start / 1000), end: Math.round(main.end / 1000),
        cost: rec ? 1 : 0, api: main.apiErrors, cmp: main.compactions, int: main.interrupts,
        la: Object.values(main.costRuns || {}).reduce((a, r) => a + r.a, 0), lr: Object.values(main.costRuns || {}).reduce((a, r) => a + r.r, 0),
        hot, tools: Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 12), t: tr,
      });
    }
    rows.sort((a, b) => b.end - a.end);
    const out = { v: VERSION, at: Math.round(Date.now() / 1000), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, areas, types, models, sessions: rows };
    const json = JSON.stringify(out);
    fs.writeFileSync(OUT_JSON, json);
    // one stylesheet per installed Claude Code extension (VS Code, Insiders, Cursor, VSCodium)
    const css = '.mkUsageData{--mk-usage:"' + Buffer.from(json).toString('base64') + '"}\n';
    let wrote = 0;
    for (const home of ['.vscode', '.vscode-insiders', '.cursor', '.vscode-oss']) {
      const ext = path.join(HOME, home, 'extensions');
      let names = [];
      try { names = fs.readdirSync(ext); } catch (e) { continue; }
      for (const n of names) {
        if (!n.startsWith('anthropic.claude-code-')) continue;
        const res = path.join(ext, n, 'resources');
        try { fs.mkdirSync(res, { recursive: true }); fs.writeFileSync(path.join(res, 'mk-usage.css'), css); wrote++; } catch (e) {}
      }
    }
    if (PRINT) console.log(`usage: ${files.length} transcripts (${parsed} parsed), ${rows.length} sessions, ${(json.length / 1024).toFixed(0)} KB, ${wrote} extension(s)`);
  } finally {
    try { fs.unlinkSync(LOCK); } catch (e) {}
  }
}
main().catch((e) => { try { fs.unlinkSync(LOCK); } catch (x) {} console.error(e && e.stack || e); process.exit(1); });

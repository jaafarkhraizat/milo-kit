// Milo Kit settings tab. Holds a draft of ~/.milo-kit/config.json; Save sends it to the extension.
(() => {
  const vscode = acquireVsCodeApi();
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const set = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; };

  const ROLES = [
    ['accent', 'Accent', 'Buttons, links, your avatar, headings'],
    ['editor', 'Editor background', 'Code area and panels'],
    ['side', 'Side bar background', 'Side bars, tab strip, status bar'],
    ['card', 'Card background', 'Chat, menus, popups, the active tab'],
    ['text', 'Text', 'Main text in the chat'],
    ['muted', 'Muted text', 'Labels, hints, timestamps'],
  ];
  const SPOTS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
  // Changes that only show after Custom UI Style reloads VS Code.
  const RELOAD = ['colors', 'corners', 'features', 'initials', 'avatar', 'status.yellow', 'status.red', 'status.usageOnly', 'fonts.ui', 'fonts.code'];

  let saved, draft, D;

  // App icon squircle: the same colors apply.js renders (the kit blue keeps its hand-picked pair).
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mixHex = (a, b, t) => '#' + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
  const iconColors = (a) => (a.toLowerCase() === '#3f74e0' ? ['#4a80ec', '#2f5bc0'] : [mixHex(a, '#ffffff', 0.07), mixHex(a, '#000000', 0.2)]);

  // ── flatten for diffing ──
  const flat = (o, pre = '', out = {}) => {
    for (const [k, v] of Object.entries(o)) {
      const p = pre ? pre + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, p, out);
      else out[p] = JSON.stringify(Array.isArray(v) ? [...v].sort() : v);
    }
    return out;
  };
  const changes = () => {
    const a = flat(saved), b = flat(draft);
    return Object.keys(b).filter((k) => a[k] !== b[k] && !k.startsWith('preset'));
  };

  // ── build dynamic parts ──
  function buildPresets() {
    $('#presets').innerHTML = '';
    for (const [id, p] of Object.entries(D.presets)) {
      const b = document.createElement('button');
      b.className = 'preset';
      b.dataset.preset = id;
      // Colors go through el.style: the panel's CSP blocks inline style="" attributes.
      b.innerHTML = `<div class="sw"></div><b>${p.label}</b><small>${p.note}</small>`;
      for (const r of ['side', 'editor', 'card', 'accent', 'text']) {
        const s = document.createElement('span');
        s.style.background = p[r];
        b.firstChild.appendChild(s);
      }
      b.onclick = () => {
        for (const [r] of ROLES) draft.colors[r] = p[r];
        draft.preset = id;
        render();
      };
      $('#presets').appendChild(b);
    }
  }
  function buildColors() {
    const box = $('#colors');
    box.innerHTML = '';
    for (const [role, label, help] of ROLES) {
      const row = document.createElement('div');
      row.className = 'row';
      const chips = role === 'accent'
        ? `<div class="chips">${Object.entries(D.swatches).map(([n, c]) => `<button class="chip" data-c="${c}" aria-label="${n}" title="${n}"></button>`).join('')}</div>`
        : '';
      row.innerHTML = `<div class="l"><b>${label}</b><small>${help}</small></div><div class="color">${chips}<input type="color" data-role="${role}" aria-label="${label}"><span class="hex"></span></div>`;
      box.appendChild(row);
    }
    $$('#colors .chip').forEach((c) => { c.style.background = c.dataset.c; });
    $$('#colors input[type=color]').forEach((i) => { i.oninput = () => { draft.colors[i.dataset.role] = i.value; render(); }; });
    $$('#colors .chip').forEach((c) => { c.onclick = () => { draft.colors.accent = c.dataset.c; render(); }; });
  }
  // Each pack's own fonts load once; failures leave the card with its name only.
  const loadedFonts = new Set();
  function loadFonts(list) {
    for (const t of list) for (const f of t.fonts || []) {
      if (loadedFonts.has(f.family)) continue;
      loadedFonts.add(f.family);
      new FontFace(f.family, `url("${f.url}")`).load().then((ff) => document.fonts.add(ff)).catch(() => {});
    }
  }
  function sampleRow(t) {
    const row = document.createElement('div');
    row.className = 'ico';
    if (t.id === 'none') {
      row.classList.add('names');
      row.textContent = 'app.ts  data.json';
      return row;
    }
    for (const s of t.icons || []) {
      let el;
      if (s.ch) {
        el = document.createElement('span');
        el.textContent = s.ch;
        el.style.fontFamily = `"${s.family}"`;
        if (s.color) el.style.color = s.color;
      } else if (s.mask) {
        el = document.createElement('span');
        el.className = 'mask';
        el.style.maskImage = el.style.webkitMaskImage = `url("${s.src}")`;
      } else {
        el = document.createElement('img');
        el.src = s.src;
        el.alt = '';
      }
      row.appendChild(el);
    }
    return row;
  }
  function buildCards(id, list, key) {
    const box = $(id);
    box.innerHTML = '';
    loadFonts(list);
    for (const t of list) {
      const b = document.createElement('button');
      b.className = 'card';
      b.dataset.v = t.id;
      b.innerHTML = `<b></b><small></small>`;
      b.querySelector('b').textContent = t.label;
      b.querySelector('small').textContent = t.note;
      if ((t.icons && t.icons.length) || t.id === 'none') b.prepend(sampleRow(t));
      b.onclick = () => { set(draft, key, t.id); render(); };
      box.appendChild(b);
    }
  }
  function buildAppIcons() {
    const box = $('#appIcons');
    box.innerHTML = '';
    const pv = D.appIcon || {};
    for (const [id, label, note] of [['milo', 'Milo', 'In your accent color'], ['stock', 'VS Code', 'The original icon']]) {
      const b = document.createElement('button');
      b.className = 'card';
      b.dataset.v = id;
      const tile = document.createElement('div');
      tile.className = 'appic';
      const img = (cls, src) => { const i = document.createElement('img'); i.className = cls; i.alt = ''; i.src = src; tile.appendChild(i); };
      if (id === 'milo') {
        const sq = document.createElement('div');
        sq.className = 'sq';
        tile.appendChild(sq);
        img('milo', pv.milo);
        if (pv.stock) img('badge', pv.stock);
      } else if (pv.stock) {
        img('stock', pv.stock);
      }
      b.append(tile);
      b.insertAdjacentHTML('beforeend', `<b>${label}</b><small>${note}</small>`);
      b.onclick = () => { draft.appIcon = id; render(); };
      box.appendChild(b);
    }
  }
  // Claude's avatar presets (images in ~/.milo-kit/avatars), then an upload tile.
  function buildAvatarGrid() {
    const list = D.avatarPresets || [];
    const box = $('#agGrid');
    box.hidden = !list.length;
    box.innerHTML = '';
    for (const p of list) {
      const b = document.createElement('button');
      b.dataset.id = p.id;
      b.title = p.label;
      b.setAttribute('aria-label', p.label);
      b.style.backgroundImage = `url("${p.data}")`;
      b.onclick = () => shrink(p.data).then((url) => {
        Object.assign(draft.avatar, { agent: 'image', agentImage: url, agentPreset: p.id });
        render();
      }, showError);
      box.appendChild(b);
    }
    const up = document.createElement('button');
    up.className = 'up';
    up.title = 'Upload your own';
    up.setAttribute('aria-label', 'Upload your own');
    up.textContent = '+';
    up.onclick = () => vscode.postMessage({ type: 'pickImage', who: 'agent' });
    box.appendChild(up);
  }
  function showError(err) {
    $('#changes').classList.add('err');
    $('#changes').textContent = err.message;
  }
  function buildSegs() {
    for (const s of $$('.seg[data-opts]')) {
      s.innerHTML = '';
      for (const pair of s.dataset.opts.split(',')) {
        const [v, label] = pair.split(':');
        const b = document.createElement('button');
        b.textContent = label;
        b.dataset.v = v;
        b.onclick = () => { set(draft, s.dataset.bind, 'num' in s.dataset ? Number(v) : v); render(); };
        s.appendChild(b);
      }
    }
    $('#spots').innerHTML = SPOTS.map((p) => `<button data-v="${p}" aria-label="${p.replace('-', ' ')}"></button>`).join('');
    $$('#spots button').forEach((b) => { b.onclick = () => { draft.scroll.position = b.dataset.v; render(); }; });
  }

  // ── wire static controls ──
  function wire() {
    $$('nav a').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        $$('nav a').forEach((x) => x.classList.toggle('on', x === a));
        $$('section').forEach((s) => s.classList.toggle('on', s.id === a.dataset.s));
        $('#main').scrollTop = 0;
        vscode.setState({ ...(vscode.getState() || {}), tab: a.dataset.s });
      };
    });
    $$('.tg[data-bind]').forEach((t) => { t.onclick = () => { set(draft, t.dataset.bind, !get(draft, t.dataset.bind)); render(); }; });
    $$('.tg[data-event]').forEach((t) => {
      t.onclick = () => {
        const e = t.dataset.event, ev = draft.scroll.events;
        draft.scroll.events = ev.includes(e) ? ev.filter((x) => x !== e) : [...ev, e];
        render();
      };
    });
    $$('select[data-bind]').forEach((s) => { s.onchange = () => { set(draft, s.dataset.bind, s.value); render(); }; });
    const clean = (v) => v.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase().slice(0, 3);
    $('#meText').oninput = () => { draft.initials = clean($('#meText').value); render(); };
    $('#agText').oninput = () => { draft.avatar.agentText = clean($('#agText').value); render(); };
    // The extension opens the file dialog and sends the file back; the page crops it here.
    $$('.pick').forEach((b) => { b.onclick = () => vscode.postMessage({ type: 'pickImage', who: b.dataset.who }); });
    // Choosing "Image" with no image yet opens the picker straight away.
    $$('.seg[data-bind^="avatar."] button').forEach((b) => {
      const choose = b.onclick;
      b.onclick = () => {
        const who = b.parentElement.dataset.bind === 'avatar.me' ? 'me' : 'agent';
        if (b.dataset.v === 'image' && !draft.avatar[who + 'Image']) vscode.postMessage({ type: 'pickImage', who });
        else choose();
      };
    });
    $('#save').onclick = save;
    $('#discard').onclick = () => { draft = clone(saved); render(); };
    // your initials and both avatars are personal: reset keeps them
    $('#reset').onclick = () => { const { initials, avatar } = draft; draft = clone(D.defaults); Object.assign(draft, { initials, avatar }); render(); };
    $('#test').onclick = () => vscode.postMessage({ type: 'testScroll', kind: 'complete' });
    $('#close').onclick = close;
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    });
  }

  // Unsaved changes are kept in the draft: closing asks first.
  function close() {
    vscode.postMessage({ type: 'close', unsaved: changes().length });
  }

  function save() {
    if (!changes().length) return;
    if (!draft.initials) draft.initials = saved.initials;
    if (!draft.avatar.agentText) draft.avatar.agentText = saved.avatar.agentText;
    $('#save').disabled = true;
    $('#save').textContent = 'Saving...';
    vscode.postMessage({ type: 'save', config: draft });
  }

  // Avatar image: centre square crop, 128 px (sharp at 2x for the 28 px account avatar), webp, png fallback.
  function shrink(src) {
    return new Promise((ok, bad) => {
      const im = new Image();
      im.onload = () => {
        const S = 128;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const w = im.naturalWidth || S, h = im.naturalHeight || S, side = Math.min(w, h);
        c.getContext('2d').drawImage(im, (w - side) / 2, (h - side) / 2, side, side, 0, 0, S, S);
        let url = c.toDataURL('image/webp', 0.9);
        if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
        ok(url);
      };
      im.onerror = () => bad(new Error("That file couldn't be read as an image. Try a PNG or JPEG."));
      im.src = src;
    });
  }

  // ── render everything from the draft ──
  function render() {
    const c = draft.colors;
    const root = document.documentElement.style;
    root.setProperty('--accent', c.accent);
    root.setProperty('--bg-editor', c.editor);
    root.setProperty('--bg-side', c.side);
    root.setProperty('--bg-card', c.card);
    root.setProperty('--fg', c.text);
    root.setProperty('--fg-2', c.muted);
    const scale = { sharp: 0.5, soft: 1, round: 1.5 }[draft.corners] || 1;
    root.setProperty('--radius', `${Math.round(12 * scale)}px`);
    root.setProperty('--r-sm', `${Math.max(3, Math.round(8 * scale))}px`);

    // presets: highlighted while the colors still match one
    const match = Object.entries(D.presets).find(([, p]) => ROLES.every(([r]) => p[r].toLowerCase() === c[r].toLowerCase()));
    draft.preset = match ? match[0] : 'custom';
    $$('.preset').forEach((b) => b.classList.toggle('on', b.dataset.preset === draft.preset));
    $$('#colors input[type=color]').forEach((i) => { i.value = c[i.dataset.role]; i.nextElementSibling.textContent = c[i.dataset.role]; });
    $$('#colors .chip').forEach((b) => b.classList.toggle('on', b.dataset.c.toLowerCase() === c.accent.toLowerCase()));

    $$('.seg[data-bind]').forEach((s) => {
      const v = String(get(draft, s.dataset.bind));
      $$('button', s).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    });
    // red must stay above yellow
    $$('.seg[data-bind="status.red"] button').forEach((b) => { b.disabled = Number(b.dataset.v) <= draft.status.yellow; });
    $$('.seg[data-bind="status.yellow"] button').forEach((b) => { b.disabled = Number(b.dataset.v) >= draft.status.red; });
    $$('.tg[data-bind]').forEach((t) => { const on = !!get(draft, t.dataset.bind); t.classList.toggle('on', on); t.setAttribute('aria-pressed', on); });
    $$('.tg[data-event]').forEach((t) => { const on = draft.scroll.events.includes(t.dataset.event); t.classList.toggle('on', on); t.setAttribute('aria-pressed', on); });
    $$('select[data-bind]').forEach((s) => { s.value = get(draft, s.dataset.bind); });
    $$('#productIcons .card').forEach((b) => b.classList.toggle('on', b.dataset.v === draft.icons.product));
    $$('#fileIcons .card').forEach((b) => b.classList.toggle('on', b.dataset.v === draft.icons.file));
    $$('#appIcons .card').forEach((b) => b.classList.toggle('on', b.dataset.v === draft.appIcon));
    const [icTop, icBottom] = iconColors(c.accent);
    root.setProperty('--ic-top', icTop);
    root.setProperty('--ic-bottom', icBottom);
    $$('#spots button').forEach((b) => b.classList.toggle('on', b.dataset.v === draft.scroll.position));
    $$('.dep').forEach((d) => d.classList.toggle('off', !get(draft, d.dataset.dep)));
    const av = draft.avatar;
    if (document.activeElement !== $('#meText')) $('#meText').value = draft.initials;
    if (document.activeElement !== $('#agText')) $('#agText').value = av.agentText;
    $('#meText').hidden = av.me !== 'text';
    $('#mePick').hidden = av.me !== 'image';
    $('#agText').hidden = av.agent !== 'text';
    // with presets, the grid's own upload tile replaces the Choose button
    const grid = (D.avatarPresets || []).length > 0;
    $('#agPick').hidden = av.agent !== 'image' || grid;
    for (const [who, el] of [['me', '#mePick'], ['agent', '#agPick']]) {
      const src = av[who + 'Image'];
      $('.thumb', $(el)).style.backgroundImage = src ? `url("${src}")` : '';
      $('.pl', $(el)).textContent = src ? 'Change' : 'Choose';
    }
    const agImage = av.agent === 'image';
    $$('#agGrid button[data-id]').forEach((b) => b.classList.toggle('on', agImage && b.dataset.id === av.agentPreset));
    const up = $('#agGrid .up');
    const uploaded = agImage && !av.agentPreset && av.agentImage;
    up.classList.toggle('on', !!uploaded);
    up.style.backgroundImage = uploaded ? `url("${av.agentImage}")` : '';

    // preview
    const pvMe = $('#pvInitials'), pvAg = $('.av.cl');
    const meImg = av.me === 'image' && av.meImage, agImg = av.agent === 'image' && av.agentImage;
    pvMe.textContent = meImg ? '' : draft.initials || saved.initials;
    pvMe.classList.toggle('img', !!meImg);
    pvMe.style.backgroundImage = meImg ? `url("${meImg}")` : '';
    pvAg.textContent = av.agent === 'text' ? av.agentText : '';
    pvAg.classList.toggle('txt', av.agent === 'text');
    pvAg.classList.toggle('img', !!agImg);
    pvAg.style.backgroundImage = agImg ? `url("${agImg}")` : '';
    $('#pvInitials').classList.toggle('hide', !draft.features.avatars);
    $('#pvMap').classList.toggle('hide', !draft.features.map);
    $('#pvScroll').classList.toggle('off', !draft.scroll.enabled);
    const pctShown = 84;
    $('#pvUsage').textContent = `Claude ${pctShown}%`;
    $('#pvBar').classList.toggle('hide', !draft.status.progressBar);
    root.setProperty('--usage', pctShown >= draft.status.red ? '#e06c75' : pctShown >= draft.status.yellow ? '#e5c07b' : c.accent);

    // footer
    const ch = changes();
    const needsReload = ch.some((k) => RELOAD.some((r) => k === r || k.startsWith(r + '.')));
    $('#changes').classList.remove('err');
    $('#changes').innerHTML = ch.length
      ? `<b>${ch.length} ${ch.length === 1 ? 'change' : 'changes'}.</b> ${needsReload ? 'VS Code reloads to apply them.' : 'They apply right away.'}`
      : 'No changes';
    $('#save').disabled = !ch.length;
    $('#discard').disabled = !ch.length;
    $('#save').textContent = needsReload ? 'Save and reload' : 'Save';
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'init') {
      D = m;
      saved = clone(m.config);
      draft = clone(m.config);
      $('#ver').textContent = 'v' + m.version;
      buildPresets();
      buildColors();
      buildCards('#productIcons', m.themes.product, 'icons.product');
      buildCards('#fileIcons', m.themes.file, 'icons.file');
      buildAppIcons();
      buildSegs();
      buildAvatarGrid();
      wire();
      if (!m.mac) { $('#scrollNote').hidden = false; $('#scrollBody').hidden = true; $('#appIconNote').hidden = false; $('#appIcons').hidden = true; }
      const tab = (vscode.getState() || {}).tab;
      if (tab) { const a = $(`nav a[data-s="${tab}"]`); if (a) a.click(); }
      $('#loading').remove();
      $('#app').hidden = false;
      render();
    } else if (m.type === 'saved') {
      saved = clone(m.config);
      draft = clone(m.config);
      render();
      $('#changes').innerHTML = '<b>Saved.</b>';
    } else if (m.type === 'image') {
      shrink(m.data).then((url) => {
        draft.avatar[m.who + 'Image'] = url;
        draft.avatar[m.who] = 'image';
        if (m.who === 'agent') draft.avatar.agentPreset = '';
        render();
      }, showError);
    } else if (m.type === 'error') {
      render();
      $('#changes').classList.add('err');
      $('#changes').textContent = m.message;
    }
  });

  vscode.postMessage({ type: 'init' });
})();

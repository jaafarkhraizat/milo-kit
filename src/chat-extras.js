// Milo Kit: extras injected into Claude Code's chat webview (webview/index.js patch).
// Built into settings.jsonc by scripts/build-chat-extras.js. Styles live in the webview stylesheet (.mk*).
// Rule: no dollar signs in this file (it is used as a String.replace replacement).
;(() => {
  if (window.__mkChat) return;
  window.__mkChat = 1;
  const root = document.documentElement;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const isChatScroller = (el) => el instanceof Element && typeof el.className === 'string' && el.className.indexOf('messagesContainer_') >= 0;

  const css = document.createElement('style');
  css.textContent = '@keyframes mkFade{from{opacity:0}to{opacity:1}}@keyframes mkIn{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}@keyframes mkCount{from{transform:scaleX(1)}to{transform:scaleX(0)}}@keyframes mkRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes mkPulse{0%,100%{box-shadow:0 0 0 0 rgba(130,169,245,.55)}50%{box-shadow:0 0 0 4px rgba(130,169,245,0)}}@keyframes mkSpin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion: reduce){html[data-mk-reveal] [data-mk-stuck]{transition:none!important}[data-mk-stuck],.mkMcpAv,.mkPanel,.mkHeld,.mkThumb,.mkMap,.mkTick,.mkAgents>i,.mkHeldMeta span::before{animation:none!important}}';
  document.head.appendChild(css);

  // 1. Usage in the chat header: the chat webview never asks for it, so ask on load and every 2 minutes.
  const askUsage = () => { try { const c = window.__ccConn; if (c && c.requestUsageUpdate) Promise.resolve(c.requestUsageUpdate()).catch(() => {}); } catch (e) {} };
  [1500, 5000, 15000].forEach((t) => setTimeout(askUsage, t));
  setInterval(askUsage, 120000);
  // show the last numbers we saw until fresh ones arrive (new chats often have none yet)
  function keepUsage() {
    const u = q('.ccUsage');
    if (!u) return;
    const html = u.innerHTML.trim();
    if (html && html !== u.dataset.mkShown) { delete u.dataset.mkCached; store.set('mkUsage', html); }
    if (!html) {
      const cached = store.get('mkUsage');
      if (cached) { u.innerHTML = cached; u.dataset.mkCached = '1'; u.dataset.mkShown = cached; }
    }
  }
  setInterval(keepUsage, 2000);

  // 2. Prompt reveal: scroll up a little to pin the current prompt, scroll down to let it go.
  const lastY = new WeakMap();
  let drift = 0;
  document.addEventListener('scroll', (e) => {
    const c = e.target;
    if (!isChatScroller(c)) return;
    const y = c.scrollTop, prev = lastY.get(c);
    lastY.set(c, y);
    if (prev !== undefined) {
      const d = y - prev;
      if (d && Math.sign(d) !== Math.sign(drift)) drift = 0;
      drift += d;
      if (drift < -12) reveal(c, true);
      else if (drift > 12 || c.scrollHeight - y - c.clientHeight < 4) reveal(c, false);
    }
    if (mapOpen) paintView();
  }, true);

  // Enter: 240 ms slide down from behind the top edge (ease-out). Exit: 160 ms slide back up (ease-in), then unpin.
  // CSS transitions, so a reversal mid-flight carries on from the current frame. The pinned copy is re-measured
  // on exit too (scrolling up can pin an earlier prompt). Reduced-motion users get an instant switch.
  let revealTimer = 0;
  function markStuck(c) {
    const top = c.getBoundingClientRect().top;
    const stuck = [];
    qa('[class*="message_"][class*="stickyHeader_"]', c).forEach((el) => {
      const r = el.getBoundingClientRect();
      // measure the resting spot: take out the copy's own slide (mid-animation it sits up to its full height higher)
      let lift = 0;
      try { lift = new DOMMatrix(getComputedStyle(el).transform).m42; } catch (e) {}
      const dy = r.top - lift - top;
      const on = dy > -2 && dy < 2 && r.bottom - lift > top + 4;
      el.toggleAttribute('data-mk-stuck', on);
      if (on) stuck.push(el);
    });
    return stuck;
  }
  function reveal(c, on) {
    const state = root.getAttribute('data-mk-reveal');
    if (on) {
      if (state === 'in') return;
      clearTimeout(revealTimer);
      if (state !== 'out') {
        // pin with the copy at its start position, commit that style, then let it ease in
        root.setAttribute('data-mk-reveal', 'pre');
        markStuck(c).forEach((el) => getComputedStyle(el).opacity);
      } else markStuck(c);
      root.setAttribute('data-mk-reveal', 'in');
      return;
    }
    if (state !== 'in') return;
    markStuck(c);
    root.setAttribute('data-mk-reveal', 'out');
    revealTimer = setTimeout(() => {
      if (root.getAttribute('data-mk-reveal') !== 'out') return;
      root.removeAttribute('data-mk-reveal');
      qa('[data-mk-stuck]').forEach((el) => el.removeAttribute('data-mk-stuck'));
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 170);
  }

  // 3. Click a collapsed message to expand it (same as pressing "Show more").
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element) || t.closest('button, a, input, textarea')) return;
    const box = t.closest('[class*="expandableContainer_"]');
    if (!box || !q('[class*="collapsed_"]', box) || String(getSelection() || '').length) return;
    const more = q('[class*="expandButton_"]', box);
    if (!more) return;
    e.preventDefault();
    e.stopPropagation();
    more.click();
  }, true);

  // 4. Chat map: a minimap of the whole conversation on the right. Collapsed by default.
  const MAP_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M5 3H19C20.1046 3 21 3.89543 21 5V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3ZM5 5V19H19V5H5ZM7 7H12V8.5H7V7ZM9 10H14V11.5H9V10ZM7 13H12V14.5H7V13ZM9 16H13V17.5H9V16ZM16 6.5H17.5V12H16V6.5Z"/></svg>';
  let mapOpen = store.get('mkMapOpen') === '1';
  let map = null, track = null, view = null, tip = null, scale = 1, prompts = [];
  root.toggleAttribute('data-mk-map', mapOpen);

  const scroller = () => q('[class*="messagesContainer_"]');

  function setOpen(v) {
    mapOpen = v;
    store.set('mkMapOpen', v ? '1' : '0');
    root.toggleAttribute('data-mk-map', v);
    syncToggle();
    schedule();
  }

  function syncToggle() {
    const usage = q('.ccUsage');
    const header = usage && usage.parentElement;
    if (!header) return;
    let b = q('.mkMapToggle', header);
    if (!b) {
      // own styles (not a copy of Bookmarks' class): Bookmarks is absent when the session has no bookmark host
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'mkMapToggle';
      b.innerHTML = MAP_ICON;
      b.addEventListener('click', () => setOpen(!mapOpen));
      header.appendChild(b);
    }
    const label = mapOpen ? 'Hide chat map' : 'Show chat map';
    b.setAttribute('aria-pressed', mapOpen ? 'true' : 'false');
    b.setAttribute('aria-label', label);
    b.title = label;
  }

  function ensureMap(c) {
    const host = c.parentElement;
    if (map && host.contains(map)) return host;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    map = document.createElement('div');
    map.className = 'mkMap';
    map.setAttribute('role', 'navigation');
    map.setAttribute('aria-label', 'Chat map');
    map.innerHTML = '<div class="mkMapTrack"></div><div class="mkMapView"></div><div class="mkMapTip" hidden></div>';
    track = map.children[0]; view = map.children[1]; tip = map.children[2];
    host.appendChild(map);
    let dragging = false;
    const toScroll = (ev) => {
      const s = scroller(); if (!s) return;
      const y = ev.clientY - track.getBoundingClientRect().top;
      s.scrollTop = y / scale - s.clientHeight / 2;
    };
    map.addEventListener('pointerdown', (ev) => { dragging = true; map.setPointerCapture(ev.pointerId); toScroll(ev); ev.preventDefault(); });
    map.addEventListener('pointerup', (ev) => { dragging = false; map.releasePointerCapture(ev.pointerId); });
    map.addEventListener('pointermove', (ev) => {
      if (dragging) { toScroll(ev); tip.hidden = true; return; }
      const bar = ev.target instanceof Element && ev.target.closest('.mkMapTrack > i.u');
      if (!bar) { tip.hidden = true; return; }
      tip.textContent = prompts[Number(bar.dataset.i)] || '';
      tip.style.top = (ev.clientY - map.getBoundingClientRect().top) + 'px';
      tip.hidden = !tip.textContent;
    });
    map.addEventListener('pointerleave', () => { tip.hidden = true; });
    return host;
  }

  function paintView() {
    const s = scroller();
    if (!map || !s) return;
    view.style.top = (6 + s.scrollTop * scale) + 'px';
    view.style.height = Math.max(8, s.clientHeight * scale) + 'px';
  }

  function build() {
    syncToggle();
    const s = scroller();
    if (!mapOpen || !s) { if (map) map.hidden = true; return; }
    const host = ensureMap(s);
    map.hidden = false;
    const composer = q('[class*="inputContainer_"][data-permission-mode]');
    const hr = host.getBoundingClientRect();
    map.style.bottom = (composer ? Math.max(16, hr.bottom - composer.getBoundingClientRect().top + 12) : 16) + 'px';
    const H = track.clientHeight;
    scale = H / Math.max(s.scrollHeight, 1);
    const top0 = s.getBoundingClientRect().top - s.scrollTop;
    const frag = document.createDocumentFragment();
    prompts = [];
    qa('[class^="userMessage_"], [class*=" userMessage_"], [class*="timelineMessage_"]', s).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.height) return;
      const user = /(^| )userMessage_/.test(el.className);
      const bar = document.createElement('i');
      bar.className = user ? 'u' : (q('[class*="toolBody_"]', el) ? 't' : 'a');
      bar.style.top = ((r.top - top0) * scale) + 'px';
      bar.style.height = Math.max(user ? 3 : 1.5, r.height * scale) + 'px';
      if (user) { bar.dataset.i = String(prompts.length); prompts.push(el.textContent.trim().replace(/\s+/g, ' ').slice(0, 280)); }
      frag.appendChild(bar);
    });
    track.replaceChildren(frag);
    paintView();
  }

  // 5. Messages sent while Claude is busy appear straight in the chat, slightly greyed, with Edit and Delete.
  //    They go to Claude after 5 quiet seconds (no timer shown). Editing holds them until you save.
  //    Once sent they stay greyed ("Waiting for Claude") until Claude's own copy shows up, then they swap out.
  const HOLD_MS = 5000;
  const EDIT_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M15.7279 9.57627L14.3137 8.16206L5 17.4758V18.89H6.41421L15.7279 9.57627ZM17.1421 8.16206L18.5563 6.74785L17.1421 5.33363L15.7279 6.74785L17.1421 8.16206ZM7.24264 20.89H3V16.6473L16.435 3.21231C16.8256 2.82179 17.4587 2.82179 17.8492 3.21231L20.6777 6.04074C21.0682 6.43126 21.0682 7.06443 20.6777 7.45495L7.24264 20.89Z"/></svg>';
  const DELETE_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M17 6H22V8H20V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V8H2V6H7V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6ZM18 8H6V20H18V8ZM9 11H11V17H9V11ZM13 11H15V17H13V11ZM9 4V6H15V4H9Z"/></svg>';
  const held = new Map();
  let bypass = false, seq = 0, lastKeyAt = 0, sending = false;
  const composerInput = () => q('[role="textbox"][aria-label="Message input"]');
  const isBusy = () => !!q('[class*="sendButton_"][data-mk-busy="1"]');
  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const norm = (t) => String(t).replace(/\s+/g, ' ').trim();
  const setInput = (box, text) => {
    box.textContent = text;
    box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  };
  const nativeCopies = (text) => qa('[class^="userMessage_"], [class*=" userMessage_"]').filter((el) => norm(el.textContent) === norm(text)).length;

  document.addEventListener('keydown', (e) => {
    const box = e.target;
    if (!(box instanceof Element) || box.getAttribute('aria-label') !== 'Message input') return;
    lastKeyAt = Date.now();
    if (bypass || e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing || e.keyCode === 229) return;
    if (!isBusy() || box.getAttribute('aria-activedescendant')) return;
    const fieldset = box.closest('fieldset');
    if (fieldset && q('img, [class*="ttachment"], [class*="humbnail"]', fieldset)) return; // attachments: let Claude handle it
    const text = box.innerText.trimEnd();
    if (!text.trim()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setInput(box, '');
    hold(text);
  }, true);

  // any normal send: follow it to the bottom of the chat
  document.addEventListener('keydown', (e) => {
    const box = e.target;
    if (!(box instanceof Element) || box.getAttribute('aria-label') !== 'Message input') return;
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing || e.keyCode === 229 || box.getAttribute('aria-activedescendant')) return;
    [60, 300, 800].forEach((t) => setTimeout(() => { const s = scroller(); if (s) s.scrollTop = s.scrollHeight; }, t));
  }, true);

  // right after the last real message (before Claude's bottom spacer), so it sits in the chat like a sent one
  function placeHeld(item, first) {
    const s = scroller();
    if (!s) return;
    let last = null;
    for (const k of Array.from(s.children)) {
      if (k.classList.contains('mkHeld')) continue;
      if ((k.matches && k.matches('[class*="message_"], [class*="turn_"], [class*="timelineMessage_"]')) || q('[class*="message_"], [class*="timelineMessage_"]', k)) last = k;
    }
    const heldAfter = (n) => { let x = n; while (x && x.nextElementSibling && x.nextElementSibling.classList.contains('mkHeld') && x.nextElementSibling !== item.el) x = x.nextElementSibling; return x; };
    const anchor = last ? heldAfter(last) : null;
    const ref = anchor ? anchor.nextSibling : s.firstChild;
    if (item.el.previousElementSibling !== anchor || item.el.parentElement !== s) s.insertBefore(item.el, ref);
    if (first) toBottom(s);
  }
  function toBottom(s) {
    s.scrollTop = s.scrollHeight;
    requestAnimationFrame(() => { s.scrollTop = s.scrollHeight; });
  }
  let myInitials = null;
  const initials = () => {
    if (myInitials !== null) return myInitials;
    const av = q('[class*="userMessageContainer_"] > [class*="userMessageContainer_"]');
    const c = av ? getComputedStyle(av, '::before').content : '';
    myInitials = c && c !== 'none' && c !== 'normal' ? c.replace(/^["']|["']/g, '') : '';
    return myInitials;
  };

  function hold(text) {
    const item = { id: ++seq, text, due: Date.now() + HOLD_MS, editing: false, sent: false, el: document.createElement('div') };
    item.el.className = 'mkHeld';
    held.set(item.id, item);
    paintHeld(item);
    placeHeld(item, true);
  }
  window.__mkHold = hold;

  function iconButton(icon, label, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon;
    b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
    return b;
  }

  function paintHeld(item) {
    const el = item.el;
    el.dataset.state = item.sent ? 'sent' : item.editing ? 'editing' : 'held';
    el.replaceChildren();
    const row = document.createElement('div');
    row.className = 'mkHeldRow';
    const av = document.createElement('i');
    av.className = 'mkHeldAv';
    av.textContent = initials();
    av.hidden = !av.textContent;
    const bubble = document.createElement('div');
    bubble.className = 'mkHeldBubble';
    row.append(av, bubble);
    el.appendChild(row);
    if (item.editing) {
      const ta = document.createElement('textarea');
      ta.value = item.text;
      ta.rows = Math.min(8, Math.max(1, item.text.split('\n').length));
      ta.setAttribute('aria-label', 'Edit message');
      ta.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); save(item, ta.value); }
        else if (ev.key === 'Escape') { ev.preventDefault(); save(item, item.text); }
      });
      bubble.appendChild(ta);
      const hint = document.createElement('div');
      hint.className = 'mkHeldMeta';
      hint.textContent = 'Enter to save, Esc to cancel';
      el.appendChild(hint);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
      return;
    }
    bubble.textContent = item.text;
    const metaRow = document.createElement('div');
    metaRow.className = 'mkHeldMeta';
    const label = document.createElement('span');
    label.textContent = item.sent ? 'Waiting for Claude' : 'Not sent yet';
    metaRow.appendChild(label);
    if (!item.sent) {
      metaRow.appendChild(iconButton(EDIT_ICON, 'Edit message', () => { item.editing = true; paintHeld(item); }));
      metaRow.appendChild(iconButton(DELETE_ICON, 'Delete message', () => drop(item)));
    }
    el.appendChild(metaRow);
  }

  function save(item, text) {
    if (!text.trim()) return drop(item);
    item.text = text.trimEnd();
    item.editing = false;
    item.due = Date.now() + HOLD_MS;
    paintHeld(item);
  }

  function drop(item) {
    held.delete(item.id);
    item.el.remove();
  }

  async function tick() {
    // sent items leave once Claude's own copy of the message is in the chat (or after 10 minutes)
    held.forEach((item) => {
      if (item.sent && (nativeCopies(item.text) > item.copiesBefore || Date.now() - item.sentAt > 600000)) drop(item);
      else placeHeld(item, false);
    });
    if (sending) return;
    const next = Array.from(held.values()).find((i) => !i.sent && !i.editing && i.due <= Date.now());
    if (!next) return;
    const box = composerInput();
    if (!box) return;
    if (Date.now() - lastKeyAt < 800 && document.activeElement === box) return; // you are typing: wait a moment
    sending = true;
    const stash = box.innerText.trimEnd();
    next.copiesBefore = nativeCopies(next.text);
    bypass = true;
    try {
      setInput(box, next.text);
      await frame(); await frame();
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      await frame(); await frame();
      const left = box.innerText.trimEnd();
      if (left.trim() === next.text.trim()) { // not sent: give it back for editing
        setInput(box, stash);
        next.due = Date.now() + HOLD_MS;
      } else {
        next.sent = true;
        next.sentAt = Date.now();
        paintHeld(next);
        if (stash.trim()) setInput(box, stash);
      }
    } finally {
      bypass = false;
      sending = false;
    }
  }
  setInterval(tick, 200);

  // 6. Agents and tasks: an always-on agents chip in the message box, a quiet tasks badge in the header,
  //    and one details panel for both. Data comes from the session the send-button patch exposes (window.__mkS).
  const AGENT_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M13.5 2C13.5 2.44425 13.3069 2.84339 13 3.11805V5H18C19.6569 5 21 6.34315 21 8V18C21 19.6569 19.6569 21 18 21H6C4.34315 21 3 19.6569 3 18V8C3 6.34315 4.34315 5 6 5H11V3.11805C10.6931 2.84339 10.5 2.44425 10.5 2C10.5 1.17157 11.1716 0.5 12 0.5C12.8284 0.5 13.5 1.17157 13.5 2ZM6 7C5.44772 7 5 7.44772 5 8V18C5 18.5523 5.44772 19 6 19H18C18.5523 19 19 18.5523 19 18V8C19 7.44772 18.5523 7 18 7H13H11H6ZM2 10H0V16H2V10ZM22 10H24V16H22V10ZM9 14.5C9.82843 14.5 10.5 13.8284 10.5 13C10.5 12.1716 9.82843 11.5 9 11.5C8.17157 11.5 7.5 12.1716 7.5 13C7.5 13.8284 8.17157 14.5 9 14.5ZM15 14.5C15.8284 14.5 16.5 13.8284 16.5 13C16.5 12.1716 15.8284 11.5 15 11.5C14.1716 11.5 13.5 12.1716 13.5 13C13.5 13.8284 14.1716 14.5 15 14.5Z"/></svg>';
  const TASK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8.00008 6V9H5.00008V6H8.00008ZM3.00008 4V11H10.0001V4H3.00008ZM13.0001 4H21.0001V6H13.0001V4ZM13.0001 11H21.0001V13H13.0001V11ZM13.0001 18H21.0001V20H13.0001V18ZM10.7072 16.2071L9.29297 14.7929L6.00008 18.0858L4.20718 16.2929L2.79297 17.7071L6.00008 20.9142L10.7072 16.2071Z"/></svg>';
  const STATE_LABEL = { working: 'Working', waiting: 'Needs you', finished: 'Done', failed: 'Failed', stopped: 'Stopped', running: 'Running', completed: 'Done' };
  let panel = null, panelAnchor = null;

  // Tasks from Claude Code's task tools (TaskCreate / TaskUpdate), rebuilt from the conversation.
  // The chat itself only tracks the older TodoWrite list. Cached until the message list changes.
  let taskCache = { key: '', list: [] };
  function toolTasks(s) {
    let msgs = [];
    try { msgs = (s.messages && s.messages.value) || []; } catch (e) {}
    const key = msgs.length + ':' + (msgs.length ? String(msgs[msgs.length - 1] && msgs[msgs.length - 1].uuid) : '');
    if (key === taskCache.key) return taskCache.list;
    const uses = [], results = new Map(), seen = new Set();
    const textOf = (o, depth) => {
      if (!o || depth > 5) return '';
      if (typeof o === 'string') return o;
      if (Array.isArray(o)) return o.map((x) => textOf(x, depth + 1)).join(' ');
      if (typeof o === 'object') return (typeof o.text === 'string' ? o.text : '') + ' ' + textOf(o.content, depth + 1);
      return '';
    };
    const visit = (o, depth, owner) => {
      if (!o || typeof o !== 'object' || depth > 7 || seen.has(o)) return;
      seen.add(o);
      if (Array.isArray(o)) { o.forEach((x) => visit(x, depth + 1, owner)); return; }
      if (o.type === 'tool_use' && (o.name === 'TaskCreate' || o.name === 'TaskUpdate') && o.input) { uses.push(o); owner = o.id; }
      if (o.type === 'tool_result' && o.tool_use_id) results.set(o.tool_use_id, textOf(o.content, 0));
      if (o.toolResult && typeof o.toolResult === 'object' && 'value' in o.toolResult && (owner || (o.content && o.content.id))) {
        const id = owner || o.content.id;
        if (!results.has(id)) results.set(id, textOf(o.toolResult.value, 0));
      }
      for (const k in o) { if (k === 'data' || k === 'text' || k === 'toolResult') continue; const v = o[k]; if (v && typeof v === 'object') visit(v, depth + 1, owner); }
    };
    msgs.forEach((m) => visit(m, 0, null));
    const tasks = new Map();
    let n = 0;
    uses.forEach((u) => {
      const i = u.input;
      if (u.name === 'TaskCreate') {
        const m = /#\s*(\d+)/.exec(results.get(u.id) || '');
        tasks.set(m ? m[1] : 'new' + ++n, { content: i.subject || i.description || 'Task', activeForm: i.activeForm, status: 'pending' });
      } else {
        const id = String(i.taskId || '');
        const t = tasks.get(id);
        if (!t) return;
        if (i.status === 'deleted') { tasks.delete(id); return; }
        if (i.status) t.status = i.status;
        if (i.subject) t.content = i.subject;
        if (i.activeForm) t.activeForm = i.activeForm;
      }
    });
    taskCache = { key, list: Array.from(tasks.values()) };
    return taskCache.list;
  }

  function snapshot() {
    const s = window.__mkS;
    if (!s) return { agents: [], todos: [], jobs: [] };
    const val = (sig, fb) => { try { const v = sig && sig.value; return v === undefined || v === null ? fb : v; } catch (e) { return fb; } };
    const waitingIds = new Set();
    try { const pr = val(s.permissionRequests, []); (Array.isArray(pr) ? pr : Array.from(pr.values ? pr.values() : [])).forEach((r) => { if (r && r.agentId) waitingIds.add(r.agentId); }); } catch (e) {}
    const agents = Array.from(val(s.agentMapAgents, new Map()).values()).map((a) => ({
      name: a.description || a.subagentType || 'Agent', kind: a.subagentType || '',
      state: a.status === 'working' && waitingIds.has(a.taskId) ? 'waiting' : a.status,
      start: a.startTime, end: a.endTime,
    }));
    const listed = val(s.todos, []) || [];
    const todos = (listed.length ? listed : toolTasks(s)).map((t) => ({ text: t.status === 'in_progress' ? (t.activeForm || t.content) : t.content, state: t.status }));
    const jobs = Array.from(val(s.backgroundTasks, new Map()).values()).map((b) => ({
      name: b.description || b.command || b.taskType || 'Background task', state: b.status || 'running', start: b.startTime, end: b.endTime,
    }));
    return { agents, todos, jobs };
  }
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  // rewrite only on change: every write is a DOM mutation, and needless ones cost layout while you scroll
  const setHtml = (el, html) => { if (el.__mkHtml !== html) { el.__mkHtml = html; el.innerHTML = html; } };
  const ago = (start, end) => {
    if (!start) return '';
    const s = Math.max(0, Math.round(((end || Date.now()) - start) / 1000));
    return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  };

  function syncAgents() {
    const d = snapshot();
    const working = d.agents.filter((a) => a.state === 'working' || a.state === 'waiting').length;
    const waiting = d.agents.some((a) => a.state === 'waiting');
    const doneTodos = d.todos.filter((t) => t.state === 'completed').length;
    const jobsRunning = d.jobs.filter((j) => j.state === 'running').length;

    // agents chip, left of the mode button in the message box footer
    const mode = q('[class*="footerButtonPrimary_"][title*="Shift+Tab"]');
    const footer = mode && mode.closest('[class*="inputFooterV2_"]');
    if (footer) {
      let chip = q('.mkAgents', footer);
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'mkAgents';
        chip.addEventListener('click', (e) => { e.preventDefault(); togglePanel(chip); });
        const holder = mode.parentElement && mode.parentElement !== footer ? mode.parentElement : mode;
        holder.parentElement.insertBefore(chip, holder);
      }
      chip.dataset.state = waiting ? 'waiting' : working ? 'working' : 'idle';
      setHtml(chip, AGENT_ICON + '<i></i><span>' + plural(working, 'agent') + '</span>');
      chip.disabled = !working;
      chip.title = working ? plural(working, 'agent') + ' running. Click for details' : 'No agents running';
    }

    // tasks badge next to the usage in the chat header (only when there is something to show)
    const usage = q('.ccUsage');
    const header = usage && usage.parentElement;
    if (header) {
      let badge = q('.mkTasks', header);
      if (!badge) {
        badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'mkTasks';
        badge.addEventListener('click', () => togglePanel(badge));
        usage.after(badge);
      }
      if (badge) {
        const bits = [d.todos.length ? doneTodos + '/' + d.todos.length + ' tasks' : '0 tasks', plural(working, 'agent')];
        if (jobsRunning) bits.push(plural(jobsRunning, 'job'));
        badge.dataset.state = waiting ? 'waiting' : working || jobsRunning ? 'working' : 'idle';
        setHtml(badge, TASK_ICON + '<span>' + bits.join(' · ') + '</span>');
        const openTodos = d.todos.length - doneTodos;
        badge.disabled = !(openTodos || working || jobsRunning);
        badge.title = badge.disabled ? 'Nothing running' : 'Tasks and agents. Click for details';
      }
    }
    if (panel && !panel.hidden) { if (panelAnchor && panelAnchor.disabled) panel.hidden = true; else paintPanel(d); }
  }

  function togglePanel(anchor) {
    if (panel && !panel.hidden && panelAnchor === anchor) { panel.hidden = true; return; }
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'mkPanel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Tasks and agents');
      document.body.appendChild(panel);
      document.addEventListener('pointerdown', (e) => {
        if (panel.hidden || panel.contains(e.target) || (panelAnchor && panelAnchor.contains(e.target))) return;
        panel.hidden = true;
      }, true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) panel.hidden = true; });
    }
    panelAnchor = anchor;
    panel.hidden = false;
    paintPanel(snapshot());
  }

  let panelSig = '';
  function paintPanel(d) {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const live = (st) => st === 'working' || st === 'waiting' || st === 'running';
    const order = { waiting: 0, working: 1, running: 1, failed: 2, stopped: 3, finished: 4, completed: 4 };
    const agents = d.agents.slice().sort((a, b) => (order[a.state] ?? 5) - (order[b.state] ?? 5) || (b.start || 0) - (a.start || 0));
    const sig = JSON.stringify([d.todos, agents.map((a) => [a.name, a.kind, a.state]), d.jobs.map((j) => [j.name, j.state])]);
    if (sig === panelSig && panel.firstChild) {
      qa('[data-start]', panel).forEach((el) => { el.textContent = ago(Number(el.dataset.start), Number(el.dataset.end) || 0); });
      return place();
    }
    panelSig = sig;
    const done = d.todos.filter((t) => t.state === 'completed').length;
    const working = agents.filter((a) => live(a.state)).length;
    const waiting = agents.some((a) => a.state === 'waiting');
    const time = (x) => (x.start ? '<time data-start="' + x.start + '" data-end="' + (live(x.state) ? 0 : x.end || 0) + '">' + ago(x.start, live(x.state) ? 0 : x.end) + '</time>' : '');
    const pill = (st, label) => '<b class="mkState" data-state="' + esc(st) + '">' + esc(label || STATE_LABEL[st] || st) + '</b>';
    let h = '<header><div class="mkPHead"><strong>Tasks and agents</strong>' +
      (waiting ? pill('waiting', 'Needs you') : working ? pill('working', plural(working, 'agent') + ' working') : pill('idle', 'Idle')) + '</div>';
    if (d.todos.length) {
      const pct = Math.round((done / d.todos.length) * 100);
      h += '<div class="mkProgress"><span>' + done + ' of ' + plural(d.todos.length, 'task') + ' done</span><em>' + pct + '%</em></div><div class="mkBar"><i style="width:' + pct + '%"></i></div>';
    }
    h += '</header>';
    if (d.todos.length) {
      h += '<section><h4>Tasks</h4><ul class="mkTasksList">';
      d.todos.forEach((t) => {
        h += '<li data-state="' + esc(t.state) + '"><i class="mkTick" data-state="' + esc(t.state) + '"></i><span>' + esc(t.text) + '</span>' + (t.state === 'in_progress' ? '<small>Now</small>' : '') + '</li>';
      });
      h += '</ul></section>';
    }
    if (agents.length) {
      h += '<section><h4>Agents<small>' + working + ' of ' + agents.length + ' active</small></h4><ul class="mkAgentList">';
      agents.forEach((a) => {
        const kind = a.kind && a.kind !== a.name ? esc(a.kind) : '';
        h += '<li data-state="' + esc(a.state) + '"><span class="mkAv" data-state="' + esc(a.state) + '">' + AGENT_ICON + '</span><div><span>' + esc(a.name) + '</span><small>' +
          kind + (kind && a.start ? ' · ' : '') + time(a) + '</small></div>' + pill(a.state) + '</li>';
      });
      h += '</ul></section>';
    }
    if (d.jobs.length) {
      h += '<section><h4>Background jobs</h4><ul class="mkAgentList">';
      d.jobs.forEach((j) => {
        h += '<li data-state="' + esc(j.state) + '"><span class="mkAv" data-state="' + esc(j.state) + '">' + TASK_ICON + '</span><div><span>' + esc(j.name) + '</span><small>' + time(j) + '</small></div>' + pill(j.state) + '</li>';
      });
      h += '</ul></section>';
    }
    if (!d.todos.length && !agents.length && !d.jobs.length) h += '<p class="mkEmpty">Nothing running in this chat. Tasks and agents show up here while Claude works.</p>';
    if (q('[class*="agentsPill_"]')) h += '<footer><button type="button" class="mkOpenAgents">Open agent view</button></footer>';
    panel.innerHTML = h;
    const open = q('.mkOpenAgents', panel);
    if (open) open.addEventListener('click', () => { panel.hidden = true; const n = q('[class*="agentsPill_"]'); if (n) n.click(); });
    place();
  }
  // under a header badge, above a message-box chip
  function place() {
    const r = panelAnchor.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 24);
    panel.style.width = w + 'px';
    panel.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
    if (r.top > window.innerHeight / 2) { panel.style.top = ''; panel.style.bottom = (window.innerHeight - r.top + 8) + 'px'; }
    else { panel.style.bottom = ''; panel.style.top = (r.bottom + 8) + 'px'; }
  }

  // 7. Image previews: when Claude reads an image (png, jpg, gif, webp, svg), show a small thumbnail under the
  //    "Read file.png" line. Uses the image Claude received (the chat cannot load files from disk). Click opens the file.
  const isImage = (name) => /\.(png|jpe?g|gif|webp|avif|bmp|svg)\b/i.test(name || '');
  const thumbs = new Map(); // tool_use id -> data URI
  function scanReads() {
    const s = window.__mkS;
    let msgs = [];
    try { msgs = (s && s.messages && s.messages.value) || []; } catch (e) {}
    const reads = [];
    const seen = new Set();
    const visit = (o, ctx, depth) => {
      if (!o || typeof o !== 'object' || depth > 7 || seen.has(o)) return;
      seen.add(o);
      if (Array.isArray(o)) { o.forEach((x) => visit(x, ctx, depth + 1)); return; }
      if (o.type === 'tool_use' && o.name === 'Read' && o.input && typeof o.input.file_path === 'string') {
        reads.push({ id: o.id, path: o.input.file_path });
        ctx = o.id;
      }
      if (o.type === 'tool_result' && o.tool_use_id) ctx = o.tool_use_id;
      if (ctx && !thumbs.has(ctx)) {
        if (o.type === 'image' && o.source && o.source.data) thumbs.set(ctx, 'data:' + (o.source.media_type || 'image/png') + ';base64,' + o.source.data);
        else if (o.type === 'text' && typeof o.text === 'string' && o.text.indexOf('<svg') >= 0) {
          const svg = o.text.replace(/^ *\d+[\t→]/gm, '');
          const at = svg.indexOf('<svg');
          if (at >= 0) thumbs.set(ctx, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.slice(at)));
        }
      }
      for (const k in o) {
        if (k === 'data' || k === 'text') continue;
        const v = o[k];
        if (v && typeof v === 'object') visit(v, ctx, depth + 1);
      }
      if (o.toolResult && typeof o.toolResult === 'object' && 'value' in o.toolResult) visit(o.toolResult.value, ctx || (o.content && o.content.id), depth + 1);
    };
    msgs.forEach((m) => visit(m, null, 0));
    return reads.filter((r) => isImage(r.path));
  }
  const readRows = () => qa('[class*="toolNameText_"]').filter((el) => el.textContent.trim() === 'Read').map((el) => {
    const summary = el.closest('[class*="toolSummary_"]');
    return { el, name: el.nextElementSibling ? el.nextElementSibling.textContent.trim() : '', root: summary && summary.parentElement };
  }).filter((r) => isImage(r.name) && r.root);
  let thumbsKey = '';
  function syncThumbs() {
    const rows = readRows();
    if (!rows.some((r) => !q(':scope > .mkThumb', r.root))) return;
    // rescan the conversation only when it or the rows changed (a Read with no image would rescan every tick)
    let msgs = [];
    try { msgs = (window.__mkS && window.__mkS.messages && window.__mkS.messages.value) || []; } catch (e) {}
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    const key = msgs.length + ':' + String(last && last.uuid) + ':' + rows.length;
    if (key === thumbsKey) return;
    thumbsKey = key;
    const reads = scanReads();
    // keep only previews for image reads still in this chat (each holds a full data URI)
    const keep = new Set(reads.map((x) => x.id));
    thumbs.forEach((v, k) => { if (!keep.has(k)) thumbs.delete(k); });
    const used = new Map();
    rows.forEach((r) => {
      const n = used.get(r.name) || 0;
      used.set(r.name, n + 1);
      if (q(':scope > .mkThumb', r.root)) return;
      const match = reads.filter((x) => x.path.split('/').pop() === r.name)[n];
      const src = match && thumbs.get(match.id);
      if (!src) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mkThumb';
      b.title = 'Open ' + r.name;
      b.setAttribute('aria-label', 'Open ' + r.name);
      const img = document.createElement('img');
      img.alt = r.name;
      img.decoding = 'async';
      img.src = src;
      b.appendChild(img);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = r.el.nextElementSibling;
        const link = target && (q('a, [role="link"], button', target) || target.firstElementChild || target);
        if (link) link.click();
      });
      r.root.appendChild(b);
    });
  }
  setInterval(syncThumbs, 1500);

  // 8. Tokens spent in this chat: a small number left of Bookmarks. Claude's session keeps only the latest call's
  //    usage, so the kit records every API response's usage by message id as it passes through processMessage
  //    (live turns, replayed history, subagents). Total = input + cache write + cache read + output, the same sum
  //    Claude Code uses for its context figure. One response arrives once per content block: keep the max per field.
  const TOKEN_KEYS = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];
  const usageBy = new WeakMap(); // session -> Map(message id -> usage)
  const partial = new WeakSet(); // sessions that already had messages when the kit started counting
  let usageVer = 0;
  const msgCount = (s) => { try { return ((s.messages && s.messages.value) || []).length; } catch (e) { return 0; } };
  const sidOf = (s) => { try { const v = s.sessionId; return String((v && typeof v === 'object' && 'value' in v ? v.value : v) || ''); } catch (e) { return ''; } };
  function usageMap(s) {
    let map = usageBy.get(s);
    const sid = sidOf(s);
    if (!map || (map.sid && sid && map.sid !== sid)) { map = new Map(); usageBy.set(s, map); usageVer++; }
    if (sid) map.sid = sid;
    return map;
  }
  function noteUsage(s, e) {
    const m = e && e.type === 'assistant' && e.message;
    const u = m && m.usage;
    const id = m && (m.id || e.uuid);
    if (!u || typeof u !== 'object' || !id) return;
    const map = usageMap(s);
    const prev = map.get(id);
    const next = {};
    TOKEN_KEYS.forEach((k) => { next[k] = Math.max(prev ? prev[k] : 0, Number(u[k]) || 0); });
    map.set(id, next);
    usageVer++;
  }
  function hookUsage(s) {
    const proto = s && typeof s === 'object' && Object.getPrototypeOf(s);
    if (!proto || typeof proto.processMessage !== 'function') return;
    if (!proto.__mkUsage) {
      const orig = proto.processMessage;
      proto.processMessage = function (e) {
        try { noteUsage(this, e); } catch (err) {}
        return orig.apply(this, arguments);
      };
      proto.__mkUsage = 1;
    }
    if (!usageBy.has(s)) { usageMap(s); if (msgCount(s)) partial.add(s); }
  }
  // 950 · 1.2k · 34k · 1.25M · 12.4M (Number() drops trailing zeros: 1.20 -> 1.2)
  const tokenShort = (v) => v < 1000 ? String(v)
    : v < 999500 ? Number((v / 1e3).toFixed(v < 1e4 ? 1 : 0)) + 'k'
    : Number((v / 1e6).toFixed(v < 1e7 ? 2 : 1)) + 'M';
  const tokenLong = (v) => v.toLocaleString('en-US');
  let tokensDrawn = '';
  function syncTokens() {
    const s = window.__mkS;
    const usage = q('.ccUsage');
    const header = usage && usage.parentElement;
    if (!s || !header) return;
    hookUsage(s);
    if (!msgCount(s) && usageMap(s).size) { usageBy.set(s, new Map()); partial.delete(s); usageVer++; }
    let el = q(':scope > .mkTokens', header);
    if (!el) { el = document.createElement('span'); el.className = 'mkTokens'; }
    const ref = q(':scope > button[aria-label="Bookmarks"]', header) || q(':scope > .mkMapToggle', header);
    if (ref ? el.nextElementSibling !== ref : el.parentElement !== header) header.insertBefore(el, ref || null);
    const key = usageVer + ':' + sidOf(s) + ':' + partial.has(s);
    if (key === tokensDrawn && el.isConnected) return;
    tokensDrawn = key;
    const t = {};
    TOKEN_KEYS.forEach((k) => { t[k] = 0; });
    usageMap(s).forEach((u) => TOKEN_KEYS.forEach((k) => { t[k] += u[k]; }));
    const total = TOKEN_KEYS.reduce((a, k) => a + t[k], 0);
    const text = total ? tokenShort(total) : '';
    if (el.textContent !== text) el.textContent = text;
    const label = total ? 'Tokens this chat: ' + tokenLong(total) + '\nInput ' + tokenLong(t.input_tokens) + ' · Output ' + tokenLong(t.output_tokens) +
      '\nCache write ' + tokenLong(t.cache_creation_input_tokens) + ' · Cache read ' + tokenLong(t.cache_read_input_tokens) +
      (partial.has(s) ? '\nCounted since this view opened' : '') : '';
    if (el.title !== label) { el.title = label; if (label) el.setAttribute('aria-label', label.split('\n')[0]); else el.removeAttribute('aria-label'); }
  }
  // hook as early as possible so a resumed chat's history is counted when it loads
  setInterval(() => { if (window.__mkS) hookUsage(window.__mkS); }, 200);

  // 9. MCP servers used in this chat: overlapping logo avatars in the header, in order of first use. Each later
  //    avatar has a crescent cut (CSS mask) where the previous one overlaps, so it reads on any background.
  //    Logos are RemixIcon glyphs (Apache-2.0) embedded inline: nothing is fetched. Unknown servers get a letter.
  const MCP_ICONS = {
    figma: 'M5.33317 5.33333C5.33317 3.49238 6.82556 2 8.6665 2H11.9997H11.9998H15.333C17.174 2 18.6663 3.49238 18.6663 5.33333C18.6663 7.17428 17.174 8.66667 15.333 8.66667H11.9998H11.9997L11.9997 12L11.9997 15.3333V18.6667C11.9997 20.5076 10.5073 22 8.66634 22C6.82539 22 5.33301 20.5076 5.33301 18.6667C5.33301 16.8257 6.82539 15.3333 8.66634 15.3333C6.82539 15.3333 5.33301 13.841 5.33301 12C5.33301 10.1591 6.82539 8.66667 8.66634 8.66667H8.6665C6.82555 8.66667 5.33317 7.17428 5.33317 5.33333ZM11.9997 12C11.9997 13.841 13.4921 15.3333 15.333 15.3333C17.174 15.3333 18.6663 13.841 18.6663 12C18.6663 10.1591 17.174 8.66667 15.333 8.66667C13.4921 8.66667 11.9997 10.1591 11.9997 12Z',
    notion: 'M6.1039 5.90972C6.68754 6.38386 6.90648 6.34768 8.00238 6.27457L18.3342 5.65418C18.5533 5.65418 18.3711 5.43557 18.2981 5.39924L16.5822 4.15879C16.2534 3.90354 15.8153 3.61122 14.9758 3.68434L4.9715 4.41403C4.60665 4.45021 4.53377 4.63262 4.67909 4.77886L6.1039 5.90972ZM6.72422 8.31752L6.72422 19.1884C6.72422 19.7726 7.01618 19.9912 7.6733 19.955L19.028 19.298C19.6854 19.2619 19.7586 18.86 19.7586 18.3854V7.58753C19.7586 7.1137 19.5764 6.85816 19.1739 6.89464L7.30815 7.58753C6.87027 7.62433 6.72422 7.84337 6.72422 8.31752ZM17.9335 8.90066C18.0063 9.22933 17.9335 9.55767 17.6043 9.5946L17.0571 9.70361V17.7292C16.5822 17.9845 16.1441 18.1304 15.7791 18.1304C15.1947 18.1304 15.0484 17.9479 14.6107 17.401L11.0321 11.783V17.2186L12.1645 17.4741C12.1645 17.4741 12.1645 18.1304 11.2509 18.1304L8.73222 18.2765C8.65905 18.1304 8.73222 17.7659 8.98769 17.6929L9.64494 17.5108V10.324L8.73237 10.2509C8.6592 9.92222 8.84146 9.44837 9.35298 9.41159L12.0549 9.22946L15.7791 14.9205V9.88603L14.8296 9.77704C14.7567 9.37526 15.0484 9.08353 15.4135 9.04735L17.9335 8.90066ZM4.13151 3.4291L14.5376 2.66279C15.8155 2.55318 16.1443 2.6266 16.9475 3.21005L20.2692 5.54473C20.8173 5.9462 21 6.05551 21 6.49316V19.298C21 20.1005 20.7077 20.5751 19.6856 20.6477L7.60101 21.3775C6.83376 21.4141 6.4686 21.3047 6.0668 20.7937L3.6206 17.6199C3.18227 17.0357 3 16.5986 3 16.0873L3 4.70545C3 4.04918 3.29242 3.50177 4.13151 3.4291Z',
    mail: 'M3 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3ZM12.0606 11.6829L5.64722 6.2377L4.35278 7.7623L12.0731 14.3171L19.6544 7.75616L18.3456 6.24384L12.0606 11.6829Z',
    calendar: 'M2 11H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V11ZM17 3H21C21.5523 3 22 3.44772 22 4V9H2V4C2 3.44772 2.44772 3 3 3H7V1H9V3H15V1H17V3Z',
    drive: 'M7.94037 4.14596L11.4217 10.1759L5.48201 20.4688L2 14.44L7.94037 4.14596ZM10.1161 14.44H22L18.518 20.4688H6.63537L10.1161 14.44ZM14.4589 13.4399L8.51799 3.14502H15.482L21.4229 13.4399H14.4589Z',
    doc: 'M21 9V20.9925C21 21.5511 20.5552 22 20.0066 22H3.9934C3.44495 22 3 21.556 3 21.0082V2.9918C3 2.45531 3.44694 2 3.99826 2H14V8C14 8.55228 14.4477 9 15 9H21ZM21 7H16V2.00318L21 7ZM8 7V9H11V7H8ZM8 11V13H16V11H8ZM8 15V17H16V15H8Z',
    google: 'M3.06364 7.50914C4.70909 4.24092 8.09084 2 12 2C14.6954 2 16.959 2.99095 18.6909 4.60455L15.8227 7.47274C14.7864 6.48185 13.4681 5.97727 12 5.97727C9.39542 5.97727 7.19084 7.73637 6.40455 10.1C6.2045 10.7 6.09086 11.3409 6.09086 12C6.09086 12.6591 6.2045 13.3 6.40455 13.9C7.19084 16.2636 9.39542 18.0227 12 18.0227C13.3454 18.0227 14.4909 17.6682 15.3864 17.0682C16.4454 16.3591 17.15 15.3 17.3818 14.05H12V10.1818H21.4181C21.5364 10.8363 21.6 11.5182 21.6 12.2273C21.6 15.2727 20.5091 17.8363 18.6181 19.5773C16.9636 21.1046 14.7 22 12 22C8.09084 22 4.70909 19.7591 3.06364 16.4909C2.38638 15.1409 2 13.6136 2 12C2 10.3864 2.38638 8.85911 3.06364 7.50914Z',
    slack: 'M6.52739 14.5136C6.52739 15.5966 5.64264 16.4814 4.55959 16.4814C3.47654 16.4814 2.5918 15.5966 2.5918 14.5136C2.5918 13.4305 3.47654 12.5458 4.55959 12.5458H6.52739V14.5136ZM7.51892 14.5136C7.51892 13.4305 8.40366 12.5458 9.48671 12.5458C10.5698 12.5458 11.4545 13.4305 11.4545 14.5136V19.4407C11.4545 20.5238 10.5698 21.4085 9.48671 21.4085C8.40366 21.4085 7.51892 20.5238 7.51892 19.4407V14.5136ZM9.48671 6.52715C8.40366 6.52715 7.51892 5.6424 7.51892 4.55935C7.51892 3.4763 8.40366 2.59155 9.48671 2.59155C10.5698 2.59155 11.4545 3.4763 11.4545 4.55935V6.52715H9.48671ZM9.48671 7.51867C10.5698 7.51867 11.4545 8.40342 11.4545 9.48647C11.4545 10.5695 10.5698 11.4543 9.48671 11.4543H4.55959C3.47654 11.4543 2.5918 10.5695 2.5918 9.48647C2.5918 8.40342 3.47654 7.51867 4.55959 7.51867H9.48671ZM17.4732 9.48647C17.4732 8.40342 18.3579 7.51867 19.4409 7.51867C20.524 7.51867 21.4087 8.40342 21.4087 9.48647C21.4087 10.5695 20.524 11.4543 19.4409 11.4543H17.4732V9.48647ZM16.4816 9.48647C16.4816 10.5695 15.5969 11.4543 14.5138 11.4543C13.4308 11.4543 12.546 10.5695 12.546 9.48647V4.55935C12.546 3.4763 13.4308 2.59155 14.5138 2.59155C15.5969 2.59155 16.4816 3.4763 16.4816 4.55935V9.48647ZM14.5138 17.4729C15.5969 17.4729 16.4816 18.3577 16.4816 19.4407C16.4816 20.5238 15.5969 21.4085 14.5138 21.4085C13.4308 21.4085 12.546 20.5238 12.546 19.4407V17.4729H14.5138ZM14.5138 16.4814C13.4308 16.4814 12.546 15.5966 12.546 14.5136C12.546 13.4305 13.4308 12.5458 14.5138 12.5458H19.4409C20.524 12.5458 21.4087 13.4305 21.4087 14.5136C21.4087 15.5966 20.524 16.4814 19.4409 16.4814H14.5138Z',
    github: 'M12.001 2C6.47598 2 2.00098 6.475 2.00098 12C2.00098 16.425 4.86348 20.1625 8.83848 21.4875C9.33848 21.575 9.52598 21.275 9.52598 21.0125C9.52598 20.775 9.51348 19.9875 9.51348 19.15C7.00098 19.6125 6.35098 18.5375 6.15098 17.975C6.03848 17.6875 5.55098 16.8 5.12598 16.5625C4.77598 16.375 4.27598 15.9125 5.11348 15.9C5.90098 15.8875 6.46348 16.625 6.65098 16.925C7.55098 18.4375 8.98848 18.0125 9.56348 17.75C9.65098 17.1 9.91348 16.6625 10.201 16.4125C7.97598 16.1625 5.65098 15.3 5.65098 11.475C5.65098 10.3875 6.03848 9.4875 6.67598 8.7875C6.57598 8.5375 6.22598 7.5125 6.77598 6.1375C6.77598 6.1375 7.61348 5.875 9.52598 7.1625C10.326 6.9375 11.176 6.825 12.026 6.825C12.876 6.825 13.726 6.9375 14.526 7.1625C16.4385 5.8625 17.276 6.1375 17.276 6.1375C17.826 7.5125 17.476 8.5375 17.376 8.7875C18.0135 9.4875 18.401 10.375 18.401 11.475C18.401 15.3125 16.0635 16.1625 13.8385 16.4125C14.201 16.725 14.5135 17.325 14.5135 18.2625C14.5135 19.6 14.501 20.675 14.501 21.0125C14.501 21.275 14.6885 21.5875 15.1885 21.4875C19.259 20.1133 21.9999 16.2963 22.001 12C22.001 6.475 17.526 2 12.001 2Z',
    microsoft: 'M11.501 3V11.5H3.00098V3H11.501ZM11.501 21H3.00098V12.5H11.501V21ZM12.501 3H21.001V11.5H12.501V3ZM21.001 12.5V21H12.501V12.5H21.001Z',
    chrome: 'M9.82726 21.7633C5.34912 20.7712 2 16.7767 2 12C2 10.1779 2.48734 8.46958 3.33878 6.99834L7.62189 14.4169C8.47396 15.9571 10.1152 17 12 17C12.2023 17 12.4018 16.988 12.5978 16.9646L9.82726 21.7633ZM12 22L16.2868 14.5751C16.7396 13.8229 17 12.9419 17 12C17 10.8744 16.6281 9.83566 16.0004 9H21.5422C21.8396 9.94704 22 10.9548 22 12C22 17.5228 17.5228 22 12 22ZM14.5721 13.545C14.0473 14.4168 13.0917 15 12 15C10.8897 15 9.92024 14.3968 9.40149 13.5002L9.37313 13.4501C9.13535 13.0203 9 12.526 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12C15 12.5465 14.8539 13.0589 14.5985 13.5002L14.5721 13.545ZM4.6322 5.23859C6.46008 3.24783 9.08432 2 12 2C15.7014 2 18.9331 4.01099 20.6622 7H12C9.93635 7 8.1647 8.25019 7.40112 10.0345L4.6322 5.23859Z',
    cloud: 'M17 7C13.5705 7 10.6449 9.15804 9.50734 12.1903L11.3805 12.8927C12.2337 10.6185 14.4278 9 17 9C17.6983 9 18.3687 9.11928 18.992 9.33857C21.3265 10.16 23 12.3846 23 15C23 18.3137 20.3137 21 17 21H7C3.68629 21 1 18.3137 1 15C1 12.3846 2.67346 10.16 5.00804 9.33857C5.0027 9.22639 5 9.11351 5 9C5 5.13401 8.13401 2 12 2C15.242 2 17.9693 4.20399 18.7652 7.19539C18.1973 7.0675 17.6065 7 17 7Z',
    web: 'M2.04932 12.9999H7.52725C7.70624 16.2688 8.7574 19.3053 10.452 21.8809C5.98761 21.1871 2.5001 17.5402 2.04932 12.9999ZM2.04932 10.9999C2.5001 6.45968 5.98761 2.81276 10.452 2.11902C8.7574 4.69456 7.70624 7.73111 7.52725 10.9999H2.04932ZM21.9506 10.9999H16.4726C16.2936 7.73111 15.2425 4.69456 13.5479 2.11902C18.0123 2.81276 21.4998 6.45968 21.9506 10.9999ZM21.9506 12.9999C21.4998 17.5402 18.0123 21.1871 13.5479 21.8809C15.2425 19.3053 16.2936 16.2688 16.4726 12.9999H21.9506ZM9.53068 12.9999H14.4692C14.2976 15.7828 13.4146 18.3732 11.9999 20.5915C10.5852 18.3732 9.70229 15.7828 9.53068 12.9999ZM9.53068 10.9999C9.70229 8.21709 10.5852 5.62672 11.9999 3.40841C13.4146 5.62672 14.2976 8.21709 14.4692 10.9999H9.53068Z',
    book: 'M21 21H13V6C13 4.34315 14.3431 3 16 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21ZM11 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H8C9.65685 3 11 4.34315 11 6V21ZM11 21H13V23H11V21Z',
    search: 'M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168Z',
    brain: 'M11 2.53513C10.4117 2.19479 9.72857 2 9 2 6.79086 2 5 3.79086 5 6V7.77422C4.14895 8.11644 3.45143 8.64785 2.94126 9.34933 2.29239 10.2415 2 11.3347 2 12.5 2 14.0614 2.79529 15.4356 4 16.242V17.5C4 19.9853 6.01472 22 8.5 22 9.42507 22 10.285 21.7209 11 21.2422V17.5C11 16.167 10.67 15.3147 10.1402 14.7408 9.59743 14.1528 8.71622 13.7165 7.3356 13.4864L7.6644 11.5136C8.96602 11.7305 10.1058 12.1373 11 12.8271V2.53513ZM13 2.53513V12.8271C13.8942 12.1373 15.034 11.7305 16.3356 11.5136L16.6644 13.4864C15.2838 13.7165 14.4026 14.1528 13.8598 14.7408 13.33 15.3147 13 16.167 13 17.5V21.2422C13.715 21.7209 14.5749 22 15.5 22 17.9853 22 20 19.9853 20 17.5V16.242C21.2047 15.4356 22 14.0614 22 12.5 22 11.3347 21.7076 10.2415 21.0587 9.34933 20.5486 8.64785 19.8511 8.11644 19 7.77422V6C19 3.79086 17.2091 2 15 2 14.2714 2 13.5883 2.19479 13 2.53513Z',
    film: 'M2 3.9934C2 3.44476 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44495 22 3.9934V20.0066C22 20.5552 21.5447 21 21.0082 21H2.9918C2.44405 21 2 20.5551 2 20.0066V3.9934ZM4 5V7H6V5H4ZM18 5V7H20V5H18ZM4 9V11H6V9H4ZM18 9V11H20V9H18ZM4 13V15H6V13H4ZM18 13V15H20V13H18ZM4 17V19H6V17H4ZM18 17V19H20V17H18Z',
    phone: 'M6 2H18C18.5523 2 19 2.44772 19 3V21C19 21.5523 18.5523 22 18 22H6C5.44772 22 5 21.5523 5 21V3C5 2.44772 5.44772 2 6 2ZM12 17C11.4477 17 11 17.4477 11 18C11 18.5523 11.4477 19 12 19C12.5523 19 13 18.5523 13 18C13 17.4477 12.5523 17 12 17Z',
    claude: 'M5.92 15.3L9.86 13.1L9.92 12.9L9.86 12.8H9.66L9 12.76L6.76 12.7L4.8 12.6L2.9 12.5L2.42 12.4L2 11.8L2.04 11.5L2.44 11.24L3.02 11.28L4.28 11.38L6.18 11.5L7.56 11.58L9.6 11.82H9.92L9.96 11.68L9.86 11.6L9.78 11.52L7.8 10.2L5.68 8.8L4.56 7.98L3.96 7.58L3.66 7.18L3.54 6.34L4.08 5.74L4.82 5.8L5 5.84L5.74 6.42L7.34 7.64L9.4 9.2L9.7 9.44L9.82 9.36L9.84 9.3L9.7 9.08L8.6 7L7.4 4.92L6.86 4.06L6.72 3.54C6.66 3.34 6.64 3.14 6.64 2.94L7.24 2.1L7.6 2L8.44 2.12L8.76 2.4L9.28 3.6L10.1 5.46L11.4 7.98L11.8 8.74L12 9.42L12.06 9.62H12.2V9.52L12.3 8.08L12.5 6.34L12.7 4.1L12.76 3.46L13.08 2.7L13.68 2.3L14.2 2.52L14.6 3.1L14.54 3.46L14.32 5L13.8 7.42L13.5 9.06H13.68L13.88 8.84L14.7 7.76L16.08 6.04L16.68 5.34L17.4 4.6L17.86 4.24H18.72L19.34 5.18L19.06 6.16L18.18 7.28L17.44 8.22L16.38 9.64L15.74 10.78L15.8 10.86H15.94L18.34 10.34L19.62 10.12L21.14 9.86L21.84 10.18L21.92 10.5L21.64 11.18L20 11.58L18.08 11.98L15.22 12.64L15.18 12.66L15.22 12.72L16.5 12.84L17.06 12.88H18.42L20.94 13.08L21.6 13.48L21.98 14.02L21.92 14.42L20.9 14.94L19.54 14.62L16.34 13.86L15.26 13.6H15.1V13.68L16.02 14.58L17.68 16.08L19.8 18.02L19.9 18.5L19.64 18.9L19.36 18.86L17.52 17.46L16.8 16.86L15.2 15.5H15.1V15.64L15.46 16.18L17.42 19.12L17.52 20.02L17.38 20.3L16.86 20.5L16.32 20.38L15.16 18.78L13.96 16.98L13.02 15.34L12.92 15.42L12.34 21.46L12.08 21.76L11.48 22L10.98 21.6L10.7 21L10.98 19.76L11.3 18.16L11.56 16.88L11.8 15.3L11.94 14.78V14.74H11.8L10.6 16.4L8.8 18.86L7.36 20.38L7.02 20.52L6.42 20.22L6.48 19.66L6.8 19.2L8.8 16.64L10 15.06L10.8 14.14L10.78 14.04H10.72L5.44 17.48L4.5 17.6L4.1 17.2L4.14 16.6L4.34 16.4L5.94 15.3H5.92Z',
    note: 'M15 14L14.8834 14.0067C14.4243 14.0601 14.0601 14.4243 14.0067 14.8834L14 15V21H3.99826C3.44694 21 3 20.5551 3 20.0066V3.9934C3 3.44476 3.44495 3 3.9934 3H20.0066C20.5552 3 21 3.44749 21 3.9985V14H15ZM21 16L16 20.997V16H21Z',
    vercel: 'M23 21.6479H1L12 2.35205L23 21.6479Z',
    supabase: 'M3.08378 15.25C1.42044 15.25 0.483971 13.3378 1.5038 12.0237L10.2099 0.806317C10.794 0.053716 11.9999 0.466765 11.9999 1.41944V8.74999H20.9159C22.5793 8.74999 23.5157 10.6622 22.4959 11.9762L13.7898 23.1937C13.2057 23.9463 11.9999 23.5332 11.9999 22.5805V15.25H3.08378Z',
  };
  // [pattern on the server name, icon, circle colour, glyph colour]. First match wins, so specific names come first.
  const MCP_BRANDS = [
    [/figma/i, 'figma', '#f24e1e'], [/notion/i, 'notion', '#ebebeb', '#191919'], [/chrome|browser/i, 'chrome', '#1a73e8'],
    [/context7/i, 'book', '#0f766e'], [/claude|anthropic/i, 'claude', '#d97757'], [/microsoft|outlook|365|teams|sharepoint/i, 'microsoft', '#0078d4'],
    [/gmail|^mail/i, 'mail', '#ea4335'], [/calendar/i, 'calendar', '#4285f4'], [/drive/i, 'drive', '#1fa463'],
    [/docs|sheets|slides/i, 'doc', '#4285f4'], [/google/i, 'google', '#4285f4'], [/slack/i, 'slack', '#611f69'],
    [/github/i, 'github', '#30363d'], [/cloudflare/i, 'cloud', '#f38020'], [/playwright|puppeteer|fetch/i, 'web', '#2ead33'],
    [/^exa|search|perplexity/i, 'search', '#1f40ed'], [/memory/i, 'brain', '#7c3aed'], [/higgsfield|video/i, 'film', '#3a3f4b'],
    [/mobbin/i, 'phone', '#3a3f4b'], [/paper|notes?/i, 'note', '#b8860b'], [/vercel/i, 'vercel', '#000000'],
    [/supabase/i, 'supabase', '#3ecf8e', '#0b2b1c'],
  ];
  const MCP_MAX = 5;
  // mcp__<server>__<tool>; claude.ai connectors and plugins carry a prefix on the server part
  const mcpParse = (name) => { const p = name.split('__'); return p.length >= 3 ? { id: p[1], tool: p.slice(2).join('__') } : null; };
  const mcpLabel = (id) => { const n = id.replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '').replace(/[_-]+/g, ' ').trim(); return n.charAt(0).toUpperCase() + n.slice(1); };
  const mcpHue = (t) => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360; return 'hsl(' + h + ', 32%, 36%)'; };
  let mcpCache = { key: '', list: [] };
  function mcpUsed(s) {
    let msgs = [];
    try { msgs = (s.messages && s.messages.value) || []; } catch (e) {}
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    const key = msgs.length + ':' + String(last && last.uuid);
    if (key === mcpCache.key) return mcpCache.list;
    const servers = new Map(), ids = new Set(), seen = new Set();
    const visit = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 6 || seen.has(o)) return;
      seen.add(o);
      if (Array.isArray(o)) { o.forEach((x) => visit(x, depth + 1)); return; }
      if (o.type === 'tool_use' && typeof o.name === 'string' && o.name.indexOf('mcp__') === 0) {
        if (o.id && ids.has(o.id)) return;
        if (o.id) ids.add(o.id);
        const p = mcpParse(o.name);
        if (!p) return;
        let e = servers.get(p.id);
        if (!e) servers.set(p.id, (e = { id: p.id, calls: 0, tools: new Map() }));
        e.calls++;
        e.tools.set(p.tool, (e.tools.get(p.tool) || 0) + 1);
        return;
      }
      for (const k in o) { if (k === 'data' || k === 'text' || k === 'input' || k === 'toolResult') continue; const v = o[k]; if (v && typeof v === 'object') visit(v, depth + 1); }
    };
    msgs.forEach((m) => visit(m, 0));
    mcpCache = { key, list: Array.from(servers.values()) };
    return mcpCache.list;
  }
  let mcpDrawn = '';
  function syncMcp() {
    const s = window.__mkS;
    const usage = q('.ccUsage');
    const header = usage && usage.parentElement;
    if (!s || !header) return;
    const list = mcpUsed(s);
    let box = q(':scope > .mkMcp', header);
    if (!box) {
      box = document.createElement('div');
      box.className = 'mkMcp';
      box.setAttribute('role', 'list');
      box.setAttribute('aria-label', 'MCP servers used in this chat');
    }
    const after = q(':scope > .mkTasks', header) || usage;
    if (box.previousElementSibling !== after) after.after(box);
    const sig = list.map((x) => x.id + ':' + x.calls).join('|');
    if (sig === mcpDrawn && box.isConnected) return;
    mcpDrawn = sig;
    box.hidden = !list.length;
    const frag = document.createDocumentFragment();
    const shown = list.length > MCP_MAX ? list.slice(0, MCP_MAX - 1) : list;
    shown.forEach((sv) => {
      const label = mcpLabel(sv.id);
      const brand = MCP_BRANDS.find((b) => b[0].test(label));
      const el = document.createElement('span');
      el.className = 'mkMcpAv';
      el.setAttribute('role', 'listitem');
      el.style.background = brand ? brand[2] : mcpHue(label);
      el.style.color = brand && brand[3] ? brand[3] : '#ffffff';
      if (brand) el.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="' + MCP_ICONS[brand[1]] + '"/></svg>';
      else el.textContent = label.charAt(0);
      const tools = Array.from(sv.tools.entries()).sort((a, b) => b[1] - a[1]).map((t) => t[0].replace(/_/g, ' ') + (t[1] > 1 ? ' ×' + t[1] : ''));
      el.title = label + ' · ' + plural(sv.calls, 'call') + '\n' + tools.slice(0, 8).join('\n') + (tools.length > 8 ? '\n+' + (tools.length - 8) + ' more' : '');
      el.setAttribute('aria-label', label + ', ' + plural(sv.calls, 'call'));
      frag.appendChild(el);
    });
    if (list.length > MCP_MAX) {
      const rest = list.slice(MCP_MAX - 1);
      const more = document.createElement('span');
      more.className = 'mkMcpAv mkMcpMore';
      more.setAttribute('role', 'listitem');
      more.textContent = '+' + rest.length;
      more.title = rest.map((x) => mcpLabel(x.id) + ' · ' + plural(x.calls, 'call')).join('\n');
      more.setAttribute('aria-label', rest.length + ' more servers');
      frag.appendChild(more);
    }
    box.replaceChildren(frag);
  }

  setInterval(() => { syncAgents(); syncTokens(); syncMcp(); }, 1000);

  let timer = 0;
  function schedule() { if (!timer) timer = setTimeout(() => { timer = 0; build(); syncAgents(); syncTokens(); syncMcp(); }, 200); }
  // React to Claude's DOM only. Mutations inside the kit's own elements (map, chips, panel, held bubbles,
  // thumbnails) would otherwise re-trigger build() + syncAgents() in an endless 200 ms loop.
  const OWN = '.mkMap, .mkAgents, .mkTasks, .mkPanel, .mkHeld, .mkThumb, .mkMapToggle, .mkTokens, .mkMcp';
  const isOwn = (n) => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return !!(el && el.closest(OWN)); };
  new MutationObserver((list) => {
    if (list.every((m) => isOwn(m.target))) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', schedule);
  schedule();
})();

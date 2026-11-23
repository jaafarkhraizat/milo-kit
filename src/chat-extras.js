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
  // Features turned off in Milo Kit settings (set by the /*mk-off*/ block that lib/apply.js writes before this script).
  const off = (f) => (window.__mkOff || []).indexOf(f) >= 0;
  const isChatScroller = (el) => el instanceof Element && typeof el.className === 'string' && el.className.indexOf('messagesContainer_') >= 0;

  const css = document.createElement('style');
  css.textContent = '@keyframes mkFade{from{opacity:0}to{opacity:1}}@keyframes mkIn{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}@keyframes mkCount{from{transform:scaleX(1)}to{transform:scaleX(0)}}@keyframes mkRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes mkPulse{0%,100%{box-shadow:0 0 0 0 rgba(130,169,245,.55)}50%{box-shadow:0 0 0 4px rgba(130,169,245,0)}}@keyframes mkSpin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion: reduce){html[data-mk-reveal] [data-mk-stuck]{transition:none!important}[data-mk-md]{transition:none!important}[data-mk-stuck],.mkMcpAv,.mkPanel,.mkUsage,.mkHeld,.mkThumb,.mkMap,.mkTick,.mkAgents>i,.mkHeldMeta span::before{animation:none!important}}';
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
    if (!isChatScroller(c) || off('pin')) return;
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
  // A prompt pinned at the top is the real message held by sticky, so it cannot grow there: unpin it, scroll the
  // chat to the message's own spot (12px under the top edge), then expand it in place. Pinned is measured at click
  // time (data-mk-stuck goes stale once the pin moves on to the next prompt): the message counts as pinned when
  // switching the pin off moves it. Not pinned: the pin is switched back on, nothing else changes.
  function unpinAndAnchor(box) {
    const state = root.getAttribute('data-mk-reveal');
    const msg = box.closest('[class*="message_"][class*="stickyHeader_"]');
    const sc = box.closest('[class*="messagesContainer_"]');
    if (!state || !msg || !sc) return false;
    const shown = msg.getBoundingClientRect().top;
    root.removeAttribute('data-mk-reveal');
    const own = msg.getBoundingClientRect().top;
    if (Math.abs(shown - own) < 2) { root.setAttribute('data-mk-reveal', state); return false; }
    clearTimeout(revealTimer);
    qa('[data-mk-stuck]').forEach((el) => el.removeAttribute('data-mk-stuck'));
    const y = Math.max(0, Math.round(sc.scrollTop + own - sc.getBoundingClientRect().top - 12));
    lastY.set(sc, y); // the jump is ours: keep the prompt-reveal scroll handler from re-pinning
    drift = 0;
    sc.scrollTop = y;
    return true;
  }
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element) || off('expand')) return;
    const box = t.closest('[class*="expandableContainer_"]');
    if (!box) return;
    const btn = t.closest('[class*="expandButton_"]');
    if (btn) {
      // Show more itself: only take over when the prompt is pinned; otherwise Claude's click runs as is
      if (!unpinAndAnchor(box)) return;
      e.preventDefault();
      e.stopPropagation();
      // let this click finish, then press the button again (unpinned by then, so this branch lets it through)
      setTimeout(() => btn.click(), 0);
      return;
    }
    if (t.closest('button, a, input, textarea')) return;
    if (!q('[class*="collapsed_"]', box) || String(getSelection() || '').length) return;
    const more = q('[class*="expandButton_"]', box);
    if (!more) return;
    e.preventDefault();
    e.stopPropagation();
    unpinAndAnchor(box);
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
    if (off('queue') || !isBusy() || box.getAttribute('aria-activedescendant')) return;
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
        // agents always; jobs only while running. Tasks stay in the details panel, not the badge.
        const bits = [plural(working, 'agent')];
        if (jobsRunning) bits.push(plural(jobsRunning, 'job'));
        badge.dataset.state = waiting ? 'waiting' : working || jobsRunning ? 'working' : 'idle';
        setHtml(badge, AGENT_ICON + '<span>' + bits.join(' · ') + '</span>');
        badge.disabled = !(working || jobsRunning);
        badge.title = badge.disabled ? 'Nothing running' : 'Agents and jobs. Click for details';
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
      b.setAttribute('data-mk-path', match.path);
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
  // RemixIcon coin-fill (tokens) and bar-chart-box-line (dashboard)
  const COIN_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M23.0049 12.0028V14.0028C23.0049 17.3165 18.08 20.0028 12.0049 20.0028C6.03824 20.0028 1.18114 17.4116 1.00957 14.1797L1.00488 14.0028V12.0028C1.00488 15.3165 5.92975 18.0028 12.0049 18.0028C18.08 18.0028 23.0049 15.3165 23.0049 12.0028ZM12.0049 4.00281C18.08 4.00281 23.0049 6.6891 23.0049 10.0028C23.0049 13.3165 18.08 16.0028 12.0049 16.0028C5.92975 16.0028 1.00488 13.3165 1.00488 10.0028C1.00488 6.6891 5.92975 4.00281 12.0049 4.00281Z"/></svg>';
  const DASH_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M3 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3ZM4 5V19H20V5H4ZM7 13H9V17H7V13ZM11 7H13V17H11V7ZM15 10H17V17H15V10Z"/></svg>';
  let tokensDrawn = '';
  function syncTokens() {
    const s = window.__mkS;
    const usage = q('.ccUsage');
    const header = usage && usage.parentElement;
    if (!s || !header) return;
    hookUsage(s);
    if (!msgCount(s) && usageMap(s).size) { usageBy.set(s, new Map()); partial.delete(s); usageVer++; }
    // header: [usage][mcp] ... [coin 12.4k] ... [Bookmarks][chat map]. The count is read-only and centred in the
    // free space (auto margins). The usage dashboard lives in the "Account & usage" section (syncAcctDash).
    let el = q(':scope > .mkTokens', header);
    if (!el) {
      el = document.createElement('span');
      el.className = 'mkTokens';
      el.innerHTML = COIN_ICON + '<b></b>';
    }
    const ref = q(':scope > .mkSpace', header) || q(':scope > button[aria-label="Bookmarks"]', header) || q(':scope > .mkMapToggle', header);
    if (ref ? el.nextElementSibling !== ref : el.parentElement !== header) header.insertBefore(el, ref || null);
    const key = usageVer + ':' + sidOf(s) + ':' + partial.has(s);
    if (key === tokensDrawn && el.isConnected) return;
    tokensDrawn = key;
    const t = {};
    TOKEN_KEYS.forEach((k) => { t[k] = 0; });
    usageMap(s).forEach((u) => TOKEN_KEYS.forEach((k) => { t[k] += u[k]; }));
    const total = TOKEN_KEYS.reduce((a, k) => a + t[k], 0);
    const text = total ? tokenShort(total) : '';
    const num = q('b', el);
    if (num.textContent !== text) num.textContent = text;
    el.hidden = !total;
    const label = total ? 'Tokens this chat: ' + tokenLong(total) + '\nInput ' + tokenLong(t.input_tokens) + ' · Output ' + tokenLong(t.output_tokens) +
      '\nCache write ' + tokenLong(t.cache_creation_input_tokens) + ' · Cache read ' + tokenLong(t.cache_read_input_tokens) +
      (partial.has(s) ? '\nCounted since this view opened' : '') : '';
    if (el.title !== label) { el.title = label; if (label) el.setAttribute('aria-label', label.split('\n')[0]); else el.removeAttribute('aria-label'); }
  }
  // Space button: a lantern icon directly before Bookmarks (after the token count) that opens a web page, set in Milo Kit
  // settings (window.__mkSpace, written by lib/apply.js). Opening goes through Claude's own open_url request, which ends in
  // the extension host's openExternal; a plain link click inside the webview is not relied on.
  const SPACE_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4.6V3.8a2 2 0 0 1 4 0v.8"/><rect x="7" y="4.6" width="10" height="2.6" rx="1"/><path d="M7.6 7.2C5.6 10 5.6 14 7.6 17h8.8c2-3 2-7 0-9.8"/><rect x="7" y="17" width="10" height="2.6" rx="1"/><path d="M12 9.8c1.3 1.5 1.6 2.4 0 4.2-1.6-1.8-1.3-2.7 0-4.2z"/></svg>';
  function syncSpace() {
    const cfg = window.__mkSpace;
    const usage = q('.ccUsage');
    const header = usage && usage.parentElement;
    if (!header) return;
    let b = q(':scope > .mkSpace', header);
    if (!cfg || !cfg.url) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'mkSpace';
      b.innerHTML = SPACE_ICON;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = b.getAttribute('data-url');
        const conn = window.__ccConn;
        if (conn && conn.sendRequest) conn.sendRequest({ type: 'open_url', url }).catch(() => { window.open(url, '_blank'); });
        else window.open(url, '_blank');
      });
    }
    if (b.getAttribute('data-url') !== cfg.url) b.setAttribute('data-url', cfg.url);
    if (b.title !== cfg.label) { b.title = cfg.label; b.setAttribute('aria-label', cfg.label); }
    const ref = q(':scope > button[aria-label="Bookmarks"]', header) || q(':scope > .mkMapToggle', header);
    if (ref ? b.nextElementSibling !== ref : b.parentElement !== header) header.insertBefore(b, ref || null);
  }
  // Usage dashboard button: in the "Account & usage" section header, between the collapse toggle and Claude's
  // "View details" link. The section's own account and usage rows stay as they are.
  function syncAcctDash() {
    const toggle = q('[class*="sectionHeader_"] > button[title*="ccount & usage"]');
    const head = toggle && toggle.parentElement;
    if (!head) return;
    let b = q(':scope > .mkDashBtn', head);
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'mkDashBtn';
      b.innerHTML = DASH_ICON;
      b.title = 'Usage dashboard';
      b.setAttribute('aria-label', 'Usage dashboard');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        // this section lives in the sessions sidebar, its own narrow webview: a popup here can't leave it. Ask the
        // extension to open the dashboard in a chat pane instead, the way Claude's "View details" opens its dialog
        // (mk:1 rides along; see the extension.js patch in build-chat-extras).
        const conn = window.__ccConn;
        if (conn && !q('[class*="messagesContainer_"]')) { conn.sendRequest({ type: 'open_account_usage', mk: 1 }).catch(() => {}); return; }
        toggleUsage(b);
        b.setAttribute('aria-pressed', dash && !dash.hidden ? 'true' : 'false');
      });
    }
    b.setAttribute('aria-pressed', dash && !dash.hidden && dashAnchor === b ? 'true' : 'false');
    const link = q(':scope > [class*="sectionLink_"]', head);
    if (link ? b.nextElementSibling !== link : b.parentElement !== head) head.insertBefore(b, link || null);
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

  // 10. Text types: tag what Claude writes so each kind reads differently at a glance. Attributes only (never
  //     rewrites Claude's DOM, so React keeps working). Markdown roots get data-mk-md; inline code gets
  //     data-mk-t = skill | cmd | key | color | var | time | date | dur | status | num | hash | id | agent | mcp | url | file;
  //     blockquotes that open with a bold title get data-mk-callout; numeric table cells data-mk-num; code blocks
  //     data-mk-lang; "Skill" tool rows data-mk-skill. Styles: [data-mk-*] rules in the webview stylesheet.
  const END = String.fromCharCode(36);
  const rx = (s, f) => new RegExp('^(?:' + s + ')' + END, f === undefined ? 'i' : f);
  const BUILTIN = new Set(('add-dir agents artifacts bug clear compact config context cost doctor exit export fast help hooks ide init ' +
    'login logout mcp memory model permissions plugin pr-comments release-notes resume review rewind status statusline ' +
    'terminal-setup usage vim').split(' '));
  const SHELL = rx('(?:\\x24 )?(?:git|gh|npm|npx|pnpm|yarn|bun|node|deno|python3?|pip3?|uv|brew|cd|ls|cat|curl|wget|open|code|claude|' +
    'rm|mv|cp|mkdir|touch|chmod|echo|export|source|bash|sh|zsh|make|docker|kubectl|sed|grep|rg|find|head|tail|cargo|go|rtk|ollama|sips|osascript|defaults|launchctl)\\s.*');
  const T = {
    key: rx('(?:⌘|⌥|⇧|⌃|cmd|command|ctrl|control|alt|opt|option|shift|meta|super|fn)(?:\\s*[+\\-]\\s*[^\\s+]+)+|enter|esc|escape|tab|backspace|f\\d{1,2}'),
    color: rx('#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|oklch|oklab|lab|lch)\\([^()]*\\)'),
    cssvar: rx('--[\\w-]+|var\\(--[\\w-]+(?:,.*)?\\)'),
    date: rx('\\d{4}-\\d{2}-\\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.? \\d{1,2}(?:,? \\d{4})?|(?:today|tomorrow|yesterday|mon|tue|wed|thu|fri|sat|sun)[a-z]*'),
    time: rx('(?:(?:\\d{4}-\\d{2}-\\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.? \\d{1,2}(?:,? \\d{4})?|(?:today|tomorrow|yesterday|mon|tue|wed|thu|fri|sat|sun)[a-z]*),?(?:[ T]| at ))?' +
      '(?:[01]?\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?(?:\\.\\d+)?(?: ?[ap]m)?(?: ?(?:z|utc|gmt|cet|cest|[a-z]{2,4}|[+\\-]\\d{2}:?\\d{2}))?|\\d+ ?(?:s|sec|min|m|h|hr|hours?|d|days?|w|weeks?) ago|just now'),
    dur: rx('~?\\d+(?:\\.\\d+)?\\s?(?:ms|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?)'),
    num: rx('[+\\-−±~]?(?:\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)\\s?(?:%|px|rem|em|pt|vh|vw|deg|x|×|k|m|b|kb|mb|gb|tb|tokens?|chars?|lines?|files?|fps)?'),
    hash: rx('(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\\d)[0-9a-f]{7,40}'),
    id: rx('[A-Z][A-Z0-9]{1,9}-\\d+|(?:PR|pr|issue) ?#\\d+', ''),
    agent: rx('@[a-z][\\w-]*'),
    mcp: rx('mcp__[\\w-]+__[\\w-]+'),
    url: rx('https?://\\S+'),
    file: rx('[\\w@.\\- ]*[\\w@\\-]\\.(?:jsonc?|[cm]?[jt]sx?|md|mdx|css|scss|html?|py|sh|zsh|svg|png|jpe?g|gif|webp|avif|ya?ml|toml|txt|pdf|fig|zip|swift|kt|go|rs|lock|env|plist|xml|csv|log|ipynb|sql|vue|svelte)(?::\\d+(?:-\\d+)?)?'),
  };
  const NUM_CELL = rx('[+\\-−~]?[\\d.,]*\\d[\\d.,]*\\s?(?:%|[a-z]{0,3})?');
  const STATUS = {
    good: 'done pass passed passing ok fixed shipped merged ready resolved approved success',
    bad: 'fail failed failing error broken blocked rejected crash',
    warn: 'warn warning pending skipped wip todo flaky draft partial',
    info: 'info beta planned',
  };
  const STATUS_OF = {};
  Object.keys(STATUS).forEach((k) => STATUS[k].split(' ').forEach((w) => { STATUS_OF[w] = k; }));
  const isPath = (t) => {
    if (/^https?:/i.test(t) || /[()<>{}=;"']/.test(t) || /\s{2}/.test(t)) return false;
    if (/^(~\/|\.{1,2}\/|\/[\w.])/.test(t)) return true;
    return t.indexOf('/') > 0 && /[\w)~.]\/[\w.~@-]/.test(t);
  };
  // skills Claude invoked in this chat (Skill tool calls), so a bare `name` in code also reads as a skill
  let skillCache = { key: '', set: new Set() };
  const usedSkills = () => {
    let msgs = [];
    try { msgs = (window.__mkS && window.__mkS.messages && window.__mkS.messages.value) || []; } catch (e) {}
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    const key = msgs.length + ':' + String(last && last.uuid);
    if (key === skillCache.key) return skillCache.set;
    const out = new Set(), seen = new Set();
    const visit = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 6 || seen.has(o)) return;
      seen.add(o);
      if (Array.isArray(o)) { o.forEach((x) => visit(x, depth + 1)); return; }
      if (o.type === 'tool_use' && o.name === 'Skill' && o.input && o.input.skill) {
        const n = String(o.input.skill).toLowerCase();
        out.add(n);
        out.add(n.split(':').pop());
        return;
      }
      for (const k in o) { if (k === 'text' || k === 'data') continue; const v = o[k]; if (v && typeof v === 'object') visit(v, depth + 1); }
    };
    msgs.forEach((m) => visit(m, 0));
    skillCache = { key, set: out };
    return out;
  };
  function codeType(t, skills) {
    const low = t.toLowerCase();
    let m = /^\/([a-z][\w-]*(?::[\w-]+)?)/i.exec(t);
    if (m && m[0].length === t.length) return BUILTIN.has(m[1].toLowerCase()) ? ['cmd', 'slash'] : ['skill'];
    if (skills.has(low) || (low.indexOf(':') > 0 && skills.has(low.split(':').pop()))) return ['skill'];
    if (T.mcp.test(t)) return ['mcp'];
    if (T.agent.test(t)) return ['agent'];
    if (T.url.test(t)) return ['url'];
    if (T.key.test(t)) return ['key'];
    if (T.color.test(t)) return ['color'];
    if (T.cssvar.test(t)) return ['var'];
    if (T.time.test(t)) return ['time'];
    if (T.date.test(t)) return ['date'];
    if (T.dur.test(t)) return ['dur'];
    if (STATUS_OF[low]) return ['status', STATUS_OF[low]];
    if (T.hash.test(t)) return ['hash'];
    if (T.id.test(t)) return ['id'];
    if (T.num.test(t) && /\d/.test(t)) return ['num', /^[+]/.test(t) ? 'up' : /^[\-−]/.test(t) ? 'down' : ''];
    if (SHELL.test(t)) return ['cmd', 'shell'];
    if (isPath(t)) return ['file', t.charAt(t.length - 1) === '/' ? 'dir' : ''];
    if (T.file.test(t)) return ['file', ''];
    return null;
  }
  const CALLOUT = {
    summary: 'summary|tl;?dr|recap|in short|overview', note: 'note|info|fyi|context|heads up', tip: 'tip|hint|pro tip',
    warn: 'warning|warn|caution|careful|watch out', risk: 'risk|danger|error|blocker|breaking|problem|issue|bug',
    decision: 'decision|decided|verdict|recommendation|my call|call', quote: 'quote|quoted|in their words|said',
    next: 'next|next steps?|to do|todo|action|actions|your move|steps', done: 'done|result|results|shipped|fixed|changed|what changed|verified',
    design: 'design|spec|ui|visual|tokens?|palette|layout', question: 'question|open questions?|ask|unknown|unclear', insight: 'insight|why|learned|finding|findings',
  };
  const calloutOf = (title) => {
    const t = title.toLowerCase().replace(/[:.]/g, ' ').trim();
    for (const k in CALLOUT) if (rx(CALLOUT[k]).test(t)) return k;
    return 'note';
  };
  const setAttr = (el, k, v) => { if (v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); } else if (el.hasAttribute(k)) el.removeAttribute(k); };
  function syncTypes() {
    qa('span[class^="root_"], span[class*=" root_"]').forEach((el) => { if (!el.hasAttribute('data-mk-md') && q('p, li, h1, h2, h3, h4, pre, blockquote, table, code', el)) el.setAttribute('data-mk-md', ''); });
    const skills = usedSkills();
    const skillKey = Array.from(skills).join(',');
    qa('[data-mk-md] code').forEach((c) => {
      if (c.closest('pre, a') || (typeof c.className === 'string' && c.className)) return;
      const t = c.textContent.trim();
      const key = t + '|' + skillKey;
      if (c.dataset.mkK === key) return;
      c.dataset.mkK = key;
      const r = t.length && t.length < 260 ? codeType(t, skills) : null;
      setAttr(c, 'data-mk-t', r && r[0]);
      setAttr(c, 'data-mk-v', r && r[1]);
      if (r && r[0] === 'color') c.style.setProperty('--hx', t);
    });
    qa('[data-mk-md] blockquote').forEach((b) => {
      const p = b.firstElementChild;
      const s = p && p.tagName === 'P' ? p.firstChild : null;
      const strong = s && s.nodeType === 1 && (s.tagName === 'STRONG' || s.tagName === 'B') ? s : null;
      setAttr(b, 'data-mk-callout', strong ? calloutOf(strong.textContent) : 'quote');
      const last = b.lastElementChild;
      if (last && last !== p && last.tagName === 'P') {
        const em = last.firstElementChild;
        setAttr(last, 'data-mk-cite', em && em.tagName === 'EM' && em.textContent.trim() === last.textContent.trim() ? '1' : '');
      }
    });
    qa('[data-mk-md] td').forEach((td) => {
      const t = td.textContent.trim();
      setAttr(td, 'data-mk-num', t && t.length < 24 && NUM_CELL.test(t.replace(/^[^\d+\-−~.]{1,2}(?=\d)/, '')) ? '1' : '');
    });
    qa('[data-mk-md] table').forEach((tb) => {
      const rows = qa('tbody tr', tb);
      qa('thead th', tb).forEach((th, i) => {
        const cells = rows.map((r) => r.children[i]).filter(Boolean);
        setAttr(th, 'data-mk-num', cells.length && cells.every((c) => c.hasAttribute('data-mk-num')) ? '1' : '');
      });
    });
    qa('[data-mk-md] pre > code[class*="language-"]').forEach((c) => {
      const w = c.parentElement.parentElement;
      const m = /language-([\w+#-]+)/.exec(c.className);
      if (w && m) setAttr(w, 'data-mk-lang', m[1].toLowerCase());
    });
    qa('[class*="toolNameText_"]').forEach((el) => setAttr(el, 'data-mk-skill', el.textContent.trim() === 'Skill' ? '1' : ''));
  }

  // 11. Usage dashboard: the button in the sessions sidebar's "Account & usage" header. It opens as a popup over the
  //     chat pane (never inside the sidebar); the expand button turns it into a full page. Where tokens went across all chats: projects, kinds of work,
  //     and where it took retries. Data comes from usage/aggregate.js (a Stop hook), which writes
  //     resources/mk-usage.css into the extension folder: the chat's CSP blocks fetch but allows stylesheets from
  //     there, so the summary rides in one custom property (base64 JSON). Turn rows:
  //     [ts, area, type, in, cacheWrite, cacheRead, out, cost, fix, toolErrors, edits, subagent, prompts, revision, prompt]
  const USD = String.fromCharCode(36);
  const ico = (d, s) => '<svg viewBox="0 0 24 24" width="' + (s || 14) + '" height="' + (s || 14) + '" fill="currentColor" aria-hidden="true"><path d="' + d + '"/></svg>';
  const UI = {
    expand: 'M17.5858 5H14V3H21V10H19V6.41421L14.7071 10.7071L13.2929 9.29289L17.5858 5ZM3 14H5V17.5858L9.29289 13.2929L10.7071 14.7071L6.41421 19H10V21H3V14Z',
    collapse: 'M15 4.00008H13V11.0001H20V9.00008H16.4142L20.7071 4.70718L19.2929 3.29297L15 7.58586V4.00008ZM4.00008 15H7.58586L3.29297 19.2929L4.70718 20.7071L9.00008 16.4142V20H11.0001V13H4.00008V15Z',
    close: 'M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093L13.4139 12.0007L18.3637 16.9504L16.9495 18.3646L11.9997 13.4149L7.04996 18.3646L5.63574 16.9504L10.5855 12.0007L5.63574 7.05093L7.04996 5.63672L11.9997 10.5865Z',
    build: 'M20 2C20.5523 2 21 2.44772 21 3V8C21 8.55228 20.5523 9 20 9H15V22C15 22.5523 14.5523 23 14 23H10C9.44772 23 9 22.5523 9 22V9H3.5C2.94772 9 2.5 8.55228 2.5 8V5.61803C2.5 5.23926 2.714 4.893 3.05279 4.72361L8.5 2H20ZM15 4H8.97214L4.5 6.23607V7H11V21H13V7H15V4ZM19 4H17V7H19V4Z',
    design: 'M12 2C17.5222 2 22 5.97778 22 10.8889C22 13.9556 19.5111 16.4444 16.4444 16.4444H14.4778C13.5556 16.4444 12.8111 17.1889 12.8111 18.1111C12.8111 18.5333 12.9778 18.9222 13.2333 19.2111C13.5 19.5111 13.6667 19.9 13.6667 20.3333C13.6667 21.2556 12.9 22 12 22C6.47778 22 2 17.5222 2 12C2 6.47778 6.47778 2 12 2ZM10.8111 18.1111C10.8111 16.0843 12.451 14.4444 14.4778 14.4444H16.4444C18.4065 14.4444 20 12.851 20 10.8889C20 7.1392 16.4677 4 12 4C7.58235 4 4 7.58235 4 12C4 16.19 7.2226 19.6285 11.324 19.9718C10.9948 19.4168 10.8111 18.7761 10.8111 18.1111ZM7.5 12C6.67157 12 6 11.3284 6 10.5C6 9.67157 6.67157 9 7.5 9C8.32843 9 9 9.67157 9 10.5C9 11.3284 8.32843 12 7.5 12ZM16.5 12C15.6716 12 15 11.3284 15 10.5C15 9.67157 15.6716 9 16.5 9C17.3284 9 18 9.67157 18 10.5C18 11.3284 17.3284 12 16.5 12ZM12 9C11.1716 9 10.5 8.32843 10.5 7.5C10.5 6.67157 11.1716 6 12 6C12.8284 6 13.5 6.67157 13.5 7.5C13.5 8.32843 12.8284 9 12 9Z',
    fix: 'M13 19.9C15.2822 19.4367 17 17.419 17 15V12C17 11.299 16.8564 10.6219 16.5846 10H7.41538C7.14358 10.6219 7 11.299 7 12V15C7 17.419 8.71776 19.4367 11 19.9V14H13V19.9ZM5.5358 17.6907C5.19061 16.8623 5 15.9534 5 15H2V13H5V12C5 11.3573 5.08661 10.7348 5.2488 10.1436L3.0359 8.86602L4.0359 7.13397L6.05636 8.30049C6.11995 8.19854 6.18609 8.09835 6.25469 8H17.7453C17.8139 8.09835 17.88 8.19854 17.9436 8.30049L19.9641 7.13397L20.9641 8.86602L18.7512 10.1436C18.9134 10.7348 19 11.3573 19 12V13H22V15H19C19 15.9534 18.8094 16.8623 18.4642 17.6907L20.9641 19.134L19.9641 20.866L17.4383 19.4077C16.1549 20.9893 14.1955 22 12 22C9.80453 22 7.84512 20.9893 6.56171 19.4077L4.0359 20.866L3.0359 19.134L5.5358 17.6907ZM8 6C8 3.79086 9.79086 2 12 2C14.2091 2 16 3.79086 16 6H8Z',
    research: 'M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748Z',
    setup: 'M3.33946 17.0002C2.90721 16.2515 2.58277 15.4702 2.36133 14.6741C3.3338 14.1779 3.99972 13.1668 3.99972 12.0002C3.99972 10.8345 3.3348 9.824 2.36353 9.32741C2.81025 7.71651 3.65857 6.21627 4.86474 4.99001C5.7807 5.58416 6.98935 5.65534 7.99972 5.072C9.01009 4.48866 9.55277 3.40635 9.4962 2.31604C11.1613 1.8846 12.8847 1.90004 14.5031 2.31862C14.4475 3.40806 14.9901 4.48912 15.9997 5.072C17.0101 5.65532 18.2187 5.58416 19.1346 4.99007C19.7133 5.57986 20.2277 6.25151 20.66 7.00021C21.0922 7.7489 21.4167 8.53025 21.6381 9.32628C20.6656 9.82247 19.9997 10.8336 19.9997 12.0002C19.9997 13.166 20.6646 14.1764 21.6359 14.673C21.1892 16.2839 20.3409 17.7841 19.1347 19.0104C18.2187 18.4163 17.0101 18.3451 15.9997 18.9284C14.9893 19.5117 14.4467 20.5941 14.5032 21.6844C12.8382 22.1158 11.1148 22.1004 9.49633 21.6818C9.55191 20.5923 9.00929 19.5113 7.99972 18.9284C6.98938 18.3451 5.78079 18.4162 4.86484 19.0103C4.28617 18.4205 3.77172 17.7489 3.33946 17.0002ZM11.9997 15.0002C10.3429 15.0002 8.99972 13.6571 8.99972 12.0002C8.99972 10.3434 10.3429 9.00021 11.9997 9.00021C13.6566 9.00021 14.9997 10.3434 14.9997 12.0002C14.9997 13.6571 13.6566 15.0002 11.9997 15.0002ZM11.9997 13.0002C12.552 13.0002 12.9997 12.5525 12.9997 12.0002C12.9997 11.4479 12.552 11.0002 11.9997 11.0002C11.4474 11.0002 10.9997 11.4479 10.9997 12.0002C10.9997 12.5525 11.4474 13.0002 11.9997 13.0002Z',
    writing: 'M6.93912 14.0328C6.7072 14.6563 6.51032 15.2331 6.33421 15.8155C7.29345 15.1189 8.43544 14.6767 9.75193 14.5121C12.2652 14.198 14.4976 12.5385 15.6279 10.4537L14.1721 8.99888L15.5848 7.58417C15.9185 7.25004 16.2521 6.91614 16.5858 6.58248C17.0151 6.15312 17.5 5.35849 18.0129 4.2149C12.4197 5.08182 8.99484 8.50647 6.93912 14.0328ZM17 8.99739L18 9.99669C17 12.9967 14 15.9967 10 16.4967C7.33146 16.8303 5.66421 18.6636 4.99824 21.9967H3C4 15.9967 6 1.99669 21 1.99669C20.0009 4.99402 19.0018 6.99313 18.0027 7.99402C17.6662 8.33049 17.3331 8.66382 17 8.99739Z',
    chat: 'M7.29117 20.8242L2 22L3.17581 16.7088C2.42544 15.3056 2 13.7025 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C10.2975 22 8.6944 21.5746 7.29117 20.8242ZM7.58075 18.711L8.23428 19.0605C9.38248 19.6745 10.6655 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 13.3345 4.32549 14.6175 4.93949 15.7657L5.28896 16.4192L4.63416 19.3658L7.58075 18.711Z',
  };
  const TYPE_LABEL = { build: 'Build', design: 'Design', fix: 'Fix and debug', research: 'Research', setup: 'Setup', writing: 'Writing', chat: 'Questions' };
  const RANGES = [[7, '7d', 'last 7 days'], [30, '30d', 'last 30 days'], [60, '60d', 'last 60 days'], [90, '90d', 'last 90 days'], [0, 'All', 'all time']];
  const escH = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtTok = (v) => (v >= 1e9 ? Number((v / 1e9).toFixed(v < 1e10 ? 2 : 1)) + 'B' : tokenShort(Math.round(v)));
  const fmtUsd = (v) => USD + (v >= 1e4 ? Number((v / 1e3).toFixed(1)) + 'k' : v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));
  const pct = (a, b) => (b ? (a / b) * 100 : 0);
  const nFix = (n) => n + (n === 1 ? ' fix' : ' fixes');
  const fmtPct = (v) => (v > 0 && v < 1 ? '<1' : v < 10 ? v.toFixed(1).replace(/\.0(?!\d)/, '') : String(Math.round(v))) + '%';
  const dayKey = (ts) => { const d = new Date(ts * 1000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  const fmtDay = (ts, long) => new Date(ts * 1000).toLocaleDateString('en-GB', long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' });
  const sinceTxt = (ts) => { const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

  let usageData = null, usageState = 'idle', usageDays = 7, dash = null, dashAnchor = null, dashSig = '', usagePage = false;
  function loadUsage(done) {
    const ref = qa('link[rel="stylesheet"]').find((l) => /\/webview\/index\.css/.test(l.href));
    if (!ref) { usageState = 'missing'; done(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.className = 'mkUsageLink';
    link.href = ref.href.replace(/\/webview\/index\.css.*/, '/resources/mk-usage.css') + '?v=' + Date.now();
    const finish = (ok) => {
      if (ok) {
        try {
          const probe = document.createElement('i');
          probe.className = 'mkUsageData';
          probe.hidden = true;
          dash.appendChild(probe);
          let raw = getComputedStyle(probe).getPropertyValue('--mk-usage').trim();
          probe.remove();
          if (raw.charAt(0) === '"' || raw.charAt(0) === "'") raw = raw.slice(1, -1);
          const bin = atob(raw);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          usageData = JSON.parse(new TextDecoder().decode(bytes));
          usageState = 'ready';
        } catch (e) { usageState = usageData ? 'ready' : 'missing'; }
      } else usageState = usageData ? 'ready' : 'missing';
      qa('link.mkUsageLink').forEach((l) => l.remove());
      done();
    };
    link.onload = () => finish(true);
    link.onerror = () => finish(false);
    document.head.appendChild(link);
  }

  function crunch(d, days) {
    const now = Date.now() / 1000;
    // calendar days: "7d" is today plus the 6 days before it; the previous period is the 7 days before that
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const from = days ? today.getTime() / 1000 - (days - 1) * 86400 : 0, before = days ? from - days * 86400 : -1;
    const blank = () => ({ tok: 0, inp: 0, cw: 0, cr: 0, out: 0, cost: 0, prompts: 0, fixes: 0, revs: 0, rework: 0, errs: 0, edits: 0, sub: 0 });
    const add = (o, t, tok) => {
      o.tok += tok; o.inp += t[3]; o.cw += t[4]; o.cr += t[5]; o.out += t[6]; o.cost += t[7]; o.prompts += t[12] || 0;
      o.fixes += t[8]; o.revs += t[13] || 0; o.errs += t[9]; o.edits += t[10];
      if (t[8] || t[13]) o.rework += tok;
      if (t[11]) o.sub += tok;
    };
    const cur = blank(), prev = blank(), areas = {}, types = {}, days_ = new Map(), sessions = [], files = {};
    let first = Infinity, friction = { int: 0, api: 0, cmp: 0 };
    d.sessions.forEach((s) => {
      let st = null;
      s.t.forEach((t) => {
        const tok = t[3] + t[4] + t[5] + t[6];
        if (t[0] < from) { if (t[0] >= before) add(prev, t, tok); return; }
        if (t[0] < first) first = t[0];
        add(cur, t, tok);
        const a = d.areas[t[1]] || 'General', ty = d.types[t[2]] || 'chat';
        add(areas[a] || (areas[a] = blank()), t, tok);
        add(types[ty] || (types[ty] = blank()), t, tok);
        const k = dayKey(t[0]);
        const b = days_.get(k) || { ts: t[0], ok: 0, re: 0, prompts: 0, cost: 0 };
        if (t[8] || t[13]) b.re += tok; else b.ok += tok;
        b.prompts += t[12] || 0; b.cost += t[7];
        days_.set(k, b);
        if (!st) st = Object.assign(blank(), { s, areas: {} });
        add(st, t, tok);
        st.areas[a] = (st.areas[a] || 0) + tok;
      });
      if (!st) return;
      sessions.push(st);
      friction.int += s.int || 0; friction.api += s.api || 0; friction.cmp += s.cmp || 0;
      (s.hot || []).forEach(([fp, n]) => { const f = files[fp] || (files[fp] = { n: 0, chats: 0 }); f.n += n; f.chats++; });
    });
    sessions.forEach((x) => { x.area = Object.entries(x.areas).sort((a, b) => b[1] - a[1])[0][0]; });
    return { cur, prev, areas, types, days: days_, sessions, files, friction, first: first === Infinity ? 0 : first, from, now };
  }

  // daily bars (weekly for long "All time" spans): first try in blue, rework (fixes + revisions) in amber on top
  function chartHtml(r, days) {
    const DAY = 86400;
    const start = days ? r.from : r.first;
    if (!start) return '';
    const span = Math.ceil((r.now - start) / DAY);
    const step = span > 120 ? 7 : 1;
    const buckets = [];
    const s0 = new Date(start * 1000); s0.setHours(0, 0, 0, 0);
    for (let t = s0.getTime() / 1000; t <= r.now; t += step * DAY) buckets.push({ ts: t, ok: 0, re: 0, prompts: 0, cost: 0 });
    r.days.forEach((b) => {
      const i = Math.min(buckets.length - 1, Math.max(0, Math.floor((b.ts - buckets[0].ts) / (step * DAY))));
      const x = buckets[i]; x.ok += b.ok; x.re += b.re; x.prompts += b.prompts; x.cost += b.cost;
    });
    const max = Math.max(1, ...buckets.map((b) => b.ok + b.re));
    const mag = Math.pow(10, Math.floor(Math.log10(max)));
    const top = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= max) || max;
    let h = '<div class="mkUChart" style="--n:' + buckets.length + '"><div class="mkUGrid"><span data-v="' + fmtTok(top) + '"></span><span data-v="' + fmtTok(top / 2) + '"></span><span data-v="0"></span></div><div class="mkUBars">';
    buckets.forEach((b, i) => {
      const tot = b.ok + b.re;
      const tip = (step > 1 ? 'Week of ' + fmtDay(b.ts, true) : fmtDay(b.ts, true)) + '|' + fmtTok(tot) + '|' + fmtTok(b.ok) + '|' + fmtTok(b.re) + '|' + b.prompts + '|' + fmtUsd(b.cost);
      h += '<div class="mkUBar" data-tip="' + escH(tip) + '" data-i="' + i + '">' +
        (b.re ? '<i class="re" style="height:' + pct(b.re, top).toFixed(2) + '%"></i>' : '') +
        (b.ok ? '<i class="ok" style="height:' + pct(b.ok, top).toFixed(2) + '%"></i>' : '') + '</div>';
    });
    const lab = (i) => (buckets[i] ? fmtDay(buckets[i].ts) : '');
    h += '</div><div class="mkUX"><span>' + lab(0) + '</span><span>' + lab(Math.floor((buckets.length - 1) / 2)) + '</span><span>' + (days ? 'Today' : lab(buckets.length - 1)) + '</span></div></div>';
    return h;
  }

  // what stands out: plain sentences, the most actionable first
  function insights(r) {
    const out = [];
    const c = r.cur;
    if (!c.tok) return out;
    const areas = Object.entries(r.areas).sort((a, b) => b[1].tok - a[1].tok);
    if (areas.length > 1) out.push(['info', '<b>' + escH(areas[0][0]) + '</b> used ' + fmtPct(pct(areas[0][1].tok, c.tok)) + ' of your tokens (' + fmtTok(areas[0][1].tok) + ', ' + fmtUsd(areas[0][1].cost) + ').']);
    const rw = areas.filter(([, v]) => v.tok > c.tok * 0.03 && v.rework).sort((a, b) => pct(b[1].rework, b[1].tok) - pct(a[1].rework, a[1].tok))[0];
    if (rw && pct(rw[1].rework, rw[1].tok) >= 5) {
      const what = [rw[1].fixes ? nFix(rw[1].fixes) : '', rw[1].revs ? plural(rw[1].revs, 'revision') : ''].filter(Boolean).join(' and ');
      out.push(['warn', '<b>' + escH(rw[0]) + '</b> took the most retries (' + what + '). ' + fmtPct(pct(rw[1].rework, rw[1].tok)) + ' of its tokens went to rework.']);
    }
    const long = r.sessions.filter((x) => x.prompts >= 25), short = r.sessions.filter((x) => x.prompts > 0 && x.prompts < 10);
    const per = (list) => list.reduce((a, x) => a + x.tok, 0) / Math.max(1, list.reduce((a, x) => a + x.prompts, 0));
    if (long.length >= 2 && short.length >= 2 && per(long) > per(short) * 1.5) out.push(['tip', 'A prompt in a long chat (25+ prompts) costs <b>' + (per(long) / per(short)).toFixed(1) + 'x</b> one in a short chat. Start a new chat when the task changes.']);
    const avg = c.tok / Math.max(1, c.prompts);
    const ty = Object.entries(r.types).filter(([, v]) => v.prompts >= 3).map(([k, v]) => [k, v.tok / v.prompts]).sort((a, b) => b[1] - a[1])[0];
    if (ty && ty[1] > avg * 1.4) out.push(['info', '<b>' + escH(TYPE_LABEL[ty[0]] || ty[0]) + '</b> prompts cost ' + (ty[1] / avg).toFixed(1) + 'x the average prompt (' + fmtTok(ty[1]) + ' vs ' + fmtTok(avg) + ').']);
    const hit = pct(c.cr, c.inp + c.cw + c.cr);
    if (hit < 80) out.push(['warn', 'Only ' + fmtPct(hit) + ' of input came from cache. Long pauses mid-chat let the cache expire.']);
    if (c.errs >= 20) out.push(['warn', '<b>' + c.errs + '</b> tool calls failed. Each failure is a round trip Claude pays for again.']);
    return out.slice(0, 4);
  }

  // share bar: first try then rework, a 2 px gap between them only when both exist
  const meter = (ok, re, max) => '<div class="mkUMeter">' + (ok > 0 ? '<i class="ok" style="width:' + pct(ok, max).toFixed(2) + '%"></i>' : '') +
    (re > 0 ? '<i class="re" style="width:max(2px, ' + pct(re, max).toFixed(2) + '%)"></i>' : '') + '</div>';
  function delta(curV, prevV, goodWhenDown) {
    if (!prevV || !isFinite(curV / prevV)) return '';
    const ch = ((curV - prevV) / prevV) * 100;
    if (Math.abs(ch) < 1) return '';
    const up = ch > 0;
    const tone = goodWhenDown === undefined ? 'flat' : up === goodWhenDown ? 'bad' : 'good';
    return '<em class="mkUD" data-t="' + tone + '">' + (up ? '+' : '−') + fmtPct(Math.abs(ch)) + '</em>';
  }

  function paintUsage() {
    if (!dash || dash.hidden) return;
    const range = RANGES.find((x) => x[0] === usageDays) || RANGES[0];
    let h = '<header class="mkUHead"><div><strong>Usage</strong><small>' +
      (usageData ? 'Updated ' + sinceTxt(usageData.at) + ' · ' + range[2] : usageState === 'loading' ? 'Loading' : 'No data yet') + '</small></div>' +
      '<div class="mkUSeg" role="tablist" aria-label="Time range">' + RANGES.map((x) => '<button type="button" role="tab" data-d="' + x[0] + '" aria-selected="' + (x[0] === usageDays) + '">' + x[1] + '</button>').join('') + '</div>' +
      '<button type="button" class="mkUExpand" aria-label="' + (usagePage ? 'Back to popup' : 'Open as page') + '" title="' + (usagePage ? 'Back to popup' : 'Open as page') + '">' +
      ico(usagePage ? UI.collapse : UI.expand, 16) + '</button>' +
      '<button type="button" class="mkUClose" aria-label="Close">' + ico(UI.close, 16) + '</button></header>';
    if (!usageData) {
      h += '<p class="mkUEmpty">' + (usageState === 'loading' ? 'Reading your chats.' : 'No usage data yet. It is written after Claude replies, by the Milo Kit usage hook. Reply once, then open this again.') + '</p>';
      dash.innerHTML = h;
      return wireUsage();
    }
    const r = crunch(usageData, usageDays);
    const c = r.cur, p = r.prev, hasPrev = usageDays && p.tok > 0;
    const hit = pct(c.cr, c.inp + c.cw + c.cr), hitPrev = pct(p.cr, p.inp + p.cw + p.cr);
    const reworkRate = pct(c.rework, c.tok), reworkPrev = pct(p.rework, p.tok);
    const kpi = (label, value, sub, d) => '<div class="mkUKpi"><span>' + label + '</span><div class="mkUKpiV"><b>' + value + '</b>' + (d || '') + '</div><small>' + sub + '</small></div>';
    h += '<div class="mkUBody">';
    if (!c.tok) {
      h += '<p class="mkUEmpty">Nothing in the ' + range[2] + '. Try a longer range.</p></div>';
      dash.innerHTML = h;
      return wireUsage();
    }
    h += '<div class="mkUKpis">' +
      kpi('Tokens', fmtTok(c.tok), plural(c.prompts, 'prompt') + ' · ' + plural(r.sessions.length, 'chat'), hasPrev ? delta(c.tok, p.tok) : '') +
      kpi('API value', fmtUsd(c.cost), fmtUsd(c.cost / Math.max(1, c.prompts)) + ' per prompt', hasPrev ? delta(c.cost, p.cost) : '') +
      kpi('Cache hit', fmtPct(hit), 'of input reused', hasPrev && hitPrev ? delta(hit, hitPrev, false) : '') +
      kpi('Rework', fmtPct(reworkRate), nFix(c.fixes) + ' · ' + plural(c.revs, 'revision'), hasPrev && reworkPrev ? delta(reworkRate, reworkPrev, true) : '') +
      '</div>';
    h += '<section class="mkUCard"><h4>Tokens per ' + (usageDays === 0 && (r.now - r.first) / 86400 > 120 ? 'week' : 'day') + '<span class="mkULegend"><i class="ok"></i>First try<i class="re"></i>Rework</span></h4>' + chartHtml(r, usageDays) + '</section>';
    const tips = insights(r);
    if (tips.length) h += '<section class="mkUCard mkUInsights"><h4>What stands out</h4><ul>' + tips.map((t) => '<li data-t="' + t[0] + '">' + t[1] + '</li>').join('') + '</ul></section>';
    // projects and kinds of work: share bar, tokens, cost, retry share
    const rows = (entries, labelOf, iconOf, limit) => {
      const max = Math.max(1, ...entries.map((e) => e[1].tok));
      return entries.slice(0, limit).map(([k, v]) => {
        const rr = pct(v.rework, v.tok);
        return '<li title="' + escH(labelOf(k) + ': ' + tokenLong(v.tok) + ' tokens, ' + plural(v.prompts, 'prompt') + ', ' + v.fixes + ' fixes, ' + v.revs + ' revisions') + '">' +
          (iconOf ? '<span class="mkUIco">' + iconOf(k) + '</span>' : '') +
          '<div class="mkURow"><div class="mkURowTop"><span>' + escH(labelOf(k)) + '</span><b>' + fmtTok(v.tok) + '</b></div>' +
          meter(v.tok - v.rework, v.rework, max) +
          '<div class="mkURowSub"><span>' + fmtUsd(v.cost) + ' · ' + (v.prompts ? plural(v.prompts, 'prompt') + ' · ' + fmtTok(v.tok / v.prompts) + ' each' : 'agent work only') + '</span>' +
          (rr >= 1 ? '<em data-t="' + (rr >= 15 ? 'bad' : rr >= 6 ? 'warn' : 'ok') + '">' + fmtPct(rr) + ' rework</em>' : '') + '</div></div></li>';
      }).join('');
    };
    const areaList = Object.entries(r.areas).sort((a, b) => b[1].tok - a[1].tok);
    const typeList = Object.entries(r.types).sort((a, b) => b[1].tok - a[1].tok);
    h += '<div class="mkUSplit"><section class="mkUCard"><h4>Projects<small>' + areaList.length + '</small></h4><ul class="mkUList">' + rows(areaList, (k) => k, null, 7) + '</ul>' +
      (areaList.length > 7 ? '<p class="mkUMore">+' + (areaList.length - 7) + ' more · ' + fmtTok(areaList.slice(7).reduce((a, e) => a + e[1].tok, 0)) + '</p>' : '') + '</section>' +
      '<section class="mkUCard"><h4>Kind of work</h4><ul class="mkUList">' + rows(typeList, (k) => TYPE_LABEL[k] || k, (k) => ico(UI[k] || UI.chat, 14), 7) + '</ul></section></div>';
    // chats that needed the most retries
    const worst = r.sessions.filter((x) => x.fixes + x.revs > 0).sort((a, b) => b.rework - a.rework).slice(0, 5);
    if (worst.length) {
      h += '<section class="mkUCard"><h4>Needed the most retries</h4><ul class="mkUList mkUChats">' + worst.map((x) => {
        const bits = [escH(x.area), fmtDay(x.s.end || x.s.start)];
        if (x.fixes) bits.push(nFix(x.fixes));
        if (x.revs) bits.push(plural(x.revs, 'revision'));
        if (x.errs) bits.push(plural(x.errs, 'tool error'));
        return '<li><div class="mkURow"><div class="mkURowTop"><span>' + escH(x.s.title) + '</span><b>' + fmtTok(x.rework) + '</b></div>' +
          meter(x.tok - x.rework, x.rework, x.tok) +
          '<div class="mkURowSub"><span>' + bits.join(' · ') + '</span><em data-t="warn">' + fmtPct(pct(x.rework, x.tok)) + ' of ' + fmtTok(x.tok) + '</em></div></div></li>';
      }).join('') + '</ul></section>';
    }
    // files edited again and again, and other friction
    const hot = Object.entries(r.files).filter((e) => e[1].n >= 4).sort((a, b) => b[1].n - a[1].n).slice(0, 5);
    const fr = [['Tool errors', c.errs], ['Interrupted', r.friction.int], ['API errors', r.friction.api], ['Compactions', r.friction.cmp]];
    h += '<div class="mkUSplit">';
    if (hot.length) {
      h += '<section class="mkUCard"><h4>Most re-edited files</h4><ul class="mkUList mkUFiles">' + hot.map(([fp, f]) => {
        const parts = fp.split('/');
        return '<li title="' + escH(fp) + '"><div class="mkURow"><div class="mkURowTop"><span>' + escH(parts.pop()) + '</span><b>' + f.n + ' edits</b></div>' +
          '<div class="mkURowSub"><span>' + escH(parts.slice(-2).join('/')) + '</span><em data-t="flat">' + plural(f.chats, 'chat') + '</em></div></div></li>';
      }).join('') + '</ul></section>';
    }
    h += '<section class="mkUCard"><h4>Friction</h4><div class="mkUFriction">' + fr.map(([k, v]) => '<div><b>' + v + '</b><span>' + k + '</span></div>').join('') + '</div>' +
      '<p class="mkUNote">Subagents used ' + fmtPct(pct(c.sub, c.tok)) + ' of tokens. Output was ' + fmtPct(pct(c.out, c.tok)) + '; the rest is context Claude re-reads each turn.</p></section></div>';
    h += '<p class="mkUFoot">From ' + plural(usageData.sessions.length, 'chat') + ' in ~/.claude/projects. API value is what the same tokens would cost on the API. Rework counts turns where you asked for a fix or a revision.</p></div>';
    dash.innerHTML = h;
    wireUsage();
  }

  function wireUsage() {
    qa('.mkUSeg button', dash).forEach((b) => b.addEventListener('click', () => { usageDays = Number(b.dataset.d); paintUsage(); const s = q('.mkUSeg [aria-selected="true"]', dash); if (s) s.focus(); }));
    const x = q('.mkUClose', dash);
    if (x) x.addEventListener('click', () => closeUsage(true));
    const ex = q('.mkUExpand', dash);
    if (ex) ex.addEventListener('click', () => setUsagePage(!usagePage));
    const tip = document.createElement('div');
    tip.className = 'mkUTip';
    tip.hidden = true;
    dash.appendChild(tip);
    qa('.mkUBar', dash).forEach((bar) => {
      bar.addEventListener('pointerenter', () => {
        const p = bar.dataset.tip.split('|');
        tip.innerHTML = '<strong>' + escH(p[0]) + '</strong><div><span>Total</span><b>' + p[1] + '</b></div><div><i class="ok"></i><span>First try</span><b>' + p[2] + '</b></div>' +
          '<div><i class="re"></i><span>Rework</span><b>' + p[3] + '</b></div><div><span>Prompts</span><b>' + p[4] + '</b></div><div><span>API value</span><b>' + escH(p[5]) + '</b></div>';
        tip.hidden = false;
        const br = bar.getBoundingClientRect(), dr = dash.getBoundingClientRect();
        const w = tip.offsetWidth, ht = tip.offsetHeight;
        tip.style.left = Math.max(8, Math.min(dr.width - w - 8, br.left - dr.left + br.width / 2 - w / 2)) + 'px';
        tip.style.top = (br.top - dr.top + dash.scrollTop - ht - 8) + 'px';
        bar.setAttribute('data-on', '');
      });
      bar.addEventListener('pointerleave', () => { tip.hidden = true; bar.removeAttribute('data-on'); });
    });
  }

  // popup (anchored to the button) or page (fills the whole Claude panel, content centred). Esc: page -> popup -> closed.
  function setUsagePage(on) {
    usagePage = on;
    dash.toggleAttribute('data-page', on);
    placeUsage();
    paintUsage();
    dash.scrollTop = 0;
    const b = q('.mkUExpand', dash);
    if (b) b.focus();
  }
  function placeUsage() {
    if (usagePage) { ['left', 'top', 'bottom', 'width', 'maxHeight'].forEach((k) => { dash.style[k] = ''; }); return; }
    const w = Math.min(720, window.innerWidth - 24);
    dash.style.width = w + 'px';
    // opened from the sessions sidebar (no button in this pane): float centred over the chat, just below its header
    if (!dashAnchor || !dashAnchor.isConnected) {
      const top = Math.min(56, Math.round(window.innerHeight * 0.08));
      dash.style.left = Math.round((window.innerWidth - w) / 2) + 'px';
      dash.style.top = top + 'px';
      dash.style.bottom = '';
      dash.style.maxHeight = (window.innerHeight - top - 16) + 'px';
      return;
    }
    const r = dashAnchor.getBoundingClientRect();
    dash.style.left = Math.max(12, Math.min(r.right - w + 40, window.innerWidth - w - 12)) + 'px';
    // open below the button; flip above it when the button sits low and there is more room on top
    const below = window.innerHeight - r.bottom - 22, above = r.top - 22;
    if (below >= 420 || below >= above) {
      dash.style.bottom = '';
      dash.style.top = (r.bottom + 10) + 'px';
      dash.style.maxHeight = below + 'px';
    } else {
      dash.style.top = '';
      dash.style.bottom = (window.innerHeight - r.top + 10) + 'px';
      dash.style.maxHeight = above + 'px';
    }
  }
  function closeUsage(focus) {
    if (!dash || dash.hidden) return;
    dash.hidden = true;
    usagePage = false;
    dash.removeAttribute('data-page');
    if (dashAnchor) dashAnchor.setAttribute('aria-pressed', 'false');
    if (focus && dashAnchor) dashAnchor.focus();
  }
  function toggleUsage(anchor) {
    if (dash && !dash.hidden) { closeUsage(true); return; }
    openUsage(anchor);
  }
  // the sessions sidebar's request arrives as Claude's own "open Account & usage" message plus mk:1; the webview patch
  // turns that into a "mk-dash" event instead of Claude's dialog (build-chat-extras section 2b d).
  window.addEventListener('mk-dash', (e) => {
    if (typeof e.detail === 'string' && e.detail.indexOf('skill:') === 0) return; // a skill action (section 15)
    if (dash && !dash.hidden) { dash.scrollTop = 0; return; }
    openUsage(null);
  });
  function openUsage(anchor) {
    if (!dash) {
      dash = document.createElement('div');
      dash.className = 'mkUsage';
      dash.setAttribute('role', 'dialog');
      dash.setAttribute('aria-label', 'Usage dashboard');
      document.body.appendChild(dash);
      document.addEventListener('pointerdown', (e) => {
        if (dash.hidden || dash.contains(e.target) || (dashAnchor && dashAnchor.contains(e.target))) return;
        closeUsage(false);
      }, true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dash.hidden) { e.stopPropagation(); if (usagePage) setUsagePage(false); else closeUsage(true); } }, true);
      window.addEventListener('resize', () => { if (!dash.hidden) placeUsage(); });
    }
    dashAnchor = anchor;
    usageDays = 7;
    dash.hidden = false;
    if (!usageData) usageState = 'loading';
    placeUsage();
    paintUsage();
    const sel = q('.mkUSeg [aria-selected="true"]', dash);
    if (sel) sel.focus();
    loadUsage(() => { if (!dash.hidden) { paintUsage(); const s = q('.mkUSeg [aria-selected="true"]', dash); if (s && dash.contains(document.activeElement)) s.focus(); } });
  }

  // 13. Final reply bubble: the last text reply of each finished turn sits in a static bubble (no sticky, no motion).
  //     A turn ends at the next user message; the reply counts only if no tool row follows it. The current turn
  //     is skipped while Claude is busy so the bubble never hops between blocks mid-reply. Attribute only.
  //     One exception: a reply streaming in a turn with no tool calls yet forms in place. It gets the bubble's full
  //     shape from its first line, fill held back by data-mk-forming, so when the turn ends only the fill fades in
  //     and the text never moves. If a tool call follows (a preamble), it eases back to plain text.
  function syncFinal() {
    const sc = scroller();
    if (!sc) return;
    let busy = false;
    try { busy = !!(window.__mkS && window.__mkS.busy && window.__mkS.busy.value); } catch (e) {}
    const rows = qa('[class*="timelineMessage_"], [class*="userMessageContainer_"]', sc).filter((el) => {
      const up = el.parentElement && el.parentElement.closest('[class*="timelineMessage_"], [class*="userMessageContainer_"]');
      return !up || !sc.contains(up);
    });
    const finals = new Set();
    let cand = null, turnTools = false;
    rows.forEach((el) => {
      if (String(el.className).indexOf('userMessageContainer_') >= 0) { if (cand) finals.add(cand); cand = null; turnTools = false; return; }
      const md = q('[data-mk-md]', el);
      const tool = !!q('[class*="toolSummary_"], [class*="toolBody_"]', el);
      if (tool) turnTools = true;
      const text = md && !tool && !md.closest('[class*="thinking"]');
      cand = text ? md : null;
    });
    const forming = cand && busy && !turnTools ? cand : null;
    if (cand && (!busy || forming)) finals.add(cand);
    // set before data-mk-bubble (same frame): a forming bubble never flashes its fill
    qa('[data-mk-forming]').forEach((m) => { if (m !== forming) m.removeAttribute('data-mk-forming'); });
    if (forming && !forming.hasAttribute('data-mk-forming')) forming.setAttribute('data-mk-forming', '');
    // the row gets data-mk-bubble-row: Claude's copy / bookmark row and the avatar are placed against the bubble
    const rowsOn = new Set(Array.from(finals).map((m) => m.closest('[class*="timelineMessage_"]')).filter(Boolean));
    qa('[data-mk-bubble]').forEach((m) => { if (!finals.has(m)) m.removeAttribute('data-mk-bubble'); });
    qa('[data-mk-bubble-row]').forEach((r) => { if (!rowsOn.has(r)) r.removeAttribute('data-mk-bubble-row'); });
    finals.forEach((m) => { if (!m.hasAttribute('data-mk-bubble')) m.setAttribute('data-mk-bubble', ''); });
    rowsOn.forEach((r) => { if (!r.hasAttribute('data-mk-bubble-row')) r.setAttribute('data-mk-bubble-row', ''); });
    finals.forEach((m) => {
      const r = m.closest('[data-mk-bubble-row]');
      if (!r) return;
      // --mk-av-bottom: the bubble's bottom edge measured up from the row's padding edge, so the avatar's bottom
      // lines up with the bubble's whatever runs below it. The avatar is absolute: no feedback into layout.
      const base = m.getBoundingClientRect().bottom;
      const rr = r.getBoundingClientRect();
      const av = Math.max(0, Math.round(rr.bottom - (parseFloat(getComputedStyle(r).borderBottomWidth) || 0) - base)) + 'px';
      if (r.style.getPropertyValue('--mk-av-bottom') !== av) r.style.setProperty('--mk-av-bottom', av);
    });
    placeActs();
  }
  // Claude's copy / bookmark pill, placed by script (CSS sticky could not measure Claude's row reliably):
  // bottom 8px inside the bubble, but never lower than 12px above the message box, and never above the bubble's
  // top + 8px. Moved with translateY only, so layout never changes and nothing feeds back.
  function placeActs() {
    const box = q('[class*="inputContainer_"][data-permission-mode]');
    const cap = box ? box.getBoundingClientRect().top - 12 : Infinity;
    qa('[data-mk-bubble-row] > [data-message-actions]').forEach((bar) => {
      const md = q(':scope > [data-mk-bubble], :scope > * [data-mk-bubble]', bar.parentElement);
      if (!md) return;
      const b = md.getBoundingClientRect(), a = bar.getBoundingClientRect();
      const was = parseFloat(bar.dataset.mkY || '0') || 0;
      const lo = b.bottom - 8;
      const target = Math.max(Math.min(lo, cap), Math.min(lo, b.top + 8 + a.height));
      const y = Math.round(target - (a.bottom - was));
      if (y !== was) { bar.dataset.mkY = String(y); bar.style.setProperty('--mk-act-y', y + 'px'); }
    });
  }
  let actsRaf = 0;
  document.addEventListener('scroll', (e) => {
    if (!isChatScroller(e.target) || actsRaf) return;
    actsRaf = requestAnimationFrame(() => { actsRaf = 0; placeActs(); });
  }, true);
  window.addEventListener('resize', () => placeActs());

  // 12. Model menu: Claude opens it as the slash-command popup, pinned to the message box's left edge at full width.
  //     Anchor it to the model pill instead: just above the pill, left-aligned, flipped to right-aligned near the edge.
  //     Inline styles only on the popup (React gives it no style prop, so nothing overwrites them).
  function placeModelMenu() {
    const pill = q('[class*="modelPill_"][aria-expanded="true"]');
    const list = pill && document.getElementById(pill.getAttribute('aria-controls') || '');
    const menu = list && list.closest('[class*="menuPopup_"]');
    const host = menu && menu.offsetParent;
    if (!host) return;
    const hr = host.getBoundingClientRect(), pr = pill.getBoundingClientRect();
    const w = Math.min(320, hr.width - 8);
    let left = pr.left - hr.left;
    if (left + w > hr.width - 4) left = Math.max(4, pr.right - hr.left - w);
    const s = menu.style;
    s.right = 'auto';
    s.width = w + 'px';
    s.left = Math.round(left) + 'px';
    s.bottom = Math.round(hr.bottom - pr.top + 6) + 'px';
    s.marginBottom = '0';
  }

  // 14. Quotes and replies. Select text anywhere in the chat and an "Add to chat" pill appears over it. Reply on a
  //     bubble (Claude's final reply or your own message) quotes the whole message. Each quote becomes a real
  //     attachment in the message box: a small text file in Claude's own attachment row (same pill as files and
  //     screenshots). Claude receives it as a titled document block, and your sent message shows it as a pill.
  //     Pill label "Claude: “first words…”" / "You: …" / "Chat: …"; syncQuotes() tags those pills for the quote icon.
  const QUOTE_RE = /^(Claude|You|Chat): “/;
  const focusComposer = () => { const b = composerInput(); if (b) b.focus(); };
  const readAsUrl = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  async function addQuote(text, from) {
    const s = window.__mkS;
    const body = String(text || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!body || !s || !s.composerAttachments) return false;
    const flat = norm(body);
    const name = from + ': “' + (flat.length > 48 ? flat.slice(0, 46).trimEnd() + '…' : flat) + '”';
    const lead = from === 'You' ? 'Quoted from one of my earlier messages in this chat.'
      : from === 'Claude' ? 'Quoted from one of your earlier replies in this chat.' : 'Quoted from earlier in this chat.';
    const file = new File([lead + ' My message refers to it.\n\n' + body], name, { type: 'text/plain' });
    const list = s.composerAttachments.value || [];
    if (list.some((a) => a && a.file && a.file.name === name && a.file.size === file.size)) return true; // already added
    try { s.composerAttachments.value = list.concat([{ file, dataUrl: await readAsUrl(file) }]); } catch (e) { return false; }
    return true;
  }

  // where a node sits: your bubble (or a held one) = You, anything else in the chat = Claude
  const quoteFrom = (node) => {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el && el.closest('[class^="userMessage_"], [class*=" userMessage_"], .mkHeld') ? 'You' : 'Claude';
  };
  function selInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const sc = scroller();
    const range = sel.getRangeAt(0);
    const anc = range.commonAncestorContainer;
    const ancEl = anc && (anc.nodeType === 1 ? anc : anc.parentElement);
    if (!sc || !ancEl || !sc.contains(ancEl) || ancEl.closest('[contenteditable], textarea, input')) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const rects = Array.from(range.getClientRects()).filter((r) => r.width || r.height);
    if (!rects.length) return null;
    const a = quoteFrom(sel.anchorNode), f = quoteFrom(sel.focusNode);
    return { text, from: a === f ? a : 'Chat', rects };
  }

  const qbtn = document.createElement('button');
  qbtn.type = 'button';
  qbtn.className = 'mkQuoteBtn';
  qbtn.hidden = true;
  qbtn.setAttribute('aria-label', 'Add selection to chat');
  qbtn.innerHTML = '<i aria-hidden="true"></i><span>Add to chat</span>';
  document.body.appendChild(qbtn);
  let qsel = null, qTimer = 0, dragging = false;
  // centred over the selection's first line; below its last line when that would leave the chat's top edge.
  // Hidden while the selection is scrolled out of view or under the message box.
  function placeQuoteBtn() {
    qsel = off('quote') ? null : selInfo();
    if (!qsel) { qbtn.hidden = true; return; }
    const sr = scroller().getBoundingClientRect();
    const input = q('[class*="inputContainer_"]');
    const floor = Math.min(sr.bottom, input ? input.getBoundingClientRect().top : sr.bottom) - 4;
    const first = qsel.rects[0], last = qsel.rects[qsel.rects.length - 1];
    const l = Math.min.apply(null, qsel.rects.map((r) => r.left)), r = Math.max.apply(null, qsel.rects.map((x) => x.right));
    qbtn.hidden = false;
    const w = qbtn.offsetWidth, h = qbtn.offsetHeight;
    let top = first.top - h - 8;
    if (top < sr.top + 4) top = last.bottom + 8;
    if (top < sr.top + 4 || top + h > floor) { qbtn.hidden = true; return; }
    const left = Math.max(sr.left + 6, Math.min(Math.round((l + r) / 2 - w / 2), sr.right - w - 6));
    qbtn.style.left = left + 'px';
    qbtn.style.top = Math.round(top) + 'px';
  }
  const queuePlace = (ms) => { clearTimeout(qTimer); qTimer = setTimeout(placeQuoteBtn, ms); };
  document.addEventListener('mousedown', (e) => {
    if (e.target instanceof Element && e.target.closest('.mkQuoteBtn')) { e.preventDefault(); return; } // keep the selection
    dragging = true;
    qbtn.hidden = true;
  }, true);
  document.addEventListener('mouseup', () => { dragging = false; queuePlace(10); }, true);
  document.addEventListener('selectionchange', () => { if (!dragging) queuePlace(150); });
  document.addEventListener('scroll', () => { if (!qbtn.hidden) placeQuoteBtn(); }, true);
  window.addEventListener('resize', () => { if (!qbtn.hidden) placeQuoteBtn(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') qbtn.hidden = true; }, true);
  qbtn.addEventListener('click', async () => {
    const info = qsel || selInfo();
    qbtn.hidden = true;
    if (!info || !(await addQuote(info.text, info.from))) return;
    try { window.getSelection().removeAllRanges(); } catch (e) {}
    focusComposer();
  });

  // Hover to add: rest the pointer on a file or an image in the chat for 1 s and the same "Add to chat" pill appears.
  // Files (file chips, file links, @-mention chips, blocked markdown images) go in through Claude's own @-mention event,
  // the one its "Insert @-mention" shortcut uses, so the message box gets a real file mention. Images shown in the chat
  // are added as image attachments, like a pasted screenshot.
  // path + optional line range: "a.js:42" and "a.js#L42-51" both become "a.js#L42-51"
  function mentionPath(raw) {
    const p = String(raw || '').trim().replace(/^file:\/\//, '').replace(/^\.\//, '');
    let s = p;
    try { s = decodeURI(p); } catch (e) {}
    const m = /^(.*?)(?:[:#]L?(\d+)(?:-L?(\d+))?)?(?![\s\S])/.exec(s);
    const base = m ? m[1] : s;
    if (!base || /^[a-z][\w+.-]*:/i.test(base) || base.charAt(0) === '#') return ''; // local paths only
    return base + (m && m[2] ? '#L' + m[2] + (m[3] ? '-' + m[3] : '') : '');
  }
  // Tool rows (Read, Edit, Write ...) show only the file's base name. The full path is in the row's React props:
  // walk up the element's fiber and take the first file_path / notebook_path found a few levels into the props.
  function toolPath(el) {
    const key = Object.keys(el).find((k) => k.indexOf('__reactFiber') === 0);
    let f = key && el[key], seen = 0;
    const find = (o, d) => {
      if (!o || typeof o !== 'object' || d > 3 || ++seen > 400) return '';
      for (const k of ['file_path', 'notebook_path']) if (typeof o[k] === 'string' && o[k]) return o[k];
      for (const k in o) {
        if (k === '_owner' || k === 'children' && d > 1) continue;
        const v = o[k];
        if (v && typeof v === 'object') { const r = find(v, d + 1); if (r) return r; }
      }
      return '';
    };
    for (let i = 0; f && i < 30; i++, f = f.return) {
      // stop at the first DOM node that holds more than one tool row: past it, props belong to other rows too
      const n = f.stateNode;
      if (n instanceof Element && n.querySelectorAll('[class*="toolNameText_"]').length > 1) return '';
      seen = 0;
      const p = find(f.memoizedProps, 0);
      if (p) return p;
    }
    return '';
  }
  function hoverTarget(el) {
    const sc = scroller();
    if (!sc || !(el instanceof Element) || !sc.contains(el)) return null;
    const thumb = el.closest('.mkThumb');
    if (thumb) return thumb; // the kit's own image preview on Read rows
    if (el.closest('[contenteditable], textarea, input, ' + OWN)) return null;
    return el.closest('[class*="toolNameTextSecondary_"]') || el.closest('a[href]') || el.closest('[class*="mentionChip_"]')
      || el.closest('span[title^="Image blocked: "]') || el.closest('code[data-mk-t="file"]') || el.closest('img');
  }
  function hoverItem(t) {
    if (t.classList.contains('mkThumb')) { const im = q('img', t); return im ? { kind: 'image', img: im } : null; }
    if (t.tagName === 'IMG') return t.width >= 32 && t.height >= 32 ? { kind: 'image', img: t } : null;
    let p = '';
    if (String(t.className).indexOf('toolNameTextSecondary_') >= 0) p = mentionPath(toolPath(t));
    else if (t.tagName === 'A') p = mentionPath(t.getAttribute('href'));
    else if (t.tagName === 'CODE') p = mentionPath(t.textContent);
    else if (/^Image blocked: /.test(t.title)) p = mentionPath(t.title.slice(15));
    else p = mentionPath((t.getAttribute('title') || '').replace(/^Open /, '') || (t.textContent || '').replace(/^@/, ''));
    return p ? { kind: 'file', path: p } : null;
  }
  function addMention(p) {
    const c = window.__ccConn, ev = c && c.atMentionEvents;
    if (!ev || typeof ev.emit !== 'function') return false;
    ev.emit('@' + p);
    return true;
  }
  // Claude takes png / jpeg / gif / webp only: anything else (svg previews) is redrawn as png
  function imageUrl(img) {
    const src = img.currentSrc || img.src || '';
    if (/^data:image\/(png|jpe?g|gif|webp)[;,]/.test(src)) return src;
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/png');
    } catch (e) { return ''; } // cross-origin image: canvas is tainted
  }
  async function addImage(img) {
    const s = window.__mkS, url = imageUrl(img);
    if (!url || !s || !s.composerAttachments) return false;
    const comma = url.indexOf(','), head = url.slice(5, comma), body = url.slice(comma + 1);
    const type = head.split(';')[0] || 'image/png';
    let bin;
    try { bin = atob(body); } catch (e) { return false; } // imageUrl only returns base64 png / jpeg / gif / webp
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const alt = norm(img.getAttribute('alt') || '').replace(/\.\w+(?![\s\S])/, '').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
    const file = new File([bytes], (alt || 'Image from chat') + '.' + ext, { type });
    const list = s.composerAttachments.value || [];
    if (list.some((a) => a && a.file && a.file.name === file.name && a.file.size === file.size)) return true;
    try { s.composerAttachments.value = list.concat([{ file, dataUrl: url }]); } catch (e) { return false; }
    return true;
  }

  const hbtn = document.createElement('button');
  hbtn.type = 'button';
  hbtn.className = 'mkQuoteBtn';
  hbtn.hidden = true;
  hbtn.setAttribute('data-mk-hover', '');
  hbtn.innerHTML = '<i aria-hidden="true"></i><span>Add to chat</span>';
  document.body.appendChild(hbtn);
  let hEl = null, hItem = null, hTimer = 0, hHide = 0;
  function hoverHide() {
    clearTimeout(hTimer); clearTimeout(hHide);
    hTimer = hHide = 0;
    hbtn.hidden = true;
    hEl = hItem = null;
  }
  // files: centred above the element (below when that leaves the chat). Images: inside the top-right corner.
  function showHover() {
    hTimer = 0;
    const sc = scroller();
    if (!sc || !hEl || !hEl.isConnected || off('quote') || !qbtn.hidden || dragging || String(getSelection() || '').length) return;
    hItem = hoverItem(hEl);
    if (!hItem) return;
    const img = hItem.kind === 'image';
    hbtn.setAttribute('data-kind', hItem.kind);
    hbtn.setAttribute('aria-label', img ? 'Add image to chat' : 'Add ' + hItem.path + ' to chat');
    hbtn.title = img ? '' : '@' + hItem.path;
    const sr = sc.getBoundingClientRect(), r = hEl.getBoundingClientRect();
    const input = q('[class*="inputContainer_"]');
    const floor = Math.min(sr.bottom, input ? input.getBoundingClientRect().top : sr.bottom) - 4;
    hbtn.hidden = false;
    const w = hbtn.offsetWidth, h = hbtn.offsetHeight;
    let top, left;
    if (img) {
      top = Math.max(r.top, sr.top + 4) + 8;
      left = Math.min(r.right, sr.right) - w - 8;
    } else {
      top = r.top - h - 6;
      if (top < sr.top + 4) top = r.bottom + 6;
      left = (r.left + r.right) / 2 - w / 2;
    }
    if (top < sr.top + 4 || top + h > floor) { hbtn.hidden = true; return; }
    hbtn.style.left = Math.round(Math.max(sr.left + 6, Math.min(left, sr.right - w - 6))) + 'px';
    hbtn.style.top = Math.round(top) + 'px';
  }
  document.addEventListener('mouseover', (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest('[data-mk-hover]')) { clearTimeout(hHide); hHide = 0; return; }
    const el = hoverTarget(t);
    if (el && el === hEl) { clearTimeout(hHide); hHide = 0; return; }
    if (!hbtn.hidden && !el) { if (!hHide) hHide = setTimeout(hoverHide, 250); return; } // grace to reach the pill
    hoverHide();
    if (!el || off('quote')) return;
    hEl = el;
    hTimer = setTimeout(showHover, 1000);
  }, true);
  document.documentElement.addEventListener('mouseleave', hoverHide);
  document.addEventListener('mousedown', (e) => { if (!(e.target instanceof Element && e.target.closest('[data-mk-hover]'))) hoverHide(); }, true);
  document.addEventListener('scroll', () => { if (hEl) hoverHide(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hoverHide(); }, true);
  hbtn.addEventListener('click', async () => {
    const item = hItem;
    hoverHide();
    if (!item) return;
    if (item.kind === 'file') addMention(item.path);
    else if (await addImage(item.img)) focusComposer();
  });

  // Reply buttons: first in Claude's copy / bookmark row on final reply bubbles; on your bubble's bottom-right corner
  // (on the bubble's container: the bubble itself clips overflow). Icon only, no text, so message textContent
  // (chat map, held-message matching) is unchanged.
  function replyButton(getText, from) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mkReply';
    b.title = 'Reply';
    b.setAttribute('aria-label', 'Reply');
    b.addEventListener('click', async (e) => { e.stopPropagation(); if (await addQuote(getText(), from)) focusComposer(); });
    return b;
  }
  const userText = (um) => {
    const c = um.cloneNode(true);
    c.querySelectorAll('button, [class*="userMessageAttachments_"]').forEach((n) => n.remove());
    return c.textContent;
  };
  function syncReplies() {
    const sc = scroller();
    if (!sc) return;
    const on = !off('quote');
    qa('.mkReply', sc).forEach((b) => {
      const p = b.parentElement;
      const stale = p && p.hasAttribute('data-message-actions') && !(p.parentElement && p.parentElement.hasAttribute('data-mk-bubble-row'));
      if (!on || stale) b.remove();
    });
    if (!on) return;
    qa('[data-mk-bubble-row] > [data-message-actions]', sc).forEach((bar) => {
      if (q(':scope > .mkReply', bar)) return;
      const row = bar.parentElement;
      bar.insertBefore(replyButton(() => { const md = q('[data-mk-bubble]', row); return md ? md.innerText : ''; }, 'Claude'), bar.firstChild);
    });
    // your bubble: Reply goes first inside Claude's "Message actions" holder, which becomes one pill styled like
    // Claude's copy / bookmark row (data-mk-uacts). No holder (held / read-only messages): Reply alone on the container.
    qa('[class^="userMessage_"], [class*=" userMessage_"]', sc).forEach((um) => {
      const box = um.parentElement;
      if (!box || String(box.className).indexOf('userMessageContainer_') < 0) return;
      const more = q(':scope > * > button[title="Message actions"]', box);
      const host = more ? more.parentElement : box;
      if (more && !host.hasAttribute('data-mk-uacts')) host.setAttribute('data-mk-uacts', '');
      // --mk-ub-r / --mk-ub-b: the bubble's right / bottom edge measured in from the container's padding box, so the
      // pill (absolute on the container) sits 8px inside the bubble's corner. Reads the bubble only: no feedback.
      const br = box.getBoundingClientRect(), ur = um.getBoundingClientRect(), cs = getComputedStyle(box);
      const ubr = Math.round(br.right - (parseFloat(cs.borderRightWidth) || 0) - ur.right) + 'px';
      const ubb = Math.round(br.bottom - (parseFloat(cs.borderBottomWidth) || 0) - ur.bottom) + 'px';
      if (box.style.getPropertyValue('--mk-ub-r') !== ubr) box.style.setProperty('--mk-ub-r', ubr);
      if (box.style.getPropertyValue('--mk-ub-b') !== ubb) box.style.setProperty('--mk-ub-b', ubb);
      qa(':scope > .mkReply', box).forEach((b) => { if (host !== box) b.remove(); });
      if (q(':scope > .mkReply', host)) return;
      const b = replyButton(() => userText(um), 'You');
      if (host === box) { b.setAttribute('data-solo', ''); box.appendChild(b); } else host.insertBefore(b, host.firstChild);
    });
  }
  // quote pills (message box and sent messages) get data-mk-quote: quote icon, blue tint
  function syncQuotes() {
    qa('[class^="pill_"], [class*=" pill_"]').forEach((p) => {
      const l = q('[class*="label_"]', p);
      const isQ = !!l && QUOTE_RE.test(l.textContent || '');
      if (isQ !== p.hasAttribute('data-mk-quote')) { if (isQ) p.setAttribute('data-mk-quote', ''); else p.removeAttribute('data-mk-quote'); }
    });
  }

  // 15. Skills: a "Skills" section in the sessions sidebar, between Account & usage and Session manager. It borrows
  //     Claude's own section header (same toggle, chevron and label) and a card like the account card. Each skill
  //     opens to its actions; clicking an action puts its text in the message box. The list comes from lib/skills.js
  //     (resources/mk-skills.css, base64 JSON keyed by account email). The sidebar is its own webview, so the text
  //     rides Claude's "open Account & usage" request with mk:"skill:<text>" to the chat pane (see section 11).
  const SK = {
    bolt: 'M13 10H20L11 23V14H4L13 1V10Z',
    add: 'M11 11V5H13V11H19V13H13V19H11V13H5V11H11Z',
    check: 'M10.0007 15.1709L19.1931 5.97852L20.6073 7.39273L10.0007 17.9993L3.63672 11.6354L5.05093 10.2212L10.0007 15.1709Z',
    search: 'M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748Z',
    chev: 'M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z',
  };
  let skStore = null, skState = 'idle', skHead = null, skBody = null, skOpenName = '', skQuery = '', skSig = '';
  let skCollapsed = store.get('mkSkills') !== 'open';

  function loadSkills(done) {
    const ref = qa('link[rel="stylesheet"]').find((l) => /\/webview\/index\.css/.test(l.href));
    if (!ref) { skState = 'missing'; done(); return; }
    skState = skStore ? 'ready' : 'loading';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.className = 'mkSkillsLink';
    link.href = ref.href.replace(/\/webview\/index\.css.*/, '/resources/mk-skills.css') + '?v=' + Date.now();
    const finish = (ok) => {
      if (ok) {
        try {
          const probe = document.createElement('i');
          probe.className = 'mkSkillsData';
          probe.hidden = true;
          document.body.appendChild(probe);
          let raw = getComputedStyle(probe).getPropertyValue('--mk-skills').trim();
          probe.remove();
          if (raw.charAt(0) === '"' || raw.charAt(0) === "'") raw = raw.slice(1, -1);
          const bin = atob(raw);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          skStore = JSON.parse(new TextDecoder().decode(bytes));
          skState = 'ready';
        } catch (e) { skState = skStore ? 'ready' : 'missing'; }
      } else skState = skStore ? 'ready' : 'missing';
      qa('link.mkSkillsLink').forEach((l) => l.remove());
      done();
    };
    link.onload = () => finish(true);
    link.onerror = () => finish(false);
    document.head.appendChild(link);
  }

  // this account's groups: matched by the email on the Account card, else the last one seen, else the newest
  function skGroups() {
    const acc = (skStore && skStore.accounts) || {};
    const shown = q('[class*="accountUsageBody_"] [class*="accountValue_"]');
    const email = shown ? norm(shown.textContent) : '';
    if (email) store.set('mkSkillsEmail', email);
    const key = [email, store.get('mkSkillsEmail') || ''].find((k) => k && acc[k]);
    if (key) return acc[key].groups || [];
    const newest = Object.values(acc).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    return newest ? newest.groups || [] : [];
  }

  function skMatch(s, words) {
    if (!words.length) return true;
    const hay = (s.n + ' ' + s.d + ' ' + s.a.map((a) => a[0] + ' ' + a[1]).join(' ')).toLowerCase();
    return words.every((w) => hay.indexOf(w) >= 0);
  }

  function paintSkills() {
    if (!skBody) return;
    const list = q('.mkSkList', skBody);
    const groups = skGroups();
    const total = groups.reduce((a, g) => a + g.skills.length, 0);
    const count = q('.mkSkCount', skHead);
    if (count) count.textContent = total ? String(total) : '';
    const words = skQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const sig = JSON.stringify([skState, skQuery, skOpenName, groups.map((g) => g.label + g.skills.map((s) => s.n + s.a.length).join())]);
    if (sig === skSig) return;
    skSig = sig;
    if (skState === 'loading' && !total) { list.innerHTML = '<p class="mkSkEmpty">Loading skills…</p>'; return; }
    if (!total) { list.innerHTML = '<p class="mkSkEmpty">No skills found. Open Milo Kit settings once, or run <code>node lib/skills.js</code> in the kit folder.</p>'; return; }
    let h = '', shown = 0;
    groups.forEach((g, gi) => {
      const items = g.skills.map((s, si) => [s, si]).filter(([s]) => skMatch(s, words));
      if (!items.length) return;
      shown += items.length;
      h += '<div class="mkSkGroup"><span>' + escH(g.label) + '</span><em>' + items.length + '</em></div>';
      items.forEach(([s, si]) => {
        const open = s.n === skOpenName;
        const id = 'mkSk' + gi + '_' + si;
        h += '<div class="mkSkItem"' + (open ? ' data-open' : '') + '>' +
          '<button type="button" class="mkSkRow" data-name="' + escH(s.n) + '" title="' + escH(s.n + (s.d && !open ? '\n' + s.d : '')) + '" aria-expanded="' + open + '" aria-controls="' + id + '">' +
          '<i class="mkSkBolt">' + ico(SK.bolt, 13) + '</i><span class="mkSkName">' + escH(s.n) + '</span>' +
          '<em class="mkSkN" title="' + s.a.length + (s.a.length === 1 ? ' action' : ' actions') + '">' + s.a.length + '</em>' +
          '<i class="mkSkChev">' + ico(SK.chev, 14) + '</i></button>';
        if (open) {
          h += '<div class="mkSkDetail" id="' + id + '">' + (s.d ? '<p class="mkSkDesc">' + escH(s.d) + '</p>' : '') + '<ul class="mkSkActs">' +
            s.a.map((a) => '<li><button type="button" class="mkSkAct" data-text="' + escH(a[2]) + '" title="Add to chat: ' + escH(a[2].trim()) + '">' +
              '<span class="mkSkActTx"><b>' + escH(a[0]) + '</b><small>' + escH(a[1]) + '</small></span>' +
              '<i class="mkSkAdd" aria-hidden="true">' + ico(SK.add, 14) + '</i></button></li>').join('') +
            '</ul></div>';
        }
        h += '</div>';
      });
    });
    list.innerHTML = shown ? h : '<p class="mkSkEmpty">No skills match “' + escH(skQuery) + '”.</p>';
  }

  // the action's text into the message box: slash commands go first, plain text goes after what you typed
  function skillIntoBox(text) {
    const box = composerInput();
    if (!box) return false;
    const cur = box.innerText.replace(/\n+/g, '\n').replace(/\s+/g, (m) => (m.indexOf('\n') >= 0 ? '\n' : ' ')).trim();
    let next = text;
    if (cur) next = text.charAt(0) === '/' ? text.trim() + ' ' + cur : cur + ' ' + text;
    setInput(box, next);
    box.focus();
    try {
      const r = document.createRange();
      r.selectNodeContents(box);
      r.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (e) {}
    return true;
  }
  window.addEventListener('mk-dash', (e) => {
    if (typeof e.detail === 'string' && e.detail.indexOf('skill:') === 0) skillIntoBox(e.detail.slice(6));
  });
  function skillToChat(text) {
    if (q('[class*="messagesContainer_"]') && skillIntoBox(text)) return;
    const conn = window.__ccConn;
    if (conn && conn.sendRequest) conn.sendRequest({ type: 'open_account_usage', mk: 'skill:' + text }).catch(() => {});
  }

  function setSkCollapsed(v) {
    skCollapsed = v;
    store.set('mkSkills', v ? 'closed' : 'open');
    const t = q('button', skHead);
    t.setAttribute('aria-expanded', String(!v));
    t.title = v ? 'Expand skills' : 'Collapse skills';
    const chev = q('svg', t);
    const base = chev && Array.from(chev.classList).find((c) => c.indexOf('sectionChevron_') === 0);
    if (base) chev.classList.toggle(base.replace('sectionChevron_', 'sectionChevronExpanded_'), !v);
    skBody.hidden = v;
    if (!v) { skSig = ''; paintSkills(); loadSkills(paintSkills); }
  }

  function makeSkills(accHead) {
    const accToggle = q(':scope > button', accHead);
    const chevSrc = q('svg', accToggle);
    const label = q('[class*="sectionLabel_"]', accToggle);
    skHead = document.createElement('div');
    skHead.className = accHead.className + ' mkSkHead';
    const t = document.createElement('button');
    t.type = 'button';
    t.className = accToggle.className;
    if (chevSrc) {
      const c = chevSrc.cloneNode(true);
      Array.from(c.classList).filter((x) => x.indexOf('sectionChevronExpanded_') === 0).forEach((x) => c.classList.remove(x));
      t.appendChild(c);
    }
    const sp = document.createElement('span');
    sp.className = label ? label.className : '';
    sp.textContent = 'Skills';
    t.appendChild(sp);
    t.addEventListener('click', () => setSkCollapsed(!skCollapsed));
    skHead.appendChild(t);
    const count = document.createElement('span');
    count.className = 'mkSkCount';
    skHead.appendChild(count);

    skBody = document.createElement('div');
    skBody.className = 'mkSkBody';
    skBody.innerHTML = '<label class="mkSkSearch">' + ico(SK.search, 14) + '<input type="text" placeholder="Search skills" aria-label="Search skills" spellcheck="false"></label><div class="mkSkList"></div>';
    const input = q('input', skBody);
    input.addEventListener('input', () => { skQuery = input.value.trim(); paintSkills(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; skQuery = ''; paintSkills(); } });
    skBody.addEventListener('click', (e) => {
      const act = e.target instanceof Element && e.target.closest('.mkSkAct');
      if (act) {
        skillToChat(act.getAttribute('data-text'));
        act.setAttribute('data-added', '');
        q('.mkSkAdd', act).innerHTML = ico(SK.check, 14);
        setTimeout(() => { act.removeAttribute('data-added'); const a = q('.mkSkAdd', act); if (a) a.innerHTML = ico(SK.add, 14); }, 1400);
        return;
      }
      const row = e.target instanceof Element && e.target.closest('.mkSkRow');
      if (!row) return;
      const name = row.getAttribute('data-name');
      skOpenName = skOpenName === name ? '' : name;
      paintSkills();
      const again = qa('.mkSkRow', skBody).find((r) => r.getAttribute('data-name') === name);
      if (again) { again.focus(); if (skOpenName) again.parentElement.scrollIntoView({ block: 'nearest' }); }
    });
    setSkCollapsed(skCollapsed);
  }

  // keep the section right before Session manager (React re-inserts its own nodes; ours follow)
  function syncSkills() {
    const accToggle = q('[class*="sectionHeader_"] > button[title*="ccount & usage"]');
    if (!accToggle || off('skills')) { if (skHead) { skHead.remove(); skBody.remove(); } return; }
    const accHead = accToggle.parentElement;
    if (!skHead) makeSkills(accHead);
    const sesToggle = q('[class*="sectionHeader_"] > button[title*="ession manager"]');
    const ref = sesToggle ? sesToggle.parentElement : null;
    const parent = ref ? ref.parentElement : accHead.parentElement;
    if (ref) {
      if (skBody.nextElementSibling !== ref) parent.insertBefore(skBody, ref);
      if (skHead.nextElementSibling !== skBody) parent.insertBefore(skHead, skBody);
    } else if (skHead.parentElement !== parent) { parent.appendChild(skHead); parent.appendChild(skBody); }
    if (!skBody.hidden) paintSkills();
  }

  setInterval(() => { syncAgents(); syncTokens(); syncSpace(); syncAcctDash(); syncSkills(); syncMcp(); syncFinal(); syncReplies(); syncQuotes(); }, 1000);

  let timer = 0;
  function schedule() { if (!timer) timer = setTimeout(() => { timer = 0; build(); syncAgents(); syncTokens(); syncSpace(); syncAcctDash(); syncSkills(); syncMcp(); syncTypes(); syncFinal(); syncReplies(); syncQuotes(); }, 200); }
  // React to Claude's DOM only. Mutations inside the kit's own elements (map, chips, panel, held bubbles,
  // thumbnails) would otherwise re-trigger build() + syncAgents() in an endless 200 ms loop.
  const OWN = '.mkMap, .mkAgents, .mkTasks, .mkPanel, .mkHeld, .mkThumb, .mkMapToggle, .mkTokens, .mkSpace, .mkDashBtn, .mkMcp, .mkUsage, .mkQuoteBtn, .mkReply, .mkSkHead, .mkSkBody';
  const isOwn = (n) => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return !!(el && el.closest(OWN)); };
  new MutationObserver((list) => {
    placeModelMenu();
    if (list.every((m) => isOwn(m.target))) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', () => { placeModelMenu(); schedule(); });
  schedule();
})();

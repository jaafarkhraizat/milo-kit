// Milo Kit: double-click a Claude Code tab to rename the session.
// Loaded into the VS Code window by Custom UI Style (custom-ui-style.external.imports).
// It presses F2, which the kit binds to "Claude Code: Rename Session Tab" while a Claude tab is active.
(() => {
  if (window.__mkTabRename) return;
  window.__mkTabRename = 1;

  // VS Code names webview tab icon classes after a random id (webview-<uuid>-name-file-icon), not the view
  // type, so a Claude tab is found by its icon: the kit's claude-tab-icons or the extension's own resources.
  const CLAUDE_ICON = /claude-tab-icons|anthropic\.claude-code/i;
  const isClaudeTab = (tab) => {
    if (!tab) return false;
    for (const el of [tab, ...tab.querySelectorAll('*')]) {
      for (const pseudo of ['::before', null]) {
        if (CLAUDE_ICON.test(getComputedStyle(el, pseudo).backgroundImage || '')) return true;
      }
    }
    return false;
  };

  const pressF2 = (target) => {
    for (const type of ['keydown', 'keyup']) {
      const ev = new KeyboardEvent(type, { key: 'F2', code: 'F2', bubbles: true, cancelable: true });
      // VS Code reads the legacy keyCode, which the constructor cannot set
      Object.defineProperty(ev, 'keyCode', { get: () => 113 });
      Object.defineProperty(ev, 'which', { get: () => 113 });
      target.dispatchEvent(ev);
    }
  };

  document.addEventListener('dblclick', (e) => {
    const tab = e.target instanceof Element ? e.target.closest('.tabs-container > .tab') : null;
    if (!isClaudeTab(tab)) return;
    // stop VS Code's own double-click (maximize group / pin) for Claude tabs only
    e.preventDefault();
    e.stopImmediatePropagation();
    // the first click already made the tab active; give focus a moment to settle
    setTimeout(() => pressF2(tab), 80);
  }, true);
})();

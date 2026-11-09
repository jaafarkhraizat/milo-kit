// Milo Kit: tags the window with its title (<html data-mk-title="...">) so the title bar can show the avatar of
// this VS Code profile. Each profile sets its own window.title (CME, Bonat, ...). Loaded by Custom UI Style.
(() => {
  if (window.__mkProfileMark) return;
  window.__mkProfileMark = 1;
  const mark = () => {
    const t = (document.title || '').trim();
    if (document.documentElement.dataset.mkTitle !== t) document.documentElement.dataset.mkTitle = t;
  };
  mark();
  new MutationObserver(mark).observe(document.head || document.documentElement, { childList: true, subtree: true, characterData: true });
})();

// Runs inside Maximo's UI frames (/maximo/ui/...), at document_start, so this
// keydown listener is registered before any of Maximo's own handlers and sees
// the shortcut first. A match is passed to the top frame, where the palette
// lives (src/content.js), via postMessage.
(() => {
  if (window === window.top) return; // only inside frames
  if (window.__magicSearchFrameLoaded) return;
  window.__magicSearchFrameLoaded = true;

  const S = MagicSearchShortcut;
  let shortcut = { ...S.DEFAULT };
  S.load().then((sc) => (shortcut = sc));
  S.onChange((sc) => (shortcut = sc));

  window.addEventListener(
    "keydown",
    (e) => {
      const matched = S.matches(e, shortcut);
      MagicSearchMarks.lastKey(document, "frame", e, matched);
      if (!matched) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // The top frame may also listen on this window (fallback); handle each
      // key press once.
      if (!MagicSearchMarks.claim(document, e)) return;
      window.top.postMessage({ magicSearch: "toggle" }, location.origin);
    },
    true
  );

  const mark = () => document.documentElement?.setAttribute("data-magic-search-frame", "listening");
  mark();
  document.addEventListener("DOMContentLoaded", mark);
})();

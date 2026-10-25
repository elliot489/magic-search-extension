// Small markers on <html> attributes, readable from any script on the page
// (the tests print them when something fails), plus a once-per-key-press guard
// shared by the frame script and the top frame's fallback listener.
var MagicSearchMarks = (() => {
  function set(doc, name, value) {
    try {
      doc.documentElement?.setAttribute(name, value);
    } catch (_) {}
  }

  return {
    // What our listener last saw: who, key, modifiers, whether it matched.
    lastKey(doc, by, e, matched) {
      set(
        doc,
        "data-magic-search-last-key",
        JSON.stringify({
          by,
          key: e.key,
          code: e.code,
          ctrl: e.ctrlKey,
          meta: e.metaKey,
          alt: e.altKey,
          shift: e.shiftKey,
          matched,
          t: Math.round(e.timeStamp),
        })
      );
    },
    // True the first time it's called for a key press, false after.
    claim(doc, e) {
      const id = String(e.timeStamp);
      const el = doc.documentElement;
      if (!el || el.getAttribute("data-magic-search-claimed") === id) return false;
      el.setAttribute("data-magic-search-claimed", id);
      return true;
    },
    set,
  };
})();

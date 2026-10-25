// Shared by the content script and the options page.
// A shortcut is stored in chrome.storage.sync under "shortcut" as
// { code, ctrlKey, altKey, shiftKey, metaKey }, where code is a KeyboardEvent.code.
var MagicSearchShortcut = (() => {
  const STORAGE_KEY = "shortcut";
  const DEFAULT = { code: "Space", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);

  function normalize(sc) {
    if (!sc || typeof sc.code !== "string" || !sc.code) return { ...DEFAULT };
    return {
      code: sc.code,
      ctrlKey: !!sc.ctrlKey,
      altKey: !!sc.altKey,
      shiftKey: !!sc.shiftKey,
      metaKey: !!sc.metaKey,
    };
  }

  function fromEvent(e) {
    return normalize({
      code: e.code,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
    });
  }

  function matches(e, sc) {
    const codeOk = e.code === sc.code || (sc.code === "Space" && e.key === " ");
    return (
      codeOk &&
      e.ctrlKey === sc.ctrlKey &&
      e.altKey === sc.altKey &&
      e.shiftKey === sc.shiftKey &&
      e.metaKey === sc.metaKey
    );
  }

  function isModifierCode(code) {
    return /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(code) || code === "CapsLock";
  }

  // Needs Ctrl, Alt or Cmd/Meta (so it can't eat normal typing), unless it's an F-key.
  function isAllowed(sc) {
    return sc.ctrlKey || sc.altKey || sc.metaKey || /^F([1-9]|1[0-9]|2[0-4])$/.test(sc.code);
  }

  function keyLabel(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad/.test(code)) return "Num " + code.slice(6);
    if (/^Arrow/.test(code)) return code.slice(5);
    return code;
  }

  function format(sc) {
    const parts = [];
    if (sc.ctrlKey) parts.push("Ctrl");
    if (sc.altKey) parts.push(isMac ? "Option" : "Alt");
    if (sc.shiftKey) parts.push("Shift");
    if (sc.metaKey) parts.push(isMac ? "Cmd" : "Meta");
    parts.push(keyLabel(sc.code));
    return parts.join("+");
  }

  async function load() {
    try {
      const data = await chrome.storage.sync.get(STORAGE_KEY);
      return normalize(data[STORAGE_KEY]);
    } catch (_) {
      return { ...DEFAULT };
    }
  }

  function save(sc) {
    return chrome.storage.sync.set({ [STORAGE_KEY]: normalize(sc) });
  }

  function reset() {
    return chrome.storage.sync.remove(STORAGE_KEY);
  }

  // Calls fn(newShortcut) whenever the saved shortcut changes.
  function onChange(fn) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && STORAGE_KEY in changes) fn(normalize(changes[STORAGE_KEY].newValue));
    });
  }

  return { DEFAULT, normalize, fromEvent, matches, isModifierCode, isAllowed, format, load, save, reset, onChange };
})();

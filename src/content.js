(() => {
  // Double check the URL in case the manifest match is broader than expected.
  if (!location.href.includes("maximo/oslc/graphite/manage-shell")) return;
  if (window.__magicSearchLoaded) return;
  window.__magicSearchLoaded = true;

  let backdrop = null;
  let previousFocus = null;

  // Find the element that really has focus, looking inside same-origin
  // iframes (Maximo's UI lives in one).
  function deepActiveElement() {
    let el = document.activeElement;
    try {
      while (el && el.tagName === "IFRAME" && el.contentDocument) {
        const inner = el.contentDocument.activeElement;
        if (!inner || inner === el.contentDocument.body) break;
        el = inner;
      }
    } catch (_) {
      // Cross-origin frame: fall back to the iframe itself.
    }
    return el;
  }

  function open() {
    if (backdrop) return;
    previousFocus = deepActiveElement();

    backdrop = document.createElement("div");
    backdrop.className = "magic-search-backdrop";

    const box = document.createElement("div");
    box.className = "magic-search-box";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "magic-search-input";
    input.placeholder = "Search Maximo...";
    input.setAttribute("aria-label", "Search Maximo");

    box.appendChild(input);
    backdrop.appendChild(box);

    // Clicking the dimmed area (not the box itself) closes the palette.
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) {
        // Stop the browser moving focus to <body> after we restore it.
        e.preventDefault();
        close();
      }
    });

    document.body.appendChild(backdrop);
    input.focus();
  }

  function close() {
    if (!backdrop) return;
    backdrop.remove();
    backdrop = null;

    // Put the cursor back where the user was before opening the palette.
    if (previousFocus && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  // Capture phase so Maximo's own key handlers don't swallow the shortcut.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey && (e.code === "Space" || e.key === " ")) {
        e.preventDefault();
        e.stopPropagation();
        backdrop ? close() : open();
      } else if (e.key === "Escape" && backdrop) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    },
    true
  );
})();

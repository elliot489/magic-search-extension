(() => {
  // Double check the URL in case the manifest match is broader than expected.
  if (!location.href.includes("maximo/oslc/graphite/manage-shell")) return;
  if (window.__magicSearchLoaded) return;
  window.__magicSearchLoaded = true;

  // Hardcoded for now; this list will be filled in automatically later.
  const OPTIONS = [
    { label: "Locations", app: "LOCATION" },
    { label: "Assets", app: "ASSET" },
    { label: "Work Orders", app: "WOTRACK" },
  ];

  // URL that opens a Maximo application in the Manage shell, e.g.
  // .../maximo/oslc/graphite/manage-shell/index.html?event=loadapp&value=wotrack#/main
  // (the same format Maximo's own side menu uses, minus its one-off _tt token).
  function appUrl(app) {
    const url = new URL(location.href);
    url.pathname = url.pathname.replace(/manage-shell\/.*$/, "manage-shell/index.html");
    url.search = new URLSearchParams({ event: "loadapp", value: app.toLowerCase() }).toString();
    url.hash = "#/main";
    return url.toString();
  }

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

    const list = document.createElement("ul");
    list.className = "magic-search-list";
    list.setAttribute("role", "listbox");

    const items = OPTIONS.map((option) => {
      const li = document.createElement("li");
      li.className = "magic-search-option";
      li.setAttribute("role", "option");
      li.textContent = option.label;
      list.appendChild(li);
      return { option, li };
    });

    function matches() {
      const query = input.value.trim().toLowerCase();
      return items.filter(({ option }) =>
        option.label.toLowerCase().includes(query)
      );
    }

    // Live filter: hide options that don't contain the typed text.
    input.addEventListener("input", () => {
      const visible = new Set(matches());
      for (const item of items) {
        item.li.hidden = !visible.has(item);
        item.li.classList.toggle("is-only-match", visible.size === 1 && visible.has(item));
      }
      list.hidden = visible.size === 0;
    });

    // Enter opens the app, but only when exactly one option is left.
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      const remaining = matches();
      if (remaining.length !== 1) return;
      const url = appUrl(remaining[0].option.app);
      previousFocus = null;
      close();
      location.assign(url);
    });

    // Clicking the list or padding mustn't take focus away from the input.
    box.addEventListener("mousedown", (e) => {
      if (e.target !== input) e.preventDefault();
    });

    box.appendChild(input);
    box.appendChild(list);
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
    // The shortcut may have come from inside an iframe: pull focus back up here.
    window.focus();
    input.focus();
  }

  function close() {
    if (!backdrop) return;
    backdrop.remove();
    backdrop = null;

    // Put the cursor back where the user was before opening the palette.
    if (previousFocus && previousFocus.isConnected) {
      // If it's inside an iframe, focus that frame's window first.
      const win = previousFocus.ownerDocument.defaultView;
      if (win && win !== window) win.focus();
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  // Current shortcut; read from settings and kept up to date when it changes.
  let shortcut = { ...MagicSearchShortcut.DEFAULT };
  MagicSearchShortcut.load().then((sc) => (shortcut = sc));
  MagicSearchShortcut.onChange((sc) => (shortcut = sc));

  function onKeyDown(e) {
    if (MagicSearchShortcut.matches(e, shortcut)) {
      e.preventDefault();
      e.stopPropagation();
      backdrop ? close() : open();
    } else if (e.key === "Escape" && backdrop) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  // Maximo's UI lives in a same-origin iframe (/maximo/ui/?type=embedded), and
  // key presses there never reach the top window. So listen on every
  // same-origin frame's window too, including frames added or reloaded later.
  const hookedWindows = new WeakSet();
  const hookedDocuments = new WeakSet();
  const hookedFrames = new WeakSet();

  function hookWindow(win) {
    if (hookedWindows.has(win)) return;
    hookedWindows.add(win);
    // Capture phase so Maximo's own key handlers don't swallow the shortcut.
    win.addEventListener("keydown", onKeyDown, true);
  }

  function hookDocument(doc) {
    if (!doc || hookedDocuments.has(doc)) return;
    hookedDocuments.add(doc);
    doc.querySelectorAll("iframe, frame").forEach(hookFrame);
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === "IFRAME" || node.tagName === "FRAME") hookFrame(node);
          else if (node.firstElementChild) node.querySelectorAll("iframe, frame").forEach(hookFrame);
        }
      }
    }).observe(doc, { childList: true, subtree: true });
  }

  function hookFrameContents(frame) {
    try {
      const win = frame.contentWindow;
      const doc = frame.contentDocument; // null (or throws) when cross-origin
      if (!win || !doc) return;
      hookWindow(win);
      hookDocument(doc);
    } catch (_) {
      // Cross-origin frame: can't listen there.
    }
  }

  function hookFrame(frame) {
    if (!hookedFrames.has(frame)) {
      hookedFrames.add(frame);
      // Each navigation inside the frame brings a new document (and usually a new window).
      frame.addEventListener("load", () => hookFrameContents(frame));
    }
    hookFrameContents(frame);
  }

  hookWindow(window);
  hookDocument(document);
})();

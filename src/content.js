(() => {
  // Double check the URL in case the manifest match is broader than expected.
  if (!location.href.includes("maximo/oslc/graphite/manage-shell")) return;
  if (window.__magicSearchLoaded) return;
  window.__magicSearchLoaded = true;

  // Hardcoded for now; this list will be filled in automatically later.
  // Aliases are extra names that also match (as a prefix), e.g. "wo".
  const OPTIONS = [
    { label: "Locations", app: "LOCATION", aliases: [] },
    { label: "Assets", app: "ASSET", aliases: [] },
    { label: "Work Orders", app: "WOTRACK", aliases: ["wo"] },
    { label: "Purchase Orders", app: "PO", aliases: ["po"] },
  ];

  // Starting the query with one of these words (then a space) opens the app
  // ready to insert a new record, e.g. "new wo" or "create work order".
  const INSERT_VERBS = ["new", "insert", "create"];

  // Text after the app name filters the app's list: "assets first" opens
  // Assets with description = "first". Maximo URL parameters used for that:
  // &additionalevent=useqbe&additionaleventvalue=description=first
  const FILTER = { event: "useqbe", field: "description" };

  // How well an option matches, best first; -1 means no match.
  // 0: name or alias starts with the text ("a" -> Assets)
  // 1: a later word in the name starts with it ("o" -> Work Orders)
  // 2: the text appears anywhere else in the name
  function matchRank(option, query) {
    const label = option.label.toLowerCase();
    if (label.startsWith(query) || option.aliases.some((alias) => alias.startsWith(query))) return 0;
    if (label.split(/\s+/).some((word) => word.startsWith(query))) return 1;
    if (label.includes(query)) return 2;
    return -1;
  }


  // OPTIONS sorted best match first; ties keep the list order (sort is stable).
  function rankOptions(query) {
    return OPTIONS.map((option) => ({ option, rank: matchRank(option, query) }))
      .filter(({ rank }) => rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .map(({ option }) => option);
  }

  // Work out what the typed text asks for:
  // { insert, matches (ranked options), filter }.
  // - A leading new/insert/create means insert mode.
  // - The longest run of leading words that matches an app picks the app(s);
  //   any words after it are the filter ("work orders pump" -> filter "pump").
  //   In insert mode extra words are ignored.
  function interpret(text) {
    let words = text.trim().split(/\s+/).filter(Boolean);
    let insert = false;
    if (words.length > 1 && INSERT_VERBS.includes(words[0].toLowerCase())) {
      insert = true;
      words = words.slice(1);
    }
    for (let n = words.length; n >= 1; n--) {
      const matches = rankOptions(words.slice(0, n).join(" ").toLowerCase());
      if (matches.length) {
        return { insert, matches, filter: insert ? "" : words.slice(n).join(" ") };
      }
    }
    return { insert, matches: words.length ? [] : rankOptions(""), filter: "" };
  }

  // URL that opens a Maximo application in the Manage shell, e.g.
  // .../maximo/oslc/graphite/manage-shell/index.html?event=loadapp&value=wotrack#/main
  // (the same format Maximo's own side menu uses, minus its one-off _tt token).
  // With insert, adds &additionalevent=insert so Maximo starts a new record.
  // With a filter, adds &additionalevent=useqbe&additionaleventvalue=description=<text>.
  function appUrl(app, { insert = false, filter = "" } = {}) {
    const url = new URL(location.href);
    url.pathname = url.pathname.replace(/manage-shell\/.*$/, "manage-shell/index.html");
    const params = { event: "loadapp", value: app.toLowerCase() };
    if (insert) {
      params.additionalevent = "insert";
    } else if (filter) {
      params.additionalevent = FILTER.event;
      params.additionaleventvalue = `${FILTER.field}=${filter}`;
    }
    url.search = new URLSearchParams(params).toString();
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

    const itemFor = new Map(items.map((item) => [item.option, item]));
    function matches() {
      return interpret(input.value).matches.map((option) => itemFor.get(option));
    }

    // Live filter: hide options that don't match the typed text and highlight
    // the top one (what Enter opens). With an insert verb, the list is marked
    // so each option shows "New record"; with a filter, the top option shows it.
    function refresh() {
      const { insert, filter } = interpret(input.value);
      const remaining = matches();
      const visible = new Set(remaining);
      list.classList.toggle("is-insert", insert);
      // Show matches in ranked order, then the hidden rest.
      for (const item of [...remaining, ...items.filter((it) => !visible.has(it))]) {
        list.appendChild(item.li);
      }
      for (const item of items) {
        item.li.hidden = !visible.has(item);
        item.li.classList.toggle("is-selected", item === remaining[0]);
        item.li.setAttribute("aria-selected", String(item === remaining[0]));
        if (filter && item === remaining[0]) item.li.dataset.filter = filter;
        else delete item.li.dataset.filter;
      }
      list.hidden = remaining.length === 0;
    }
    input.addEventListener("input", refresh);
    refresh();

    // Enter opens the top remaining option; it does nothing when none match.
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      const { insert, matches: remaining, filter } = interpret(input.value);
      if (remaining.length === 0) return;
      const url = appUrl(remaining[0].app, { insert, filter });
      previousFocus = null;
      close();
      // Same address as now (the app is already open): assign() would only
      // jump within the page and load nothing, so reload instead.
      if (url === location.href) location.reload();
      else location.assign(url);
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

    // Keep the cursor in the search box while it's open: Maximo can move focus
    // to its own fields when a page finishes loading, mid-typing.
    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (backdrop && input.isConnected && document.activeElement !== input) {
          window.focus();
          input.focus();
        }
      }, 0);
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
  const hookedDocuments = new WeakSet();
  const hookedFrames = new WeakSet();

  // Listeners on a frame can disappear without a new window or a load event
  // (e.g. when the page rewrites its document with document.open()). So the
  // listener is added again often: on frame load, whenever a frame's document
  // changes (see hookDocument), and when focus moves into a frame. Adding the
  // same listener twice is a no-op.
  function hookWindow(win) {
    if (!win) return;
    // Capture phase so Maximo's own key handlers don't swallow the shortcut.
    win.addEventListener("keydown", onKeyDown, true);
    // Visible marker (for the tests' failure reports): this frame is listening.
    try {
      win.document.documentElement?.setAttribute("data-magic-search", "listening");
    } catch (_) {}
  }

  function hookDocument(doc) {
    if (!doc || hookedDocuments.has(doc)) return;
    hookedDocuments.add(doc);
    doc.querySelectorAll("iframe, frame").forEach(hookFrame);
    // The observer survives document.open(), which empties the document (and
    // drops the window's listeners), so use each change to re-add ours.
    new MutationObserver((mutations) => {
      if (doc.defaultView && doc.documentElement?.getAttribute("data-magic-search") !== "listening") {
        hookWindow(doc.defaultView);
      }
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

  // Re-check every same-origin frame (cheap; everything here is idempotent).
  function rehookAll(doc = document) {
    for (const frame of doc.querySelectorAll("iframe, frame")) {
      hookFrame(frame);
      try {
        if (frame.contentDocument) rehookAll(frame.contentDocument);
      } catch (_) {}
    }
  }

  hookWindow(window);
  hookDocument(document);
  // The top window loses focus when the cursor moves into a frame.
  window.addEventListener("blur", () => rehookAll());
})();

(() => {
  // Double check the URL in case the manifest match is broader than expected.
  if (!location.href.includes("maximo/oslc/graphite/manage-shell")) return;
  if (window.__magicSearchLoaded) return;
  window.__magicSearchLoaded = true;

  // The apps come from MagicSearchCatalog (src/catalog.js): the user's Maximo
  // apps, one per group (industry versions merged), with generated or edited
  // aliases. Ranking is in MagicSearchApps.rankGroups (src/apps.js).
  const Apps = MagicSearchApps;
  const Catalog = MagicSearchCatalog;

  // Starting the query with one of these words (then a space) opens the app
  // ready to insert a new record, e.g. "new wo" or "create work order".
  const INSERT_VERBS = ["new", "insert", "create"];

  // Typing "refresh" (or the start of it, 3+ letters) offers this command.
  const REFRESH_COMMAND = "refresh";

  // Text after the app name filters the app's list: "assets first" opens
  // Assets with description = "first". Maximo URL parameters used for that:
  // &additionalevent=useqbe&additionaleventvalue=description=first
  const FILTER = { event: "useqbe", field: "description" };

  // Ranked [{ group, alias }]; in insert mode only apps the user can insert into.
  function rankFor(query, insert) {
    const ranked = Apps.rankGroups(Catalog.groups(), query);
    return insert ? ranked.filter((m) => m.group.app.canInsert) : ranked;
  }

  // Work out what the typed text asks for:
  // { insert, matches (ranked options), filter }.
  // - A leading new/insert/create means insert mode.
  // - The longest run of leading words that matches an app picks the app(s);
  //   any words after it are the filter ("work orders pump" -> filter "pump").
  //   In insert mode extra words are ignored.
  // command: "refresh" when the text is (the start of) the refresh command.
  function interpret(text) {
    const query = text.trim().toLowerCase();
    const command = query.length >= 3 && REFRESH_COMMAND.startsWith(query) ? "refresh" : "";
    let words = text.trim().split(/\s+/).filter(Boolean);
    let insert = false;
    if (words.length > 1 && INSERT_VERBS.includes(words[0].toLowerCase())) {
      insert = true;
      words = words.slice(1);
    }
    for (let n = words.length; n >= 1; n--) {
      const matches = rankFor(words.slice(0, n).join(" "), insert);
      if (matches.length) {
        return { insert, matches, filter: insert ? "" : words.slice(n).join(" "), command };
      }
    }
    return { insert, matches: words.length ? [] : rankFor("", insert), filter: "", command };
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
  // Set while the palette is open; re-renders it when the app list changes.
  let rerenderOpenPalette = null;
  Catalog.onUpdate(() => rerenderOpenPalette && rerenderOpenPalette());

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

    // What Enter does: the first entry shown (an app, or the refresh command).
    let entries = [];
    let refreshing = false;

    function statusRow(text) {
      const li = document.createElement("li");
      li.className = "magic-search-status";
      li.textContent = text;
      return li;
    }

    // Show the top matches (best first, top one highlighted). With an insert
    // verb the list is marked so each option shows "New record"; with a
    // filter, the top option shows it. When an alias (not the name) matched,
    // it's shown after the label, e.g. "Item Master · im".
    function render(status) {
      const { insert, filter, matches, command } = interpret(input.value);
      entries = matches.slice(0, Apps.SHOW_TOP).map((m) => ({ type: "app", ...m }));
      if (command) {
        const cmd = { type: "command" };
        if (input.value.trim().toLowerCase() === REFRESH_COMMAND) entries.unshift(cmd);
        else entries.push(cmd);
        entries = entries.slice(0, Apps.SHOW_TOP);
      }
      list.classList.toggle("is-insert", insert);
      const rows = entries.map((entry, index) => {
        const li = document.createElement("li");
        li.className = "magic-search-option";
        li.setAttribute("role", "option");
        const selected = index === 0;
        li.classList.toggle("is-selected", selected);
        li.setAttribute("aria-selected", String(selected));
        const label = document.createElement("span");
        label.className = "magic-search-label";
        if (entry.type === "command") {
          li.classList.add("magic-search-command");
          label.textContent = "Refresh app list";
        } else {
          li.dataset.app = entry.group.app.id;
          label.textContent = entry.group.label;
          if (entry.alias) label.dataset.alias = entry.alias;
          if (filter && selected) li.dataset.filter = filter;
        }
        li.appendChild(label);
        return li;
      });
      if (status) rows.push(statusRow(status));
      list.replaceChildren(...rows);
      list.hidden = rows.length === 0;
    }
    input.addEventListener("input", () => render());
    render();
    // The list may arrive (or change) while the palette is open.
    rerenderOpenPalette = () => {
      if (!refreshing) render();
    };

    async function runRefresh() {
      refreshing = true;
      input.value = "";
      render("Refreshing the app list…");
      let message;
      try {
        const count = await Catalog.refresh();
        message = `Loaded ${count} apps`;
      } catch (err) {
        message = "Couldn't load the app list from Maximo";
        console.warn("[Magic Search]", err);
      }
      refreshing = false;
      if (backdrop && input.isConnected) render(message);
    }

    // Enter opens the top entry (or runs the refresh command); it does
    // nothing when nothing matches.
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      if (refreshing) return;
      const { insert, filter } = interpret(input.value);
      const top = entries[0];
      if (!top) return;
      if (top.type === "command") {
        runRefresh();
        return;
      }
      const url = appUrl(top.group.app.id, { insert, filter });
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
    rerenderOpenPalette = null;

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

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
  // Set while the palette is open: its input, and its key handler (so keys
  // that land in a Maximo field instead can be passed on to it).
  let paletteInput = null;
  let paletteKey = null;
  // Set while the palette is open in an app (searching that app's actions):
  // switches it to normal app search; returns false if it already was.
  let paletteLeaveContext = null;

  // The palette's tag for the current app, e.g. "Work Order Tracking": the
  // label from the app list, else the app id.
  function contextLabel(app) {
    const id = app.toUpperCase();
    for (const group of Catalog.groups()) {
      const version = group.versions.find((v) => v.id === id);
      if (version) return version.label;
    }
    return id;
  }
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
    input.setAttribute("aria-label", "Search Maximo");

    // Opened inside an app: search that app's actions (toolbar, Common and
    // More Actions), shown by a tag before the input. Backspace on an empty
    // box, the tag's x or the shortcut again goes back to normal app search.
    let context = MagicSearchActions.current();
    const inputRow = document.createElement("div");
    inputRow.className = "magic-search-input-row";
    const tag = document.createElement("span");
    tag.className = "magic-search-tag";
    const tagLabel = document.createElement("span");
    const tagClose = document.createElement("button");
    tagClose.type = "button";
    tagClose.className = "magic-search-tag-close";
    tagClose.textContent = "×";
    tagClose.setAttribute("aria-label", "Search all apps instead");
    tag.append(tagLabel, tagClose);
    function showMode() {
      tag.hidden = !context;
      if (context) {
        tagLabel.textContent = contextLabel(context.app);
        input.placeholder = "Search actions...";
      } else {
        input.placeholder = "Search Maximo...";
      }
    }
    showMode();
    function leaveContext() {
      if (!context) return false;
      context = null;
      showMode();
      render();
      input.focus();
      return true;
    }
    tagClose.addEventListener("click", leaveContext);

    const list = document.createElement("ul");
    list.className = "magic-search-list";
    list.setAttribute("role", "listbox");

    // Entries shown (apps, or the refresh command) and which one is
    // highlighted: what Enter opens. Typing highlights the top entry again;
    // Up/Down moves the highlight.
    let entries = [];
    let selected = 0;
    // Set by Up/Down: Space then fills in the highlighted app's name.
    let navigated = false;
    // After Space fills in a name, keep that app highlighted while it's listed.
    let pinnedApp = null;
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
      if (context) return renderActions();
      const { insert, filter, matches, command } = interpret(input.value);
      entries = matches.slice(0, Apps.SHOW_TOP).map((m) => ({ type: "app", ...m }));
      if (command) {
        const cmd = { type: "command" };
        if (input.value.trim().toLowerCase() === REFRESH_COMMAND) entries.unshift(cmd);
        else entries.push(cmd);
        entries = entries.slice(0, Apps.SHOW_TOP);
      }
      selected = 0;
      if (pinnedApp) {
        const at = entries.findIndex((en) => en.type === "app" && en.group.app.id === pinnedApp);
        if (at >= 0) selected = at;
        else pinnedApp = null;
      }
      navigated = false;
      list.classList.toggle("is-insert", insert);
      const rows = entries.map((entry, index) => {
        const li = document.createElement("li");
        li.className = "magic-search-option";
        li.setAttribute("role", "option");
        li.dataset.index = String(index);
        const label = document.createElement("span");
        label.className = "magic-search-label";
        if (entry.type === "command") {
          li.classList.add("magic-search-command");
          label.textContent = "Refresh app list";
        } else {
          li.dataset.app = entry.group.app.id;
          label.textContent = entry.group.label;
          if (entry.alias) label.dataset.alias = entry.alias;
          if (filter) li.dataset.filterText = filter;
        }
        li.appendChild(label);
        return li;
      });
      if (status) rows.push(statusRow(status));
      list.replaceChildren(...rows);
      list.hidden = rows.length === 0;
      highlight();
    }

    // In an app: its actions matching the text, top one highlighted.
    function renderActions() {
      entries = MagicSearchActions.rank(context.actions, input.value)
        .slice(0, MagicSearchActions.SHOW_TOP)
        .map((action) => ({ type: "action", action }));
      selected = 0;
      pinnedApp = null;
      navigated = false;
      list.classList.remove("is-insert");
      const rows = entries.map((entry, index) => {
        const li = document.createElement("li");
        li.className = "magic-search-option magic-search-action";
        li.setAttribute("role", "option");
        li.dataset.index = String(index);
        li.dataset.event = entry.action.event;
        const label = document.createElement("span");
        label.className = "magic-search-label";
        label.textContent = entry.action.label;
        li.appendChild(label);
        return li;
      });
      list.replaceChildren(...rows);
      list.hidden = rows.length === 0;
      highlight();
    }

    // Mark the highlighted row (and show the filter badge on it).
    function highlight() {
      for (const li of list.querySelectorAll(".magic-search-option")) {
        const on = Number(li.dataset.index) === selected;
        li.classList.toggle("is-selected", on);
        li.setAttribute("aria-selected", String(on));
        if (on && li.dataset.filterText) li.dataset.filter = li.dataset.filterText;
        else delete li.dataset.filter;
      }
    }

    function moveSelection(step) {
      if (!entries.length) return;
      selected = Math.min(entries.length - 1, Math.max(0, selected + step));
      navigated = true;
      pinnedApp = null;
      highlight();
    }

    // Space after Up/Down: put the highlighted app's name in the box, ready
    // for a filter, e.g. "pm" -> Down, Down -> Space gives "Master PM ".
    // Keeps a leading new/insert/create.
    function completeSelected() {
      const entry = entries[selected];
      if (!entry || entry.type !== "app") return false;
      const { insert, filter } = interpret(input.value);
      const verb = insert ? input.value.trim().split(/\s+/)[0] + " " : "";
      input.value = `${verb}${entry.group.label} ${filter ? filter : ""}`;
      input.setSelectionRange(input.value.length, input.value.length);
      pinnedApp = entry.group.app.id;
      render();
      return true;
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

    // Up/Down move the highlight; Space after them fills in the app's name.
    // Enter opens the highlighted entry (or runs the refresh command); it
    // does nothing when nothing matches.
    function onPaletteKey(e) {
      if (e.key === "Backspace" && context && input.value === "") {
        e.preventDefault();
        e.stopPropagation();
        leaveContext();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        moveSelection(e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (e.key === " " && navigated && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (completeSelected()) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      if (refreshing) return;
      const { insert, filter } = interpret(input.value);
      const top = entries[selected];
      if (!top) return;
      if (top.type === "command") {
        runRefresh();
        return;
      }
      if (top.type === "action") {
        previousFocus = null;
        close();
        MagicSearchActions.run(top.action);
        return;
      }
      const url = appUrl(top.group.app.id, { insert, filter });
      previousFocus = null;
      close();
      // Same address as now (the app is already open): assign() would only
      // jump within the page and load nothing, so reload instead.
      if (url === location.href) location.reload();
      else location.assign(url);
    }
    input.addEventListener("keydown", onPaletteKey);
    paletteInput = input;
    paletteKey = onPaletteKey;
    paletteLeaveContext = leaveContext;

    // Clicking the list or padding mustn't take focus away from the input.
    box.addEventListener("mousedown", (e) => {
      if (e.target !== input) e.preventDefault();
    });

    inputRow.append(tag, input);
    box.appendChild(inputRow);
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
    paletteInput = null;
    paletteKey = null;
    paletteLeaveContext = null;

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
      // In an app, the shortcut first switches to searching all apps.
      if (!backdrop) open();
      else if (!(paletteLeaveContext && paletteLeaveContext())) close();
    } else if (e.key === "Escape" && backdrop) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (backdrop && paletteInput && e.target !== paletteInput) {
      redirectToPalette(e);
    }
  }

  // While the palette is open, Maximo can move focus to one of its own fields
  // (e.g. when a page finishes loading) between key presses. Such a key is
  // kept from Maximo and applied to the palette instead.
  function redirectToPalette(e) {
    if (MagicSearchShortcut.isModifierCode(e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    const input = paletteInput;
    window.focus();
    input.focus();
    const typing = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (["Enter", "ArrowUp", "ArrowDown", "Backspace"].includes(e.key) || (e.key === " " && typing)) {
      // The palette's own handler; preventDefault means it handled the key.
      let handled = false;
      paletteKey({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        preventDefault: () => (handled = true),
        stopPropagation() {},
      });
      if (handled || !(e.key === " " || e.key === "Backspace")) return;
    }
    if (typing) {
      input.value += e.key;
    } else if (e.key === "Backspace") {
      input.value = input.value.slice(0, -1);
    } else {
      return;
    }
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("input"));
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

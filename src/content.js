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

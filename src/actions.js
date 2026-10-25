// The current Maximo app's actions, read from Maximo's own page: the toolbar
// (New, Save, Previous...) and the side panel's Common Actions and More
// Actions menus. Used by the palette when it's opened inside an app.
//
// What the page looks like (MAS Manage classic UI, inside the shell's iframe
// /maximo/ui/?type=embedded&event=loadapp&value=<app>):
// - Toolbar: li[id^="toolactions_"][ctype=toolbarbutton] > a[role=button]
//   with eventtype=<EVENT>, title "New Work Order    CTRL+ALT+I", and class
//   "off" when disabled. Its href runs sendEvent("click", ...).
// - Side panel: div.navSection > .navHead[title="More Actions"] and a
//   ul[role=menu] of li > a[role=menuitem] (eventtype=<EVENT>). A submenu's
//   parent has aria-haspopup="true", and its li has subid=<id of the child ul>.
//   Clicking an item runs Maximo's own handler: sendEvent(<EVENT>, <app>, ...).
// - The Go To menu uses the same markup with eventtype="changeapp"; those
//   are apps, not actions, so they're left out.
//
// An action is run by clicking Maximo's own element, as a user would, so
// Maximo does its usual event handling.
var MagicSearchActions = (() => {
  const SHOW_TOP = 10;
  // App ids where the palette stays in normal (app search) mode.
  const NO_CONTEXT_APPS = new Set(["startcntr", ""]);

  // Same-origin frame documents, top first.
  function documents(doc = document, out = []) {
    out.push(doc);
    for (const frame of doc.querySelectorAll("iframe, frame")) {
      try {
        if (frame.contentDocument) documents(frame.contentDocument, out);
      } catch (_) {}
    }
    return out;
  }

  function appIdFrom(href) {
    try {
      const url = new URL(href);
      return url.searchParams.get("event") === "loadapp" ? (url.searchParams.get("value") || "").toLowerCase() : "";
    } catch (_) {
      return "";
    }
  }

  const clean = (text) => (text || "").replace(/\s+/g, " ").trim();
  // "New Work Order    CTRL+ALT+I" -> "New Work Order"
  const stripShortcut = (title) => clean((title || "").split(/\s{2,}|\t/)[0]);

  function menuItemLabel(a) {
    return clean(a.querySelector("[id$='_tnode']")?.textContent || a.textContent) || stripShortcut(a.getAttribute("title"));
  }

  // Labels of the submenus an item sits in, outermost first: ["View"].
  function menuPath(a, doc) {
    const path = [];
    let ul = a.closest("ul[role=menu]");
    while (ul && ul.id) {
      const parentLi = doc.querySelector(`li[subid="${CSS.escape(ul.id)}"]`);
      if (!parentLi) break;
      const parentA = parentLi.querySelector("a[role=menuitem]");
      if (parentA) path.unshift(menuItemLabel(parentA));
      ul = parentLi.closest("ul[role=menu]");
    }
    return path;
  }

  function isOff(el) {
    return /(^|\s)off(\s|$)/.test(el.className || "") || /(^|\s)off(\s|$)/.test(el.parentElement?.className || "");
  }

  // Actions in one Maximo document, side panel menus first, then the toolbar.
  function actionsIn(doc) {
    const actions = [];
    const seen = new Set();
    const add = (action) => {
      const key = action.label.toLowerCase();
      if (!action.label || seen.has(key)) return;
      seen.add(key);
      actions.push(action);
    };
    for (const a of doc.querySelectorAll(".navSection a[role=menuitem]")) {
      const li = a.closest("li");
      const event = a.getAttribute("eventtype") || li?.getAttribute("eventtype") || "";
      if (!event || /^changeapp$/i.test(event) || a.getAttribute("aria-haspopup") === "true") continue;
      if ((li?.id || "").includes("_changeapp_")) continue;
      const path = menuPath(a, doc);
      const name = menuItemLabel(a);
      add({ label: [...path, name].join(" › "), name, event, el: a, source: "menu" });
    }
    for (const a of doc.querySelectorAll('li[id^="toolactions_"] > a[role=button], a[id^="toolactions_"][id$="-tbb_anchor"]')) {
      if (isOff(a)) continue;
      const event = a.getAttribute("eventtype") || "";
      const label = stripShortcut(a.getAttribute("title") || a.querySelector("img")?.getAttribute("alt"));
      add({ label, name: label, event, el: a, source: "toolbar" });
    }
    return actions;
  }

  // The app open in Maximo's frame and its actions, or null when there's no
  // app (e.g. the shell's start page) or it has no actions.
  function current() {
    for (const doc of documents()) {
      if (doc === document) continue;
      const app = appIdFrom(doc.location?.href) || appIdFrom(location.href);
      if (NO_CONTEXT_APPS.has(app)) continue;
      const actions = actionsIn(doc);
      if (actions.length) return { app, doc, actions };
    }
    return null;
  }

  // Actions matching the query, best first; ties keep Maximo's order.
  // 0 label (or the item's own name) starts with it, 1 a word starts with it,
  // 2 it appears anywhere, 3 the event name starts with it ("insert").
  function rank(actions, query) {
    query = clean(query).toLowerCase();
    return actions
      .map((action, index) => {
        if (!query) return { action, index, rank: 0 };
        const label = action.label.toLowerCase();
        const name = action.name.toLowerCase();
        let r = -1;
        if (label.startsWith(query) || name.startsWith(query)) r = 0;
        else if (label.split(/[\s›/-]+/).some((w) => w.startsWith(query))) r = 1;
        else if (label.includes(query)) r = 2;
        else if (action.event.toLowerCase().startsWith(query)) r = 3;
        return { action, index, rank: r };
      })
      .filter((m) => m.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((m) => m.action);
  }

  // Run an action by clicking Maximo's element. Notes the event on the frame's
  // <html data-magic-search-action> (the tests read it).
  function run(action) {
    // Maximo may have redrawn its menus since the palette opened.
    if (!action.el.isConnected) {
      const fresh = current()?.actions.find((a) => a.label === action.label && a.event === action.event);
      if (!fresh) return false;
      action = fresh;
    }
    const doc = action.el.ownerDocument;
    doc.documentElement?.setAttribute("data-magic-search-action", action.event);
    const win = doc.defaultView;
    if (win) win.focus();
    action.el.click();
    return true;
  }

  return { SHOW_TOP, current, rank, run, actionsIn };
})();

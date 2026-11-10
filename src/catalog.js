// The app list for the content script: the user's Maximo apps, saved per
// Maximo server and user in chrome.storage.local, fetched from Maximo when
// there's none or it's more than a day old, plus the version choices and
// alias edits from the options page (chrome.storage.sync). The same entry
// holds the user's site ids, used to tell a site from a status in record
// search (src/records.js).
var MagicSearchCatalog = (() => {
  const A = MagicSearchApps;
  const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
  // Sent with our requests to Maximo, so they're recognisable (the tests use it).
  const HEADERS = { accept: "application/json", "x-magic-search": "1" };
  // "/maximo" from ".../maximo/oslc/graphite/manage-shell/..."
  const BASE = location.pathname.replace(/\/oslc\/graphite\/.*$/, "");

  let apps = A.BUILTIN_APPS;
  let source = "builtin";
  let variantChoices = {};
  let aliasEdits = {};
  let savedSites = [];
  let extraSites = [];
  let groups = A.buildGroups(apps);
  let key = null;
  const listeners = [];

  function rebuild() {
    groups = A.buildGroups(apps, variantChoices, aliasEdits);
    // Visible state for the tests, e.g. "saved:187".
    document.documentElement?.setAttribute("data-magic-search-apps", `${source}:${groups.length}`);
    // And the sites record search knows, e.g. "BEDFORD NEWCASTLE".
    document.documentElement?.setAttribute("data-magic-search-sites", sites().join(" "));
    for (const fn of listeners) fn();
  }

  function useEntry(entry) {
    savedSites = entry && Array.isArray(entry.sites) ? entry.sites : [];
    if (entry && Array.isArray(entry.apps) && entry.apps.length) {
      apps = entry.apps;
      source = "saved";
    } else {
      apps = A.BUILTIN_APPS;
      source = "builtin";
    }
    rebuild();
  }

  async function getJson(path) {
    const res = await fetch(BASE + path, { headers: HEADERS, credentials: "same-origin" });
    if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status}`);
    return res.json();
  }

  // Storage key for this Maximo server and user: "apps:<origin>|<userid>".
  async function storageKey() {
    if (key) return key;
    const who = await getJson("/oslc/whoami?lean=1");
    const user = String(who.loginID || who.userName || who.personid || who.personId || "").toUpperCase();
    if (!user) throw new Error("whoami: no user id");
    key = `apps:${location.origin}|${user}`;
    return key;
  }

  // The user's site ids, e.g. ["BEDFORD", "NEWCASTLE"], and where they came
  // from. mxapisite lists every site the user can see; if that object
  // structure is blocked, whoami gives at least the default and insert sites.
  async function fetchSites() {
    try {
      const res = await getJson("/oslc/os/mxapisite?lean=1&oslc.select=siteid&oslc.pageSize=1000");
      const ids = (res.member || []).map((m) => String(m.siteid || "").toUpperCase()).filter(Boolean);
      if (ids.length) return { sites: [...new Set(ids)], sitesSource: "mxapisite" };
    } catch (err) {
      console.warn("[Magic Search] Couldn't read the site list (mxapisite); using whoami.", err);
    }
    try {
      const who = await getJson("/oslc/whoami?lean=1");
      const ids = Object.entries(who)
        .filter(([k, v]) => /site$/i.test(k) && typeof v === "string" && v.trim())
        .map(([, v]) => v.trim().toUpperCase());
      return { sites: [...new Set(ids)], sitesSource: "whoami" };
    } catch (err) {
      console.warn("[Magic Search] Couldn't read the user's sites.", err);
      return { sites: [], sitesSource: "none" };
    }
  }

  // Fetch the list from Maximo, save it and use it. Resolves to the number of
  // apps (groups shown in the palette).
  async function refresh() {
    const k = await storageKey();
    const [modules, options] = await Promise.all([
      getJson("/oslc/permission/modules?lean=1&relativeuri=1&internalvalues=1"),
      getJson("/oslc/permission/allowedappoptions?format=text&lean=1&relativeuri=1&internalvalues=1"),
    ]);
    const list = A.withInsertFlags(A.appsFromModules(modules), options);
    if (!list.length) throw new Error("Maximo returned no apps");
    const entry = { fetchedAt: new Date().toISOString(), apps: list, ...(await fetchSites()) };
    await chrome.storage.local.set({ [k]: entry, appsLastUsed: k });
    useEntry(entry);
    return groups.length;
  }

  function isStale(entry) {
    if (!entry || !Array.isArray(entry.apps) || !entry.apps.length) return true;
    // Saved before site lists existed.
    if (!Array.isArray(entry.sites)) return true;
    const at = Date.parse(entry.fetchedAt);
    return !(at > 0) || Date.now() - at > REFRESH_AFTER_MS;
  }

  async function init() {
    try {
      const sync = await chrome.storage.sync.get(["appVariants", "appAliases", "extraSites"]);
      variantChoices = A.variantChoicesFor(sync.appVariants, location.origin);
      aliasEdits = sync.appAliases || {};
      extraSites = extraSitesFor(sync.extraSites);
    } catch (_) {}
    rebuild();
    try {
      const k = await storageKey();
      const saved = (await chrome.storage.local.get(k))[k];
      await chrome.storage.local.set({ appsLastUsed: k });
      if (saved) useEntry(saved);
      if (isStale(saved)) await refresh();
    } catch (err) {
      console.warn("[Magic Search] Couldn't load the app list from Maximo; using the built-in apps.", err);
      document.documentElement?.setAttribute("data-magic-search-apps-error", String(err && err.message));
    }
  }

  function sites() {
    return [...new Set([...savedSites, ...extraSites])];
  }

  // Sites added by hand on the options page for this server.
  function extraSitesFor(all) {
    const list = (all || {})[location.origin];
    return Array.isArray(list) ? list.map((s) => String(s).trim().toUpperCase()).filter(Boolean) : [];
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.extraSites) {
      extraSites = extraSitesFor(changes.extraSites.newValue);
      rebuild();
    }
    if (area === "sync" && (changes.appVariants || changes.appAliases)) {
      if (changes.appVariants) variantChoices = A.variantChoicesFor(changes.appVariants.newValue, location.origin);
      if (changes.appAliases) aliasEdits = changes.appAliases.newValue || {};
      rebuild();
    }
    // Saved by another tab, or cleared on the options page (the built-in apps
    // are used until the next page load fetches it again).
    if (area === "local" && key && changes[key]) useEntry(changes[key].newValue);
  });

  const ready = init();

  return {
    groups: () => groups,
    sites,
    onUpdate: (fn) => listeners.push(fn),
    refresh,
    ready,
  };
})();

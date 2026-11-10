// Options page: saved app lists, choosing app versions, editing aliases.
// See docs/app-list-plan.md.
(() => {
  const A = MagicSearchApps;
  const listsEl = document.getElementById("app-lists");
  const sitesEl = document.getElementById("sites");
  const variantsEl = document.getElementById("variants");
  const aliasesEl = document.getElementById("aliases");
  const searchEl = document.getElementById("alias-search");

  let appVariants = {}; // { "<origin>": { groupName: appId } } (see MagicSearchApps.variantChoicesFor)
  let aliasEdits = {};
  let lastUsed = null; // { key, entry } of the list from the Maximo page used last
  let sites = []; // [{ origin, apps }]: each Maximo server's apps, from its saved lists
  let descriptions = {}; // { "<origin>": "text" }, in sync storage as siteDescriptions
  let selected = null; // origin of the environment shown below the list

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) node.append(child);
    return node;
  };

  function parseKey(key) {
    const [server, user] = key.slice("apps:".length).split("|");
    return { server, user };
  }

  function selectedSite() {
    return sites.find((s) => s.origin === selected) || null;
  }

  // App groups of the selected environment, for the aliases section.
  function groups() {
    const site = selectedSite();
    if (!site) return [];
    return A.buildGroups(site.apps, A.variantChoicesFor(appVariants, site.origin), aliasEdits);
  }

  // Each Maximo server's apps: all of its saved lists together (one per user).
  function sitesFrom(local) {
    const byOrigin = new Map();
    for (const key of Object.keys(local).filter((k) => k.startsWith("apps:")).sort()) {
      const apps = (local[key] && local[key].apps) || [];
      const { server } = parseKey(key);
      if (!byOrigin.has(server)) byOrigin.set(server, new Map());
      const seen = byOrigin.get(server);
      for (const app of apps) if (!seen.has(app.id)) seen.set(app.id, app);
    }
    return [...byOrigin].map(([origin, apps]) => ({ origin, apps: [...apps.values()] }));
  }

  // Choices saved by older versions applied to every site: copy them to each
  // saved site that has those versions, then drop them.
  async function migrateSharedChoices() {
    const shared = Object.entries(appVariants).filter(([, v]) => typeof v === "string");
    if (!shared.length || !sites.length) return;
    const next = Object.fromEntries(Object.entries(appVariants).filter(([, v]) => typeof v !== "string"));
    for (const site of sites) {
      const names = new Set(A.buildGroups(site.apps).filter((g) => g.versions.length > 1).map((g) => g.name));
      const own = { ...(next[site.origin] || {}) };
      for (const [name, id] of shared) if (names.has(name) && !(name in own)) own[name] = id;
      if (Object.keys(own).length) next[site.origin] = own;
    }
    appVariants = next;
    await chrome.storage.sync.set({ appVariants: next });
  }

  async function load() {
    const local = await chrome.storage.local.get(null);
    const sync = await chrome.storage.sync.get(["appVariants", "appAliases", "siteDescriptions"]);
    appVariants = sync.appVariants || {};
    aliasEdits = sync.appAliases || {};
    descriptions = sync.siteDescriptions || {};
    const key = local.appsLastUsed;
    lastUsed = key && local[key] && Array.isArray(local[key].apps) ? { key, entry: local[key] } : null;
    sites = sitesFrom(local);
    // Keep the environment that was picked; at first, the one used last.
    if (!sites.some((s) => s.origin === selected)) {
      const last = lastUsed && parseKey(lastUsed.key).server;
      selected = sites.some((s) => s.origin === last) ? last : sites[0]?.origin ?? null;
    }
    await migrateSharedChoices();
    renderLists(local);
    renderSites();
    renderVariants();
    renderAliases();
  }

  function select(origin) {
    if (origin === selected) return;
    selected = origin;
    renderSites();
    renderVariants();
    renderAliases();
  }

  // ---- Environments ----
  // One entry per Maximo server with a saved list; picking one shows its
  // description, versions and aliases below.
  function renderSites() {
    if (!sites.length) {
      sitesEl.replaceChildren(el("p", { className: "empty", textContent: "Open Maximo first to load your apps." }));
      return;
    }
    const items = sites.map((site) => {
      const item = el(
        "button",
        { type: "button", className: "site-item" },
        el("span", { className: "site-origin", textContent: site.origin }),
        el("span", { className: "site-item-description", textContent: descriptions[site.origin] || "" })
      );
      item.dataset.site = site.origin;
      item.setAttribute("role", "tab");
      item.setAttribute("aria-selected", String(site.origin === selected));
      item.addEventListener("click", () => select(site.origin));
      return item;
    });
    const list = el("div", { className: "site-list" }, ...items);
    list.setAttribute("role", "tablist");
    list.setAttribute("aria-label", "Environments");
    list.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const i = sites.findIndex((s) => s.origin === selected) + (e.key === "ArrowDown" ? 1 : -1);
      if (i < 0 || i >= sites.length) return;
      select(sites[i].origin);
      sitesEl.querySelector(`.site-item[aria-selected="true"]`)?.focus();
    });

    // The selected environment's description. Keep the field (and the cursor
    // in it) when only the list changes.
    let input = sitesEl.querySelector(".site-description");
    if (!input || input.dataset.site !== selected) {
      input = el("input", { className: "site-description", placeholder: "e.g. Production, Test, Client A", maxLength: 200 });
      input.dataset.site = selected;
      input.setAttribute("aria-label", "Description");
      let timer = null;
      input.addEventListener("input", () => {
        const origin = input.dataset.site;
        const text = input.value.trim();
        const next = { ...descriptions };
        if (text) next[origin] = text;
        else delete next[origin];
        descriptions = next;
        const label = sitesEl.querySelector(`.site-item[data-site="${CSS.escape(origin)}"] .site-item-description`);
        if (label) label.textContent = text;
        clearTimeout(timer);
        timer = setTimeout(() => chrome.storage.sync.set({ siteDescriptions: descriptions }), 300);
      });
    }
    const hadFocus = document.activeElement === input;
    if (!hadFocus) input.value = descriptions[selected] || "";
    const field = el("label", { className: "site-description-field" }, el("span", { textContent: "Description " }), input);
    sitesEl.replaceChildren(list, field);
    if (hadFocus) input.focus();
  }


  // ---- Saved app lists ----
  function renderLists(local) {
    const keys = Object.keys(local).filter((k) => k.startsWith("apps:")).sort();
    if (!keys.length) {
      listsEl.replaceChildren(el("p", { className: "empty", textContent: "No app lists saved yet. Open Maximo to load yours." }));
      return;
    }
    const rows = keys.map((key) => {
      const { server, user } = parseKey(key);
      const entry = local[key] || {};
      const when = entry.fetchedAt ? new Date(entry.fetchedAt).toLocaleString() : "-";
      const clear = el("button", { type: "button", className: "small clear-list", textContent: "Clear" });
      clear.addEventListener("click", () => chrome.storage.local.remove(key));
      const tr = el(
        "tr",
        {},
        el("td", { textContent: server }),
        el("td", { textContent: user }),
        el("td", { className: "app-count", textContent: String((entry.apps || []).length) }),
        el("td", { className: "fetched-at", textContent: when }),
        el("td", {}, clear)
      );
      tr.className = "app-list-row";
      tr.dataset.key = key;
      return tr;
    });
    listsEl.replaceChildren(
      el(
        "table",
        {},
        el("tr", {}, ...["Server", "User", "Apps", "Last loaded", ""].map((t) => el("th", { textContent: t }))),
        ...rows
      )
    );
  }

  // ---- Versions ----
  // The selected environment's apps with more than one version: only the
  // versions that server has.
  function renderVariants() {
    const site = selectedSite();
    if (!site) {
      variantsEl.replaceChildren(el("p", { className: "empty", textContent: "Open Maximo first to load your apps." }));
      return;
    }
    const choices = A.variantChoicesFor(appVariants, site.origin);
    const multi = A.buildGroups(site.apps, choices).filter((g) => g.versions.length > 1);
    const section = el("div", { className: "variant-site" });
    section.dataset.site = site.origin;
    if (!multi.length) {
      section.append(el("p", { className: "empty", textContent: "None: each app has one version on this server." }));
    } else {
      const rows = multi.map((g, i) => {
        const cell = el("td", { className: "variant-choices" });
        for (const v of g.versions) {
          const radio = el("input", { type: "radio", name: `variant-${i}`, value: v.id, checked: v.id === g.app.id });
          radio.addEventListener("change", () => {
            const own = typeof appVariants[site.origin] === "object" ? appVariants[site.origin] : {};
            appVariants = { ...appVariants, [site.origin]: { ...own, [g.name]: v.id } };
            chrome.storage.sync.set({ appVariants });
          });
          cell.append(el("label", {}, radio, ` ${v.label}`));
        }
        const tr = el("tr", {}, el("td", { textContent: A.baseLabel(g.label) }), cell);
        tr.className = "variant-row";
        tr.dataset.group = g.name;
        return tr;
      });
      section.append(el("table", {}, ...rows));
    }
    variantsEl.replaceChildren(section);
  }

  // ---- Aliases ----
  function sameList(a, b) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }

  function renderAliases() {
    // Keep the cursor in the same row's field across a re-render.
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest(".alias-row");
    const focusGroup = focused ? focused.dataset.group : null;
    const all = groups();
    if (!all.length) {
      aliasesEl.replaceChildren(el("p", { className: "empty", textContent: "Open Maximo first to load your apps." }));
      return;
    }
    const shared = A.sharedAliases(all);
    const rows = all.map((g) => {
      const generated = A.generatedAliases(g.name, g.versions).map((a) => a.alias);
      const input = el("input", { className: "alias-input", value: g.aliases.map((a) => a.alias).join(", ") });
      input.setAttribute("aria-label", `Aliases for ${g.label}`);
      input.addEventListener("change", () => {
        const list = input.value
          .split(",")
          .map((a) => a.trim().toLowerCase())
          .filter((a, i, arr) => a && arr.indexOf(a) === i);
        const next = { ...aliasEdits };
        if (sameList(list, generated)) delete next[g.name];
        else next[g.name] = list;
        aliasEdits = next;
        chrome.storage.sync.set({ appAliases: next });
      });
      const reset = el("button", { type: "button", className: "small alias-reset", textContent: "Reset" });
      reset.addEventListener("click", () => {
        const next = { ...aliasEdits };
        delete next[g.name];
        aliasEdits = next;
        chrome.storage.sync.set({ appAliases: next });
      });
      const notes = el("td");
      if (g.edited) notes.append(el("span", { className: "alias-edited", textContent: "edited " }));
      const others = [
        ...new Set(g.aliases.flatMap((a) => (shared[a.alias] || []).filter((label) => label !== g.label))),
      ];
      if (others.length) notes.append(el("span", { className: "alias-shared", textContent: `also used by ${others.join(", ")}` }));
      const tr = el("tr", {}, el("td", { textContent: g.label }), el("td", {}, input), el("td", {}, reset), notes);
      tr.className = "alias-row";
      tr.dataset.group = g.name;
      return tr;
    });
    aliasesEl.replaceChildren(el("table", {}, ...rows));
    filterAliases();
    if (focusGroup) {
      const row = [...aliasesEl.querySelectorAll(".alias-row")].find((tr) => tr.dataset.group === focusGroup);
      row?.querySelector(".alias-input")?.focus();
    }
  }

  function filterAliases() {
    const q = searchEl.value.trim().toLowerCase();
    for (const tr of aliasesEl.querySelectorAll(".alias-row")) {
      const text = `${tr.dataset.group} ${tr.querySelector(".alias-input").value}`.toLowerCase();
      tr.hidden = !!q && !text.includes(q);
    }
  }
  searchEl.addEventListener("input", filterAliases);

  chrome.storage.onChanged.addListener((changes, area) => {
    // A description typed here is already shown; another tab's is picked up.
    const descriptionsChanged =
      changes.siteDescriptions &&
      JSON.stringify(changes.siteDescriptions.newValue || {}) !== JSON.stringify(descriptions);
    const relevant =
      (area === "sync" && (changes.appVariants || changes.appAliases || descriptionsChanged)) ||
      (area === "local" && Object.keys(changes).some((k) => k.startsWith("apps:") || k === "appsLastUsed"));
    if (relevant) load();
  });

  load();
})();

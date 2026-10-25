// Options page: saved app lists, choosing app versions, editing aliases.
// See docs/app-list-plan.md.
(() => {
  const A = MagicSearchApps;
  const listsEl = document.getElementById("app-lists");
  const variantsEl = document.getElementById("variants");
  const aliasesEl = document.getElementById("aliases");
  const searchEl = document.getElementById("alias-search");

  let variantChoices = {};
  let aliasEdits = {};
  let lastUsed = null; // { key, entry } of the list from the Maximo page used last

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children) node.append(child);
    return node;
  };

  function parseKey(key) {
    const [server, user] = key.slice("apps:".length).split("|");
    return { server, user };
  }

  function groups() {
    return lastUsed ? A.buildGroups(lastUsed.entry.apps, variantChoices, aliasEdits) : [];
  }

  async function load() {
    const local = await chrome.storage.local.get(null);
    const sync = await chrome.storage.sync.get(["appVariants", "appAliases"]);
    variantChoices = sync.appVariants || {};
    aliasEdits = sync.appAliases || {};
    const key = local.appsLastUsed;
    lastUsed = key && local[key] && Array.isArray(local[key].apps) ? { key, entry: local[key] } : null;
    renderLists(local);
    renderVariants();
    renderAliases();
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
  function renderVariants() {
    const multi = groups().filter((g) => g.versions.length > 1);
    if (!multi.length) {
      variantsEl.replaceChildren(
        el("p", { className: "empty", textContent: lastUsed ? "None: each of your apps has one version." : "Open Maximo first to load your apps." })
      );
      return;
    }
    const rows = multi.map((g, i) => {
      const choices = el("td", { className: "variant-choices" });
      for (const v of g.versions) {
        const radio = el("input", { type: "radio", name: `variant-${i}`, value: v.id, checked: v.id === g.app.id });
        radio.addEventListener("change", () => {
          variantChoices = { ...variantChoices, [g.name]: v.id };
          chrome.storage.sync.set({ appVariants: variantChoices });
        });
        choices.append(el("label", {}, radio, ` ${v.label}`));
      }
      const tr = el("tr", {}, el("td", { textContent: A.baseLabel(g.label) }), choices);
      tr.className = "variant-row";
      tr.dataset.group = g.name;
      return tr;
    });
    variantsEl.replaceChildren(el("table", {}, ...rows));
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
    const relevant =
      (area === "sync" && (changes.appVariants || changes.appAliases)) ||
      (area === "local" && Object.keys(changes).some((k) => k.startsWith("apps:") || k === "appsLastUsed"));
    if (relevant) load();
  });

  load();
})();

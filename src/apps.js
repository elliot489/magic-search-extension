// App list logic shared by the content script and the options page.
// Pure functions: turning Maximo's permission data into app groups (one per
// app, merging industry versions such as "(Oil)"), generating aliases, and
// ranking groups for a search. See docs/app-list-plan.md.
var MagicSearchApps = (() => {
  // Used until a list has been fetched from Maximo (and if fetching fails).
  const BUILTIN_APPS = [
    { id: "LOCATION", label: "Locations", module: "Assets", canInsert: true },
    { id: "ASSET", label: "Assets", module: "Assets", canInsert: true },
    { id: "WOTRACK", label: "Work Order Tracking", module: "Work Orders", canInsert: true },
    { id: "PO", label: "Purchase Orders", module: "Purchasing", canInsert: true },
  ];

  // Aliases the initials rule can't produce, keyed by group name. They count as
  // generated aliases (editable like the rest).
  const EXTRA_ALIASES = {
    "purchase requisitions": ["purchase request"],
    "work order tracking": ["work orders"],
  };

  const SMALL_WORDS = new Set(["of", "and", "the", "for", "to", "&", "a", "an"]);
  const SHOW_TOP = 10;

  // "Work Order Tracking (Oil)" -> "Work Order Tracking"
  function baseLabel(label) {
    return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
  }

  function groupName(label) {
    return baseLabel(label).toLowerCase();
  }

  function hasSuffix(label) {
    return /\([^)]*\)\s*$/.test(label);
  }

  // Apps from /oslc/permission/modules (lean): a tree of modules whose
  // children are apps (ELEMENTTYPE "APP") or more modules. Only RUN apps open
  // with event=loadapp, so others are left out. An app listed in several
  // modules is kept once (first module).
  function appsFromModules(modules) {
    const apps = [];
    const seen = new Set();
    (function walk(nodes, module) {
      for (const node of nodes || []) {
        if (node.ELEMENTTYPE === "APP") {
          if (node.APPTYPE === "RUN" && node.KEY && !seen.has(node.KEY)) {
            seen.add(node.KEY);
            apps.push({ id: node.KEY, label: node.TEXT || node.KEY, module: module || "" });
          }
        } else {
          walk(node.children, node.ELEMENTTYPE === "MODULE" ? node.TEXT : module);
        }
      }
    })(Array.isArray(modules) ? modules : (modules && modules.member) || [], "");
    return apps;
  }

  // canInsert from /oslc/permission/allowedappoptions: { APPID: { OPTION: ... } }.
  function withInsertFlags(apps, options) {
    return apps.map((app) => ({
      ...app,
      canInsert: !!(options && options[app.id] && "INSERT" in options[app.id]),
    }));
  }

  function initials(words) {
    return words.map((w) => w[0]).join("").toLowerCase();
  }

  // Generated aliases for a group, each with its kind:
  // "id" (an app id), "full" (initials of every word), "two" (first two
  // words), "extra" (EXTRA_ALIASES).
  function generatedAliases(name, versions) {
    const out = [];
    const add = (alias, kind) => {
      alias = alias.trim().toLowerCase();
      if (alias && !out.some((a) => a.alias === alias)) out.push({ alias, kind });
    };
    for (const v of versions) add(v.id, "id");
    const words = baseLabel(versions[0].label)
      .split(/[\s/-]+/)
      .filter((w) => w && !SMALL_WORDS.has(w.toLowerCase()) && /[a-z0-9]/i.test(w));
    if (words.length >= 2) {
      add(initials(words), "full");
      add(initials(words.slice(0, 2)), "two");
    }
    for (const extra of EXTRA_ALIASES[name] || []) add(extra, "extra");
    return out;
  }

  // Which version a group uses: the one chosen on the options page if it's
  // available, else the industry version (label with a "(...)" suffix) over
  // the standard one, else the first.
  function chooseVersion(versions, chosenId) {
    return (
      versions.find((v) => v.id === chosenId) ||
      versions.find((v) => hasSuffix(v.label)) ||
      versions[0]
    );
  }

  // Groups in menu order: { name, label, app (chosen version), versions,
  // aliases: [{ alias, kind }], edited }.
  // variantChoices: { groupName: appId }; aliasEdits: { groupName: [alias] }.
  function buildGroups(apps, variantChoices = {}, aliasEdits = {}) {
    const byName = new Map();
    for (const app of apps) {
      const name = groupName(app.label);
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(app);
    }
    return [...byName.entries()].map(([name, versions]) => {
      const app = chooseVersion(versions, (variantChoices || {})[name]);
      const edits = (aliasEdits || {})[name];
      const edited = Array.isArray(edits);
      const aliases = edited
        ? edits
            .map((a) => ({ alias: String(a).trim().toLowerCase(), kind: "edited" }))
            .filter((a, i, all) => a.alias && all.findIndex((b) => b.alias === a.alias) === i)
        : generatedAliases(name, versions);
      return { name, label: app.label, app, versions, aliases, edited };
    });
  }

  // How well a group matches a query (lower is better; -1 = no match), and
  // which alias matched (shown next to the label).
  //  0 exact app id or edited alias   1 exact full-name initials
  //  2 exact two-word initials/extra  3 label starts with the query
  //  4 an alias starts with it        5 a later word of the label starts with it
  //  6 label contains it              7 a word of the module name starts with it
  function matchGroup(group, query) {
    if (!query) return { rank: 3, alias: "" };
    const exact = group.aliases.find((a) => a.alias === query);
    if (exact) {
      const rank = exact.kind === "id" || exact.kind === "edited" ? 0 : exact.kind === "full" ? 1 : 2;
      return { rank, alias: exact.alias };
    }
    const label = group.label.toLowerCase();
    if (label.startsWith(query)) return { rank: 3, alias: "" };
    const prefixAlias = group.aliases.find((a) => a.alias.startsWith(query));
    if (prefixAlias) return { rank: 4, alias: prefixAlias.alias };
    // Words of the name without its "(Oil)"-style suffix, so "o" doesn't rank
    // every Oil app first.
    if (baseLabel(group.label).toLowerCase().split(/[\s/-]+/).some((w) => w.startsWith(query))) {
      return { rank: 5, alias: "" };
    }
    if (label.includes(query)) return { rank: 6, alias: "" };
    const module = (group.app.module || "").toLowerCase();
    if (module && module.split(/\s+/).some((w) => w.startsWith(query))) return { rank: 7, alias: "" };
    return { rank: -1, alias: "" };
  }

  // Groups matching the query, best first; ties keep menu order.
  // Returns [{ group, alias }].
  function rankGroups(groups, query) {
    query = query.trim().toLowerCase();
    return groups
      .map((group, index) => ({ group, index, ...matchGroup(group, query) }))
      .filter((m) => m.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(({ group, alias }) => ({ group, alias }));
  }

  // Aliases used by more than one group: { alias: [groupLabel, ...] }.
  function sharedAliases(groups) {
    const users = new Map();
    for (const g of groups) {
      for (const { alias } of g.aliases) {
        if (!users.has(alias)) users.set(alias, []);
        users.get(alias).push(g.label);
      }
    }
    return Object.fromEntries([...users].filter(([, labels]) => labels.length > 1));
  }

  return {
    BUILTIN_APPS,
    EXTRA_ALIASES,
    SHOW_TOP,
    baseLabel,
    groupName,
    appsFromModules,
    withInsertFlags,
    generatedAliases,
    buildGroups,
    matchGroup,
    rankGroups,
    sharedAliases,
  };
})();

if (typeof module !== "undefined") module.exports = MagicSearchApps;

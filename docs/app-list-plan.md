# Plan: fill the app list from the user's Maximo access

Status: planned, not built. Today the palette has four hardcoded apps (Locations, Assets, Work Orders, Purchase Orders) in `OPTIONS` in `src/content.js`.

## Goal

The palette lists every Maximo app the signed-in user can open, using Maximo's own data. The list is fetched automatically when none is saved, and can be refreshed by hand.

## Where the data comes from

The Manage shell already calls these with the user's login. `npm run discover-apps` (branch `investigate/discover-apps`) recorded them on the test instance on 2026-10-25.

| Source | What it gives | Use |
|---|---|---|
| `/maximo/oslc/permission/modules` | The Go To menu as data: modules, each with apps (`KEY` app id such as `WOTRACK`, `TEXT` label, `APPTYPE`). 257 apps on the test instance, the same set as the side menu. | Main app list |
| `/maximo/oslc/permission/allowedappoptions` | Per-app options, e.g. `ASSET` has `READ` and `INSERT`. 85 menu apps have no `INSERT`. | Only offer "new ..." where the user can insert |
| `/maximo/oslc/whoami` | The signed-in user id | Key for the saved list |

- Only `APPTYPE = RUN` apps (about 207) are included at first. These open with the `event=loadapp&value=<app>` address the extension already uses. Other types (MAS, APP, WC, such as dashboards and mobile apps) open differently and are left out for now.
- The list is very likely filtered by the user's security groups. It matches the Go To menu, but this is unconfirmed because the test login can open everything. To confirm, run `npm run discover-apps` as a user with fewer rights and compare.

## Storage

`chrome.storage.local`. Not `chrome.storage.sync`, which is capped at about 100 KB total and 8 KB per item.

There's one entry per Maximo server and user, since different users see different apps:

```
key:   apps:<origin>|<userid>        e.g. apps:http://192.168.0.60:9080|MAXADMIN
value: {
  fetchedAt: "2026-10-25T19:00:00Z",
  apps: [
    { id: "WOTRACK", label: "Work Order Tracking", module: "Work Orders", canInsert: true },
    ...
  ]
}
```

Only app ids, labels, modules and the insert flag are stored. No personal data, cookies or credentials.

If field lists are added later (see below), they go in the same storage per app, e.g. `fields:<origin>|<userid>|WOTRACK`, fetched the first time they're needed.

## Automatic fetch

1. When a Maximo page loads, the content script reads the user id (`whoami`, cached for the page) and looks up `apps:<origin>|<userid>`.
2. If there is no entry, or its list is empty, it fetches `permission/modules` and `allowedappoptions` in the background. These are same-origin requests with the user's login, so no new extension permissions are needed. It then saves the result.
3. Until the fetch finishes, the palette shows the four built-in apps, so it never opens empty.
4. If the fetch fails, it keeps the built-in apps, logs a console warning and tries again on the next page load.

Open question: should the list also refresh itself when it's older than N days (e.g. 7)?

## Manual refresh

1. **Palette command.** Typing `refresh` shows a "Refresh app list" entry. Enter re-fetches on the current Maximo page and replaces the saved list, then shows "Loaded N apps".
2. **Options page.** A section lists each saved list (server, user, number of apps, last refreshed) with a Clear button. Clearing makes the next Maximo page load fetch it again. The options page doesn't fetch from Maximo itself, because that would need extra host permissions to use the login.

Open question: keep both manual triggers, or only one?

## Duplicate apps (industry variants)

Some apps come in more than one version, with the same name plus a suffix in brackets. On the test instance there are 20 such pairs among the `RUN` apps, all "(Oil)" versions, for example:

| Standard | Variant |
|---|---|
| `WOTRACK` Work Order Tracking | `PLUSGWO` Work Order Tracking (Oil) |
| `ASSET` Assets | `PLUSGASS` Assets (Oil) |
| `LOCATION` Locations | `PLUSGLOC` Locations (Oil) |
| `PO` Purchase Orders | `PLUSGPO` Purchase Orders (Oil) |

Others: Crafts, Hazards, Incidents, Item Master, Job Plans, Organizations, People, Precautions, Preventive Maintenance, Purchase Requisitions, Qualifications, Quick Reporting, Routes, Service Requests, Solutions, Ticket Templates.

The palette shows only one app per group, so searching "work order" gives one result, not two.

- **Grouping.** Apps are grouped when their labels match after removing a trailing "(...)" suffix, ignoring case. Only `RUN` apps count (e.g. "Assets (Monitor)" is `MAS` and already left out). The group's name is the label without the suffix, e.g. "Work Order Tracking".
- **One version available.** If the user can open only one app in a group, that one is used automatically and nothing needs configuring. For example, a user with only "Work Order Tracking (Oil)" gets the Oil app whenever they pick Work Order Tracking.
- **Several versions available.** The palette uses one of them and hides the others. Which one is set on the options page (below). Until it's set, the variant is used over the standard app (Oil over standard), because a user given an industry version normally works in it.
- **Hidden versions give no results.** A hidden app doesn't appear when searching by its label, its app id or an alias. Aliases are attached to the group, so "wo" opens whichever Work Order Tracking is chosen.
- **The chosen app is used everywhere.** That includes plain Enter, the description filter ("wo pump") and "new" (if the chosen app can't insert, "new" isn't offered for that group).
- **Label shown.** The chosen app's own label, e.g. "Work Order Tracking (Oil)", so it's clear which one opens.

### Options page: choosing a version

A section "Apps with more than one version" lists each group where the user can open more than one app, from the saved list for the Maximo server and user last used, with a choice of which to use:

```
Work Order Tracking   (•) Work Order Tracking (Oil)   ( ) Work Order Tracking
Assets                (•) Assets (Oil)                ( ) Assets
...
```

The choice is saved in `chrome.storage.sync` (small, and follows the user's Chrome profile):

```
key:   appVariants
value: { "work order tracking": "PLUSGWO", "assets": "ASSET" }
```

- It's keyed by the group name, so it applies on any Maximo server. If the chosen app isn't available on a server or for a user, the default rule above applies.
- A change takes effect in open Maximo tabs straight away, the same way the shortcut setting does.
- Groups with only one available version aren't listed, because there's nothing to choose.

## Labels, aliases and search

- Labels come from Maximo, e.g. "Work Order Tracking" instead of "Work Orders". The module name is also searchable.
- Aliases are worked out from each app by a generic rule (below), so no app needs a hand-written alias.
- With about 200 apps, the ranking does the heavy lifting. An exact alias match comes first. Next comes a label or alias starting with the query, then a word in the label starting with it, then any other match. The list should show only the top N matches (e.g. 10), with the top entry highlighted.
- "new / insert / create" only offers apps with `canInsert`.
- The description filter ("assets first") keeps working for any app. Some apps may not have a description field (see below).

### Generic aliases

Each app gets these aliases automatically:

1. **Initials of its name**, taken after removing a bracketed suffix and small words (of, and, the, for, to, &). There is one alias for the first two words and one for the whole name. Names of a single word get none, because one letter is too short to be useful.
2. **Its app id**, e.g. `PR`, `PO`, `PM`, `WOTRACK`.

| App | Aliases |
|---|---|
| Work Order Tracking (`WOTRACK`) | wo, wot, wotrack |
| Purchase Requisitions (`PR`) | pr |
| Purchase Orders (`PO`) | po |
| Preventive Maintenance (`PM`) | pm |
| Job Plans (`JOBPLAN`) | jp, jobplan |
| Item Master (`ITEM`) | im, item |
| Service Requests (`SR`) | sr |
| Work Order Tracking (Oil) (`PLUSGWO`) | wo, wot, plusgwo |

- **Exact match first.** If the query equals an alias, that app tops the list. So "pr" gives Purchase Requisitions, not Precautions or Preventive Maintenance, even though those names also start with "pr".
- **Shared aliases.** On the test instance, 33 of the 133 generated aliases belong to more than one app, for example "pm" for Preventive Maintenance and Prioritization Matrix (Oil); "sr" for Service Requests and Shipment Receiving; "im" for Item Master, Integration Modules and Isolation Management (Oil); "ct" for five apps. Nothing is hidden: all of them are listed, in this order:
  1. the app whose id equals the query ("pm" gives `PM` Preventive Maintenance, "sr" gives `SR` Service Requests);
  2. apps whose full-name initials equal the query;
  3. apps whose first-two-word initials equal the query;
  4. then the usual label ranking.

  Remaining ties keep Maximo's menu order. "im" is one such tie, and a built-in extra can settle it (see below).
- **The matched alias is shown** next to the label when an alias, not the name, matched, e.g. "Item Master · im". This makes it clear why an app is listed.
- **Prefix matching still applies**, so "wo" also matches "wot", as it does today.
- **Variants share aliases.** Initials come from the name without its suffix, so "wo" finds the chosen Work Order Tracking version (see Duplicate apps).
- **Built-in extras are kept only where the rule falls short.** A small map keyed by app id adds aliases that aren't initials, e.g. `PR: ["purchase request"]`, since Maximo calls it Purchase Requisitions. It starts almost empty.
- **Filters and "new" work with aliases.** "wo pump" filters Work Order Tracking, and "new pr" inserts a requisition.

Open questions:
- Should users be able to add their own aliases on the options page (alias → app, synced, winning over generated ones)?
- Should long app ids such as `PLUSGWO` count as aliases, or only ids that are short or readable (`PR`, `ITEM`, `JOBPLAN`)?

## Tests

These follow the project rules: live Maximo, one login and one tab per run, most Enter targets checked without loading, sign out at the end.

- First load with nothing saved: the list is fetched and saved, and the palette shows Maximo labels, e.g. "wo" gives Work Order Tracking.
- Saved list present: no fetch on load (check the network log).
- `refresh` command: the list is re-fetched and `fetchedAt` changes.
- Options page Clear: the entry is removed, and the next load fetches again.
- Fetch failure (route `permission/modules` to 500): the built-in four are still shown.
- "new" is offered only for apps with `canInsert`.
- Existing tests are updated for the new labels.
- Aliases: "wo" opens Work Order Tracking, "pr" ranks Purchase Requisitions first, "pm" lists Preventive Maintenance above Prioritization Matrix (Oil), "po" gives Purchase Orders, and "new pr" inserts a requisition.
- Variants: with both Work Order Tracking and its (Oil) version available, "work order" shows one result, the Oil app by default. Choosing the standard app on the options page makes "wo" open `WOTRACK`, and the Oil app no longer appears. With only one version available (simulated by routing `permission/modules` to a reduced list), that version is used and the options page lists no choice for it.

## Later: field metadata

Possible future uses are choosing the filter field per app and searching records from the palette (e.g. "wo 1002"). These calls come from knowledge of the Maximo API and haven't been checked on the instance yet:

- `/maximo/oslc/jsonschemas/mxapiwodetail` gives the fields of an object structure with title, type and maxLength (use `mxapiasset`, `mxapilocations`, `mxapipo` etc. for the others).
- `/maximo/oslc/apimeta?lean=1` lists object structures and their main object.
- `/maximo/oslc/os/mxapiwodetail?lean=1&oslc.select=wonum,description,status&oslc.searchTerms=pump` queries records.
- Mapping an app (WOTRACK) to its object (WORKORDER) and object structure takes a lookup. There's no single obvious call.
- These calls list every field on the object, not just the app's list columns.

Next step if wanted: add these calls to `npm run discover-apps` and run it once.

# Plan: app list from Maximo

Status: plan only, nothing built yet.

Today the palette has four hardcoded apps (Locations, Assets, Work Orders,
Purchase Orders). The goal is to fill it automatically with the apps the
signed-in user can open, and refresh it on demand.

## What Maximo provides

Found with `npm run discover-apps` (see `tests/discover/discover-apps.spec.js`)
on the test instance. All three calls are made by the Manage shell itself, with
the user's normal login.

| Call | What it returns |
| --- | --- |
| `/maximo/oslc/permission/modules?lean=1` | The Go To menu as data: modules, each with its apps. Per app: `KEY` (app id, e.g. `WOTRACK`), `TEXT` (label, "Work Order Tracking"), `APPTYPE`, `ELEMENTTYPE` (`APP` or `MODULE`). 257 apps, exactly the side menu's list. |
| `/maximo/oslc/permission/allowedappoptions?lean=1` | Per app, the options the user has, e.g. `READ`, `INSERT`, `SAVE`. 85 menu apps have no `INSERT`. |
| `/maximo/oslc/whoami?addapps=1&lean=1` | The user (login id etc.) plus an `applications` map. Close to the menu but not identical (has e.g. `CHANGEPSWD`, misses about 24 menu apps), so not used for the list. |

App types in the menu: 207 `RUN` (classic apps, open with
`?event=loadapp&value=<app>`), 50 others (`MAS`, `APP`, `WC`: dashboards,
mobile and React apps) that open differently. Only `RUN` apps go in the
palette at first.

Not yet confirmed: that the lists are filtered by the user's security groups.
They match the Go To menu, which Maximo builds from security, but the test
user can open everything. Check by running `npm run discover-apps` as a user
with fewer rights.

## Storage

`chrome.storage.local` (the extension's own storage on that computer).
Not `chrome.storage.sync`: it allows about 100 KB in total and 8 KB per item,
too small for 200+ apps and, later, field lists.

One entry per Maximo server and user, because users can see different apps:

```
key:   apps:<origin>|<login id>      e.g. apps:http://192.168.0.60:9080|MAXADMIN
value: {
  fetchedAt: "2026-10-25T19:00:00Z",
  apps: [
    { id: "WOTRACK", label: "Work Order Tracking", module: "Work Orders", canInsert: true },
    ...
  ]
}
```

The login id comes from `/oslc/whoami`. Only app ids, labels, modules and the
insert flag are stored; no other personal details.

Aliases (`wo`, `po`) stay as a small built-in list of extra names, matched by
app id, on top of Maximo's labels.

## When it's fetched

Automatic:

1. On every Maximo page load, the content script reads the entry for this
   server and user.
2. If there is none, or its app list is empty, it fetches
   `permission/modules` and `permission/allowedappoptions` in the background
   (same-origin `fetch` from the Maximo page, so no extra extension
   permissions) and saves the result.
3. Until that finishes, the palette uses the four built-in apps, so it never
   opens empty.
4. If the fetch fails, the built-in apps stay and it tries again on the next
   page load.

Manual:

- In the palette: a "Refresh app list" command (type `refresh`). Runs on the
  current Maximo page with the user's login and replaces the saved list.
- On the options page: each saved list (server, user, number of apps, last
  refreshed) with a Clear button. The next Maximo page load fetches it again.
  The options page doesn't fetch itself: that would need host permissions to
  call Maximo with the user's cookies.

## Using the list

- Labels come from Maximo, so "Work Orders" becomes "Work Order Tracking".
  Matching and ranking stay as they are (name or alias starts with the text,
  then a later word, then anywhere).
- `new` / `insert` / `create` only offer apps with `canInsert`.
- With about 200 apps, the list shows the top matches only (e.g. 10).

## Later: fields

Maximo's REST API can describe and query fields (not yet checked on this
instance):

- `/maximo/oslc/jsonschemas/<object structure>` (e.g. `mxapiwodetail`):
  field names, labels, types, lengths.
- `/maximo/oslc/os/<object structure>?lean=1&oslc.select=wonum,description,status&oslc.where=...`:
  records with chosen fields.
- `/maximo/oslc/apimeta?lean=1`: the object structures that exist.

Mapping an app to its object structure needs a lookup. Field lists would be
stored per app next to the app list (e.g. `fields:<origin>|<login id>|WOTRACK`)
and fetched the first time they're needed.

## Tests

- Existing tests change where labels change (e.g. "Work Orders" → "Work Order
  Tracking").
- New tests: list fetched automatically on first load when empty; built-in apps
  shown until it arrives; "refresh" replaces it; Clear on the options page
  causes a re-fetch; `new` hides apps without insert.

## Open questions

- Should the list also refresh itself after a while (e.g. older than 7 days),
  or only when empty or refreshed by hand?
- Manual trigger: palette command, options page Clear, or both?
- How many matches to show at once?

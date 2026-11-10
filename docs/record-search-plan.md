# Plan: search Maximo records from the palette

Status: planned, not built. Written 2026-11-10 for discussion.

## Goal

From the palette, find a record by any mix of:

- its **identifier**, the key users see (`WONUM`, `ASSETNUM`, `LOCATION`, `PONUM`...), not the hidden numeric id (`WORKORDERID`);
- its **description**, with words in any order;
- its **site**;
- its **status**.

Matches show up in the palette as you type, and Enter opens the record.

Examples, all in Work Order Tracking:

| Typed | Finds |
|---|---|
| `wo 1002` | WONUM 1002 first, then 10020, 11002... |
| `wo pump seal` | Work orders whose description has both "pump" and "seal" |
| `wo pump BEDFORD` | The same, only at site BEDFORD |
| `wo pump APPR INPRG` | The same, only with status APPR or INPRG |
| `wo bedford` | Description contains "bedford" (lowercase is never a site) |
| `wo 10 pump` | WONUM containing 10 and description containing pump |

## What we have today

`wo pump` already opens Work Order Tracking with its list filtered on description (`useqbe`, see `FILTER` in `src/content.js`). It searches only the description, shows nothing in the palette, and opens a list rather than a record.

## How the search would work

### 1. Ask Maximo, not a local index

The palette queries Maximo's REST API with the user's own login, the same way `src/catalog.js` already loads the app list (same-origin `fetch`, no new permissions). For work orders:

```
/maximo/oslc/os/mxapiwodetail?lean=1
  &oslc.select=wonum,description,siteid,status,workorderid
  &oslc.where=wonum="%1002%" and siteid="BEDFORD" and status in ["APPR","INPRG"]
  &oslc.orderBy=-changedate
  &oslc.pageSize=10
```

- Results respect the user's security, because Maximo applies it.
- Nothing is copied into the browser, so it's always current and works with millions of records.
- `%` in `oslc.where` gives "contains". I expect it to be case-insensitive for these fields, but that needs checking on the instance.

A local copy (download every work order and search it in the browser) would allow typo-tolerant matching, but it goes stale, it's large, and it would hold business data in the browser. I don't recommend it.

### 2. Work out what each word means

The text after the app is split into words. **Capitals decide what a word can be**: only a word typed in capitals can be a site, a status or a letters-only identifier. Lowercase words are always description words. So `wo pump APPR BEDFORD` means "description has pump, status APPR, site BEDFORD", while `wo bedford pump` searches the description for both words.

Each word is sorted in this order:

1. **Site.** A capitalised word equal to a site id the user can see (`BEDFORD`). The site list is fetched once per server and user and saved like the app list (`/oslc/os/mxapisite?oslc.select=siteid,description`).
2. **Status.** A capitalised word equal to one of the app's status values (`WAPPR`, `APPR`, `INPRG`, `COMP`, `CLOSE`...). The values come from the app's status domain (`WOSTATUS` for work orders, `LOCASSETSTATUS` for assets, `POSTATUS` for POs...), including the site's own synonyms, fetched once and saved like the site list. Several statuses mean any of them: `wo pump WAPPR APPR` finds both.
3. **Identifier.** A word containing a digit (`1002`, `pmp-04`, any case), or any other capitalised word (`BOILER`, a location). Identifiers are stored in capitals in Maximo, so capitals are a natural signal.
4. **Description.** Everything else.

Each identifier and description word must match (AND), in any order. That's what makes it feel fuzzy: `seal pump` finds "Replace pump seal". The query itself still matches case-insensitively; capitals only decide how a word is read.

Edge cases:

- A capitalised word that is both a site and a status (unlikely): site wins, and the row shows how each word was read so it's visible.
- A capitalised acronym meant for the description (`HVAC`, `PPM`) would be read as an identifier. To cover that, a capitalised letters-only word that isn't a site or status is tried both as identifier and as description, in two queries side by side, and the results are merged.
- The highlighted row shows chips for what was understood, e.g. `Site: BEDFORD · Status: APPR · Description: pump`, so a misread is obvious.
- Typing in all lowercase never applies a site or status filter, so caps lock or a phone keyboard is the only way to trip over it.

### 3. Rank the results

Maximo returns up to 10 matches per query. The palette re-ranks them:

1. identifier equal to the typed text;
2. identifier starting with it;
3. identifier containing it;
4. description matches, with words matching at word starts first;
5. ties broken by most recently changed.

Each row shows the identifier, description, site and status, e.g. `1002 · Replace pump seal · BEDFORD · WAPPR`.

### 4. Open the record

Two ways, to be tested on the instance:

- **Direct:** the Manage shell address plus the record's unique id, `...?event=loadapp&value=wotrack&uniqueid=<workorderid>#/main`. The user never sees this id; the query fetches it alongside the identifier.
- **Fallback:** the existing `useqbe` filter with the identifier and site, `additionaleventvalue=wonum=1002|siteid=BEDFORD`. When one record matches, Maximo opens it directly (as the README notes).

Ctrl/Cmd+Enter could open the matching list instead, keeping today's behaviour reachable.

### 5. Keep it light on Maximo

- Search starts after 2 characters of record text and waits 250 ms after the last key.
- A new key press cancels the previous request (`AbortController`).
- Results for the same text are reused while the palette is open.
- Each request asks for at most 10 rows and 5 fields.
- REST calls don't start a UI session, so they shouldn't count towards the session limit, but that's worth confirming.

## Which apps

Every app needs three facts: its object structure, its identifier field and its unique id field. Two ways to get them:

**A. A hand-written table for the common apps (recommended to start).**

| App | Object structure | Identifier | Unique id |
|---|---|---|---|
| Work Order Tracking | `mxapiwodetail` | `wonum` | `workorderid` |
| Assets | `mxapiasset` | `assetnum` | `assetuid` |
| Locations | `mxapioperloc` | `location` | `locationsid` |
| Purchase Orders | `mxapipo` | `ponum` | `poid` |
| Purchase Requisitions | `mxapipr` | `prnum` | `prid` |
| Service Requests | `mxapisr` | `ticketid` | `ticketuid` |
| Item Master | `mxapiitem` | `itemnum` | `itemid` |
| Preventive Maintenance | `mxapipm` | `pmnum` | `pmuid` |
| Job Plans | `mxapijobplan` | `jpnum` | `jobplanid` |

(Oil) versions use the same objects, so they share the row of their standard app. Names above are from Maximo's standard object structures and need confirming on the instance.

**B. Work it out for any app.** Look up the app's main object, find an object structure built on it (`/oslc/apimeta`), and read its key fields from `/oslc/jsonschemas/<name>`. This covers every app but is slower to build and has more edge cases (apps without a REST object structure, objects keyed on more than one field). Worth doing after A proves the idea.

Apps not in the table keep today's behaviour: the text filters the list on description.

## Where it shows in the palette

Today, `wo pump` shows the Work Order Tracking row with a "Description: pump" label. With this change:

- That app row stays on top, so Enter-without-looking still opens the filtered list (Option 1 below), **or** records take over (Option 2).
- Record rows appear under it as they arrive, with a small "Searching…" row while waiting and "No records" when there are none.
- Arrow keys move through apps and records alike.

## Before building: check the API on the instance

The instance is on Elliot's LAN, so these can only be checked from his Mac. Step one would be to add them to `npm run discover-apps` (or a new `discover-records`) and have Elliot run it once:

1. The object structure names in the table exist and the test user can query them.
2. `oslc.where` with `%` is case-insensitive on `wonum` and `description`.
3. `uniqueid=` opens a record in the Manage shell.
4. `useqbe` accepts several fields separated by `|`.
5. REST calls don't use up UI sessions.
6. Status values can be read per domain, e.g. `/oslc/os/mxapisynonymdomain?oslc.where=domainid="WOSTATUS"`, and `status in [...]` works in `oslc.where`.

## Tests

Following the project rules (live Maximo, one login and tab, most Enter targets checked without loading):

- `wo <known wonum>` lists that work order first; Enter's address contains its unique id.
- `wo <two description words in reverse order>` finds a known record.
- `wo <word> <SITEID>` returns only that site; the same word in lowercase searches the description.
- `wo <word> <STATUS>` returns only that status; two statuses return either.
- Typing fast sends one request for the final text (check the network log).
- A failing REST call (routed to 500) leaves the app row working.
- One test in `real-navigation.spec.js` really opens a found record.

Test records are looked up at the start of the run (the first work order the test user can see), so the tests don't depend on fixed data.

## Questions for Elliot

1. **How record search starts.**
   - Option 1: automatic. `wo pump` shows the app row first (Enter opens the filtered list, as today) and records below it.
   - Option 2: automatic, records first. Enter opens the top record.
   - Option 3: explicit. Tab on an app turns it into a tag (like the in-app actions tag), and then typing searches only its records.
2. **Status values.** Match the stored status (e.g. `APPR`) only, or also its description ("Approved")? The plan matches only the code.
3. **Apps.** Is the table above the right starting list?
4. **Later:** a search with no app (`1002` alone searching work orders, assets and locations at once)?

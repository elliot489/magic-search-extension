# Plan: search Maximo records from the palette

Status: planned, not built. Written 2026-11-10, revised the same day after discussion with Elliot.

## Goal

From the palette, open an app's list filtered by any mix of:

- the record's **identifier**, the key users see (`WONUM`, `ASSETNUM`, `LOCATION`...), not the hidden numeric id (`WORKORDERID`);
- its **description**;
- its **site**;
- its **status**.

All conditions must match (AND). If only one record matches, Maximo opens it directly.

| Typed | Opens Work Order Tracking filtered on |
|---|---|
| `wo 1002` | `wonum=%1002%` |
| `wo pump` | `description=%pump%` (as today) |
| `wo 1002 pump APPR BEDFORD` | `wonum=%1002%` and `description=%pump%` and `status=APPR` and `siteid=BEDFORD` |
| `wo pump APPR INPRG` | description has pump, and status is APPR or INPRG |
| `wo bedford` | `description=%bedford%` (lowercase is never a site) |
| `wo HVAC` | `status=HVAC` (capitals that aren't a site are a status) |

## Decision: no record REST API

The first version of this plan queried records through Maximo's REST object structures (`mxapiwodetail` etc.) to show matches inside the palette. Elliot decided against it on 2026-11-10, because those object structures can be blocked for ordinary users. Instead the palette only builds a better filter and opens the app's list with it, through the normal UI, where the user's app rights apply. Nothing is fetched while typing.

## How the filter is passed

Today `wo pump` opens:

```
...?event=loadapp&value=wotrack&additionalevent=useqbe&additionaleventvalue=description=pump#/main
```

`additionaleventvalue` takes several `attribute=value` pairs separated by `|`. IBM's documentation describes `|` only as the separator between pairs: "Use the | character to separate each name=value pair" ([IBM: Power Maximo URL parameters](https://www.ibm.com/support/pages/power-maximo-url-parameters); same format in [Bruno Portaluri, Maximo URLs](https://bportaluri.com/2012/04/maximo-urls.html)). So it isn't an "or". Neither page says in words how a QBE combines several pairs, but each pair fills one field of the list's filter row, and the filter row ANDs its fields. That gives the AND we want:

```
additionaleventvalue=wonum=%1002%|description=%pump%|status=APPR|siteid=BEDFORD
```

The value is URL-encoded, so `%` becomes `%25` and `|` becomes `%7C`.

Within one field, the filter row's own syntax applies, as if typed there:

- `%` is a wildcard. Text fields already match "contains" by default, so `%` is mostly for clarity.
- A comma means "any of": `status=APPR,INPRG`. That's how two typed statuses become an "or" inside the status field, while the fields stay ANDed.
- A leading `=` means an exact match. Statuses and sites should be exact, so `APPR` doesn't also find `WAPPR`.

These three need confirming on the instance (see checks below).

## How words are read

The text after the app is split into words:

1. **Site.** A word in capitals that is in the user's site list (`BEDFORD`). Goes into `siteid`, exact.
2. **Status.** Any other word in capitals, letters only (`APPR`, `WAPPR`, `HVAC`). Goes into `status`, exact; several become "any of". No status list is needed, so nothing depends on the work order API. A word like `HVAC` meant for the description is read as a status, by design: type it in lowercase to search the description.
3. **Identifier.** A word containing a digit, in any case (`1002`, `pmp-04`). Goes into the app's identifier field. More than one are joined with `%` (`10%02`).
4. **Description.** Everything else, i.e. lowercase words. Joined with `%`, so `pump seal` becomes `description=%pump%seal%`. The words must appear in the order typed: `seal pump` won't find "Replace pump seal", because the filter row has no "all these words in any order".

The highlighted row shows how the words were read, e.g. `Site: BEDFORD · Status: APPR · WO: 1002 · Description: pump`, so a misread is visible before pressing Enter. Words that don't apply to the app are dropped, e.g. a site on an app without `siteid`.

### The site list

Needed to tell a site from a status. Sources, in order, to be checked on the instance:

1. `/maximo/oslc/os/mxapisite?oslc.select=siteid,description` (or `mxapiorganization` with its sites). One small call per server and user, saved like the app list (`sites:<origin>|<userid>` in local storage) and refreshed with it (daily, `refresh`, Clear).
2. If that's blocked too: the user's default and insert sites from `/maximo/oslc/whoami`, which the extension already calls.
3. Sites added by hand on the options page, for when both are incomplete.

A site missing from the list is read as a status. The filter then finds nothing, and the label shows `Status: BEDFORD`, which makes the cause obvious.

## Which apps

Each app needs its field names. Most follow the same pattern, so a small table is enough:

| App | Identifier | Description | Site | Status |
|---|---|---|---|---|
| Work Order Tracking | `wonum` | `description` | `siteid` | `status` |
| Assets | `assetnum` | `description` | `siteid` | `status` |
| Locations | `location` | `description` | `siteid` | `status` |
| Purchase Orders | `ponum` | `description` | `siteid` | `status` |
| Purchase Requisitions | `prnum` | `description` | `siteid` | `status` |
| Service Requests | `ticketid` | `description` | `siteid` | `status` |
| Item Master | `itemnum` | `description` | — | `status` |
| Preventive Maintenance | `pmnum` | `description` | `siteid` | `status` |
| Job Plans | `jpnum` | `description` | `siteid` | `status` |

(Oil) versions share the row of their standard app. Apps not in the table keep today's behaviour: all the text filters the description. Field names come from Maximo's standard objects and need confirming on the instance.

## Where it shows in the palette

The same place as today's description filter: the app row, with the "Description: …" label replaced by the chips above. Enter opens the filtered list. No extra rows, no waiting, no network calls while typing.

## Before building: checks on the instance

From Elliot's Mac, in the discover script or a test:

1. Several `|` pairs in `useqbe` combine as AND.
2. `status=APPR,INPRG` matches either status.
3. `=APPR` doesn't match `WAPPR`, and how the leading `=` is written in the URL.
4. Whether an ordinary user can read `mxapisite` (or `mxapiorganization`), and what `whoami` gives for sites if not.
5. The field names in the table are right for each app.

## Tests

Following the project rules (live Maximo, one login and tab, most Enter targets checked without loading):

- `wo 1002 pump APPR <SITE>` builds a filter with all four fields.
- `wo <site in lowercase>` filters only the description.
- `wo HVAC` filters status HVAC.
- `wo APPR INPRG` puts both statuses in the status field as "any of".
- An app without a site field drops the site word.
- The site list loads once and is reused. With `mxapisite` routed to 403, sites come from `whoami`.
- In `real-navigation.spec.js`: one test opens a list filtered on two fields and checks only matching rows show; one opens a known work order by number and lands on the record.

## Questions for Elliot

1. Is it OK that description words must be in the typed order (`pump%seal`), given the filter row can't do any order?
2. Is the app table the right starting list?

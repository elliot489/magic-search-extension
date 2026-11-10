// Record search: turns the text after an app's name into a list filter on
// several fields. See docs/record-search-plan.md.
//
//   "wo 1002 pump APPR BEDFORD" -> wonum=1002|description=pump|status==APPR|siteid==BEDFORD
//
// Unless a site is typed, the user's default site is used. Apps whose table
// has a history flag (work orders, POs, PRs, service requests) also get
// historyflag=0, so closed and cancelled records ("history") are left out,
// unless a status is typed (wo CLOSE finds closed work orders).
//
// Words are read as:
//   site        a word in capitals that is one of the user's sites (BEDFORD)
//   status      any other word in capitals, letters only (APPR, HVAC)
//   identifier  a word containing a digit, any case (1002, pmp-04)
//   description everything else (lowercase words)
// The fields are ANDed by Maximo's list filter. Several statuses become
// "any of" (=APPR,=INPRG). Sites and statuses match exactly (=APPR doesn't
// find WAPPR); identifiers and descriptions match "contains", Maximo's
// default, and several words are joined with % (in the order typed).
// Pure functions, shared by the content script and the tests.
var MagicSearchRecords = (() => {
  // Field names per app group (all versions of an app share them). Apps not
  // listed here filter only the description, with all the text as typed.
  // label: shown on the chip for the identifier, e.g. "WO: 1002".
  // history: the table has HISTORYFLAG (filtered to 0).
  const APP_FIELDS = {
    "work order tracking": { id: "wonum", label: "WO", site: "siteid", history: true },
    assets: { id: "assetnum", label: "Asset", site: "siteid" },
    locations: { id: "location", label: "Location", site: "siteid" },
    "purchase orders": { id: "ponum", label: "PO", site: "siteid", history: true },
    "purchase requisitions": { id: "prnum", label: "PR", site: "siteid", history: true },
    "service requests": { id: "ticketid", label: "SR", site: "siteid", history: true },
    "item master": { id: "itemnum", label: "Item", site: null },
    "preventive maintenance": { id: "pmnum", label: "PM", site: "siteid" },
    "job plans": { id: "jpnum", label: "Job plan", site: "siteid" },
  };
  const DESCRIPTION = "description";
  const STATUS = "status";
  const HISTORY = "historyflag";

  function fieldsFor(groupName) {
    return APP_FIELDS[String(groupName || "").toLowerCase()] || null;
  }

  // A word typed in capitals: has a letter and no lowercase letters.
  function isCapitals(word) {
    return /[A-Z]/.test(word) && word === word.toUpperCase();
  }

  // Sort the words of text for an app group. sites: the user's site ids;
  // defaultSite: used when no site is typed. Returns { site, siteIsDefault,
  // statuses, ids, description } (arrays of words, site may be ""), or null
  // for apps without a field table (plain description filter).
  function read(text, groupName, sites = [], defaultSite = "") {
    const fields = fieldsFor(groupName);
    if (!fields) return null;
    const siteSet = new Set((sites || []).map((s) => String(s).toUpperCase()));
    const out = { site: "", statuses: [], ids: [], description: [] };
    for (const word of String(text || "").trim().split(/\s+/).filter(Boolean)) {
      if (isCapitals(word) && siteSet.has(word)) {
        // A site on an app without a site field is dropped; a second site
        // replaces the first (a record has only one).
        if (fields.site) out.site = word;
      } else if (/\d/.test(word)) {
        out.ids.push(word);
      } else if (isCapitals(word) && /^[A-Z]+$/.test(word)) {
        if (!out.statuses.includes(word)) out.statuses.push(word);
      } else {
        out.description.push(word);
      }
    }
    out.siteIsDefault = false;
    if (!out.site && fields.site && defaultSite) {
      out.site = String(defaultSite).toUpperCase();
      out.siteIsDefault = true;
    }
    return out;
  }

  // [field, value] pairs for the list filter, in a fixed order.
  // Nothing typed means no filter (and no default site or history flag).
  function pairs(text, groupName, sites, defaultSite) {
    const t = String(text || "").trim();
    if (!t) return [];
    const parts = read(text, groupName, sites, defaultSite);
    if (!parts) return [[DESCRIPTION, t]];
    const fields = fieldsFor(groupName);
    const out = [];
    if (parts.ids.length) out.push([fields.id, parts.ids.join("%")]);
    if (parts.description.length) out.push([DESCRIPTION, parts.description.join("%")]);
    if (parts.statuses.length) out.push([STATUS, parts.statuses.map((s) => `=${s}`).join(",")]);
    if (parts.site) out.push([fields.site, `=${parts.site}`]);
    // A typed status says which records are wanted, closed ones included
    // (CLOSE and CAN records are history), so then the flag isn't added.
    if (fields.history && !parts.statuses.length) out.push([HISTORY, "0"]);
    return out;
  }

  // The additionaleventvalue for useqbe, e.g. "wonum=1002|status==APPR",
  // or "" when there's nothing to filter.
  function qbe(text, groupName, sites, defaultSite) {
    return pairs(text, groupName, sites, defaultSite)
      .map(([field, value]) => `${field}=${value}`)
      .join("|");
  }

  // What the highlighted row shows, e.g.
  // "WO: 1002 · Description: pump · Status: APPR · Site: BEDFORD".
  function label(text, groupName, sites, defaultSite) {
    const t = String(text || "").trim();
    if (!t) return "";
    const parts = read(text, groupName, sites, defaultSite);
    if (!parts) return `Description: ${t}`;
    const fields = fieldsFor(groupName);
    const chips = [];
    if (parts.ids.length) chips.push(`${fields.label}: ${parts.ids.join(" ")}`);
    if (parts.description.length) chips.push(`Description: ${parts.description.join(" ")}`);
    if (parts.statuses.length) chips.push(`Status: ${parts.statuses.join(" or ")}`);
    if (parts.site) chips.push(`Site: ${parts.site}${parts.siteIsDefault ? " (default)" : ""}`);
    return chips.join(" · ");
  }

  return { APP_FIELDS, fieldsFor, isCapitals, read, pairs, qbe, label };
})();

if (typeof module !== "undefined") module.exports = MagicSearchRecords;

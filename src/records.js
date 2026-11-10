// Record search: turns the text after an app's name into a list filter on
// several fields. See docs/record-search-plan.md.
//
//   "wo 1002 pump APPR BEDFORD" -> wonum=1002|description=pump|status==APPR|siteid==BEDFORD
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
  const APP_FIELDS = {
    "work order tracking": { id: "wonum", label: "WO", site: "siteid" },
    assets: { id: "assetnum", label: "Asset", site: "siteid" },
    locations: { id: "location", label: "Location", site: "siteid" },
    "purchase orders": { id: "ponum", label: "PO", site: "siteid" },
    "purchase requisitions": { id: "prnum", label: "PR", site: "siteid" },
    "service requests": { id: "ticketid", label: "SR", site: "siteid" },
    "item master": { id: "itemnum", label: "Item", site: null },
    "preventive maintenance": { id: "pmnum", label: "PM", site: "siteid" },
    "job plans": { id: "jpnum", label: "Job plan", site: "siteid" },
  };
  const DESCRIPTION = "description";
  const STATUS = "status";

  function fieldsFor(groupName) {
    return APP_FIELDS[String(groupName || "").toLowerCase()] || null;
  }

  // A word typed in capitals: has a letter and no lowercase letters.
  function isCapitals(word) {
    return /[A-Z]/.test(word) && word === word.toUpperCase();
  }

  // Sort the words of text for an app group. sites: the user's site ids.
  // Returns { site, statuses, ids, description } (arrays of words, site may
  // be ""), or null for apps without a field table (plain description filter).
  function read(text, groupName, sites = []) {
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
    return out;
  }

  // [field, value] pairs for the list filter, in a fixed order.
  function pairs(text, groupName, sites) {
    const parts = read(text, groupName, sites);
    if (!parts) {
      const t = String(text || "").trim();
      return t ? [[DESCRIPTION, t]] : [];
    }
    const fields = fieldsFor(groupName);
    const out = [];
    if (parts.ids.length) out.push([fields.id, parts.ids.join("%")]);
    if (parts.description.length) out.push([DESCRIPTION, parts.description.join("%")]);
    if (parts.statuses.length) out.push([STATUS, parts.statuses.map((s) => `=${s}`).join(",")]);
    if (parts.site) out.push([fields.site, `=${parts.site}`]);
    return out;
  }

  // The additionaleventvalue for useqbe, e.g. "wonum=1002|status==APPR",
  // or "" when there's nothing to filter.
  function qbe(text, groupName, sites) {
    return pairs(text, groupName, sites)
      .map(([field, value]) => `${field}=${value}`)
      .join("|");
  }

  // What the highlighted row shows, e.g.
  // "WO: 1002 · Description: pump · Status: APPR · Site: BEDFORD".
  function label(text, groupName, sites) {
    const parts = read(text, groupName, sites);
    if (!parts) {
      const t = String(text || "").trim();
      return t ? `Description: ${t}` : "";
    }
    const fields = fieldsFor(groupName);
    const chips = [];
    if (parts.ids.length) chips.push(`${fields.label}: ${parts.ids.join(" ")}`);
    if (parts.description.length) chips.push(`Description: ${parts.description.join(" ")}`);
    if (parts.statuses.length) chips.push(`Status: ${parts.statuses.join(" or ")}`);
    if (parts.site) chips.push(`Site: ${parts.site}`);
    return chips.join(" · ");
  }

  return { APP_FIELDS, fieldsFor, isCapitals, read, pairs, qbe, label };
})();

if (typeof module !== "undefined") module.exports = MagicSearchRecords;

#!/usr/bin/env node
// Checks which attribute each Maximo app's record search should use.
//
//   npm run check-search-fields            all apps you can open
//   npm run check-search-fields -- PERSON  only these apps (ids), with all their attributes
//
// Reads MAXIMO_URL and MAXIMO_USER from .env, and asks for the password
// (or uses MAXIMO_PASSWORD from .env). Read-only: it only GETs from Maximo's
// REST API: the apps you can open (/oslc/permission/modules), each app's main
// table (MAXAPPS.MAINTBNAME) and that table's attributes (MAXATTRIBUTE),
// found through whichever object structures this Maximo has (/oslc/apimeta).
//
// Prints, per app: its main table, whether that table has DESCRIPTION, the
// field the extension searches now (src/records.js), and a suggestion. The
// full result goes to .auth/search-fields.json (gitignored).
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const Records = require("../src/records.js");
const Apps = require("../src/apps.js");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const OUT = path.join(ROOT, ".auth", "search-fields.json");

const { MAXIMO_URL, MAXIMO_USER } = process.env;
if (!MAXIMO_URL || !MAXIMO_USER) {
  console.error("Set MAXIMO_URL and MAXIMO_USER in .env (see .env.example).");
  process.exit(1);
}
const BASE = (MAXIMO_URL.endsWith("/") ? MAXIMO_URL : MAXIMO_URL + "/").replace(/\/$/, "");
const ONLY = process.argv.slice(2).map((a) => a.toUpperCase());

// Text attributes worth searching, best first, when there's no DESCRIPTION.
const PREFERRED = ["description", "displayname", "name", "subject", "title", "summary"];
const TEXT_TYPES = new Set(["ALN", "UPPER", "LOWER", "LONGALN", "GL"]);

function askPassword() {
  if (process.env.MAXIMO_PASSWORD) return Promise.resolve(process.env.MAXIMO_PASSWORD);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith("Password")) rl.output.write(s);
    };
    rl.question(`Password for ${MAXIMO_USER} at ${BASE}: `, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

// ---- HTTP with a cookie jar ----
const cookies = new Map();
let authHeader = {};

function keepCookies(res) {
  for (const c of res.headers.getSetCookie?.() || []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1));
  }
}
function cookieHeader() {
  return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function request(pathAndQuery, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(BASE + pathAndQuery, {
    method,
    body,
    redirect: "manual",
    headers: { accept: "application/json", cookie: cookieHeader(), ...authHeader, ...headers },
  });
  keepCookies(res);
  return res;
}
async function getJson(pathAndQuery) {
  const res = await request(pathAndQuery);
  if (!res.ok) throw new Error(`${pathAndQuery.split("?")[0]}: HTTP ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (!type.includes("json")) throw new Error(`${pathAndQuery.split("?")[0]}: not JSON (${type || "no type"}), not signed in?`);
  return res.json();
}

async function signIn(password) {
  // 1. Maximo's own login header (native authentication).
  authHeader = { maxauth: Buffer.from(`${MAXIMO_USER}:${password}`).toString("base64") };
  try {
    const who = await getJson("/oslc/whoami?lean=1");
    return who;
  } catch (_) {}
  // 2. The app server's form login.
  authHeader = {};
  cookies.clear();
  await request("/webclient/login/login.jsp");
  const res = await request("/j_security_check", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    body: new URLSearchParams({ j_username: MAXIMO_USER, j_password: password }).toString(),
  });
  if (res.status >= 400) throw new Error(`login: HTTP ${res.status}`);
  return getJson("/oslc/whoami?lean=1");
}

async function signOut() {
  await request("/oslc/logout").catch(() => {});
}

// ---- Object structures ----
// /oslc/apimeta lists the object structures and their main object. The shape
// differs between versions, so look for any object naming a structure and its
// main object.
function structuresFrom(meta) {
  const out = [];
  const seen = new Set();
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const keys = Object.keys(node);
    const nameKey = keys.find((k) => /^(name|objectstructure|intobjectname|title)$/i.test(k));
    const mboKey = keys.find((k) => /^(mainmbo|mainobject|objectname|mbo|mbonname|maintbname)$/i.test(k));
    if (nameKey && mboKey && typeof node[nameKey] === "string" && typeof node[mboKey] === "string") {
      const os = node[nameKey].toUpperCase();
      if (!seen.has(os)) {
        seen.add(os);
        out.push({ os, mbo: node[mboKey].toUpperCase() });
      }
    }
    for (const k of keys) walk(node[k]);
  })(meta);
  return out;
}

async function queryAll(os, select, where) {
  const rows = [];
  let url = `/oslc/os/${os.toLowerCase()}?lean=1&oslc.select=${encodeURIComponent(select)}&oslc.pageSize=1000${
    where ? `&oslc.where=${encodeURIComponent(where)}` : ""
  }`;
  for (let page = 0; url && page < 200; page++) {
    const res = await getJson(url);
    rows.push(...(res.member || []));
    const next = res.responseInfo && res.responseInfo.nextPage && res.responseInfo.nextPage.href;
    url = next ? next.replace(/^.*?\/oslc\//, "/oslc/") : null;
  }
  return rows;
}

// Try each object structure on mbo until one answers.
async function firstWorking(structures, mbo, select, where, notes) {
  const candidates = structures.filter((s) => s.mbo === mbo).map((s) => s.os);
  for (const os of candidates) {
    try {
      const rows = await queryAll(os, select, where);
      notes.push(`${mbo} read through ${os}`);
      return rows;
    } catch (err) {
      notes.push(`${mbo} through ${os}: ${err.message}`);
    }
  }
  return null;
}

// Attributes of one table through its own object structure's JSON schema
// (only when MAXATTRIBUTE can't be read).
async function attributesFromSchema(structures, table, notes) {
  for (const { os } of structures.filter((s) => s.mbo === table)) {
    try {
      const schema = await getJson(`/oslc/jsonschemas/${os.toLowerCase()}`);
      const props = Object.entries(schema.properties || {})
        .filter(([, p]) => p && p.type !== "array" && p.type !== "object")
        .map(([name, p]) => ({ name: name.toLowerCase(), type: String(p.subType || p.type || "").toUpperCase(), title: p.title || "" }));
      if (props.length) return { from: `jsonschema ${os}`, attrs: props };
    } catch (err) {
      notes.push(`${table} schema through ${os}: ${err.message}`);
    }
  }
  return null;
}

// Object structure names to try when apimeta doesn't list one.
const GUESSES = [
  { os: "MXAPIMAXAPPS", mbo: "MAXAPPS" },
  { os: "MXAPPS", mbo: "MAXAPPS" },
  { os: "MXAPIMAXATTRIBUTE", mbo: "MAXATTRIBUTE" },
  { os: "MXAPIMAXOBJECT", mbo: "MAXOBJECT" },
  { os: "MXOBJECT", mbo: "MAXOBJECT" },
];

// Main tables of the apps the extension knows, if MAXAPPS can't be read.
const KNOWN_TABLES = {
  PERSON: "PERSON", USER: "MAXUSER", MASUSER: "MAXUSER", LABOR: "LABOR", COMPANY: "COMPANIES",
  COMPMASTER: "COMPMASTER", INVENTOR: "INVENTORY", TOOLINV: "INVENTORY", BBOARD: "BULLETINBOARD",
  EXCHANGE: "EXCHANGE", CHRTACCT: "CHARTOFACCOUNTS", WFADMIN: "WFINSTANCE", LOGGING: "MAXLOGGER",
  WOTRACK: "WORKORDER", ASSET: "ASSET", LOCATION: "LOCATIONS", PO: "PO", PR: "PR", SR: "SR",
  ITEM: "ITEM", PM: "PM", JOBPLAN: "JOBPLAN", MASTERPM: "MASTERPM",
};

function suggest(attrs) {
  const names = new Set(attrs.map((a) => a.name));
  return PREFERRED.find((n) => names.has(n)) || "";
}

async function main() {
  const password = await askPassword();
  const notes = [];
  const who = await signIn(password);
  console.log(`Signed in as ${who.loginID || who.userName || MAXIMO_USER}.`);
  try {
    // Apps the user can open, with their group (as the extension names them).
    const modules = await getJson("/oslc/permission/modules?lean=1&relativeuri=1&internalvalues=1");
    let apps = Apps.appsFromModules(modules);
    if (ONLY.length) apps = apps.filter((a) => ONLY.includes(a.id));
    console.log(`${apps.length} apps.`);

    const meta = await getJson("/oslc/apimeta?lean=1").catch((err) => {
      notes.push(`apimeta: ${err.message}`);
      return [];
    });
    const structures = structuresFrom(meta);
    notes.push(`${structures.length} object structures listed by apimeta`);
    if (!structures.length) notes.push(`apimeta looked like: ${JSON.stringify(meta).slice(0, 600)}`);
    for (const g of GUESSES) if (!structures.some((s) => s.os === g.os)) structures.push(g);

    // Main table per app.
    const appRows = await firstWorking(structures, "MAXAPPS", "app,maintbname", "", notes);
    const mainTable = new Map((appRows || []).map((r) => [String(r.app).toUpperCase(), String(r.maintbname || "").toUpperCase()]));
    if (!appRows) {
      notes.push("MAXAPPS unreadable: main tables only for the apps the extension knows");
      for (const [app, table] of Object.entries(KNOWN_TABLES)) mainTable.set(app, table);
    }

    // Attributes per table.
    const tables = [...new Set(apps.map((a) => mainTable.get(a.id)).filter(Boolean))];
    const attrsByTable = new Map();
    const attrRows = await firstWorking(
      structures,
      "MAXATTRIBUTE",
      "objectname,attributename,maxtype,persistent,title",
      tables.length && tables.length <= 300 ? `objectname in [${tables.map((t) => `"${t}"`).join(",")}]` : "",
      notes
    );
    let objectRows = null;
    if (!attrRows) {
      // Database Configuration's structure: MAXOBJECT with its MAXATTRIBUTE children.
      objectRows = await firstWorking(
        structures,
        "MAXOBJECT",
        "objectname,maxattribute{attributename,maxtype,persistent,title}",
        tables.length && tables.length <= 300 ? `objectname in [${tables.map((t) => `"${t}"`).join(",")}]` : "",
        notes
      );
    }
    if (objectRows) {
      for (const o of objectRows) {
        attrsByTable.set(String(o.objectname).toUpperCase(), {
          from: "MAXOBJECT",
          attrs: (o.maxattribute || []).map((r) => ({
            name: String(r.attributename).toLowerCase(),
            type: String(r.maxtype || "").toUpperCase(),
            title: r.title || "",
            persistent: r.persistent,
          })),
        });
      }
    } else if (attrRows) {
      for (const r of attrRows) {
        const t = String(r.objectname).toUpperCase();
        if (!attrsByTable.has(t)) attrsByTable.set(t, { from: "MAXATTRIBUTE", attrs: [] });
        attrsByTable.get(t).attrs.push({
          name: String(r.attributename).toLowerCase(),
          type: String(r.maxtype || "").toUpperCase(),
          title: r.title || "",
          persistent: r.persistent,
        });
      }
    } else {
      for (const t of tables) {
        const found = await attributesFromSchema(structures, t, notes);
        if (found) attrsByTable.set(t, found);
      }
    }

    const result = apps.map((app) => {
      const group = Apps.groupName(app.label);
      const table = mainTable.get(app.id) || "";
      const info = attrsByTable.get(table);
      const attrs = info ? info.attrs : null;
      const current = Records.defaultTextField(group);
      const has = (n) => !!attrs && attrs.some((a) => a.name === n);
      return {
        app: app.id,
        label: app.label,
        group,
        table,
        attributesFrom: info ? info.from : "",
        hasDescription: attrs ? has("description") : null,
        current,
        currentExists: attrs ? has(current.split(".")[0]) || current.includes(".") : null,
        suggested: attrs ? suggest(attrs) : "",
        textAttributes: attrs ? attrs.filter((a) => TEXT_TYPES.has(a.type)).map((a) => a.name) : [],
        ...(ONLY.length ? { attributes: attrs } : {}),
      };
    });

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ checkedAt: new Date().toISOString(), base: BASE, notes, structures, apps: result }, null, 1));

    const unknown = result.filter((r) => r.hasDescription === null);
    const problems = result.filter((r) => r.currentExists === false);
    const noDescription = result.filter((r) => r.hasDescription === false);
    console.log("\nApps whose main table has no DESCRIPTION:");
    for (const r of noDescription) {
      console.log(
        `  ${r.app.padEnd(12)} ${r.label.padEnd(32)} ${r.table.padEnd(16)} now: ${r.current.padEnd(14)} ${
          r.currentExists ? "ok" : "MISSING"
        }  suggested: ${r.suggested || "-"}  text fields: ${r.textAttributes.slice(0, 12).join(", ")}`
      );
    }
    console.log(`\nSearch field missing on its table: ${problems.length ? problems.map((r) => `${r.app} (${r.current})`).join(", ") : "none"}`);
    if (unknown.length) console.log(`Couldn't check ${unknown.length} apps: ${unknown.map((r) => r.app).join(", ")}`);
    console.log(`\nNotes:\n  ${notes.join("\n  ")}`);
    console.log(`\nFull result: ${path.relative(ROOT, OUT)}`);
  } finally {
    await signOut();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

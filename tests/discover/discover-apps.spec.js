const fs = require("fs");
const path = require("path");
const { test, SHELL_URL } = require("../fixtures");

const OUT = path.join(__dirname, "..", "..", ".auth", "discover-apps.json");
// Response bodies that mention any of these are kept.
const KEYWORDS = ["loadapp", "changeapp", "eventvalue", "wotrack", "WOTRACK", "appname", "APPNAME", "applications"];
const MAX_BODY = 2_000_000;

// Runs in a frame: the Go To menu data and any app links in the DOM.
function readMenus() {
  // fillAppNavSection({...}) calls in inline scripts (classic UI side menu).
  function jsonAt(text, start) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }
  const navSections = [];
  for (const s of document.scripts) {
    const text = s.textContent || "";
    let at = text.indexOf("fillAppNavSection(");
    while (at !== -1) {
      const raw = jsonAt(text, text.indexOf("{", at));
      try {
        navSections.push(JSON.parse(raw));
      } catch (e) {
        navSections.push({ parseError: e.message, sample: (raw || "").slice(0, 300) });
      }
      at = text.indexOf("fillAppNavSection(", at + 1);
    }
  }
  const links = [];
  for (const el of document.querySelectorAll("a, [onclick], [href], [data-app], [data-appname], [role=menuitem]")) {
    const attrs = {};
    for (const a of el.attributes) {
      if (/^(href|onclick|data-|id$|role$|aria-label$|title$)/.test(a.name) && /loadapp|changeapp|sendEvent|app/i.test(a.value + a.name)) {
        attrs[a.name] = a.value.slice(0, 300);
      }
    }
    if (Object.keys(attrs).length) links.push({ tag: el.tagName, text: (el.textContent || "").trim().slice(0, 80), attrs });
  }
  return { url: location.href, navSections, links: links.slice(0, 2000) };
}

function summariseMenu(menu) {
  const apps = [];
  (function walk(node, path) {
    for (const it of (node && node.items) || []) {
      if (it.sub) walk(it.sub, [...path, it.text]);
      else if (it.eventvalue) apps.push({ app: it.eventvalue, label: it.text, apptype: it.apptype, module: path.join(" / ") });
    }
  })(menu, []);
  return apps;
}

test("discover where Maximo lists the user's apps", async ({ page }) => {
  const responses = [];
  const pending = [];
  page.on("response", (res) => {
    const type = res.request().resourceType();
    if (!["xhr", "fetch"].includes(type)) return;
    pending.push(
      (async () => {
        let body;
        try {
          body = await res.text();
        } catch (_) {
          return;
        }
        if (!KEYWORDS.some((k) => body.includes(k))) return;
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (_) {}
        responses.push({
          url: res.url(),
          method: res.request().method(),
          status: res.status(),
          contentType: res.headers()["content-type"] || "",
          size: body.length,
          body: json ?? body.slice(0, MAX_BODY),
        });
      })()
    );
  });

  // Load the shell once more with the recorder on, then let it settle.
  await page.goto("about:blank");
  await page.goto(SHELL_URL);
  await page.waitForLoadState("load");
  await page.waitForTimeout(10_000);
  await Promise.all(pending);

  const frames = [];
  for (const f of page.frames()) {
    frames.push(await f.evaluate(readMenus).catch((e) => ({ url: f.url(), error: e.message })));
  }

  const menuApps = frames.flatMap((f) => (f.navSections || []).flatMap((s) => summariseMenu(s.menu)));
  const result = {
    note: "Written by `npm run discover-apps`. No cookies or credentials; response bodies may include your user name.",
    summary: {
      menuApps: menuApps.length,
      uniqueMenuApps: new Set(menuApps.map((a) => a.app)).size,
      recordedResponses: responses.map((r) => `${r.method} ${r.status} ${r.url.slice(0, 160)} (${r.size} bytes)`),
    },
    menuApps,
    frames,
    responses,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true, mode: 0o700 });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(`Wrote ${OUT}: ${result.summary.uniqueMenuApps} apps in the menu, ${responses.length} matching responses.`);
});

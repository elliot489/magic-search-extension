const fs = require("fs");
const path = require("path");
const { test, gotoApp, maximoFrame } = require("../fixtures");

// Records how Maximo's classic UI (inside the Manage shell's iframe) shows an
// app's toolbar and its More Actions menu, in the list view and on a record,
// so the palette can search and run those actions. Read-only: it opens menus
// and closes them again, and never runs an action.
const OUT = path.join(__dirname, "..", "..", ".auth", "discover-actions.json");
const MORE = /more actions|select action/i;

// Runs in Maximo's frame: everything that looks like a toolbar button, menu or
// menu item, with the attributes Maximo uses to wire up events.
function snapshot() {
  const keep = /^(id|class|role|aria-|title|alt|ctype|ev|mxevent|event|targetid|onclick|onmousedown|data-|href|accesskey|tabindex)/;
  const looksRelevant = (el) => {
    const s = `${el.id} ${el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className} ${el.getAttribute("role") || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`;
    return /toolbar|toolact|menu|action|button|tbb|navbar|qmenu|mx\d+_/i.test(s);
  };
  const describe = (el) => {
    const attrs = {};
    for (const a of el.attributes) if (keep.test(a.name)) attrs[a.name] = a.value.slice(0, 300);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100),
      visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden",
      attrs,
    };
  };
  const els = [...document.querySelectorAll("*")].filter(looksRelevant);
  // Containers that look like the toolbar or a menu: keep a slice of their HTML.
  const containers = els
    .filter((el) => /toolbar|menu/i.test(`${el.id} ${el.getAttribute("role") || ""}`) && el.children.length)
    .slice(0, 40)
    .map((el) => ({ id: el.id, role: el.getAttribute("role"), html: el.outerHTML.slice(0, 20_000) }));
  return {
    url: location.href,
    title: document.title,
    elements: els.slice(0, 3000).map(describe),
    containers,
    globals: ["sendEvent", "sendEventWithValue", "topLevelMenus", "menus", "MENUS", "dojo", "dijit"].filter((n) => n in window),
  };
}

async function captureMenus(page, label, result) {
  const frame = maximoFrame(page);
  const entry = { label, before: await frame.locator("body").evaluate(snapshot) };
  // The More Actions / Select Action button, by text, title or aria-label.
  const candidates = frame.locator("a, button, [role=button], img, span, div").filter({ hasText: MORE });
  const byAttr = frame.locator('[title*="ction" i], [aria-label*="ction" i]');
  let button = null;
  for (const loc of [candidates, byAttr]) {
    const n = await loc.count();
    for (let i = 0; i < n && !button; i++) {
      const el = loc.nth(i);
      const t = `${await el.innerText().catch(() => "")} ${await el.getAttribute("title")} ${await el.getAttribute("aria-label")}`;
      if (MORE.test(t) && (await el.isVisible().catch(() => false))) button = el;
    }
    if (button) break;
  }
  entry.moreActionsButton = button ? await button.evaluate((el) => ({ tag: el.tagName, id: el.id, outer: el.outerHTML.slice(0, 2000) })) : null;
  if (button) {
    await button.click();
    await page.waitForTimeout(3_000);
    entry.afterOpen = await frame.locator("body").evaluate(snapshot);
    // Open the first submenu too (items with a child menu), to see how those load.
    const sub = frame.locator('[role=menuitem][aria-haspopup="true"], [aria-haspopup="true"][role=menuitem]').first();
    if (await sub.isVisible().catch(() => false)) {
      await sub.hover();
      await page.waitForTimeout(2_000);
      entry.afterSubmenu = await frame.locator("body").evaluate(snapshot);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1_000);
  }
  result.views.push(entry);
}

test("discover how Maximo shows an app's actions", async ({ page }) => {
  test.setTimeout(240_000);
  const result = {
    note: "Written by `npm run discover-actions`. No cookies or credentials; page text may include record data and your user name.",
    views: [],
    responses: [],
  };
  page.on("response", async (res) => {
    const url = res.url();
    if (!/maximo\.jsp|\/ui\//.test(url) || res.request().resourceType() === "document") return;
    const body = await res.text().catch(() => "");
    if (/menu|action|sigoption/i.test(body)) {
      result.responses.push({ url: url.slice(0, 300), method: res.request().method(), post: (res.request().postData() || "").slice(0, 2000), body: body.slice(0, 50_000) });
    }
  });

  await gotoApp(page, "wotrack");
  await page.waitForTimeout(3_000);
  await captureMenus(page, "WOTRACK list", result);

  // Open the first record in the list, then look again.
  const frame = maximoFrame(page);
  const firstRow = frame.locator('[id*="_tdrow_"] a, [id*="_tdrow_"][ev]').first();
  if (await firstRow.isVisible().catch(() => false)) {
    await firstRow.click();
    await page.waitForTimeout(6_000);
    await captureMenus(page, "WOTRACK record", result);
  } else {
    result.recordNote = "No list row found to open a record.";
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true, mode: 0o700 });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(`Wrote ${OUT}: ${result.views.length} views, ${result.responses.length} responses.`);
});

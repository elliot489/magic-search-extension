const fs = require("fs");
const path = require("path");
const { test, gotoApp, maximoFrame } = require("../fixtures");

// Records how Maximo's classic UI (inside the Manage shell's iframe) shows an
// app's toolbar and its Common / More Actions (left nav "navSection" blocks),
// in the list view and on a record, and how clicking an item turns into a
// Maximo event. Read-only: it expands menus and runs the list query, but every
// action click happens with Maximo's event functions and server requests
// blocked, so nothing actually runs.
const OUT = path.join(__dirname, "..", "..", ".auth", "discover-actions.json");
const MAX_BODY = 50_000;
const MAX_REQUESTS = 300;

// ---- In the Maximo frame (main world) ----

// Wrap Maximo's event functions with a logger. In block mode calls are logged
// but not forwarded. Re-installable (after the frame reloads).
function installEventLogger(_el) {
  const w = window;
  if (!w.__msDiscover) w.__msDiscover = { log: [], block: false };
  const state = w.__msDiscover;
  const names = ["sendEvent", "sendEventWithValue", "setClickElementId", "sendXHREvent", "queueEvent"];
  const wrapped = [];
  for (const name of names) {
    const fn = w[name];
    if (typeof fn !== "function" || fn.__msWrapped) continue;
    const wrapper = function (...args) {
      state.log.push({
        fn: name,
        args: args.map((a) => (typeof a === "string" ? a.slice(0, 300) : a && a.id ? `#${a.id}` : typeof a)),
        blocked: state.block && name !== "setClickElementId",
        t: Date.now(),
      });
      if (state.block && name !== "setClickElementId") return undefined;
      return fn.apply(this, args);
    };
    wrapper.__msWrapped = true;
    w[name] = wrapper;
    wrapped.push(name);
  }
  return { wrapped, present: names.filter((n) => typeof w[n] === "function") };
}

function setBlock(_el, on) {
  window.__msDiscover.block = on;
}

function takeLog(_el) {
  const log = window.__msDiscover ? window.__msDiscover.log.splice(0) : [];
  return log;
}

// A navSection (Common Actions / More Actions) by its header title: its lists
// and items with the attributes Maximo uses to wire them.
function snapshotSection(_el, title) {
  const head = [...document.querySelectorAll(".navHead")].find((h) => (h.getAttribute("title") || "").trim() === title);
  if (!head) return { found: false };
  const section = head.closest(".navSection") || head.parentElement;
  const attrNames = ["id", "class", "role", "eventtype", "aria-haspopup", "aria-expanded", "subid", "anchorid", "title", "href", "onclick", "ev", "tabindex", "data-menu-div"];
  const describe = (el) => {
    const attrs = {};
    for (const n of attrNames) if (el.hasAttribute(n)) attrs[n] = el.getAttribute(n).slice(0, 300);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      text: (el.tagName === "UL" ? "" : (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ")).slice(0, 80),
      visible: r.width > 0 && r.height > 0,
      attrs,
    };
  };
  const els = [...section.querySelectorAll("ul, li, a")];
  // Submenus may be rendered outside the section (popups): include ULs named by subid.
  const subIds = els.map((e) => e.getAttribute("subid")).filter(Boolean);
  const popups = subIds.map((id) => document.getElementById(id)).filter((u) => u && !section.contains(u));
  for (const u of popups) els.push(u, ...u.querySelectorAll("li, a"));
  return {
    found: true,
    head: describe(head),
    section: { id: section.id, class: section.className, role: section.getAttribute("role") },
    headHtml: head.outerHTML.slice(0, 2000),
    items: els.map(describe),
    html: section.outerHTML.slice(0, 20_000),
  };
}

// Toolbar buttons: LI#toolactions_<EVENT>-tbb and their anchors.
function snapshotToolbar(_el) {
  return [...document.querySelectorAll('li[id^="toolactions_"]')].map((li) => {
    const a = li.querySelector("a");
    const pick = (el, names) => Object.fromEntries(names.filter((n) => el && el.hasAttribute(n)).map((n) => [n, el.getAttribute(n).slice(0, 300)]));
    return {
      li: pick(li, ["id", "class", "ctype", "role"]),
      a: pick(a, ["id", "class", "role", "eventtype", "title", "href", "onclick"]),
    };
  });
}

// ---- Driver ----

// Run one of the functions above in Maximo's frame (first argument: <body>).
async function inFrame(page, fn, arg) {
  return maximoFrame(page).locator("body").evaluate(fn, arg);
}

async function settle(page, ms = 2_500) {
  await page.waitForTimeout(ms);
}

// Click something in the frame with Maximo's event functions and server
// requests blocked; returns what was called / requested.
async function blockedClick(page, net, locator, label) {
  await inFrame(page, installEventLogger);
  await inFrame(page, takeLog);
  await inFrame(page, setBlock, true);
  net.block = true;
  const start = net.blocked.length;
  let clickError = null;
  try {
    await locator.click({ timeout: 5_000 });
  } catch (e) {
    clickError = e.message.split("\n")[0];
  }
  await settle(page, 2_000);
  const calls = await inFrame(page, takeLog);
  await inFrame(page, setBlock, false);
  net.block = false;
  // Close anything the click opened (nothing should have).
  await page.keyboard.press("Escape").catch(() => {});
  return { label, clickError, calls, blockedRequests: net.blocked.slice(start) };
}

async function captureView(page, net, label) {
  const frame = maximoFrame(page);
  const view = { label, url: await frame.locator("body").evaluate(() => location.href).catch(() => "") };
  view.eventFunctions = await inFrame(page, installEventLogger);
  view.toolbar = await inFrame(page, snapshotToolbar);
  view.commonActions = await inFrame(page, snapshotSection, "Common Actions");
  view.moreActionsBefore = await inFrame(page, snapshotSection, "More Actions");

  // Expand More Actions (normal mode: loading the list isn't an action).
  // Only click the header if no items are listed yet, so we don't collapse it.
  const reqStart = net.requests.length;
  await inFrame(page, takeLog);
  const head = frame.locator('.navHead[title="More Actions"]').first();
  const itemsListed = (view.moreActionsBefore.items || []).some((i) => i.tag === "LI" && i.visible);
  if (!itemsListed && (await head.isVisible().catch(() => false))) {
    await head.click();
    await settle(page, 3_000);
    view.expandedByClick = true;
  }
  view.expandCalls = await inFrame(page, takeLog);
  view.expandRequests = net.requests.slice(reqStart).map((r) => r.id);
  view.moreActionsExpanded = await inFrame(page, snapshotSection, "More Actions");

  // Open one submenu (an item with a child menu) and snapshot again.
  const section = frame.locator(".navSection").filter({ has: frame.locator('.navHead[title="More Actions"]') }).first();
  const parent = section.locator('a[aria-haspopup="true"]').first();
  if (await parent.isVisible().catch(() => false)) {
    view.submenuParent = await parent.evaluate((a) => ({ id: a.id, title: a.getAttribute("title") }));
    const subStart = net.requests.length;
    await parent.hover();
    await settle(page, 1_500);
    view.moreActionsSubmenuHover = await inFrame(page, snapshotSection, "More Actions");
    if (!(await parent.getAttribute("aria-expanded").catch(() => null) === "true")) {
      await parent.click();
      await settle(page, 2_000);
    }
    view.submenuCalls = await inFrame(page, takeLog);
    view.submenuRequests = net.requests.slice(subStart).map((r) => r.id);
    view.moreActionsSubmenu = await inFrame(page, snapshotSection, "More Actions");
  }

  // How an item click becomes an event, with everything blocked.
  const createReport = frame.locator('.navSection a[title="Create Report"], .navSection a:has-text("Create Report")').first();
  if (await createReport.isVisible().catch(() => false)) {
    view.clickCommonAction = await blockedClick(page, net, createReport, "Common Actions > Create Report");
  }
  const leaf = section.locator('li[eventtype]:not([subid]) > a[role="menuitem"]:not([aria-haspopup="true"])');
  const leafCount = await leaf.count();
  for (let i = 0; i < leafCount; i++) {
    const a = leaf.nth(i);
    if (await a.isVisible().catch(() => false)) {
      const title = await a.getAttribute("title");
      view.clickMoreAction = await blockedClick(page, net, a, `More Actions > ${title}`);
      break;
    }
  }
  return view;
}

test("discover how Maximo shows an app's actions", async ({ page }) => {
  test.setTimeout(300_000);
  const result = {
    note: "Written by `npm run discover-actions`. No cookies or credentials; responses and page text may include record data and your user name.",
    views: [],
    requests: [],
  };

  // Every xhr/fetch to /maximo/ui/ (incl. maximo.jsp): method, post body, response.
  const net = { requests: result.requests, blocked: [], block: false, n: 0 };
  page.on("requestfinished", async (req) => {
    if (!/\/maximo\/ui\//.test(req.url()) || !["xhr", "fetch"].includes(req.resourceType())) return;
    if (net.requests.length >= MAX_REQUESTS) return;
    const res = await req.response().catch(() => null);
    const body = res ? await res.text().catch(() => "") : "";
    net.requests.push({
      id: ++net.n,
      url: req.url().slice(0, 500),
      method: req.method(),
      post: (req.postData() || "").slice(0, 5_000),
      status: res ? res.status() : null,
      contentType: res ? res.headers()["content-type"] || "" : "",
      body: body.slice(0, MAX_BODY),
    });
  });
  // While a test click runs, Maximo server requests are recorded and stopped.
  await page.route("**/maximo/ui/**", async (route) => {
    const req = route.request();
    if (net.block && ["xhr", "fetch"].includes(req.resourceType())) {
      net.blocked.push({ url: req.url().slice(0, 500), method: req.method(), post: (req.postData() || "").slice(0, 5_000) });
      return route.abort();
    }
    return route.continue();
  });

  try {
    await gotoApp(page, "wotrack");
    await settle(page, 3_000);
    result.views.push(await captureView(page, net, "WOTRACK list"));

    // Open a record: run the list query, then click the first row's link.
    const frame = maximoFrame(page);
    const filter = frame.locator('input[id*="_tfrow_"][type="text"]:visible').first();
    if (await filter.isVisible().catch(() => false)) {
      await filter.click();
      await filter.press("Enter");
      await settle(page, 4_000);
    }
    const rowLink = frame.locator('[id*="_tdrow_"] a').first();
    if (await rowLink.isVisible().catch(() => false)) {
      result.rowLink = await rowLink.evaluate((a) => ({ id: a.id, href: (a.getAttribute("href") || "").slice(0, 300) }));
      await rowLink.click();
      await settle(page, 6_000);
      result.views.push(await captureView(page, net, "WOTRACK record"));
    } else {
      result.recordNote = "No list row link found after running the query.";
    }
  } finally {
    await page.unroute("**/maximo/ui/**").catch(() => {});
    fs.mkdirSync(path.dirname(OUT), { recursive: true, mode: 0o700 });
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(`Wrote ${OUT}: ${result.views.length} views, ${result.requests.length} requests.`);
  }
});

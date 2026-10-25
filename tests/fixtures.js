const path = require("path");
const fs = require("fs");
const os = require("os");
const { test: base, chromium, expect } = require("@playwright/test");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const { MAXIMO_URL, MAXIMO_USER, MAXIMO_PASSWORD } = process.env;
if (!MAXIMO_URL || !MAXIMO_USER || !MAXIMO_PASSWORD) {
  throw new Error(
    "Missing MAXIMO_URL, MAXIMO_USER or MAXIMO_PASSWORD. Copy .env.example to .env and fill it in."
  );
}

const BASE = MAXIMO_URL.endsWith("/") ? MAXIMO_URL : MAXIMO_URL + "/";
const SHELL_URL = new URL("oslc/graphite/manage-shell/index.html#/main", BASE).toString();

// Manage shell URL that opens one app, e.g. appUrl("wotrack").
function appUrl(app) {
  const url = new URL("oslc/graphite/manage-shell/index.html", BASE);
  url.search = new URLSearchParams({ event: "loadapp", value: app }).toString();
  url.hash = "#/main";
  return url.toString();
}

// Default shortcut: Cmd+K on Mac, Ctrl+K elsewhere ("ControlOrMeta" picks the right one).
const DEFAULT_KEYS = "ControlOrMeta+KeyK";
const DEFAULT_LABEL = process.platform === "darwin" ? "Cmd+K" : "Ctrl+K";

// Headless by default; HEADED=1 shows the browser window.
const HEADED = /^(1|true|yes)$/i.test(process.env.HEADED || "");

async function logIn(page) {
  await page.goto(BASE);
  const password = page.locator('input[type="password"]').first();
  // Already signed in (e.g. the server kept the session): nothing to do.
  if (!(await password.isVisible({ timeout: 10_000 }).catch(() => false))) return;
  await page
    .locator('input[name="username"], input#username, input[type="text"]')
    .first()
    .fill(MAXIMO_USER);
  await password.fill(MAXIMO_PASSWORD);
  const submit = page.locator('#loginbutton, button[type="submit"], input[type="submit"]').first();
  if (await submit.isVisible().catch(() => false)) await submit.click();
  else await password.press("Enter");
  await expect(password).toBeHidden({ timeout: 30_000 });
}

// Every test shares one browser, one Maximo login and one Maximo tab, loaded
// once. Maximo limits how many UI sessions a login may have and every page
// load can start one, so most tests check where Enter *would* go without
// loading it (see enterTarget); only a few tests really load Maximo pages.
const SESSION_LIMIT_TEXT = /maximum number of sessions/i;

// Within a run the login is kept in .auth/ (see session-file.js), so the new
// browser Playwright starts after a failed test reuses it. It's signed out and
// deleted when the run ends (global-teardown.js).
const sessionFile = require("./session-file");

class MaximoSession {
  async start() {
    // A throwaway profile with Chrome's password manager off, so no
    // "Save password?" prompt appears after signing in (it can take the
    // keyboard away from the page).
    this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "magic-search-test-"));
    fs.mkdirSync(path.join(this.profileDir, "Default"));
    fs.writeFileSync(
      path.join(this.profileDir, "Default", "Preferences"),
      JSON.stringify({ credentials_enable_service: false, profile: { password_manager_enabled: false } })
    );
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      channel: "chromium",
      headless: !HEADED,
      viewport: { width: 1400, height: 900 },
      args: [
        `--disable-extensions-except=${ROOT}`,
        `--load-extension=${ROOT}`,
        "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection",
      ],
    });
    // Diagnostics: in every frame, before the page's own scripts, note the
    // last key press Chrome delivered (printed by frameReport on failures).
    await this.context.addInitScript(() => {
      window.addEventListener(
        "keydown",
        (e) => {
          try {
            document.documentElement?.setAttribute(
              "data-test-last-keydown",
              JSON.stringify({ key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, t: Math.round(e.timeStamp) })
            );
          } catch (_) {}
        },
        true
      );
    });
    const saved = sessionFile.load();
    if (saved?.cookies?.length) await this.context.addCookies(saved.cookies).catch(() => {});

    // Sign in on a throwaway tab, then close it: anything the browser shows
    // for that tab after the login form (e.g. a password prompt) goes with it.
    this.page = this.context.pages()[0] || (await this.context.newPage());
    await logIn(this.page);
    await this.loadShell();
    await this.checkSessionLimit();
    await this.saveSession();
    const loginTab = this.page;

    // The tab every test shares.
    this.page = await this.context.newPage();
    // Leaving a page with unsaved Maximo changes (e.g. a new record) may ask
    // "Leave site?": always leave. Other dialogs are dismissed as usual.
    this.page.on("dialog", (d) => (d.type() === "beforeunload" ? d.accept() : d.dismiss()).catch(() => {}));
    await loginTab.close();
    await this.page.bringToFront();
    await this.page.goto(SHELL_URL);
    await this.page.waitForLoadState("load");
    await this.checkSessionLimit();
  }

  // Keep the login and Maximo's sign-out URL for the rest of the run.
  async saveSession() {
    let logoutUrl = new URL("webclient/login/logout.jsp", BASE).toString();
    for (const frame of this.page.frames()) {
      const url = await frame.evaluate(() => window.LOGOUTURL).catch(() => null);
      if (typeof url === "string" && url.includes("logout")) logoutUrl = url;
    }
    sessionFile.save({ cookies: await this.context.cookies(), logoutUrl });
  }

  // After signing in, Maximo redirects to the Manage shell by itself. Wait for
  // that instead of navigating on top of it (which cancels the load).
  async loadShell() {
    const page = this.page;
    const onShell = () => page.url().includes("/manage-shell/");
    await page.waitForURL(/\/manage-shell\//, { timeout: 30_000 }).catch(() => {});
    for (let attempt = 1; !onShell(); attempt++) {
      try {
        await page.goto(SHELL_URL);
      } catch (e) {
        // A redirect still in flight cancels our load: wait and check again.
        if (attempt >= 3 || !/ERR_ABORTED|interrupted by another navigation/.test(e.message)) throw e;
        await page.waitForLoadState("load").catch(() => {});
      }
    }
    await page.waitForLoadState("load");
  }

  // Closes the browser but stays signed in: a later browser in this run may
  // reuse the login. global-teardown.js signs out at the end of the run.
  async stop() {
    if (this.context) await this.saveSession().catch(() => {});
    await this.context?.close().catch(() => {});
    if (this.profileDir) fs.rmSync(this.profileDir, { recursive: true, force: true });
  }

  // Maximo answers with this page when the login has too many UI sessions.
  async checkSessionLimit() {
    const texts = await Promise.all(
      this.page.frames().map((f) => f.locator("body").innerText({ timeout: 2_000 }).catch(() => ""))
    );
    if (texts.some((t) => SESSION_LIMIT_TEXT.test(t))) {
      throw new Error(
        'Maximo says "You have reached the maximum number of sessions allowed for a user". ' +
          "Wait for old sessions to time out (or raise the limit on the server), then run again."
      );
    }
  }

  // The shared tab, ready for the next test: wherever the last test left it,
  // with the palette closed. No reload.
  async forTest() {
    const page = this.page;
    await page.bringToFront();
    const backdrop = page.locator(".magic-search-backdrop");
    if (await backdrop.count()) {
      await page.keyboard.press("Escape");
      await backdrop.evaluateAll((els) => els.forEach((el) => el.remove())).catch(() => {});
    }
    return page;
  }
}
const test = base.extend({
  // One Chromium browser with the unpacked extension loaded, signed in once,
  // with one Maximo tab shared by every test in the run. Headless uses
  // Chromium's new headless mode (channel "chromium"), which supports
  // extensions.
  maximo: [
    async ({}, use) => {
      const session = new MaximoSession();
      await session.start();
      await use(session);
      await session.stop();
    },
    { scope: "worker" },
  ],

  // The unpacked extension's ID, read from chrome://extensions.
  extensionId: [
    async ({ maximo }, use) => {
      const page = await maximo.context.newPage();
      await page.goto("chrome://extensions");
      const item = page.locator("extensions-item").first();
      await expect(item).toBeAttached();
      const id = await item.getAttribute("id");
      await page.close();
      await use(id);
    },
    { scope: "worker" },
  ],

  // The extension's options page, open in its own tab (not a Maximo page).
  options: async ({ maximo, extensionId }, use) => {
    const page = await maximo.context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options.html`);
    await expect(page.locator("#current")).not.toHaveText("…");
    await use(optionsPage(page));
    await page.close();
  },

  // The shared Maximo tab (not reloaded between tests).
  page: async ({ maximo }, use) => {
    await use(await maximo.forTest());
  },
});

const palette = (page) => ({
  backdrop: page.locator(".magic-search-backdrop"),
  input: page.locator(".magic-search-input"),
  options: page.locator(".magic-search-option:visible"),
  list: page.locator(".magic-search-list"),
});

const optionsPage = (page) => ({
  page,
  current: page.locator("#current"),
  status: page.locator("#status"),
  // Record a new shortcut by clicking "Record" and pressing keys, e.g. "Alt+Shift+KeyM".
  async record(keys) {
    await page.bringToFront();
    await page.locator("#record").click();
    await page.keyboard.press(keys);
    await expect(page.locator("#status")).toContainText("Saved");
  },
  async reset() {
    await page.bringToFront();
    await page.locator("#reset").click();
    await expect(page.locator("#current")).toHaveText(DEFAULT_LABEL);
  },
});

// The content script loads at document_idle, so the first key press can come
// too early on a slow Maximo page. Press until the palette shows (bounded).
async function openPalette(page, keys = DEFAULT_KEYS) {
  const { backdrop } = palette(page);
  try {
    await expect(async () => {
      if (!(await backdrop.isVisible())) await page.keyboard.press(keys);
      await expect(backdrop).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
  } catch (e) {
    throw new Error(`${keys} didn't open the palette. Frames:\n${await frameReport(page)}`, { cause: e });
  }
}

// One line per frame: whether the extension is listening there (it marks
// <html data-magic-search="listening">), what has focus, and the URL.
async function frameReport(page) {
  const lines = await Promise.all(
    page.frames().map(async (f) => {
      const info = await f
        .evaluate(() => ({
          // Chrome delivered this key press to the frame (test logger):
          delivered: document.documentElement?.getAttribute("data-test-last-keydown") || "none",
          listening: document.documentElement?.getAttribute("data-magic-search") || "no",
          focus: document.hasFocus(),
          active: document.activeElement
            ? `${document.activeElement.tagName}${document.activeElement.id ? "#" + document.activeElement.id : ""}`
            : "-",
          ready: document.readyState,
        }))
        .catch((err) => ({ error: err.message.split("\n")[0] }));
      return `  ${f === page.mainFrame() ? "top" : "frame"} ${f.url().slice(0, 100)} ${JSON.stringify(info)}`;
    })
  );
  return lines.join("\n");
}

// Maximo's own UI iframe (/maximo/ui/?type=embedded) inside the Manage shell.
function maximoFrame(page) {
  return page.locator('iframe[src*="/ui/"], iframe[src*="type=embedded"]').first().contentFrame();
}

// First editable, visible text field inside Maximo's iframe.
// A list view's filter fields (ids contain "_tfrow_"), not e.g. the side menu's search.
function iframeTextField(page) {
  return maximoFrame(page)
    .locator('input[id*="_tfrow_"][type="text"]:visible:not([readonly]):not([disabled])')
    .first();
}

// Click a text field in Maximo's iframe until the cursor stays in it (Maximo
// may still be loading and move the cursor to its own first field).
async function focusField(page) {
  const field = iframeTextField(page);
  await expect(field).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await field.click();
    await expect.poll(() => hasRealFocus(field), { timeout: 2_000 }).toBe(true);
  }).toPass({ timeout: 30_000 });
  return field;
}

// Open an app in the Manage shell and wait for a text field in Maximo's iframe.
// Skipped when the shared tab already shows that app (saves a Maximo session).
// Maximo sometimes shows the Start Center instead, so retry a few times.
async function gotoApp(page, app) {
  test.info().setTimeout(test.info().timeout + 60_000);
  const field = iframeTextField(page);
  const here = new URL(page.url());
  if (here.searchParams.get("value") === app && !here.searchParams.get("additionalevent")) {
    if (await field.isVisible({ timeout: 3_000 }).catch(() => false)) return field;
    if (await field.waitFor({ state: "visible", timeout: 3_000 }).then(() => true, () => false)) return field;
  }
  for (let attempt = 1; ; attempt++) {
    await page.goto(appUrl(app));
    await page.waitForLoadState("load");
    try {
      await expect(field).toBeVisible({ timeout: 20_000 });
      return field;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
}

// Look inside Maximo's iframe for the result of a description filter.
// Returns { mode: "list", column, rows, bad } when a list filter field holds
// the text (rows = description cells checked, bad = ones not containing it),
// { mode: "record", field } when a record page's field contains it, or null.
function readFilterResult(page, text) {
  return maximoFrame(page)
    .locator("body")
    .evaluate((body, text) => {
      const needle = text.toLowerCase();
      const doc = body.ownerDocument;
      const valueOf = (el) => (el.value !== undefined ? el.value : el.textContent || "");
      const inputs = [...doc.querySelectorAll("input, textarea")];

      // List view: the filter-row field (id contains "_tfrow_[C:n]") holds the text.
      const filterInput = inputs.find(
        (el) => /_tfrow_\[C:\d+\]/.test(el.id) && valueOf(el).trim().toLowerCase() === needle
      );
      if (filterInput) {
        const [, prefix, col] = filterInput.id.match(/^(.*?)_tfrow_\[C:(\d+)\]/);
        // Data cells are "<prefix>_tdrow_[C:n]-c[R:r]".
        const cells = [...doc.querySelectorAll(`[id^="${prefix}_tdrow_[C:${col}]-c[R:"]`)];
        const texts = cells.map((c) => {
          const inner = c.querySelector("input, textarea");
          return (inner ? valueOf(inner) : c.textContent).trim();
        }).filter(Boolean);
        return {
          mode: "list",
          column: filterInput.id,
          rows: texts.length,
          bad: texts.filter((t) => !t.toLowerCase().includes(needle)),
        };
      }

      // Single record: Maximo opens it directly; its description field contains the text.
      // Maximo's field ids are generated, so prefer one labelled as a
      // description, else any visible field containing the text.
      const label = (el) => `${el.id} ${el.getAttribute("aria-label") || ""} ${el.title || ""}`;
      const candidates = inputs.filter(
        (el) => el.offsetParent !== null && valueOf(el).toLowerCase().includes(needle)
      );
      const field = candidates.find((el) => /desc/i.test(label(el))) || candidates[0];
      if (field) return { mode: "record", field: label(field).trim() };
      return null;
    }, text)
    .catch(() => null);
}

// After opening an app with a description filter, check Maximo applied it:
// either the list's description filter holds the text and every row's
// description contains it, or (one match) the record opened directly with a
// description containing it. Maximo sometimes ignores loadapp and shows the
// Start Center, so reload the same URL up to twice.
async function expectFilteredBy(page, text) {
  test.info().setTimeout(test.info().timeout + 60_000);
  for (let attempt = 1; ; attempt++) {
    let result = null;
    try {
      await expect
        .poll(async () => (result = await readFilterResult(page, text)), { timeout: 20_000 })
        .not.toBeNull();
    } catch (e) {
      if (attempt >= 3) {
        throw new Error(
          `Maximo didn't show a list filtered on description "${text}" or a record with that description (URL: ${page.url()})`
        );
      }
      await page.reload();
      await page.waitForLoadState("load");
      continue;
    }
    test.info().annotations.push({ type: "filter result", description: JSON.stringify(result) });
    if (result.mode === "list") {
      expect(result.bad, `rows whose description doesn't contain "${text}"`).toEqual([]);
    }
    return result;
  }
}

// Press Enter in the palette and return the URL it navigates to, without
// loading it: the request is answered with "204 No Content", which leaves the
// page where it is (so no new Maximo session). Fails if Enter doesn't navigate.
async function enterTarget(page) {
  let resolve;
  const target = new Promise((r) => (resolve = r));
  const matcher = (url) =>
    url.pathname.endsWith("/manage-shell/index.html") && url.searchParams.get("event") === "loadapp";
  const handler = async (route) => {
    if (!route.request().isNavigationRequest()) return route.continue();
    resolve(new URL(route.request().url()));
    await route.fulfill({ status: 204, body: "" });
  };
  await page.route(matcher, handler);
  try {
    await palette(page).input.press("Enter");
    let timer;
    const url = await Promise.race([
      target,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Enter didn't open an app")), 10_000);
      }),
    ]).finally(() => clearTimeout(timer));
    // The palette closes as it navigates.
    await expect(palette(page).backdrop).toHaveCount(0);
    expect(url.pathname).toMatch(/manage-shell\/index\.html$/);
    expect(url.searchParams.get("event")).toBe("loadapp");
    return url;
  } finally {
    await page.unroute(matcher, handler);
  }
}

// True when el has real keyboard focus (its frame is focused and it's the active element).
function hasRealFocus(locator) {
  return locator.evaluate((el) => el.ownerDocument.hasFocus() && el.ownerDocument.activeElement === el);
}

module.exports = {
  test,
  expect,
  palette,
  openPalette,
  appUrl,
  maximoFrame,
  iframeTextField,
  gotoApp,
  focusField,
  enterTarget,
  expectFilteredBy,
  hasRealFocus,
  SHELL_URL,
  DEFAULT_KEYS,
  DEFAULT_LABEL,
};

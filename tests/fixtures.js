const path = require("path");
const fs = require("fs");
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

const test = base.extend({
  // One Chromium browser with the unpacked extension loaded, signed in once
  // and shared by every test in the run. Headless uses Chromium's new headless
  // mode (channel "chromium"), which supports extensions.
  maximo: [
    async ({}, use) => {
      const context = await chromium.launchPersistentContext("", {
        channel: "chromium",
        headless: !HEADED,
        viewport: { width: 1400, height: 900 },
        args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
      });
      await logIn(context.pages()[0] || (await context.newPage()));
      await use(context);
      await context.close();
    },
    { scope: "worker" },
  ],

  // The unpacked extension's ID, read from chrome://extensions.
  extensionId: [
    async ({ maximo }, use) => {
      const page = await maximo.newPage();
      await page.goto("chrome://extensions");
      const item = page.locator("extensions-item").first();
      await expect(item).toBeAttached();
      const id = await item.getAttribute("id");
      await page.close();
      await use(id);
    },
    { scope: "worker" },
  ],

  // The extension's options page, open in its own tab.
  options: async ({ maximo, extensionId }, use) => {
    const page = await maximo.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options.html`);
    await expect(page.locator("#current")).not.toHaveText("…");
    await use(optionsPage(page));
    await page.close();
  },

  // Each test gets a fresh Manage shell page.
  page: async ({ maximo }, use) => {
    const page = await maximo.newPage();
    await page.goto(SHELL_URL);
    await page.waitForLoadState("load");
    await use(page);
    await page.close();
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
  await expect(async () => {
    if (!(await backdrop.isVisible())) await page.keyboard.press(keys);
    await expect(backdrop).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

// Maximo's own UI iframe (/maximo/ui/?type=embedded) inside the Manage shell.
function maximoFrame(page) {
  return page.locator('iframe[src*="/ui/"], iframe[src*="type=embedded"]').first().contentFrame();
}

// First editable, visible text field inside Maximo's iframe.
function iframeTextField(page) {
  return maximoFrame(page)
    .locator('input[type="text"]:visible:not([readonly]):not([disabled])')
    .first();
}

// Open an app in the Manage shell and wait for a text field in Maximo's iframe.
// Maximo sometimes ignores loadapp and shows the Start Center instead, so
// retry the navigation a few times before giving up.
async function gotoApp(page, app) {
  test.info().setTimeout(test.info().timeout + 60_000);
  const field = iframeTextField(page);
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
  hasRealFocus,
  SHELL_URL,
  DEFAULT_KEYS,
  DEFAULT_LABEL,
};

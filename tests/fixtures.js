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
  // One visible Chromium window with the unpacked extension loaded, signed in
  // once and shared by every test in the run.
  maximo: [
    async ({}, use) => {
      const context = await chromium.launchPersistentContext("", {
        headless: false,
        viewport: { width: 1400, height: 900 },
        args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
      });
      await logIn(context.pages()[0] || (await context.newPage()));
      await use(context);
      await context.close();
    },
    { scope: "worker" },
  ],

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

// The content script loads at document_idle, so the first key press can come
// too early on a slow Maximo page. Press until the palette shows (bounded).
async function openPalette(page) {
  const { backdrop } = palette(page);
  await expect(async () => {
    if (!(await backdrop.isVisible())) await page.keyboard.press("Control+Space");
    await expect(backdrop).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

module.exports = { test, expect, palette, openPalette, SHELL_URL };

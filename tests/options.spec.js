const {
  test,
  expect,
  palette,
  openPalette,
  appUrl,
  iframeTextField,
  hasRealFocus,
  DEFAULT_KEYS,
  DEFAULT_LABEL,
} = require("./fixtures");

const CUSTOM = "Alt+Shift+KeyM";

// Give a key press time to (wrongly) open the palette before checking it didn't.
async function expectStaysClosed(page, keys) {
  await page.keyboard.press(keys);
  await page.waitForTimeout(1_000);
  await expect(palette(page).backdrop).toHaveCount(0);
}

test.describe("custom shortcut", () => {
  // Always put the default back, even if a test fails.
  test.afterEach(async ({ options }) => {
    await options.reset();
  });

  test("options page shows Cmd/Ctrl+K by default", async ({ options }) => {
    await options.reset();
    await expect(options.current).toHaveText(DEFAULT_LABEL);
  });

  test("recording a shortcut saves and shows it", async ({ options }) => {
    await options.record(CUSTOM);
    await expect(options.current).toHaveText(/^Alt\+Shift\+M$|^Option\+Shift\+M$/);
    // Still there after reloading the options page.
    await options.page.reload();
    await expect(options.current).toHaveText(/^(Alt|Option)\+Shift\+M$/);
  });

  test("a shortcut without Ctrl, Alt or Cmd is refused", async ({ options }) => {
    await options.page.locator("#record").click();
    await options.page.keyboard.press("KeyQ");
    await expect(options.status).toContainText("isn't allowed");
    await expect(options.current).toHaveText(DEFAULT_LABEL);
  });

  test("the new shortcut opens the palette and the old one doesn't", async ({ options, page }) => {
    await options.record(CUSTOM);
    await page.bringToFront();
    await page.reload();
    await page.waitForLoadState("load");

    await openPalette(page, CUSTOM);
    await expect(palette(page).input).toBeFocused();
    await page.keyboard.press(CUSTOM);
    await expect(palette(page).backdrop).toHaveCount(0);

    await expectStaysClosed(page, DEFAULT_KEYS);
  });

  test("a change applies to an open Maximo page without reloading", async ({ options, page }) => {
    // Prove the content script is running with the default first.
    await openPalette(page);
    await page.keyboard.press("Escape");
    await expect(palette(page).backdrop).toHaveCount(0);

    await options.record(CUSTOM);
    await page.bringToFront();

    await openPalette(page, CUSTOM);
    await page.keyboard.press("Escape");
    await expectStaysClosed(page, DEFAULT_KEYS);
  });

  test("the new shortcut works inside Maximo's iframe", async ({ options, page }) => {
    await options.record(CUSTOM);
    await page.bringToFront();
    await page.goto(appUrl("wotrack"));
    await page.waitForLoadState("load");

    const field = iframeTextField(page);
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.click();
    await expect.poll(() => hasRealFocus(field)).toBe(true);

    await openPalette(page, CUSTOM);
    await page.keyboard.press("Escape");
    await expect.poll(() => hasRealFocus(field)).toBe(true);
    await expectStaysClosed(page, DEFAULT_KEYS);
  });

  test("resetting brings Cmd/Ctrl+K back", async ({ options, page }) => {
    await options.record(CUSTOM);
    await options.reset();
    await page.bringToFront();
    await openPalette(page);
    await page.keyboard.press("Escape");
    await expectStaysClosed(page, CUSTOM);
  });
});

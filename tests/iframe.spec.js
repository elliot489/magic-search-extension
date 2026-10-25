const {
  test,
  expect,
  palette,
  openPalette,
  appUrl,
  iframeTextField,
  hasRealFocus,
} = require("./fixtures");

// Maximo's UI (and every text field in it) is inside a same-origin iframe.
// These tests put the cursor in a real field there before pressing the shortcut.
test.describe("shortcut inside Maximo's iframe", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(appUrl("wotrack"));
    await page.waitForLoadState("load");
  });

  async function focusField(page) {
    const field = iframeTextField(page);
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.click();
    await expect.poll(() => hasRealFocus(field)).toBe(true);
    return field;
  }

  test("Ctrl+Space in a text field opens the palette", async ({ page }) => {
    await focusField(page);
    await openPalette(page);
    await expect(palette(page).input).toBeFocused();
    await expect(palette(page).options).toHaveText(["Locations", "Assets", "Work Orders"]);
  });

  test("Escape closes it and puts the cursor back in the field", async ({ page }) => {
    const field = await focusField(page);
    await openPalette(page);
    await page.keyboard.press("Escape");
    await expect(palette(page).backdrop).toHaveCount(0);
    await expect.poll(() => hasRealFocus(field)).toBe(true);
  });

  test("Ctrl+Space again closes it", async ({ page }) => {
    await focusField(page);
    await openPalette(page);
    await page.keyboard.press("Control+Space");
    await expect(palette(page).backdrop).toHaveCount(0);
  });

  test("normal typing in the field still works", async ({ page }) => {
    const field = await focusField(page);
    await field.fill("");
    await page.keyboard.type("ab c");
    await expect(field).toHaveValue("ab c");
    await expect(palette(page).backdrop).toHaveCount(0);
  });

  test("still works after the iframe reloads", async ({ page }) => {
    const frameEl = page.locator('iframe[src*="/ui/"], iframe[src*="type=embedded"]').first();
    await focusField(page);
    await openPalette(page);
    await page.keyboard.press("Escape");

    // Reload only the iframe; the shell (and its content script) stays put.
    const handle = await frameEl.elementHandle();
    const frame = await handle.contentFrame();
    await Promise.all([
      frame.waitForNavigation({ waitUntil: "load" }),
      frame.evaluate(() => location.reload()),
    ]);

    await focusField(page);
    await openPalette(page);
    await expect(palette(page).input).toBeFocused();
  });
});

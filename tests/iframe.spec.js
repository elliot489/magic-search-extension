const {
  test,
  expect,
  palette,
  openPalette,
  gotoApp,
  maximoFrame,
  iframeTextField,
  hasRealFocus,
  DEFAULT_KEYS,
} = require("./fixtures");

// Maximo's UI (and every text field in it) is inside a same-origin iframe.
// These tests put the cursor in a real field there before pressing the shortcut.
test.describe("shortcut inside Maximo's iframe", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page, "wotrack");
  });

  async function focusField(page) {
    const field = iframeTextField(page);
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.click();
    await expect.poll(() => hasRealFocus(field)).toBe(true);
    return field;
  }

  test("Cmd/Ctrl+K in a text field opens the palette", async ({ page }) => {
    await focusField(page);
    await openPalette(page);
    await expect(palette(page).input).toBeFocused();
    await expect(palette(page).options).toHaveText(["Locations", "Assets", "Work Orders", "Purchase Orders"]);
  });

  test("Escape closes it and puts the cursor back in the field", async ({ page }) => {
    const field = await focusField(page);
    await openPalette(page);
    await page.keyboard.press("Escape");
    await expect(palette(page).backdrop).toHaveCount(0);
    await expect.poll(() => hasRealFocus(field)).toBe(true);
  });

  test("Cmd/Ctrl+K again closes it", async ({ page }) => {
    await focusField(page);
    await openPalette(page);
    await page.keyboard.press(DEFAULT_KEYS);
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
    await focusField(page);
    await openPalette(page);
    await page.keyboard.press("Escape");

    // Reload only the iframe; the shell (and its content script) stays put.
    // Maximo shows the Start Center after this, so there may be no text field:
    // click on the page inside the frame instead.
    const frame = await (await maximoFrame(page).owner().elementHandle()).contentFrame();
    await frame.evaluate(() => (window.__beforeReload = true));
    await Promise.all([
      frame.waitForNavigation({ waitUntil: "load" }),
      frame.evaluate(() => location.reload()),
    ]);
    expect(await frame.evaluate(() => window.__beforeReload)).toBeUndefined();

    const body = maximoFrame(page).locator("body");
    await body.click({ position: { x: 400, y: 400 } });
    await expect.poll(() => body.evaluate((b) => b.ownerDocument.hasFocus())).toBe(true);

    await openPalette(page);
    await expect(palette(page).input).toBeFocused();
  });
});

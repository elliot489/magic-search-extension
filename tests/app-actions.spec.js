const { test, expect, palette, openPalette, gotoApp, enterTarget, blockMaximoActions, DEFAULT_KEYS } = require("./fixtures");

// Opened inside an app, the palette searches that app's actions (Maximo's
// toolbar and its Common / More Actions menus), shown by a tag with the app's
// name. Backspace on an empty box, the tag's x or the shortcut again goes back
// to searching all apps. Most tests here stop Maximo from running the action
// (see blockMaximoActions) and only check which one Enter picks.
const tag = (page) => page.locator(".magic-search-tag");
const selected = (page) => page.locator(".magic-search-option.is-selected");

test.describe("searching the current app's actions", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page, "wotrack");
  });

  test("the palette shows the app's tag and its actions", async ({ page }) => {
    await openPalette(page, DEFAULT_KEYS, { context: true });
    await expect(tag(page)).toBeVisible();
    await expect(tag(page)).toContainText("Work Order Tracking");
    await expect(palette(page).input).toHaveAttribute("placeholder", "Search actions...");
    const { options } = palette(page);
    await expect(options.filter({ hasText: /^New Work Order$/ })).toHaveCount(1);
    await expect(options.filter({ hasText: /^Create Report$/ })).toHaveCount(1);
    // Apps aren't listed here.
    await expect(options.filter({ hasText: /^Assets/ })).toHaveCount(0);
  });

  test('"new" finds the New Work Order action', async ({ page }) => {
    await openPalette(page, DEFAULT_KEYS, { context: true });
    await palette(page).input.pressSequentially("new");
    await expect(selected(page)).toHaveText(["New Work Order"]);
    await expect(selected(page)).toHaveAttribute("data-event", "INSERT");
  });

  test("Enter runs the highlighted action in Maximo", async ({ page }) => {
    const blocker = await blockMaximoActions(page);
    try {
      await openPalette(page, DEFAULT_KEYS, { context: true });
      await palette(page).input.pressSequentially("create rep");
      await expect(selected(page)).toHaveText(["Create Report"]);
      await palette(page).input.press("Enter");
      await expect(palette(page).backdrop).toHaveCount(0);
      await expect.poll(() => blocker.lastAction()).toBe("CREATEREPT");
      expect(await blocker.clicked()).toEqual(["CREATEREPT"]);
    } finally {
      await blocker.stop();
    }
  });

  test("arrow keys pick an action", async ({ page }) => {
    const blocker = await blockMaximoActions(page);
    try {
      await openPalette(page, DEFAULT_KEYS, { context: true });
      const { options, input } = palette(page);
      const second = await options.nth(1).getAttribute("data-event");
      await input.press("ArrowDown");
      await expect(selected(page)).toHaveAttribute("data-event", second);
      await input.press("Enter");
      await expect.poll(() => blocker.lastAction()).toBe(second);
    } finally {
      await blocker.stop();
    }
  });

  test("no matching action shows nothing, and Enter does nothing", async ({ page }) => {
    await openPalette(page, DEFAULT_KEYS, { context: true });
    await palette(page).input.pressSequentially("zzz");
    await expect(palette(page).options).toHaveCount(0);
    await palette(page).input.press("Enter");
    await expect(palette(page).backdrop).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("Backspace on an empty box goes back to searching all apps", async ({ page }) => {
    await openPalette(page, DEFAULT_KEYS, { context: true });
    const { input } = palette(page);
    await input.pressSequentially("ne");
    await input.press("Backspace");
    await input.press("Backspace");
    // Still in the app: the text was deleted first.
    await expect(tag(page)).toBeVisible();
    await input.press("Backspace");
    await expect(tag(page)).toBeHidden();
    await expect(input).toHaveAttribute("placeholder", "Search Maximo...");
    await expect(input).toBeFocused();
    // Now "new wo" means the insert address, as usual.
    await input.pressSequentially("new wo");
    await expect(selected(page)).toHaveText(["Work Order Tracking (Oil)"]);
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("plusgwo");
    expect(target.searchParams.get("additionalevent")).toBe("insert");
  });

  test("the tag's x goes back to searching all apps", async ({ page }) => {
    await openPalette(page, DEFAULT_KEYS, { context: true });
    await page.locator(".magic-search-tag-close").click();
    await expect(tag(page)).toBeHidden();
    await expect(palette(page).input).toBeFocused();
    await expect(palette(page).options).toHaveCount(10);
    await page.keyboard.press("Escape");
  });

  test("the shortcut again goes back to all apps, and once more closes", async ({ page }) => {
    await openPalette(page, DEFAULT_KEYS, { context: true });
    await page.keyboard.press(DEFAULT_KEYS);
    await expect(palette(page).backdrop).toBeVisible();
    await expect(tag(page)).toBeHidden();
    await page.keyboard.press(DEFAULT_KEYS);
    await expect(palette(page).backdrop).toHaveCount(0);
  });

  test("Escape closes it straight away", async ({ page }) => {
    await openPalette(page, DEFAULT_KEYS, { context: true });
    await page.keyboard.press("Escape");
    await expect(palette(page).backdrop).toHaveCount(0);
  });

  // Last: really runs New Work Order, which leaves the tab on a new, unsaved
  // record (the next test's page load leaves it).
  test('"new" + Enter really starts a new work order', async ({ page }) => {
    await openPalette(page, DEFAULT_KEYS, { context: true });
    await palette(page).input.pressSequentially("new");
    await expect(selected(page)).toHaveText(["New Work Order"]);
    const request = page.waitForRequest(
      (r) => r.url().includes("/maximo/ui/maximo.jsp") && r.method() === "POST" && (r.postData() || "").includes("INSERT"),
      { timeout: 15_000 }
    );
    await palette(page).input.press("Enter");
    await request;
    await expect(palette(page).backdrop).toHaveCount(0);
  });
});

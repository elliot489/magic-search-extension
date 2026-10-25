const Apps = require("../src/apps.js");
const {
  test,
  expect,
  palette,
  openPalette,
  enterTarget,
  appListState,
  FIXTURE_MODULES,
  FIXTURE_OPTIONS,
} = require("./fixtures");

// The app list: fetched from Maximo when there's none saved (or it's more than
// a day old), saved per server and user, refreshed by the "refresh" command or
// after Clear on the options page, and the built-in apps if fetching fails.
// By default the extension's requests get the test list in tests/data (see
// MaximoSession.routeAppList); one test uses the real Maximo answer.

const FIXTURE_APPS = Apps.appsFromModules(FIXTURE_MODULES); // RUN apps only
const FIXTURE_GROUPS = Apps.buildGroups(Apps.withInsertFlags(FIXTURE_APPS, FIXTURE_OPTIONS)).length;
const SAVED = `saved:${FIXTURE_GROUPS}`;
const BUILTIN = ["Locations", "Assets", "Work Order Tracking", "Purchase Orders"];

async function savedEntry(ext) {
  const lists = await ext.savedLists();
  const keys = Object.keys(lists);
  expect(keys, "one saved app list").toHaveLength(1);
  return { key: keys[0], entry: lists[keys[0]] };
}

// Back to the normal state for the next tests: the test list, saved and in use.
// (reloadShell closes the palette first.)
async function restore(maximo, ext) {
  maximo.appListMode = "fixture";
  maximo.appListModules = null;
  await ext.clearSavedLists();
  const page = await maximo.reloadShell();
  await expect.poll(() => appListState(page), { timeout: 30_000 }).toBe(SAVED);
}

test.describe("app list from Maximo", () => {
  test("the first Maximo page load fetched and saved the list", async ({ page, ext }) => {
    await expect.poll(() => appListState(page), { timeout: 30_000 }).toBe(SAVED);
    const { key, entry } = await savedEntry(ext);
    expect(key).toMatch(/^apps:https?:\/\/[^|]+\|.+$/);
    expect(entry.apps).toHaveLength(FIXTURE_APPS.length);
    expect(Date.parse(entry.fetchedAt)).toBeGreaterThan(Date.now() - 24 * 60 * 60 * 1000);
    // Insert flags come from allowedappoptions; non-RUN apps are left out.
    expect(entry.apps.find((a) => a.id === "CITYPE")).toMatchObject({ label: "CI Types", canInsert: false });
    expect(entry.apps.find((a) => a.id === "WOTRACK")).toMatchObject({ canInsert: true, module: "Work Orders" });
    expect(entry.apps.find((a) => a.id === "MONITOR_SETUP_ASSETS")).toBeUndefined();
    expect((await ext.get("local", "appsLastUsed")).appsLastUsed).toBe(key);
  });

  test("a saved list less than a day old isn't fetched again", async ({ page, maximo }) => {
    maximo.appListRequests = 0;
    page = await maximo.reloadShell();
    await expect.poll(() => appListState(page), { timeout: 30_000 }).toBe(SAVED);
    await page.waitForTimeout(3_000);
    expect(maximo.appListRequests).toBe(0);
  });

  test("a list more than a day old is fetched again", async ({ page, maximo, ext }) => {
    const { key, entry } = await savedEntry(ext);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await ext.set("local", { [key]: { ...entry, fetchedAt: old } });
    maximo.appListRequests = 0;
    page = await maximo.reloadShell();
    await expect.poll(async () => (await savedEntry(ext)).entry.fetchedAt, { timeout: 30_000 }).not.toBe(old);
    expect(maximo.appListRequests).toBeGreaterThanOrEqual(2); // modules + allowedappoptions
    await expect.poll(() => appListState(page)).toBe(SAVED);
  });

  test('typing "ref" offers the refresh command', async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("ref");
    await expect(palette(page).options).toHaveText(["Refresh app list"]);
    await expect(page.locator(".magic-search-option.is-selected")).toHaveClass(/magic-search-command/);
  });

  test('"refresh" + Enter fetches the list again', async ({ page, maximo, ext }) => {
    const before = (await savedEntry(ext)).entry.fetchedAt;
    await page.waitForTimeout(10); // so the new fetchedAt differs
    await openPalette(page);
    await palette(page).input.pressSequentially("refresh");
    await expect(palette(page).options.first()).toHaveText("Refresh app list");
    maximo.appListRequests = 0;
    await palette(page).input.press("Enter");
    await expect(page.locator(".magic-search-status")).toHaveText(`Loaded ${FIXTURE_GROUPS} apps`);
    // The palette stays open with the cursor in it, ready to search.
    await expect(palette(page).input).toBeFocused();
    expect(maximo.appListRequests).toBe(2);
    expect((await savedEntry(ext)).entry.fetchedAt).not.toBe(before);
  });

  test("Clear on the options page removes the list; the next load fetches it", async ({
    page,
    maximo,
    ext,
    options,
  }) => {
    await options.page.bringToFront();
    const rows = options.page.locator(".app-list-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.locator(".app-count")).toHaveText(String(FIXTURE_APPS.length));
    await rows.locator(".clear-list").click();
    await expect(rows).toHaveCount(0);
    await expect(options.page.locator("#app-lists")).toContainText("No app lists saved yet");
    expect(await ext.savedLists()).toEqual({});
    // The open Maximo page drops back to the built-in apps straight away...
    await expect.poll(() => appListState(page)).toBe("builtin:4");
    // ...and the next page load fetches the list again.
    page = await maximo.reloadShell();
    await expect.poll(() => appListState(page), { timeout: 30_000 }).toBe(SAVED);
    await savedEntry(ext);
  });

  test("if Maximo's list can't be fetched, the built-in apps are used", async ({ page, maximo, ext }) => {
    try {
      await ext.clearSavedLists();
      maximo.appListMode = "fail";
      page = await maximo.reloadShell();
      await expect
        .poll(() => page.locator("html").getAttribute("data-magic-search-apps-error"), { timeout: 30_000 })
        .toContain("HTTP 500");
      expect(await appListState(page)).toBe("builtin:4");
      expect(await ext.savedLists()).toEqual({});
      await openPalette(page);
      await expect(palette(page).options).toHaveText(BUILTIN);
      await palette(page).input.pressSequentially("wo");
      const target = await enterTarget(page);
      expect(target.searchParams.get("value")).toBe("wotrack");
    } finally {
      await restore(maximo, ext);
    }
  });

  test("the real list from Maximo is loaded and searchable", async ({ page, maximo, ext }) => {
    try {
      maximo.appListMode = "real";
      await ext.clearSavedLists();
      page = await maximo.reloadShell();
      await expect.poll(() => appListState(page), { timeout: 30_000 }).toMatch(/^saved:\d+$/);
      const count = Number((await appListState(page)).split(":")[1]);
      expect(count).toBeGreaterThan(FIXTURE_GROUPS);
      const { entry } = await savedEntry(ext);
      expect(entry.apps.length).toBeGreaterThan(FIXTURE_APPS.length);
      expect(entry.apps.some((a) => /^Work Order Tracking/.test(a.label))).toBe(true);
      await openPalette(page);
      await palette(page).input.pressSequentially("work order tracking");
      await expect(palette(page).options.first()).toContainText("Work Order Tracking");
    } finally {
      await restore(maximo, ext);
    }
  });
});

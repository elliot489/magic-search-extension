const {
  test,
  expect,
  palette,
  openPalette,
  enterTarget,
  appListState,
  FIXTURE_MODULES,
} = require("./fixtures");

// One app per group of versions (e.g. Work Order Tracking and its (Oil)
// version), chosen on the options page; generated aliases, editable there.
// Uses the test list in tests/data.

const selectedLabel = (page) => page.locator(".magic-search-option.is-selected");
const labels = (page) => page.locator(".magic-search-option:visible .magic-search-label");

async function search(page, text) {
  await openPalette(page);
  await palette(page).input.pressSequentially(text);
}

// The test list without one app (e.g. only one version of an app available).
function modulesWithout(appId) {
  const prune = (nodes) =>
    nodes
      .filter((n) => !(n.ELEMENTTYPE === "APP" && n.KEY === appId))
      .map((n) => (n.children ? { ...n, children: prune(n.children) } : n));
  return prune(FIXTURE_MODULES);
}

test.describe("app versions and aliases", () => {
  test.afterEach(async ({ ext }) => {
    await ext.remove("sync", ["appVariants", "appAliases"]);
  });

  test("each app is listed once, the (Oil) version by default", async ({ page }) => {
    await search(page, "work order");
    await expect(palette(page).options).toHaveText(["Work Order Tracking (Oil)"]);
    await page.keyboard.press("Escape");
    await search(page, "wotrack");
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("plusgwo");
  });

  test("choosing the standard version on the options page", async ({ page, options, ext }) => {
    await options.page.bringToFront();
    const row = options.page.locator('.variant-row[data-group="work order tracking"]');
    await expect(row.locator('input[type="radio"]')).toHaveCount(2);
    await expect(row.locator('input[value="PLUSGWO"]')).toBeChecked();
    await row.locator('input[value="WOTRACK"]').check();
    await expect
      .poll(async () => (await ext.get("sync", "appVariants")).appVariants)
      .toEqual({ "work order tracking": "WOTRACK" });

    await page.bringToFront();
    await search(page, "work order");
    await expect(palette(page).options).toHaveText(["Work Order Tracking"]);
    await page.keyboard.press("Escape");
    // Any alias of the group, even the Oil app's id, opens the chosen version.
    await search(page, "plusgwo");
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("wotrack");
  });

  test("with only one version available, it's used and there's nothing to choose", async ({
    page,
    maximo,
    ext,
    options,
  }) => {
    try {
      maximo.appListModules = modulesWithout("PLUSGWO");
      await ext.clearSavedLists();
      await maximo.reloadShell();
      await expect
        .poll(async () => {
          const lists = Object.values(await ext.savedLists());
          return lists.length === 1 && !lists[0].apps.some((a) => a.id === "PLUSGWO");
        }, { timeout: 30_000 })
        .toBe(true);

      await search(page, "wo");
      await expect(selectedLabel(page)).toHaveText(["Work Order Tracking"]);
      const target = await enterTarget(page);
      expect(target.searchParams.get("value")).toBe("wotrack");

      await options.page.reload();
      await expect(options.page.locator('.variant-row[data-group="assets"]')).toHaveCount(1);
      await expect(options.page.locator('.variant-row[data-group="work order tracking"]')).toHaveCount(0);
    } finally {
      maximo.appListModules = null;
      await ext.clearSavedLists();
      await maximo.reloadShell();
      await expect
        .poll(async () => {
          const lists = Object.values(await ext.savedLists());
          return lists.length === 1 && lists[0].apps.some((a) => a.id === "PLUSGWO");
        }, { timeout: 30_000 })
        .toBe(true);
      await expect.poll(() => appListState(page)).toMatch(/^saved:/);
    }
  });

  const ranked = [
    // An app id equal to the query wins; then full-name initials, then the rest.
    ["pm", ["Preventive Maintenance (Oil)", "Prioritization Matrix (Oil)"]],
    ["sr", ["Service Requests (Oil)", "Shipment Receiving"]],
    ["im", ["Integration Modules", "Item Master (Oil)", "Isolation Management (Oil)"]],
    ["pr", ["Purchase Requisitions (Oil)"]],
    ["jp", ["Job Plans (Oil)"]],
    ["ct", ["CI Types"]],
  ];
  for (const [query, top] of ranked) {
    test(`"${query}" ranks ${top.join(", ")} first`, async ({ page }) => {
      await search(page, query);
      // Other matches may follow; check the first ones.
      await expect.poll(async () => (await labels(page).allTextContents()).slice(0, top.length)).toEqual(top);
    });
  }

  test("shared aliases are shown next to each name", async ({ page }) => {
    await search(page, "pm");
    await expect(labels(page).nth(0)).toHaveAttribute("data-alias", "pm");
    await expect(labels(page).nth(1)).toHaveAttribute("data-alias", "pm");
  });

  test('"new pr" inserts a requisition', async ({ page }) => {
    await search(page, "new pr");
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("plusgpr");
    expect(target.searchParams.get("additionalevent")).toBe("insert");
  });

  test("editing aliases on the options page, and Reset", async ({ page, options, ext }) => {
    await options.page.bringToFront();
    await options.page.locator("#alias-search").fill("integration");
    const row = options.page.locator('.alias-row[data-group="integration modules"]');
    await expect(row).toBeVisible();
    await expect(row.locator(".alias-input")).toHaveValue("im");
    await expect(row.locator(".alias-shared")).toContainText("Item Master (Oil)");
    await row.locator(".alias-input").fill("intmod");
    await row.locator(".alias-input").press("Tab");
    await expect
      .poll(async () => (await ext.get("sync", "appAliases")).appAliases)
      .toEqual({ "integration modules": ["intmod"] });
    await expect(row.locator(".alias-edited")).toBeVisible();

    await page.bringToFront();
    await search(page, "intmod");
    await expect(selectedLabel(page)).toHaveText(["Integration Modules"]);
    await page.keyboard.press("Escape");
    // "im" no longer belongs to Integration Modules.
    await search(page, "im");
    await expect(labels(page).first()).toHaveText("Item Master (Oil)");
    await page.keyboard.press("Escape");

    await options.page.bringToFront();
    await row.locator(".alias-reset").click();
    await expect.poll(async () => (await ext.get("sync", "appAliases")).appAliases).toEqual({});
    await expect(row.locator(".alias-input")).toHaveValue("im");
    await expect(row.locator(".alias-edited")).toHaveCount(0);

    await page.bringToFront();
    await search(page, "im");
    await expect(labels(page).first()).toHaveText("Integration Modules");
  });

  test("aliases open whichever version is chosen", async ({ page, ext }) => {
    await ext.set("sync", {
      appVariants: { "work order tracking": "WOTRACK" },
      appAliases: { "work order tracking": ["job", "wo"] },
    });
    // An edited alias beats Job Plans, whose name starts with "job".
    await search(page, "job");
    await expect(labels(page).first()).toHaveText("Work Order Tracking");
    let target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("wotrack");

    await ext.set("sync", { appVariants: { "work order tracking": "PLUSGWO" } });
    await search(page, "job");
    target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("plusgwo");
  });
});

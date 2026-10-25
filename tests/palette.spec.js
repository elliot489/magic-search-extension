const { test, expect, palette, openPalette, enterTarget, gotoApp, DEFAULT_KEYS } = require("./fixtures");

// These tests use the small test app list in tests/data (see
// MaximoSession.routeAppList), where the (Oil) version of each app is the one
// shown by default. Only the top 10 matches are listed.
const FIRST_TEN = [
  "CI Types",
  "Work View",
  "Assets (Oil)",
  "Asset Templates",
  "Locations (Oil)",
  "Integration Modules",
  "Item Master (Oil)",
  "Shipment Receiving",
  "Job Plans (Oil)",
  "Precautions (Oil)",
];

test.describe("opening and closing", () => {
  test("Cmd/Ctrl+K opens the search box with the cursor in it", async ({ page }) => {
    await openPalette(page);
    const { input, options } = palette(page);
    await expect(input).toBeFocused();
    await expect(options).toHaveText(FIRST_TEN);
  });

  test("Escape closes it", async ({ page }) => {
    await openPalette(page);
    await page.keyboard.press("Escape");
    await expect(palette(page).backdrop).toHaveCount(0);
  });

  test("Cmd/Ctrl+K again closes it", async ({ page }) => {
    await openPalette(page);
    await page.keyboard.press(DEFAULT_KEYS);
    await expect(palette(page).backdrop).toHaveCount(0);
  });

  test("Ctrl+Space no longer opens it", async ({ page }) => {
    // Make sure the content script is running first.
    await openPalette(page);
    await page.keyboard.press("Escape");
    await expect(palette(page).backdrop).toHaveCount(0);
    await page.keyboard.press("Control+Space");
    await page.waitForTimeout(1_000);
    await expect(palette(page).backdrop).toHaveCount(0);
  });

  test("clicking the dimmed backdrop closes it", async ({ page }) => {
    await openPalette(page);
    await page.mouse.click(10, 10);
    await expect(palette(page).backdrop).toHaveCount(0);
  });

  test("clicking inside the box keeps it open", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.click();
    await expect(palette(page).backdrop).toBeVisible();
  });
});

test.describe("filtering", () => {
  const cases = [
    ["loc", ["Locations (Oil)"]],
    ["ass", ["Assets (Oil)", "Asset Templates", "Locations (Oil)"]],
    ["WORK", ["Work View", "Work Order Tracking (Oil)", "Quick Reporting (Oil)"]],
    ["work order", ["Work Order Tracking (Oil)"]],
    // Ranked: name starts with it, then a later word does, then anywhere.
    ["orders", ["Purchase Orders (Oil)", "Work Order Tracking (Oil)", "Quick Reporting (Oil)"]],
    // Aliases: exact alias first, then the rest.
    ["wo", ["Work Order Tracking (Oil)", "Work View", "Quick Reporting (Oil)"]],
    ["WO", ["Work Order Tracking (Oil)", "Work View", "Quick Reporting (Oil)"]],
    ["po", ["Purchase Orders (Oil)", "Quick Reporting (Oil)"]],
    ["PU", ["Purchase Requisitions (Oil)", "Purchase Orders (Oil)"]],
    // A leading new/insert/create filters on the rest of the text.
    ["new wo", ["Work Order Tracking (Oil)", "Quick Reporting (Oil)"]],
    ["create work order", ["Work Order Tracking (Oil)"]],
    ["new po", ["Purchase Orders (Oil)", "Quick Reporting (Oil)"]],
    ["create loc", ["Locations (Oil)"]],
    // "new" only offers apps the user can insert into (CI Types can't).
    ["ci types", ["CI Types"]],
    ["new ci types", []],
  ];

  for (const [query, expected] of cases) {
    test(`"${query}" leaves ${expected.join(", ") || "nothing"}`, async ({ page }) => {
      await openPalette(page);
      await palette(page).input.pressSequentially(query);
      await expect(palette(page).options).toHaveText(expected);
    });
  }

  test("only the top 10 matches are shown", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("a");
    await expect(palette(page).options).toHaveCount(10);
    await expect(palette(page).options.first()).toHaveText("Assets (Oil)");
  });

  test("no match hides the list", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("zzz");
    await expect(palette(page).options).toHaveCount(0);
    await expect(palette(page).list).toBeHidden();
  });

  test("the top match is highlighted", async ({ page }) => {
    await openPalette(page);
    const selected = page.locator(".magic-search-option.is-selected");
    await expect(selected).toHaveText(["CI Types"]);
    await palette(page).input.pressSequentially("orders");
    await expect(selected).toHaveText(["Purchase Orders (Oil)"]);
  });

  test("clearing the text puts the list back in its usual order", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("orders");
    await expect(palette(page).options).toHaveCount(3);
    await palette(page).input.fill("");
    await expect(palette(page).options).toHaveText(FIRST_TEN);
  });

  test("the matched alias is shown next to the name", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("wo");
    await expect(page.locator(".magic-search-option.is-selected .magic-search-label")).toHaveAttribute(
      "data-alias",
      "wo"
    );
  });

  test('"a" + Enter opens Assets (Oil)', async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("a");
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("plusgass");
    expect(target.searchParams.get("additionalevent")).toBeNull();
  });

  test("new + several matches opens the top one ready to insert", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("new orders");
    await expect(palette(page).options).toHaveText([
      "Purchase Orders (Oil)",
      "Work Order Tracking (Oil)",
      "Quick Reporting (Oil)",
    ]);
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("plusgpo");
    expect(target.searchParams.get("additionalevent")).toBe("insert");
  });

  test("Enter does nothing when nothing matches", async ({ page }) => {
    await openPalette(page);
    const before = page.url();
    await palette(page).input.pressSequentially("zzz");
    await palette(page).input.press("Enter");
    await expect(palette(page).backdrop).toBeVisible();
    expect(page.url()).toBe(before);
  });
});

test.describe("opening apps", () => {
  const apps = [
    ["Loc", "plusgloc"],
    ["Ass", "plusgass"],
    ["work order", "plusgwo"],
    ["wo", "plusgwo"],
    ["wotrack", "plusgwo"],
    ["PO", "plusgpo"],
    ["pr", "plusgpr"],
    ["ci types", "citype"],
  ];

  for (const [query, app] of apps) {
    test(`"${query}" + Enter opens the ${app} app`, async ({ page }) => {
      await openPalette(page);
      await palette(page).input.pressSequentially(query);
      const target = await enterTarget(page);
      expect(target.searchParams.get("value")).toBe(app);
      const url = target;
      expect(url.pathname).toMatch(/manage-shell\/index\.html$/);
      expect(url.searchParams.get("event")).toBe("loadapp");
      // Plain matches open the list view, not a new record.
      expect(url.searchParams.get("additionalevent")).toBeNull();
    });
  }
});

test("choosing the app that's already open reloads it", async ({ page, ext }) => {
  // Same address as the current page: must still load, not just close the palette.
  await ext.set("sync", { appVariants: { "work order tracking": "WOTRACK" } });
  try {
    await gotoApp(page, "wotrack");
    await openPalette(page);
    await palette(page).input.pressSequentially("wo");
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("wotrack");
    expect(target.searchParams.get("additionalevent")).toBeNull();
  } finally {
    await ext.remove("sync", "appVariants");
  }
});

test.describe("inserting new records", () => {
  const cases = [
    ["new wo", "plusgwo"],
    ["create work order", "plusgwo"],
    ["insert work", "plusgwo"],
    ["NEW PO", "plusgpo"],
    ["create pu", "plusgpr"],
    ["insert loc", "plusgloc"],
    ["new pr", "plusgpr"],
  ];

  for (const [query, app] of cases) {
    test(`"${query}" + Enter opens ${app} ready to insert`, async ({ page }) => {
      await openPalette(page);
      await palette(page).input.pressSequentially(query);
      await expect(palette(page).list).toHaveClass(/is-insert/);
      const target = await enterTarget(page);
      expect(target.searchParams.get("value")).toBe(app);
      const url = target;
      expect(url.pathname).toMatch(/manage-shell\/index\.html$/);
      expect(url.searchParams.get("event")).toBe("loadapp");
      expect(url.searchParams.get("value")).toBe(app);
      expect(url.searchParams.get("additionalevent")).toBe("insert");
    });
  }

  test("the list isn't marked for insert without a verb", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("work");
    await expect(palette(page).options.first()).toHaveText("Work View");
    await expect(palette(page).list).not.toHaveClass(/is-insert/);
  });

  test('"new" on its own matches nothing', async ({ page }) => {
    await openPalette(page);
    const before = page.url();
    await palette(page).input.pressSequentially("new");
    await expect(palette(page).options).toHaveCount(0);
    await palette(page).input.press("Enter");
    await expect(palette(page).backdrop).toBeVisible();
    expect(page.url()).toBe(before);
  });
});

test.describe("filtering an app's list", () => {
  const selected = (page) => page.locator(".magic-search-option.is-selected");

  const shown = [
    ["assets first", "Assets (Oil)", "first"],
    ["Assets First", "Assets (Oil)", "First"],
    ["wo pump", "Work Order Tracking (Oil)", "pump"],
    ["work orders pump", "Work Order Tracking (Oil)", "pump"],
    ["po 1001", "Purchase Orders (Oil)", "1001"],
    ["a first", "Assets (Oil)", "first"],
  ];

  for (const [query, top, filter] of shown) {
    test(`"${query}" shows ${top} with filter "${filter}"`, async ({ page }) => {
      await openPalette(page);
      await palette(page).input.pressSequentially(query);
      await expect(selected(page)).toHaveText([top]);
      await expect(selected(page)).toHaveAttribute("data-filter", filter);
    });
  }

  test("no filter label without extra words", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("work o");
    await expect(selected(page)).toHaveText(["Work Order Tracking (Oil)"]);
    await expect(selected(page)).not.toHaveAttribute("data-filter");
  });

  const opened = [
    ["assets first", "plusgass", "first"],
    ["wo pump", "plusgwo", "pump"],
    ["work orders pump", "plusgwo", "pump"],
    ["po 1001", "plusgpo", "1001"],
    ["loc office", "plusgloc", "office"],
  ];

  for (const [query, app, filter] of opened) {
    test(`"${query}" + Enter goes to ${app} filtered on description "${filter}"`, async ({ page }) => {
      await openPalette(page);
      await palette(page).input.pressSequentially(query);
      const target = await enterTarget(page);
      expect(target.searchParams.get("value")).toBe(app);
      const url = target;
      expect(url.searchParams.get("event")).toBe("loadapp");
      expect(url.searchParams.get("value")).toBe(app);
      expect(url.searchParams.get("additionalevent")).toBe("useqbe");
      expect(url.searchParams.get("additionaleventvalue")).toBe(`description=${filter}`);
    });
  }

  test("new + app + text opens a new record and ignores the text", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("new wo pump");
    await expect(selected(page)).toHaveText(["Work Order Tracking (Oil)"]);
    await expect(selected(page)).not.toHaveAttribute("data-filter");
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("plusgwo");
    const url = target;
    expect(url.searchParams.get("additionalevent")).toBe("insert");
    expect(url.searchParams.get("additionaleventvalue")).toBeNull();
  });
});

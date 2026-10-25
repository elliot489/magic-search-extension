const { test, expect, palette, openPalette, enterTarget, gotoApp, DEFAULT_KEYS } = require("./fixtures");

test.describe("opening and closing", () => {
  test("Cmd/Ctrl+K opens the search box with the cursor in it", async ({ page }) => {
    await openPalette(page);
    const { input, options } = palette(page);
    await expect(input).toBeFocused();
    await expect(options).toHaveText(["Locations", "Assets", "Work Orders", "Purchase Orders"]);
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
    ["Loc", ["Locations"]],
    ["ass", ["Assets"]],
    ["WORK", ["Work Orders"]],
    // Ranked: name starts with it, then a later word does, then anywhere.
    ["o", ["Work Orders", "Purchase Orders", "Locations"]],
    ["a", ["Assets", "Locations", "Purchase Orders"]],
    ["A", ["Assets", "Locations", "Purchase Orders"]],
    ["new a", ["Assets", "Locations", "Purchase Orders"]],
    // Aliases match too.
    ["wo", ["Work Orders"]],
    ["WO", ["Work Orders"]],
    ["po", ["Purchase Orders"]],
    ["PU", ["Purchase Orders"]],
    // A leading new/insert/create filters on the rest of the text.
    ["new wo", ["Work Orders"]],
    ["create work order", ["Work Orders"]],
    ["insert work", ["Work Orders"]],
    ["new po", ["Purchase Orders"]],
    ["create loc", ["Locations"]],
  ];

  for (const [query, expected] of cases) {
    test(`"${query}" leaves ${expected.join(", ")}`, async ({ page }) => {
      await openPalette(page);
      await palette(page).input.pressSequentially(query);
      await expect(palette(page).options).toHaveText(expected);
    });
  }

  test("no match hides the list", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("zzz");
    await expect(palette(page).options).toHaveCount(0);
    await expect(palette(page).list).toBeHidden();
  });

  test("the top match is highlighted", async ({ page }) => {
    await openPalette(page);
    const selected = page.locator(".magic-search-option.is-selected");
    await expect(selected).toHaveText(["Locations"]);
    await palette(page).input.pressSequentially("orders");
    await expect(palette(page).options).toHaveText(["Work Orders", "Purchase Orders"]);
    await expect(selected).toHaveText(["Work Orders"]);
  });

  test('"a" puts Assets on top and highlights it', async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("a");
    await expect(palette(page).options).toHaveText(["Assets", "Locations", "Purchase Orders"]);
    await expect(page.locator(".magic-search-option.is-selected")).toHaveText(["Assets"]);
  });

  test("clearing the text puts the list back in its usual order", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("o");
    await expect(palette(page).options).toHaveText(["Work Orders", "Purchase Orders", "Locations"]);
    await palette(page).input.fill("");
    await expect(palette(page).options).toHaveText(["Locations", "Assets", "Work Orders", "Purchase Orders"]);
  });

  test('"a" + Enter opens Assets', async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("a");
    await expect(palette(page).options).toHaveCount(3);
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("asset");
    expect(target.searchParams.get("additionalevent")).toBeNull();
  });

  test("new + several matches opens the top one ready to insert", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("new orders");
    await expect(palette(page).options).toHaveText(["Work Orders", "Purchase Orders"]);
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("wotrack");
    expect(target.searchParams.get("additionalevent")).toBe("insert");
  });

  test('"o" + Enter opens Work Orders (word match beats Locations)', async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("o");
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("wotrack");
    expect(target.searchParams.get("additionalevent")).toBeNull();
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
    ["Loc", "location"],
    ["Ass", "asset"],
    ["Work", "wotrack"],
    ["wo", "wotrack"],
    ["PO", "po"],
    ["pu", "po"],
  ];

  for (const [query, app] of apps) {
    test(`"${query}" + Enter opens the ${app} app`, async ({ page }) => {
      await openPalette(page);
      await palette(page).input.pressSequentially(query);
      await expect(palette(page).options).toHaveCount(1);
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

test("choosing the app that's already open reloads it", async ({ page }) => {
  // Same address as the current page: must still load, not just close the palette.
  await gotoApp(page, "wotrack");
  await openPalette(page);
  await palette(page).input.pressSequentially("wo");
  const target = await enterTarget(page);
  expect(target.searchParams.get("value")).toBe("wotrack");
  expect(target.searchParams.get("additionalevent")).toBeNull();
});

test.describe("inserting new records", () => {
  const cases = [
    ["new wo", "wotrack"],
    ["create work order", "wotrack"],
    ["insert work", "wotrack"],
    ["NEW PO", "po"],
    ["create pu", "po"],
    ["insert loc", "location"],
  ];

  for (const [query, app] of cases) {
    test(`"${query}" + Enter opens ${app} ready to insert`, async ({ page }) => {
      await openPalette(page);
      await palette(page).input.pressSequentially(query);
      await expect(palette(page).options).toHaveCount(1);
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
    await expect(palette(page).options).toHaveCount(1);
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
    ["assets first", ["Assets"], "Assets", "first"],
    ["Assets First", ["Assets"], "Assets", "First"],
    ["wo pump", ["Work Orders"], "Work Orders", "pump"],
    ["work orders pump", ["Work Orders"], "Work Orders", "pump"],
    ["po 1001", ["Purchase Orders"], "Purchase Orders", "1001"],
    ["a first", ["Assets", "Locations", "Purchase Orders"], "Assets", "first"],
  ];

  for (const [query, options, top, filter] of shown) {
    test(`"${query}" shows ${top} with filter "${filter}"`, async ({ page }) => {
      await openPalette(page);
      await palette(page).input.pressSequentially(query);
      await expect(palette(page).options).toHaveText(options);
      await expect(selected(page)).toHaveText([top]);
      await expect(selected(page)).toHaveAttribute("data-filter", filter);
    });
  }

  test("no filter label without extra words", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("work o");
    await expect(selected(page)).toHaveText(["Work Orders"]);
    await expect(selected(page)).not.toHaveAttribute("data-filter");
  });

  const opened = [
    ["assets first", "asset", "first"],
    ["wo pump", "wotrack", "pump"],
    ["work orders pump", "wotrack", "pump"],
    ["po 1001", "po", "1001"],
    ["loc office", "location", "office"],
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
    await expect(selected(page)).toHaveText(["Work Orders"]);
    await expect(selected(page)).not.toHaveAttribute("data-filter");
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("wotrack");
    const url = target;
    expect(url.searchParams.get("additionalevent")).toBe("insert");
    expect(url.searchParams.get("additionaleventvalue")).toBeNull();
  });
});

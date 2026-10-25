const { test, expect, palette, openPalette, DEFAULT_KEYS } = require("./fixtures");

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
    ["o", ["Locations", "Work Orders", "Purchase Orders"]],
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

  test("Enter opens the top match when several apps match", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("o");
    await expect(palette(page).options).toHaveCount(3);
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("value") === "location"),
      palette(page).input.press("Enter"),
    ]);
    expect(new URL(page.url()).searchParams.get("additionalevent")).toBeNull();
    await page.waitForLoadState("load");
  });

  test("new + several matches opens the top one ready to insert", async ({ page }) => {
    await openPalette(page);
    await palette(page).input.pressSequentially("new orders");
    await expect(palette(page).options).toHaveText(["Work Orders", "Purchase Orders"]);
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("value") === "wotrack"),
      palette(page).input.press("Enter"),
    ]);
    expect(new URL(page.url()).searchParams.get("additionalevent")).toBe("insert");
    await page.waitForLoadState("load");
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
      await Promise.all([
        page.waitForURL((url) => url.searchParams.get("value") === app),
        palette(page).input.press("Enter"),
      ]);
      const url = new URL(page.url());
      expect(url.pathname).toMatch(/manage-shell\/index\.html$/);
      expect(url.searchParams.get("event")).toBe("loadapp");
      // Plain matches open the list view, not a new record.
      expect(url.searchParams.get("additionalevent")).toBeNull();
      await page.waitForLoadState("load");
    });
  }
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
      await Promise.all([
        page.waitForURL((url) => url.searchParams.get("value") === app),
        palette(page).input.press("Enter"),
      ]);
      const url = new URL(page.url());
      expect(url.pathname).toMatch(/manage-shell\/index\.html$/);
      expect(url.searchParams.get("event")).toBe("loadapp");
      expect(url.searchParams.get("value")).toBe(app);
      expect(url.searchParams.get("additionalevent")).toBe("insert");
      await page.waitForLoadState("load");
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

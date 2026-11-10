const Records = require("../src/records.js");
const {
  test,
  expect,
  palette,
  openPalette,
  enterTarget,
  appListState,
  FIXTURE_SITES,
  SHELL_URL,
} = require("./fixtures");

// Record search: the text after an app filters its list on several fields,
// e.g. "wo 1002 pump APPR BEDFORD" -> work order number, description, status
// and site (see docs/record-search-plan.md and src/records.js). These tests
// check the address Enter would open; tests/real-navigation.spec.js proves
// Maximo applies such a filter.
//
// By default the extension's site list request gets FIXTURE_SITES
// (BEDFORD, NEWCASTLE; see MaximoSession.routeSites).

const SITE = new URL(SHELL_URL).origin;
const selected = (page) => page.locator(".magic-search-option.is-selected");

async function search(page, text) {
  await openPalette(page);
  await palette(page).input.pressSequentially(text);
}

async function filterFor(page, text) {
  await search(page, text);
  const target = await enterTarget(page);
  expect(target.searchParams.get("additionalevent")).toBe("useqbe");
  return { app: target.searchParams.get("value"), filter: target.searchParams.get("additionaleventvalue") };
}

test.describe("reading the words (no browser)", () => {
  const SITES = ["BEDFORD", "SITE2"];
  const cases = [
    ["1002", "work order tracking", "wonum=1002"],
    ["pump", "work order tracking", "description=pump"],
    ["pump seal", "work order tracking", "description=pump%seal"],
    ["1002 pump APPR BEDFORD", "work order tracking", "wonum=1002|description=pump|status==APPR|siteid==BEDFORD"],
    ["bedford", "work order tracking", "description=bedford"],
    ["HVAC", "work order tracking", "status==HVAC"],
    ["APPR INPRG", "work order tracking", "status==APPR,=INPRG"],
    ["Pump", "work order tracking", "description=Pump"],
    ["pmp-04 SITE2", "assets", "assetnum=pmp-04|siteid==SITE2"],
    ["10 02", "work order tracking", "wonum=10%02"],
    ["pump BEDFORD", "item master", "description=pump"],
    ["boiler", "locations", "description=boiler"],
    ["1001", "purchase orders", "ponum=1001"],
    ["123 ACTIVE", "job plans", "jpnum=123|status==ACTIVE"],
    // Apps without a field table: all the text on the description, as typed.
    ["pump APPR 12", "master pm", "description=pump APPR 12"],
  ];
  for (const [text, group, qbe] of cases) {
    test(`${group}: "${text}" -> ${qbe}`, () => {
      expect(Records.qbe(text, group, SITES)).toBe(qbe);
    });
  }

  test("labels say how each word was read", () => {
    expect(Records.label("1002 pump APPR INPRG BEDFORD", "work order tracking", SITES)).toBe(
      "WO: 1002 · Description: pump · Status: APPR or INPRG · Site: BEDFORD"
    );
    expect(Records.label("pump", "work order tracking", SITES)).toBe("Description: pump");
    expect(Records.label("pump APPR", "master pm", SITES)).toBe("Description: pump APPR");
  });
});

test.describe("filtering on several fields", () => {
  test("the site list is loaded with the app list", async ({ page, ext }) => {
    await expect.poll(() => appListState(page), { timeout: 30_000 }).toMatch(/^saved:/);
    await expect(page.locator("html")).toHaveAttribute("data-magic-search-sites", FIXTURE_SITES.join(" "));
    const lists = await ext.savedLists();
    const entry = Object.values(lists)[0];
    expect(entry.sites).toEqual(FIXTURE_SITES);
    expect(entry.sitesSource).toBe("mxapisite");
  });

  test('"wo 1002 pump APPR BEDFORD" filters all four fields', async ({ page }) => {
    await search(page, "wo 1002 pump APPR BEDFORD");
    await expect(selected(page)).toHaveText(["Work Order Tracking (Oil)"]);
    await expect(selected(page)).toHaveAttribute(
      "data-filter-label",
      "WO: 1002 · Description: pump · Status: APPR · Site: BEDFORD"
    );
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("plusgwo");
    expect(target.searchParams.get("additionalevent")).toBe("useqbe");
    expect(target.searchParams.get("additionaleventvalue")).toBe(
      "wonum=1002|description=pump|status==APPR|siteid==BEDFORD"
    );
  });

  test("a site in lowercase searches the description", async ({ page }) => {
    const { filter } = await filterFor(page, "wo bedford");
    expect(filter).toBe("description=bedford");
  });

  test("capitals that aren't a site are a status", async ({ page }) => {
    await search(page, "wo HVAC");
    await expect(selected(page)).toHaveAttribute("data-filter-label", "Status: HVAC");
    const target = await enterTarget(page);
    expect(target.searchParams.get("additionaleventvalue")).toBe("status==HVAC");
  });

  test("two statuses mean either", async ({ page }) => {
    const { filter } = await filterFor(page, "wo pump APPR INPRG");
    expect(filter).toBe("description=pump|status==APPR,=INPRG");
  });

  test("description words keep their order", async ({ page }) => {
    const { filter } = await filterFor(page, "wo pump seal");
    expect(filter).toBe("description=pump%seal");
  });

  test("a number goes to each app's own identifier field", async ({ page }) => {
    expect(await filterFor(page, "assets 1001 NEWCASTLE")).toEqual({
      app: "plusgass",
      filter: "assetnum=1001|siteid==NEWCASTLE",
    });
    expect((await filterFor(page, "service requests 42")).filter).toBe("ticketid=42");
  });

  test("an app without a site field drops the site", async ({ page }) => {
    await search(page, "item master pump BEDFORD");
    await expect(selected(page)).toHaveText(["Item Master (Oil)"]);
    await expect(selected(page)).toHaveAttribute("data-filter-label", "Description: pump");
    const target = await enterTarget(page);
    expect(target.searchParams.get("additionaleventvalue")).toBe("description=pump");
  });

  test("apps without a field table filter the description with all the text", async ({ page }) => {
    await search(page, "master pm pump APPR");
    await expect(selected(page)).toHaveText(["Master PM"]);
    await expect(selected(page)).toHaveAttribute("data-filter-label", "Description: pump APPR");
    const target = await enterTarget(page);
    expect(target.searchParams.get("additionaleventvalue")).toBe("description=pump APPR");
  });

  test("sites added on the options page count as sites", async ({ page, options, ext }) => {
    try {
      await options.page.bringToFront();
      const field = options.page.locator(".extra-sites");
      await field.fill("leeds, york");
      await expect.poll(async () => (await ext.get("sync", "extraSites")).extraSites).toEqual({ [SITE]: ["LEEDS", "YORK"] });
      await page.bringToFront();
      await expect(page.locator("html")).toHaveAttribute("data-magic-search-sites", /\bLEEDS YORK$/);
      const { filter } = await filterFor(page, "wo pump LEEDS");
      expect(filter).toBe("description=pump|siteid==LEEDS");
    } finally {
      await ext.remove("sync", "extraSites");
    }
    await expect(page.locator("html")).toHaveAttribute("data-magic-search-sites", FIXTURE_SITES.join(" "));
    const { filter } = await filterFor(page, "wo pump LEEDS");
    expect(filter).toBe("description=pump|status==LEEDS");
  });

  test("the options page shows the sites loaded from Maximo", async ({ options }) => {
    await expect(options.page.locator(".loaded-sites")).toHaveText(`Sites loaded from Maximo: ${FIXTURE_SITES.join(", ")}`);
  });

  // Reloads the Maximo page twice (two UI sessions).
  test("with mxapisite blocked, the sites come from whoami", async ({ maximo, ext }) => {
    test.setTimeout(150_000);
    try {
      maximo.sitesMode = "fail";
      await ext.clearSavedLists();
      let page = await maximo.reloadShell();
      await expect.poll(() => appListState(page), { timeout: 30_000 }).toMatch(/^saved:/);
      const who = await page.evaluate(async () => {
        const base = location.pathname.replace(/\/oslc\/graphite\/.*$/, "");
        const res = await fetch(`${base}/oslc/whoami?lean=1`, { headers: { accept: "application/json" } });
        return res.json();
      });
      const expected = [
        ...new Set(
          Object.entries(who)
            .filter(([k, v]) => /site$/i.test(k) && typeof v === "string" && v.trim())
            .map(([, v]) => v.trim().toUpperCase())
        ),
      ];
      const entry = Object.values(await ext.savedLists())[0];
      expect(entry.sitesSource).toBe("whoami");
      expect(entry.sites).toEqual(expected);
      test.info().annotations.push({ type: "sites from whoami", description: expected.join(", ") || "none" });
    } finally {
      maximo.sitesMode = "fixture";
      await ext.clearSavedLists();
      const page = await maximo.reloadShell();
      await expect.poll(() => appListState(page), { timeout: 30_000 }).toMatch(/^saved:/);
    }
  });
});

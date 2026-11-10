const {
  test,
  expect,
  palette,
  openPalette,
  iframeTextField,
  maximoFrame,
  expectFilteredBy,
  readListColumn,
  waitForMaximoIdle,
  SHELL_URL,
} = require("./fixtures");

const SITE = new URL(SHELL_URL).origin;

// The other tests only check where Enter would go. These few really load the
// page, to prove Maximo does what the URL asks. Each one starts a Maximo
// session, so keep this list short. This file runs last (alphabetical order).
test.describe("Maximo really opens what Enter asks for", () => {
  // Use the standard versions of these apps (the test list defaults to Oil).
  test.beforeEach(async ({ ext }) => {
    await ext.set("sync", { appVariants: { [SITE]: { "work order tracking": "WOTRACK", assets: "ASSET" } } });
  });
  test.afterEach(async ({ ext }) => {
    await ext.remove("sync", "appVariants");
  });

  async function enterAndLoad(page, query, app) {
    // Let the page the previous test loaded finish first: Maximo can move the
    // cursor when it's done loading.
    await page.waitForLoadState("load");
    await expect
      .poll(() =>
        maximoFrame(page)
          .locator("body")
          .evaluate((b) => b.ownerDocument.readyState)
          .catch(() => "loading")
      )
      .toBe("complete");
    // A record page keeps loading after that (maximo.jsp requests).
    await waitForMaximoIdle(page);
    await openPalette(page);
    await palette(page).input.pressSequentially(query);
    await expect(palette(page).input).toHaveValue(query);
    // Wait for the page load Enter starts (the URL may already name the app,
    // or even be the same URL, which reloads).
    await Promise.all([page.waitForEvent("load"), palette(page).input.press("Enter")]);
    const url = new URL(page.url());
    expect(url.searchParams.get("value")).toBe(app);
    return url;
  }

  test('"wo" + Enter opens the Work Orders list', async ({ page }) => {
    const url = await enterAndLoad(page, "wo", "wotrack");
    expect(url.searchParams.get("additionalevent")).toBeNull();
    await expect(iframeTextField(page)).toBeVisible({ timeout: 30_000 });
  });

  test('"wo pump" + Enter opens Work Orders filtered on description', async ({ page }) => {
    const url = await enterAndLoad(page, "wo pump", "wotrack");
    expect(url.searchParams.get("additionalevent")).toBe("useqbe");
    expect(url.searchParams.get("additionaleventvalue")).toBe("description=pump");
    await expectFilteredBy(page, "pump");
  });

  // "first" matches a single asset on Elliot's instance, so Maximo skips the
  // list and opens that record; either outcome passes.
  test('"assets first" + Enter opens Assets filtered on description', async ({ page }) => {
    const url = await enterAndLoad(page, "assets first", "asset");
    expect(url.searchParams.get("additionaleventvalue")).toBe("description=first");
    await expectFilteredBy(page, "first");
  });

  // A real work order, read with the test's own REST request (the extension
  // doesn't use this API): one whose status is letters only and with a site.
  async function someWorkOrder(page) {
    const list = await page.evaluate(async () => {
      const base = location.pathname.replace(/\/oslc\/graphite\/.*$/, "");
      const res = await fetch(
        `${base}/oslc/os/mxapiwodetail?lean=1&oslc.select=wonum,status,siteid&oslc.pageSize=50`,
        { headers: { accept: "application/json" } }
      );
      if (!res.ok) throw new Error(`mxapiwodetail: HTTP ${res.status}`);
      return (await res.json()).member || [];
    });
    const wo = list.find((w) => w.wonum && w.siteid && /^[A-Z]+$/.test(w.status || ""));
    expect(wo, "a work order with a site and a letters-only status").toBeTruthy();
    test.info().annotations.push({ type: "work order", description: JSON.stringify(wo) });
    return wo;
  }

  // Number, status and site together (ANDed by Maximo): finds that work
  // order, either as a list of matches or opened directly when it's the only
  // one. The site is added as an extra site, as the test site list is fake.
  test('"wo <number> <STATUS> <SITE>" + Enter finds that work order', async ({ page, ext }) => {
    const wo = await someWorkOrder(page);
    await ext.set("sync", { extraSites: { [SITE]: [wo.siteid] } });
    try {
      await expect(page.locator("html")).toHaveAttribute("data-magic-search-sites", new RegExp(`\\b${wo.siteid}\\b`));
      const url = await enterAndLoad(page, `wo ${wo.wonum} ${wo.status} ${wo.siteid}`, "wotrack");
      expect(url.searchParams.get("additionaleventvalue")).toBe(
        `wonum=${wo.wonum}|status==${wo.status}|siteid==${wo.siteid}`
      );
      await expectFilteredBy(page, wo.wonum);
    } finally {
      await ext.remove("sync", "extraSites");
    }
  });

  // A status matches exactly: "=APPR" doesn't also list WAPPR.
  test('"wo <STATUS>" + Enter lists only that status', async ({ page }) => {
    const wo = await someWorkOrder(page);
    const url = await enterAndLoad(page, `wo ${wo.status}`, "wotrack");
    expect(url.searchParams.get("additionaleventvalue")).toBe(`status==${wo.status}`);
    let result = null;
    await expect
      .poll(async () => (result = await readListColumn(page, `=${wo.status}`)), { timeout: 30_000 })
      .not.toBeNull();
    test.info().annotations.push({ type: "status column", description: JSON.stringify(result) });
    if (result.mode === "list") {
      expect(result.rows.length, "rows listed").toBeGreaterThan(0);
      expect(result.rows.filter((r) => r.toUpperCase() !== wo.status)).toEqual([]);
    }
  });

  // From an app, "home" goes back to the Start Center: the palette opened
  // there searches apps, not actions (no app tag).
  test('"home" + Enter goes back to the Start Center', async ({ page }) => {
    await enterAndLoad(page, "wo", "wotrack");
    await expect(iframeTextField(page)).toBeVisible({ timeout: 30_000 });
    const url = await enterAndLoad(page, "home", "startcntr");
    expect(url.searchParams.get("additionalevent")).toBeNull();
    // Maximo's frame has left Work Order Tracking (the Start Center may not
    // name itself in the frame's address).
    await expect
      .poll(
        () =>
          maximoFrame(page)
            .locator("body")
            .evaluate((b) => (new URL(b.ownerDocument.location.href).searchParams.get("value") || "").toLowerCase())
            .catch(() => "wotrack"),
        { timeout: 30_000 }
      )
      .not.toBe("wotrack");
    await waitForMaximoIdle(page);
    await openPalette(page, undefined, { context: true });
    await expect(page.locator(".magic-search-tag")).toBeHidden();
    await expect(palette(page).input).toHaveAttribute("placeholder", "Search Maximo...");
    await page.keyboard.press("Escape");
  });

  // Last: it leaves an unsaved new record open (never saved).
  test('"new wo" + Enter opens Work Orders ready to insert', async ({ page }) => {
    const url = await enterAndLoad(page, "new wo", "wotrack");
    expect(url.searchParams.get("additionalevent")).toBe("insert");
    // A new record's form, not the list: Maximo puts the cursor in the key
    // field, already filled with the new number (e.g. Work Order 1002), and
    // there are no list filter fields.
    const frame = maximoFrame(page);
    await expect
      .poll(
        () =>
          frame
            .locator("body")
            .evaluate((body) => {
              const el = body.ownerDocument.activeElement;
              return !!el && el.tagName === "INPUT" && !/_tfrow_/.test(el.id) && el.value.trim() !== "";
            })
            .catch(() => false),
        { timeout: 30_000 }
      )
      .toBe(true);
    await expect(iframeTextField(page)).toHaveCount(0);
  });
});

const Records = require("../src/records.js");
const {
  test,
  gotoApp,
  expect,
  palette,
  openPalette,
  iframeTextField,
  maximoFrame,
  expectFilteredBy,
  readListColumn,
  withDefaults,
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
    // Plus the user's default site and historyflag=0 (read before the page changes).
    const expected = await withDefaults(page, "description=pump", { history: true });
    const url = await enterAndLoad(page, "wo pump", "wotrack");
    expect(url.searchParams.get("additionalevent")).toBe("useqbe");
    expect(url.searchParams.get("additionaleventvalue")).toBe(expected);
    await expectFilteredBy(page, "pump");
  });

  // "first" matches a single asset on Elliot's instance, so Maximo skips the
  // list and opens that record; either outcome passes.
  test('"assets first" + Enter opens Assets filtered on description', async ({ page }) => {
    const expected = await withDefaults(page, "description=first");
    const url = await enterAndLoad(page, "assets first", "asset");
    expect(url.searchParams.get("additionaleventvalue")).toBe(expected);
    await expectFilteredBy(page, "first");
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

  // These two run after the Start Center test: when a filter finds a single
  // work order, Maximo opens it, and opening Work Order Tracking again later
  // in the same session shows that record instead of the list.

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

  // A status matches exactly: "=APPR" doesn't also list WAPPR. The work
  // order's own site is typed, so the user's default site doesn't apply.
  test('"wo <STATUS> <SITE>" + Enter lists only that status', async ({ page, ext }) => {
    const wo = await someWorkOrder(page);
    await ext.set("sync", { extraSites: { [SITE]: [wo.siteid] } });
    try {
      await expect(page.locator("html")).toHaveAttribute("data-magic-search-sites", new RegExp(`\\b${wo.siteid}\\b`));
      const url = await enterAndLoad(page, `wo ${wo.status} ${wo.siteid}`, "wotrack");
      expect(url.searchParams.get("additionaleventvalue")).toBe(`status==${wo.status}|siteid==${wo.siteid}`);
      let result = null;
      await expect
        .poll(async () => (result = await readListColumn(page, `=${wo.status}`)), { timeout: 30_000 })
        .not.toBeNull();
      test.info().annotations.push({ type: "status column", description: JSON.stringify(result) });
      if (result.mode === "list") {
        expect(result.rows.length, "rows listed").toBeGreaterThan(0);
        expect(result.rows.filter((r) => r.toUpperCase() !== wo.status)).toEqual([]);
      }
    } finally {
      await ext.remove("sync", "extraSites");
    }
  });

  // Apps whose main table has no DESCRIPTION search another field by default
  // (src/records.js TEXT_FIELDS; People -> DISPLAYNAME). Open each one with
  // that filter and check Maximo shows the app without an error, so the
  // field exists. Loaded straight from the URL: these apps aren't in the
  // recorded test menu. A user without an app gets Maximo's own "no access"
  // message, which fails the test too; remove the app from the list below
  // if that happens.
  const TEXT_FIELD_APPS = {
    people: ["PERSON"],
    users: ["USER"],
    labor: ["LABOR"],
    companies: ["COMPANY"],
    "company master": ["COMPMASTER"],
    inventory: ["INVENTOR"],
    "bulletin board": ["BBOARD"],
    "workflow administration": ["WFADMIN"],
    logging: ["LOGGING"],
    "ci types": ["CITYPE"],
    "record release": ["RLADMIN"],
    "time zone rules": ["TZRULE"],
    "configure tooltips": ["SCHTTMGR"],
    "cognos analytics": ["COGNOSHOME"],
    "report viewer": ["RPTOUTPUT"],
    "failure codes": ["FAILURE"],
    "launch in context": ["LAUNCH"],
    "message tracking": ["INTMSGTRK"],
    "message reprocessing": ["INTERROR"],
    "shipment receiving": ["SHIPREC"],
    "operational actions": ["PLUSGOPACT"],
    "labor reporting": ["LABREP"],
    "assignment manager": ["WORKMAN"],
  };

  test("every app with its own search field is listed here", () => {
    expect(Object.keys(TEXT_FIELD_APPS).sort()).toEqual(Object.keys(Records.TEXT_FIELDS).sort());
  });

  // Maximo's messages in its frame(s), e.g. "BMXAA4214E - ...": errors only.
  async function maximoErrors(page) {
    const texts = await Promise.all(
      page.frames().map((f) => f.locator("body").innerText({ timeout: 2_000 }).catch(() => ""))
    );
    return texts.flatMap((t) => t.split("\n").filter((line) => /BMXAA\d+E|does not exist|is not valid/i.test(line)));
  }

  // Maximo's own frame (/maximo/ui/?type=embedded...) as a Playwright Frame.
  function uiFrame(page) {
    return page.frames().find((f) => /\/maximo\/ui\//.test(f.url()) && f !== page.mainFrame()) || null;
  }

  // The UI session the frame is in (Maximo puts it in its forms and links).
  async function uiSessionId(frame) {
    return frame
      .evaluate(() => {
        const input = document.querySelector('input[name="uisessionid"]');
        if (input && input.value) return input.value;
        const m = document.documentElement.innerHTML.match(/uisessionid=(\d+)/);
        return m ? m[1] : "";
      })
      .catch(() => "");
  }

  // Each page load starts a new Maximo UI session, and the login allows only
  // a few, so these checks don't load the page: they open each app inside
  // Maximo's frame, in the UI session it already has (as Maximo's own menu
  // does). Only the first one loads Work Order Tracking if the frame isn't there.
  for (const [group, apps] of Object.entries(TEXT_FIELD_APPS)) {
    for (const app of apps) {
      const field = Records.TEXT_FIELDS[group].field;
      test(`${app} (${group}) opens filtered on ${field.toUpperCase()} without an error`, async ({ page }) => {
        test.info().setTimeout(test.info().timeout + 60_000);
        const qbe = Records.qbe("a", group);
        expect(qbe).toBe(`${field}=a`);
        let frame = uiFrame(page);
        let session = frame ? await uiSessionId(frame) : "";
        if (!session) {
          await gotoApp(page, "wotrack");
          frame = uiFrame(page);
          session = frame ? await uiSessionId(frame) : "";
        }
        expect(session, "Maximo's UI session id in its frame").not.toBe("");
        const url = new URL(frame.url());
        url.search = new URLSearchParams({
          type: "embedded",
          event: "loadapp",
          value: app.toLowerCase(),
          additionalevent: "useqbe",
          additionaleventvalue: qbe,
          uisessionid: session,
        }).toString();
        url.hash = "";
        test.info().annotations.push({ type: "url", description: url.toString() });
        await frame.goto(url.toString(), { waitUntil: "load" });
        // Wait for the app: a list (filter fields) or a single record opened.
        await expect
          .poll(
            () =>
              frame
                .evaluate(() => {
                  if (document.readyState !== "complete") return false;
                  if (/maximum number of sessions/i.test(document.body.innerText)) return "session limit";
                  const inputs = [...document.querySelectorAll("input, textarea")];
                  return inputs.some((el) => /_tfrow_/.test(el.id)) || inputs.some((el) => el.offsetParent !== null);
                })
                .catch(() => false),
            { timeout: 30_000 }
          )
          .toBe(true);
        await waitForMaximoIdle(page);
        const after = await uiSessionId(frame);
        test.info().annotations.push({ type: "ui session", description: `${session} -> ${after}` });
        const errors = await maximoErrors(page);
        expect(errors, `Maximo's messages after filtering ${app} on ${field}`).toEqual([]);
      });
    }
  }

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

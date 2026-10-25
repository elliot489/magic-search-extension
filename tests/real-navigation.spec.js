const {
  test,
  expect,
  palette,
  openPalette,
  iframeTextField,
  maximoFrame,
  expectFilteredBy,
} = require("./fixtures");

// The other tests only check where Enter would go. These few really load the
// page, to prove Maximo does what the URL asks. Each one starts a Maximo
// session, so keep this list short. This file runs last (alphabetical order).
test.describe("Maximo really opens what Enter asks for", () => {
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

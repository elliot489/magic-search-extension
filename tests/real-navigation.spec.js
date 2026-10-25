const {
  test,
  expect,
  palette,
  openPalette,
  iframeTextField,
  expectFilteredBy,
} = require("./fixtures");

// The other tests only check where Enter would go. These few really load the
// page, to prove Maximo does what the URL asks. Each one starts a Maximo
// session, so keep this list short. This file runs last (alphabetical order).
test.describe("Maximo really opens what Enter asks for", () => {
  async function enterAndLoad(page, query, app) {
    await openPalette(page);
    await palette(page).input.pressSequentially(query);
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("value") === app),
      palette(page).input.press("Enter"),
    ]);
    await page.waitForLoadState("load");
    return new URL(page.url());
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
    await expect(iframeTextField(page)).toBeVisible({ timeout: 30_000 });
  });
});

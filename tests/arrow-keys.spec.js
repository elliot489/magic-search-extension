const { test, expect, palette, openPalette, enterTarget } = require("./fixtures");

// Uses the test app list in tests/data. "pm" lists:
// Preventive Maintenance (Oil), Prioritization Matrix (Oil), Master PM, ...
const selected = (page) => page.locator(".magic-search-option.is-selected");

async function typePm(page) {
  await openPalette(page);
  await palette(page).input.pressSequentially("pm");
  await expect(palette(page).options.nth(2)).toHaveText("Master PM");
  await expect(selected(page)).toHaveText(["Preventive Maintenance (Oil)"]);
}

test.describe("choosing with the arrow keys", () => {
  test("Down moves the highlight, Up moves it back", async ({ page }) => {
    await typePm(page);
    const { input } = palette(page);
    await input.press("ArrowDown");
    await expect(selected(page)).toHaveText(["Prioritization Matrix (Oil)"]);
    await input.press("ArrowDown");
    await expect(selected(page)).toHaveText(["Master PM"]);
    await input.press("ArrowUp");
    await expect(selected(page)).toHaveText(["Prioritization Matrix (Oil)"]);
    await expect(input).toBeFocused();
  });

  test("the highlight stops at the top and bottom of the list", async ({ page }) => {
    await typePm(page);
    const { input, options } = palette(page);
    await input.press("ArrowUp");
    await expect(selected(page)).toHaveText(["Preventive Maintenance (Oil)"]);
    const count = await options.count();
    for (let i = 0; i < count + 2; i++) await input.press("ArrowDown");
    await expect(selected(page)).toHaveText([await options.nth(count - 1).textContent()]);
  });

  test("Enter opens the highlighted app", async ({ page }) => {
    await typePm(page);
    await palette(page).input.press("ArrowDown");
    await palette(page).input.press("ArrowDown");
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("masterpm");
    expect(target.searchParams.get("additionalevent")).toBeNull();
  });

  test("typing again highlights the top match", async ({ page }) => {
    await typePm(page);
    await palette(page).input.press("ArrowDown");
    await palette(page).input.press("ArrowDown");
    await palette(page).input.press("Backspace");
    await expect(selected(page)).toHaveText([await palette(page).options.first().textContent()]);
  });

  test("Space fills in the highlighted app's name", async ({ page }) => {
    await typePm(page);
    const { input } = palette(page);
    await input.press("ArrowDown");
    await input.press("ArrowDown");
    await input.press("Space");
    await expect(input).toHaveValue("Master PM ");
    await expect(selected(page)).toHaveText(["Master PM"]);
  });

  test("Space then a filter, then Enter, opens the app filtered", async ({ page }) => {
    await typePm(page);
    const { input } = palette(page);
    await input.press("ArrowDown");
    await input.press("ArrowDown");
    await input.press("Space");
    await input.pressSequentially("pump");
    await expect(input).toHaveValue("Master PM pump");
    await expect(selected(page)).toHaveText(["Master PM"]);
    await expect(selected(page)).toHaveAttribute("data-filter", "pump");
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("masterpm");
    expect(target.searchParams.get("additionalevent")).toBe("useqbe");
    expect(target.searchParams.get("additionaleventvalue")).toBe("description=pump");
  });

  test("Space without the arrow keys is just a space", async ({ page }) => {
    await openPalette(page);
    const { input } = palette(page);
    await input.pressSequentially("work order");
    await expect(input).toHaveValue("work order");
    await expect(selected(page)).toHaveText(["Work Order Tracking (Oil)"]);
  });

  test("new + arrows + Space keeps the new", async ({ page }) => {
    await openPalette(page);
    const { input } = palette(page);
    await input.pressSequentially("new orders");
    await expect(palette(page).options.nth(1)).toHaveText("Work Order Tracking (Oil)");
    await input.press("ArrowDown");
    await input.press("Space");
    await expect(input).toHaveValue("new Work Order Tracking (Oil) ");
    await expect(selected(page)).toHaveText(["Work Order Tracking (Oil)"]);
    const target = await enterTarget(page);
    expect(target.searchParams.get("value")).toBe("plusgwo");
    expect(target.searchParams.get("additionalevent")).toBe("insert");
  });

  test("the filter label follows the highlight", async ({ page }) => {
    await openPalette(page);
    const { input } = palette(page);
    await input.pressSequentially("pm pump");
    await expect(selected(page)).toHaveAttribute("data-filter", "pump");
    await input.press("ArrowDown");
    await expect(selected(page)).toHaveText(["Prioritization Matrix (Oil)"]);
    await expect(selected(page)).toHaveAttribute("data-filter", "pump");
    await expect(page.locator(".magic-search-option[data-filter]")).toHaveCount(1);
  });
});

const { test, expect } = require("@playwright/test");
const Apps = require("../src/apps.js");

// Compound words in app names ("Database", "Workflow") also give aliases from
// their parts' initials ("db", "wf"), next to the usual ones. These check the
// alias rules only (no browser needed); the names are real Maximo apps that
// aren't in the test app list.
const aliasesOf = (label, id = "X") =>
  Apps.generatedAliases(Apps.groupName(label), [{ id, label }]).map((a) => a.alias);

test.describe("aliases for compound words", () => {
  const cases = [
    ["Database Configuration", ["dc", "dbc", "db"]],
    ["Workflow Designer", ["wd", "wfd", "wf"]],
    ["Workflow Administration", ["wa", "wfa", "wf"]],
    ["Storerooms", ["sr"]],
    ["Configure Tooltips", ["ct", "ctt"]],
  ];
  for (const [label, expected] of cases) {
    test(`${label} gets ${expected.join(", ")}`, () => {
      expect(aliasesOf(label)).toEqual(["x", ...expected]);
    });
  }

  test("ordinary long words aren't split", () => {
    for (const word of ["Inventory", "Requisitions", "Templates", "Scheduling", "Organizations", "Classifications", "Settings"]) {
      expect(Apps.splitCompound(word)).toEqual([word]);
    }
    expect(aliasesOf("Work Order Tracking", "WOTRACK")).toEqual(["wotrack", "wot", "wo", "work orders"]);
  });

  test('"db" finds Database Configuration, after an exact app id', () => {
    const groups = Apps.buildGroups([
      { id: "DBCONFIG", label: "Database Configuration", module: "System Configuration" },
      { id: "DB", label: "Some App", module: "" },
      { id: "ASSET", label: "Assets", module: "Assets" },
    ]);
    const ranked = Apps.rankGroups(groups, "db").map((m) => `${m.group.label} · ${m.alias}`);
    expect(ranked).toEqual(["Some App · db", "Database Configuration · db"]);
  });

  test("a compound alias ranks after other apps' full initials", () => {
    const groups = Apps.buildGroups([
      { id: "STOREROOM", label: "Storerooms", module: "Inventory" },
      { id: "SR", label: "Service Requests", module: "Service Desk" },
    ]);
    const ranked = Apps.rankGroups(groups, "sr").map((m) => m.group.label);
    expect(ranked).toEqual(["Service Requests", "Storerooms"]);
  });
});

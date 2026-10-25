const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  // One browser, one window, tests in order: they share a single Maximo login.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

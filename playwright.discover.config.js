const { defineConfig } = require("@playwright/test");

// `npm run discover-apps`: one-off script (not part of `npm test`) that signs in
// once, records where Maximo's shell gets its app menu, and writes
// .auth/discover-apps.json. Signs out at the end like the tests.
module.exports = defineConfig({
  testDir: "tests/discover",
  workers: 1,
  timeout: 180_000,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/global-setup.js",
  globalTeardown: "./tests/global-teardown.js",
});

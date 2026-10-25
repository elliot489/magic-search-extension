const { defineConfig } = require("@playwright/test");

// `npm run discover-actions`: one-off script (not part of `npm test`) that
// signs in once, records how Maximo shows an app's toolbar and More Actions
// menu, and writes .auth/discover-actions.json (gitignored). Signs out at the
// end like the tests.
module.exports = defineConfig({
  testDir: "tests/discover",
  workers: 1,
  timeout: 240_000,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/global-setup.js",
  globalTeardown: "./tests/global-teardown.js",
});

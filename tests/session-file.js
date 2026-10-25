// The run's Maximo login (cookies + Maximo's own sign-out URL), kept in a
// gitignored file only while a run is going. Playwright starts a new browser
// after any failed test; that browser reuses this login instead of signing in
// again. global-setup.js clears it at the start of a run, and
// global-teardown.js signs out and deletes it at the end.
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", ".auth", "maximo-session.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (_) {
    return null;
  }
}

function save(session) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify(session), { mode: 0o600 });
}

function clear() {
  fs.rmSync(FILE, { force: true });
}

module.exports = { load, save, clear };

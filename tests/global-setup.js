const fs = require("fs");
const path = require("path");
const { request } = require("@playwright/test");
const sessionFile = require("./session-file");

const OLD_COOKIE_FILE = path.join(__dirname, "..", ".auth", "maximo-cookies.json");

// Each run signs in once, fresh. If an earlier run was interrupted (or used
// the old cookie file), sign that login out first, then forget it.
module.exports = async () => {
  const leftovers = [];
  const saved = sessionFile.load();
  if (saved?.cookies?.length) leftovers.push(saved);
  try {
    const cookies = JSON.parse(fs.readFileSync(OLD_COOKIE_FILE, "utf8"));
    if (cookies.length) leftovers.push({ cookies });
  } catch (_) {}

  const envFile = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const base = process.env.MAXIMO_URL ? process.env.MAXIMO_URL.replace(/\/?$/, "/") : null;

  for (const { cookies, logoutUrl } of leftovers) {
    const url = logoutUrl || (base && new URL("webclient/login/logout.jsp", base).toString());
    if (!url) continue;
    const ctx = await request.newContext({ storageState: { cookies, origins: [] } });
    await ctx.get(url, { timeout: 15_000 }).catch(() => {});
    await ctx.dispose();
  }

  sessionFile.clear();
  fs.rmSync(OLD_COOKIE_FILE, { force: true });
};

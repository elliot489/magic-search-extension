const { request } = require("@playwright/test");
const sessionFile = require("./session-file");

// End of the run: sign out of Maximo with its own sign-out URL (the
// LOGOUTURL its pages define, /maximo/webclient/login/logout.jsp), so the
// login and its sessions end now instead of waiting to time out.
module.exports = async () => {
  const saved = sessionFile.load();
  sessionFile.clear();
  if (!saved || !saved.logoutUrl || !saved.cookies?.length) return;
  const ctx = await request.newContext({ storageState: { cookies: saved.cookies, origins: [] } });
  try {
    const res = await ctx.get(saved.logoutUrl, { timeout: 15_000 });
    console.log(`[maximo] signed out (${res.status()})`);
  } catch (e) {
    console.warn(`[maximo] sign-out failed: ${e.message}`);
  } finally {
    await ctx.dispose();
  }
};

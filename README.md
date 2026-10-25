# Magic Search for Maximo

A Chrome extension that adds a command palette style search box to Maximo Manage.

It only runs on pages whose URL contains `maximo/oslc/graphite/manage-shell`. Press **Cmd+K** on Mac (**Ctrl+K** on Windows/Linux) to open the search box, even while the cursor is in a Maximo text field (Maximo's UI sits in an iframe; the extension listens there too). Press **Escape** or click the dimmed background to close it.

Under the search box is a list of **your** Maximo apps: the ones in your Go To menu, loaded from Maximo (see below). Until that list has loaded, or if it can't be loaded, the box shows four built-in apps: Locations, Assets, Work Order Tracking and Purchase Orders. It shows the top 10 matches.

Typing filters the list (case-insensitive). Apps match by name, by alias (short names such as `wo`, see below) or by module name. The matches are sorted, best first (apps that match equally keep Maximo's menu order):

1. An alias equal to the text: an app id (`pm`, `wotrack`) or an alias you edited first, then the initials of the whole name, then of its first two words.
2. The name starts with the text.
3. An alias starts with it.
4. A later word of the name starts with it: `orders` finds Purchase **Orders** and Work **Order** Tracking.
5. The text appears anywhere in the name, then in the module name.

When an alias made the match, it's shown after the name, e.g. "Item Master · im". The top app is highlighted, and **Enter** opens it in its list view. Enter does nothing if no apps match.

Use **Up** and **Down** to highlight a different app. Enter opens the highlighted one. Pressing **Space** after the arrow keys fills in that app's name, e.g. `pm`, Down, Down, Space gives `Master PM `, ready for a filter. Typing anything else highlights the top match again.

### Your app list

- **Loaded from Maximo** the first time you open it, using your own login: `/oslc/permission/modules` (the Go To menu) and `/oslc/permission/allowedappoptions` (what you may do in each app). Only standard Maximo apps (type `RUN`) are listed.
- **Saved** in the extension's local storage, one list per Maximo server and user.
- **Fetched again** when it's more than a day old, when you type **refresh** in the search box (the "Refresh app list" command) or after you click **Clear** for it on the options page.

### One entry per app

Some apps come in more than one version, such as Work Order Tracking and Work Order Tracking (Oil): the same name with a suffix in brackets. The search box lists only one of them. If you can open only one version, that one is used. If you can open several, the (Oil)-style version is used unless you choose another on the options page, under **Apps with more than one version**.

### Aliases

Each app gets aliases automatically: its app ids (all versions), the initials of its name (`wot` for Work Order Tracking) and of its first two words (`wo`). An alias opens whichever version of the app is chosen. Edit them on the options page under **Aliases** (comma-separated); **Reset** puts the generated ones back. Edited aliases rank above generated ones when several apps share an alias.

### Open an app with its list filtered

Type the app (name or alias), a space, then some text: `assets first`, `wo pump`, `work orders pump`, `po 1001`. The app is picked from the longest start of what you typed that matches, and the rest is the filter. The highlighted app shows a **Description: …** label, and Enter opens it with the list filtered on description. Maximo does the matching with the text as typed. If only one record matches, Maximo opens that record directly.

This uses `&additionalevent=useqbe&additionaleventvalue=description=<text>` (set in `FILTER` at the top of `src/content.js`).

### Insert a new record

Start with **new**, **insert** or **create** and a space, then the app: `new wo`, `create work order`, `insert work`, `new po`. Only apps you're allowed to insert into are offered. Each option then shows a **New record** label, and Enter opens the top app ready to insert a new record. Any text after the app name is ignored here.

Apps open with the Manage shell URL `.../maximo/oslc/graphite/manage-shell/index.html?event=loadapp&value=<app>#/main`, for example `value=wotrack` or `value=plusgwo`. To insert a new record, `&additionalevent=insert` is added after the app name.

## Load it in Chrome

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the repository folder (the one containing `manifest.json`).
5. Open or reload a Maximo Manage page and press **Cmd+K** (Mac) or **Ctrl+K** (Windows/Linux).

After changing any files, click the reload icon on the extension's card in `chrome://extensions`, then reload the Maximo tab.

> Why not Ctrl+Space? On macOS it's the shortcut for switching input source, and macOS takes it whenever the cursor is in a text box, so Chrome never sees it. If you'd still like Ctrl+Space, turn that macOS shortcut off in System Settings > Keyboard > Keyboard Shortcuts > Input Sources, then set it on the options page (below).

## Change the shortcut

Open the extension's options: in `chrome://extensions` click **Details** on the extension's card, then **Extension options** (or right-click the extension's toolbar icon and choose **Options**). Click **Record new shortcut** and press the keys you want. It must include Ctrl, Alt/Option or Cmd, or be an F-key. **Reset to Cmd+K** (Ctrl+K on Windows/Linux) puts the default back.

The setting is saved with Chrome sync and applies straight away to open Maximo tabs, no reload needed.

## Tests

The tests drive Chromium, with the extension loaded, against a live Maximo instance. They sign in once and then check opening, closing, filtering (including aliases), opening apps, opening apps with their list filtered on description, opening apps ready to insert a new record (nothing gets saved), the shortcut inside Maximo's iframe, changing the shortcut on the options page (they put the default back afterwards), loading and refreshing the app list, choosing app versions and editing aliases.

Most tests don't depend on what the test user can see: the extension's own requests for the app list are answered with a small list in `tests/data/` (taken from a real Maximo menu), with both standard and (Oil) versions. One test (`tests/app-list.spec.js`) loads the real list from your Maximo.

One-time setup (Node 20.12 or newer):

```sh
npm install
npx playwright install chromium
cp .env.example .env   # then fill in MAXIMO_URL, MAXIMO_USER and MAXIMO_PASSWORD
```

`.env` is gitignored, so the login never gets committed.

Run them with:

```sh
npm test
```

The whole run uses one Maximo login and one tab. Maximo limits how many sessions a login can have, and every page load can start one, so most tests check the address Enter would open without loading it. A few tests (`tests/real-navigation.spec.js`, run last) really open Maximo pages to prove the app, the new record and the description filter work. If Maximo still reports "maximum number of sessions", wait for old sessions to time out and run again. Each run signs in once. If a test fails, Playwright starts a new browser, which reuses that login (kept in the gitignored `.auth/` folder during the run). When the run ends, the tests sign out with Maximo's own sign-out URL and delete it.

They run headless by default (Chromium's new headless mode, which supports extensions). To watch the browser window instead:

```sh
HEADED=1 npm test
```

After a failed run, `npx playwright show-report` shows a screenshot and trace for each failure.

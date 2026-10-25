# Magic Search for Maximo

A Chrome extension that adds a command palette style search box to Maximo Manage.

It only runs on pages whose URL contains `maximo/oslc/graphite/manage-shell`. Press **Cmd+K** on Mac (**Ctrl+K** on Windows/Linux) to open the search box, even while the cursor is in a Maximo text field (Maximo's UI sits in an iframe; the extension listens there too). Press **Escape** or click the dimmed background to close it.

Under the search box is a list of apps (hardcoded for now):

| App | Maximo app | Aliases |
| --- | --- | --- |
| Locations | `location` | |
| Assets | `asset` | |
| Work Orders | `wotrack` | `wo` |
| Purchase Orders | `po` | `po` |

Typing filters the list (case-insensitive): an app stays if its name contains the text, or one of its aliases starts with it. So `work` and `wo` both leave Work Orders, and `pu` and `po` both leave Purchase Orders.

The matches are sorted, best first (apps that match equally keep the order above):

1. The name or an alias starts with the text: `a` puts **Assets** first.
2. A later word in the name starts with it: `o` puts Work **O**rders and Purchase **O**rders next.
3. The text appears anywhere else in the name: `a` also leaves Loc**a**tions and Purch**a**se Orders, below Assets.

The top app is highlighted, and **Enter** opens it in its list view, so there's no need to narrow it down to one (`a` + Enter opens Assets). Enter does nothing if no apps match.

### Open an app with its list filtered

Type the app (name or alias), a space, then some text: `assets first`, `wo pump`, `work orders pump`, `po 1001`. The app is picked from the longest start of what you typed that matches, and the rest is the filter. The highlighted app shows a **Description: …** label, and Enter opens it with the list filtered on description. Maximo does the matching with the text as typed. If only one record matches, Maximo opens that record directly.

This uses `&additionalevent=useqbe&additionaleventvalue=description=<text>` (set in `FILTER` at the top of `src/content.js`).

### Insert a new record

Start with **new**, **insert** or **create** and a space, then the app: `new wo`, `create work order`, `insert work`, `new po`. Each option then shows a **New record** label, and Enter opens the top app ready to insert a new record. Any text after the app name is ignored here.

Apps open with the Manage shell URL `.../maximo/oslc/graphite/manage-shell/index.html?event=loadapp&value=<app>#/main`, for example `value=location`, `value=asset`, `value=wotrack` or `value=po`. To insert a new record, `&additionalevent=insert` is added after the app name.

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

The tests drive Chromium, with the extension loaded, against a live Maximo instance. They sign in once and then check opening, closing, filtering (including aliases), opening apps, opening apps with their list filtered on description, opening apps ready to insert a new record (nothing gets saved), the shortcut inside Maximo's iframe, and changing the shortcut on the options page (they put the default back afterwards).

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

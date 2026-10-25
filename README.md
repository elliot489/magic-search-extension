# Magic Search for Maximo

A Chrome extension that adds a command palette style search box to Maximo Manage.

It only runs on pages whose URL contains `maximo/oslc/graphite/manage-shell`. Press **Cmd+K** on Mac (**Ctrl+K** on Windows/Linux) to open the search box, even while the cursor is in a Maximo text field (Maximo's UI sits in an iframe; the extension listens there too). Press **Escape** or click the dimmed background to close it.

Under the search box is a list of apps: **Locations**, **Assets** and **Work Orders** (hardcoded for now). Typing filters the list (case-insensitive). When only one app is left, press **Enter** to open it. Enter does nothing if zero or several apps match.

Apps open with the Manage shell URL `.../maximo/oslc/graphite/manage-shell/index.html?event=loadapp&value=<app>#/main`, for example `value=location`, `value=asset` or `value=wotrack`.

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

The tests drive Chromium, with the extension loaded, against a live Maximo instance. They sign in once and then check opening, closing, filtering and opening apps, the shortcut inside Maximo's iframe, and changing the shortcut on the options page (they put the default back afterwards).

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

They run headless by default (Chromium's new headless mode, which supports extensions). To watch the browser window instead:

```sh
HEADED=1 npm test
```

After a failed run, `npx playwright show-report` shows a screenshot and trace for each failure.

# Magic Search for Maximo

A Chrome extension that adds a command palette style search box to Maximo Manage.

It only runs on pages whose URL contains `maximo/oslc/graphite/manage-shell`. Press **Ctrl+Space** to open the search box. Press **Escape** or click the dimmed background to close it.

The search box doesn't do anything yet.

## Load it in Chrome

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the repository folder (the one containing `manifest.json`).
5. Open or reload a Maximo Manage page and press **Ctrl+Space**.

After changing any files, click the reload icon on the extension's card in `chrome://extensions`, then reload the Maximo tab.

> On macOS, Ctrl+Space may be taken by the input source switcher. If nothing happens, turn that shortcut off in System Settings > Keyboard > Keyboard Shortcuts > Input Sources.

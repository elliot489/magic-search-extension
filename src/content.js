(() => {
  // Double check the URL in case the manifest match is broader than expected.
  if (!location.href.includes("maximo/oslc/graphite/manage-shell")) return;
  if (window.__magicSearchLoaded) return;
  window.__magicSearchLoaded = true;

  let backdrop = null;

  function open() {
    if (backdrop) return;

    backdrop = document.createElement("div");
    backdrop.className = "magic-search-backdrop";

    const box = document.createElement("div");
    box.className = "magic-search-box";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "magic-search-input";
    input.placeholder = "Search Maximo...";
    input.setAttribute("aria-label", "Search Maximo");

    box.appendChild(input);
    backdrop.appendChild(box);

    // Clicking the dimmed area (not the box itself) closes the palette.
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close();
    });

    document.body.appendChild(backdrop);
    input.focus();
  }

  function close() {
    if (!backdrop) return;
    backdrop.remove();
    backdrop = null;
  }

  // Capture phase so Maximo's own key handlers don't swallow the shortcut.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey && (e.code === "Space" || e.key === " ")) {
        e.preventDefault();
        e.stopPropagation();
        backdrop ? close() : open();
      } else if (e.key === "Escape" && backdrop) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    },
    true
  );
})();

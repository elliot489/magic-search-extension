(() => {
  const S = MagicSearchShortcut;
  const current = document.getElementById("current");
  const recordBtn = document.getElementById("record");
  const resetBtn = document.getElementById("reset");
  const status = document.getElementById("status");
  let recording = false;

  function show(sc) {
    current.textContent = S.format(sc);
  }

  function setStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle("error", isError);
  }

  function stopRecording() {
    recording = false;
    recordBtn.classList.remove("recording");
    recordBtn.textContent = "Record new shortcut";
  }

  recordBtn.addEventListener("click", () => {
    recording = true;
    recordBtn.classList.add("recording");
    recordBtn.textContent = "Press the new shortcut…";
    setStatus("Press the key combination you want. Escape cancels.");
    recordBtn.focus();
  });

  recordBtn.addEventListener("blur", () => {
    if (recording) {
      stopRecording();
      setStatus("");
    }
  });

  document.addEventListener(
    "keydown",
    async (e) => {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();
      if (S.isModifierCode(e.code)) return; // wait for the main key
      if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        stopRecording();
        setStatus("Cancelled.");
        return;
      }
      const sc = S.fromEvent(e);
      if (!S.isAllowed(sc)) {
        setStatus(`${S.format(sc)} isn't allowed: include Ctrl, Alt or Cmd (or use an F-key).`, true);
        return;
      }
      stopRecording();
      await S.save(sc);
      show(sc);
      setStatus(`Saved. Press ${S.format(sc)} in Maximo to open the search box.`);
    },
    true
  );

  resetBtn.addEventListener("click", async () => {
    stopRecording();
    await S.reset();
    show(S.DEFAULT);
    setStatus(`Saved. Shortcut reset to ${S.format(S.DEFAULT)}.`);
  });

  resetBtn.textContent = `Reset to ${S.format(S.DEFAULT)}`;
  S.load().then(show);
  S.onChange(show);
})();

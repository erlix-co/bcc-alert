(() => {
  const STORAGE_KEY = "vrg_blocked_count";
  const DEBUG_KEY = "vrg_debug";

  const t = (key) => chrome.i18n.getMessage(key) || key;

  const statsLineEl = document.getElementById("statsLine");
  const titleEl = document.getElementById("title");
  const resetBtnEl = document.getElementById("resetBtn");
  const debugToggleEl = document.getElementById("debugToggle");
  const debugLabelEl = document.getElementById("debugLabel");

  const renderStatsLine = (count) => {
    const n = String(Math.max(0, Math.floor(Number(count) || 0)));
    statsLineEl.textContent = "";
    statsLineEl.append(
      document.createTextNode(t("popupStatsBefore")),
      Object.assign(document.createElement("span"), {
        className: "popup-stat-number",
        textContent: n
      }),
      document.createTextNode(t("popupStatsAfter"))
    );
  };

  const render = (count, debug) => {
    titleEl.textContent = t("popupTitle");
    renderStatsLine(count);
    resetBtnEl.textContent = t("popupResetButton");
    if (typeof debug === "boolean") {
      debugToggleEl.checked = debug;
    }
  };

  const loadCount = () =>
    new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY, DEBUG_KEY], (data) => {
        resolve({
          count: Number(data?.[STORAGE_KEY] || 0),
          debug: Boolean(data?.[DEBUG_KEY])
        });
      });
    });

  const saveCount = (count) =>
    new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: count }, () => resolve());
    });

  resetBtnEl.addEventListener("click", async () => {
    await saveCount(0);
    const { debug } = await loadCount();
    render(0, debug);
  });

  debugToggleEl.addEventListener("change", () => {
    chrome.storage.local.set({ [DEBUG_KEY]: debugToggleEl.checked });
  });

  loadCount().then(({ count, debug }) => {
    debugLabelEl.textContent = t("popupDebugLabel");
    debugToggleEl.checked = debug;
    render(count, debug);
  });
})();

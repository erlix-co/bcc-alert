(() => {
  const STORAGE_KEY = "vrg_blocked_count";

  const t = (key) => chrome.i18n.getMessage(key) || key;

  const counterEl = document.getElementById("counter");
  const titleEl = document.getElementById("title");
  const labelEl = document.getElementById("label");
  const resetBtnEl = document.getElementById("resetBtn");

  const render = (count) => {
    titleEl.textContent = t("popupTitle");
    labelEl.textContent = t("popupCounterLabel");
    resetBtnEl.textContent = t("popupResetButton");
    counterEl.textContent = String(count);
  };

  const loadCount = () =>
    new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (data) => {
        resolve(Number(data?.[STORAGE_KEY] || 0));
      });
    });

  const saveCount = (count) =>
    new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: count }, () => resolve());
    });

  resetBtnEl.addEventListener("click", async () => {
    await saveCount(0);
    render(0);
  });

  loadCount().then(render);
})();

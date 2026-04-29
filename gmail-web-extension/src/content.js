(() => {
  const STORAGE_KEY = "vrg_blocked_count";

  let lastDialog = null;
  let lastSendBtn = null;

  const getBlockedCount = () =>
    new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (data) => {
        resolve(Number(data?.[STORAGE_KEY] || 0));
      });
    });

  const incrementBlockedCount = () =>
    new Promise((resolve) => {
      getBlockedCount().then((count) => {
        const next = count + 1;
        chrome.storage.local.set({ [STORAGE_KEY]: next }, () => resolve(next));
      });
    });

  const isBccChip = (el) => {
    let current = el;
    while (current) {
      const text = (current.innerText || "").trim();
      if (
        text === "\u05e2\u05d5\u05ea\u05e7 \u05de\u05d5\u05e1\u05ea\u05e8:" ||
        text === "Bcc:" ||
        text.includes("\u05e2\u05d5\u05ea\u05e7 \u05de\u05d5\u05e1\u05ea\u05e8") ||
        text.includes("Bcc")
      ) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  };

  const countChips = (dialog) => {
    const all = Array.from(dialog.querySelectorAll("span[email][data-hovercard-id]"));
    const visible = all.filter((el) => !isBccChip(el));
    const unique = new Set();

    visible.forEach((el) => {
      const email = (el.getAttribute("email") || el.getAttribute("data-hovercard-id") || "")
        .trim()
        .toLowerCase();
      if (email.includes("@")) unique.add(email);
    });

    return { toCc: unique.size, bcc: all.length - visible.length };
  };

  const createPopup = async (dialog, onContinue) => {
    const blockedCount = await incrementBlockedCount();

    const popup = document.createElement("div");
    popup.innerHTML =
      "<strong>\u05e9\u05d9\u05dd \u05dc\u05d1! \u05d4\u05e0\u05da \u05e9\u05d5\u05dc\u05d7 \u05dc\u05de\u05e1\u05e4\u05e8 \u05e0\u05de\u05e2\u05e0\u05d9\u05dd \u05d1\u05d0\u05d5\u05e4\u05df \u05d7\u05e9\u05d5\u05e3. \u05e9\u05e7\u05d5\u05dc \u05dc\u05d4\u05e9\u05ea\u05de\u05e9 \u05d1\u05e2\u05d5\u05ea\u05e7 \u05de\u05d5\u05e1\u05ea\u05e8.</strong><br><br>" +
      "<div style='font-size:12px;color:#57606a;margin-bottom:10px'>\u05e2\u05d3 \u05d4\u05d9\u05d5\u05dd \u05e0\u05de\u05e0\u05e2\u05d5 \u05de\u05de\u05da " +
      blockedCount +
      " \u05e4\u05e2\u05de\u05d9\u05dd \u05e9\u05dc\u05d9\u05d7\u05d4 \u05d2\u05dc\u05d5\u05d9\u05d4 \u05dc\u05de\u05e1\u05e4\u05e8 \u05e0\u05de\u05e2\u05e0\u05d9\u05dd.</div>" +
      "<button id='vrg-send-anyway'>\u05e9\u05dc\u05d7 \u05d1\u05db\u05dc \u05d6\u05d0\u05ea</button> <button id='vrg-back'>\u05d7\u05d6\u05d5\u05e8</button>";

    Object.assign(popup.style, {
      position: "fixed",
      top: "30px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#fff",
      color: "#000",
      padding: "15px 20px",
      border: "2px solid #d1242f",
      borderRadius: "10px",
      fontSize: "16px",
      fontWeight: "bold",
      textAlign: "center",
      boxShadow: "0 0 10px rgba(0,0,0,0.2)",
      zIndex: "2147483647"
    });

    document.body.appendChild(popup);

    popup.querySelector("#vrg-send-anyway").onclick = () => {
      dialog.dataset.vrgForceSend = "true";
      popup.remove();
      onContinue();
    };

    popup.querySelector("#vrg-back").onclick = () => {
      popup.remove();
    };
  };

  const isSendButton = (btn) => {
    const txt = (btn.innerText || btn.getAttribute("aria-label") || "").trim().toLowerCase();
    return txt === "send" || txt === "\u05e9\u05dc\u05d9\u05d7\u05d4" || txt === "\u05e9\u05dc\u05d7";
  };

  const hookSendButton = () => {
    const buttons = Array.from(document.querySelectorAll("div[role='button'], button"));

    buttons.forEach((sendBtn) => {
      if (!isSendButton(sendBtn)) return;
      if (sendBtn.dataset.vrgAttached === "true") return;

      sendBtn.dataset.vrgAttached = "true";

      sendBtn.addEventListener(
        "click",
        (e) => {
          const dialog = sendBtn.closest("div[role='dialog']");
          if (!dialog) return;

          lastDialog = dialog;
          lastSendBtn = sendBtn;

          const { toCc } = countChips(dialog);

          if (toCc > 1 && !dialog.dataset.vrgForceSend) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            createPopup(dialog, () => sendBtn.click());
          }
        },
        true
      );
    });
  };

  // Empty-message specific fix: Gmail uses window.confirm before send.
  const originalConfirm = window.confirm.bind(window);
  window.confirm = (message) => {
    const msg = String(message || "").toLowerCase();
    const isEmptyMessagePrompt =
      msg.includes("without") ||
      msg.includes("subject") ||
      msg.includes("body") ||
      msg.includes("\u05d1\u05d2\u05d5\u05e3 \u05d4\u05d4\u05d5\u05d3\u05e2\u05d4") ||
      msg.includes("\u05e0\u05d5\u05e9\u05d0");

    if (!isEmptyMessagePrompt) {
      return originalConfirm(message);
    }

    const dialog = lastDialog;
    if (!dialog) {
      return originalConfirm(message);
    }

    const { toCc } = countChips(dialog);

    if (dialog.dataset.vrgForceSend === "true") {
      dialog.dataset.vrgForceSend = "";
      return originalConfirm(message);
    }

    if (toCc > 1) {
      setTimeout(() => {
        createPopup(dialog, () => {
          dialog.dataset.vrgForceSend = "true";
          if (lastSendBtn) lastSendBtn.click();
        });
      }, 0);
      return false;
    }

    return originalConfirm(message);
  };

  if (!window.location.hostname.includes("mail.google.com")) return;
  hookSendButton();
  setInterval(hookSendButton, 1000);
})();
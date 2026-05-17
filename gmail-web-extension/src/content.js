(() => {
  if (!window.location.hostname.includes("mail.google.com")) return;

  console.log("✅ BCC base rebuilt loaded");

  const STORAGE_KEY = "vrg_blocked_count";
  const DEBUG_KEY = "vrg_debug";

  let blockedCountCache = 0;
  let vrgDebug = false;

  // Global one-shot bypass (robust even if Gmail swaps compose DOM)
  let forceSendGlobalOnce = false;
  let forceSendBypassUntilMs = 0;

  const dlog = (...args) => {
    if (vrgDebug) console.log("[VRG]", ...args);
  };

  chrome.storage.local.get([STORAGE_KEY, DEBUG_KEY], (data) => {
    blockedCountCache = Number(data?.[STORAGE_KEY] || 0);
    vrgDebug = Boolean(data?.[DEBUG_KEY]);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.prototype.hasOwnProperty.call(changes, DEBUG_KEY)) return;
    vrgDebug = Boolean(changes[DEBUG_KEY].newValue);
  });

  const bumpBlockedCountSync = () => {
    blockedCountCache += 1;
    chrome.storage.local.set({ [STORAGE_KEY]: blockedCountCache });
    return blockedCountCache;
  };

  function isChipUiVisible(el) {
    if (!(el instanceof Element)) return false;
    if (typeof el.getClientRects !== "function") return false;
    const rects = el.getClientRects();
    if (!rects || rects.length === 0) return false;
    const st = window.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    const op = parseFloat(st.opacity === "" ? "1" : st.opacity);
    if (op < 0.05) return false;
    return true;
  }

  /** Avoid double-counting when Gmail leaves duplicate chip nodes for the same address. */
  function uniqChipsByRecipientKey(chips) {
    const seen = new Set();
    const out = [];
    for (const el of chips) {
      const key = String(el.getAttribute?.("email") || el.getAttribute?.("data-hovercard-id") || "")
        .trim()
        .toLowerCase();
      if (!key) {
        out.push(el);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(el);
    }
    return out;
  }

  function isToOrCcFieldLabel(label) {
    const s = String(label || "").trim();
    if (!s) return false;
    if (/\b(bcc|עותק מוסתר)\b/i.test(s)) return false;
    if (/^\s*(to|cc)\b/i.test(s)) return true;
    if (/^\s*(אל|עותק)\b/.test(s)) return true;
    if (/^\s*(נמענים|נמען)\b/.test(s)) return true;
    return false;
  }

  function recipientFieldRow(el) {
    if (!(el instanceof Element)) return null;
    return (
      el.closest("tr") ||
      el.closest("[data-recipient-context]") ||
      el.closest("div[role='list']")?.parentElement ||
      el.parentElement?.parentElement ||
      el
    );
  }

  /** To/Cc input rows only — avoids counting thread hovercards in plain Reply. */
  function findComposeRecipientRoots(dialog) {
    const roots = new Set();
    const add = (el) => {
      const row = recipientFieldRow(el);
      if (row && dialog.contains(row)) roots.add(row);
    };

    dialog.querySelectorAll('[name="to"], [name="cc"]').forEach(add);

    dialog.querySelectorAll('[role="textbox"]').forEach((tb) => {
      if (isToOrCcFieldLabel(tb.getAttribute("aria-label"))) add(tb);
    });

    dialog.querySelectorAll("[aria-label]").forEach((node) => {
      const aria = node.getAttribute("aria-label");
      if (!isToOrCcFieldLabel(aria)) return;
      if (node.matches?.('[role="textbox"], [name="to"], [name="cc"], input')) add(node);
    });

    return Array.from(roots);
  }

  function collectVisibleChipsInScope(scope) {
    const seen = new Set();
    const chips = [];
    const addKey = (key, el) => {
      const k = String(key || "").trim().toLowerCase();
      if (!k) return;
      if (seen.has(k)) return;
      seen.add(k);
      chips.push(el);
    };

    const selectors = [
      "span[email][data-hovercard-id]",
      "[email][data-hovercard-id]",
      "span[email]",
      "[data-hovercard-id]"
    ];
    for (const sel of selectors) {
      for (const el of scope.querySelectorAll(sel)) {
        if (!isChipUiVisible(el) || isBccChip(el)) continue;
        addKey(el.getAttribute?.("email") || el.getAttribute?.("data-hovercard-id"), el);
      }
    }

    for (const a of scope.querySelectorAll('a[href^="mailto:"]')) {
      if (!isChipUiVisible(a) || isBccChip(a)) continue;
      const href = String(a.getAttribute("href") || "");
      const email = href.replace(/^mailto:/i, "").split("?")[0].trim();
      addKey(email, a);
    }

    return chips;
  }

  function countChipsInRecipientFields(dialog) {
    const roots = findComposeRecipientRoots(dialog);
    if (roots.length === 0) return null;

    const chips = uniqChipsByRecipientKey(
      roots.flatMap((root) => collectVisibleChipsInScope(root))
    );
    const visible = chips.filter((el) => !isBccChip(el));
    const bccOnly = chips.length - visible.length;
    return { toCc: visible.length, bcc: bccOnly };
  }

  function isBccChip(el) {
    let current = el;
    for (let i = 0; i < 12 && current; i++) {
      const text = String(current.innerText || "").trim();
      const aria = String(current.getAttribute?.("aria-label") || "").trim();
      const name = String(current.getAttribute?.("name") || "").trim().toLowerCase();
      const dataName = String(current.getAttribute?.("data-name") || "").trim().toLowerCase();

      // Prefer structural hints first.
      if (name === "bcc" || dataName === "bcc") return true;
      if (/^\s*(bcc|עותק מוסתר)\s*:?\s*$/i.test(aria)) return true;
      // Gmail labels the Bcc row/field as "Bcc" or "Bcc - user@…" (not only exact-match strings).
      if (/\b(bcc|עותק מוסתר)\b/i.test(aria)) return true;

      // Text fallback: strict label match only (no broad includes that misclassifies To/Cc rows).
      if (/^\s*(bcc|עותק מוסתר)\s*:?\s*$/i.test(text)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function countChips(dialog) {
    // Reply-all: multiple visible addresses live in To/Cc rows; a whole-compose scan can
    // return 1 chip while Cc (or alternate chip markup) holds the rest.
    const fieldScoped = countChipsInRecipientFields(dialog);
    if (fieldScoped && fieldScoped.toCc > 0) {
      dlog("field-scoped count", fieldScoped);
      return fieldScoped;
    }

    // Keep base selector behavior (proven stable in user's environment)
    const all = uniqChipsByRecipientKey(
      Array.from(dialog.querySelectorAll("span[email][data-hovercard-id]")).filter(isChipUiVisible)
    );
    const visible = all.filter((el) => !isBccChip(el));
    const bccOnly = all.length - visible.length;
    if (visible.length > 1) return { toCc: visible.length, bcc: bccOnly };
    // When Gmail shows at least one real To/Cc chip, trust that count. A broad [data-hovercard-id]
    // scan would also match thread/message cards in Reply and falsely trip multi-recipient warnings.
    if (visible.length > 0) return { toCc: visible.length, bcc: bccOnly };

    // Minimal fallback for "Reply all" layouts where chips are not span[email][data-hovercard-id].
    const anyHover = uniqChipsByRecipientKey(
      Array.from(dialog.querySelectorAll("[data-hovercard-id]")).filter(isChipUiVisible)
    );
    const anyVisible = anyHover.filter((el) => !isBccChip(el));
    const anyBccOnly = anyHover.length - anyVisible.length;
    if (anyVisible.length > 1) return { toCc: anyVisible.length, bcc: anyBccOnly };
    return { toCc: Math.max(visible.length, anyVisible.length), bcc: Math.max(bccOnly, anyBccOnly) };
  }

  function removePopup() {
    const p = document.getElementById("vrg-popup");
    if (p) p.remove();
  }

  function createPopup(dialog, onContinue) {
    if (document.getElementById("vrg-popup")) return;
    const blockedCount = bumpBlockedCountSync();
    const logoUrl = chrome.runtime.getURL("src/assets/bcc-alert-logo.png");

    const popup = document.createElement("div");
    popup.id = "vrg-popup";
    popup.innerHTML =
      `<div style="margin-bottom:8px;"><img src="${logoUrl}" alt="BCC Alert" style="max-width:220px;height:auto;" /></div>` +
      "<strong>🚨 נמצאו יותר מנמען אחד גלוי – שקול להשתמש בעותק מוסתר!</strong><br><br>" +
      `<div style="font-size:12px;color:#555;margin-bottom:10px;">נמנעו עד כה ${String(
        blockedCount
      )} שליחות גלויות.</div>` +
      "<button id='bcc-continue'>שלח בכל זאת</button> <button id='bcc-cancel'>חזור</button>" +
      "<div style='margin-top:10px;font-size:12px;color:#444;'>מופעל על ידי <a href='https://erlix.net/' target='_blank' rel='noopener noreferrer' style='color:#0b57d0;text-decoration:underline;'>erlix.net</a></div>";

    Object.assign(popup.style, {
      position: "fixed",
      top: "30px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#f2f2f2",
      color: "#000",
      padding: "15px 20px",
      border: "4px solid #f00",
      borderRadius: "10px",
      fontSize: "16px",
      fontWeight: "bold",
      textAlign: "center",
      boxShadow: "0 0 10px rgba(0,0,0,0.2)",
      zIndex: "999999"
    });

    document.body.appendChild(popup);

    const continueBtn = document.getElementById("bcc-continue");
    const cancelBtn = document.getElementById("bcc-cancel");

    if (continueBtn) {
      Object.assign(continueBtn.style, {
        background: "#d32f2f",
        color: "#fff",
        border: "1px solid #b71c1c",
        borderRadius: "6px",
        padding: "6px 10px",
        cursor: "pointer"
      });
      continueBtn.onclick = () => {
        forceSendGlobalOnce = true;
        forceSendBypassUntilMs = Date.now() + 2500;
        dialog.dataset.bccForceSend = "true";
        removePopup();
        onContinue();
      };
    }
    if (cancelBtn) {
      Object.assign(cancelBtn.style, {
        background: "#2e7d32",
        color: "#fff",
        border: "1px solid #1b5e20",
        borderRadius: "6px",
        padding: "6px 10px",
        cursor: "pointer",
        marginInlineStart: "8px"
      });
      cancelBtn.onclick = () => {
        removePopup();
      };
    }
  }

  function isSendButton(btn) {
    if (!btn || btn.nodeType !== 1) return false;
    const aria = String(btn.getAttribute("aria-label") || "").trim().toLowerCase();
    const text = String(btn.innerText || "").trim().toLowerCase();
    const combined = `${aria} ${text}`;

    if (
      /(discard|delete|trash|close|cancel|שמירה וסגירה|סגירה|מחיקה|ביטול)/i.test(combined)
    ) {
      return false;
    }
    if (combined.includes("schedule send") || combined.includes("תזמון שליחה")) return false;
    if (text === "send" || text === "שליחה" || text === "שלח") return true;
    if (aria === "send" || aria.startsWith("send ")) return true;
    if (aria.includes("ctrl") && (aria.includes("send") || aria.includes("שליחה") || aria.includes("שלח"))) {
      return true;
    }
    return false;
  }

  function resolveComposeContainer(sendBtn) {
    if (!sendBtn || sendBtn.nodeType !== 1) return null;

    // Prefer the tightest compose scope around this send button (prevents counting thread recipients in Reply).
    let bestScope = null;
    let bestArea = Infinity;
    let cur = sendBtn;
    for (let i = 0; i < 40 && cur; i++) {
      if (cur.querySelector) {
        const hasComposeBody = !!cur.querySelector("div[role='textbox'][g_editable='true']");
        const hasActionButtons = !!cur.querySelector("div[role='button'], button");
        const hasRecipientSignals = !!cur.querySelector(
          "span[email][data-hovercard-id], [data-hovercard-id], [email], [data-recipient-context], a[href^='mailto:']"
        );
        if (hasComposeBody && hasActionButtons && hasRecipientSignals) {
          const r = cur.getBoundingClientRect?.();
          if (r && r.width > 120 && r.height > 80) {
            const area = r.width * r.height;
            if (area < bestArea) {
              bestArea = area;
              bestScope = cur;
            }
          }
        }
      }
      cur = cur.parentElement;
    }
    if (bestScope) return bestScope;

    const dialog = sendBtn.closest("div[role='dialog']");
    if (dialog) return dialog;

    // Reply/Forward inline compose is often not wrapped in role=dialog.
    cur = sendBtn;
    for (let i = 0; i < 35 && cur; i++) {
      if (
        cur.querySelector?.("span[email][data-hovercard-id]") &&
        cur.querySelector?.("div[role='button'], button")
      ) {
        return cur;
      }
      cur = cur.parentElement;
    }

    // Windowed/non-fullscreen Gmail can place send button and recipients in sibling branches.
    // Fallback: nearest visible compose-like dialog by geometry.
    if (sendBtn.getBoundingClientRect) {
      const sr = sendBtn.getBoundingClientRect();
      const scx = (sr.left + sr.right) / 2;
      const scy = (sr.top + sr.bottom) / 2;
      let best = null;
      let bestScore = Infinity;
      const dialogs = Array.from(document.querySelectorAll("div[role='dialog']")).filter(
        (d) => d && d.offsetParent !== null
      );
      for (const d of dialogs) {
        const hasComposeSignals =
          d.querySelector?.("span[email][data-hovercard-id], [data-hovercard-id], [name='subjectbox']") ||
          d.querySelector?.("div[role='button'], button");
        if (!hasComposeSignals) continue;
        const dr = d.getBoundingClientRect?.();
        if (!dr || dr.width < 120 || dr.height < 80) continue;
        const dcx = (dr.left + dr.right) / 2;
        const dcy = (dr.top + dr.bottom) / 2;
        const dist = Math.hypot(scx - dcx, scy - dcy);
        const inside =
          scx >= dr.left - 24 && scx <= dr.right + 24 && scy >= dr.top - 24 && scy <= dr.bottom + 24;
        const score = dist - (inside ? 400 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = d;
        }
      }
      if (best) return best;
    }

    return null;
  }

  function handleSendClick(e, sendBtn) {
    const dialog = resolveComposeContainer(sendBtn);
    if (!dialog) return;

    if (Date.now() < forceSendBypassUntilMs) {
      dlog("skip: bypass window");
      return;
    }
    if (forceSendGlobalOnce) {
      forceSendGlobalOnce = false;
      forceSendBypassUntilMs = Date.now() + 2000;
      dlog("skip: forceSendGlobalOnce");
      return;
    }

    if (dialog.dataset.bccForceSend === "true") {
      delete dialog.dataset.bccForceSend;
      dlog("skip: dialog forceSend one-shot");
      return;
    }

    const { toCc, bcc } = countChips(dialog);
    dlog("Final smart count", { toCc, bcc });

    if (toCc > 1) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      createPopup(dialog, () => sendBtn.click());
    }
  }

  function hookSendButtons() {
    const buttons = Array.from(document.querySelectorAll("div[role='button'], button"));
    for (const sendBtn of buttons) {
      if (!isSendButton(sendBtn)) continue;
      if (sendBtn.dataset.bccAttached === "true") continue;

      sendBtn.dataset.bccAttached = "true";
      dlog("Hooked send button");
      sendBtn.addEventListener(
        "click",
        (e) => {
          handleSendClick(e, sendBtn);
        },
        true
      );
    }
  }

  function onClickCapture(e) {
    if (e.button !== 0 && e.button !== undefined) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    const btn = t.closest?.("div[role='button'], button");
    if (!btn || !isSendButton(btn)) return;
    // Ensure dynamic buttons in Reply all are intercepted even before interval hook runs.
    if (btn.dataset.bccAttached !== "true") {
      btn.dataset.bccAttached = "true";
      btn.addEventListener(
        "click",
        (evt) => {
          handleSendClick(evt, btn);
        },
        true
      );
    }
    handleSendClick(e, btn);
  }

  // Keep base behavior (polling), but faster initial reaction + robust to DOM churn
  hookSendButtons();
  setInterval(hookSendButtons, 800);
  document.addEventListener("click", onClickCapture, true);
})();

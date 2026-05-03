(() => {
  if (!window.location.hostname.includes("mail.google.com")) {
    return;
  }

  const STORAGE_KEY = "vrg_blocked_count";
  const DEBUG_KEY = "vrg_debug";

  let blockedCountCache = 0;
  let vrgDebug = false;

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
    if (vrgDebug) console.log("[VRG]", "debug on");
  });

  let lastComposeRoot = null;
  let lastSendBtn = null;
  let popupOpen = false;

  const persistBlockedCount = () => {
    chrome.storage.local.set({ [STORAGE_KEY]: blockedCountCache });
  };

  const bumpBlockedCountSync = () => {
    blockedCountCache += 1;
    persistBlockedCount();
    return blockedCountCache;
  };

  const isVisible = (el) =>
    !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

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

  const isRecipientChip = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (!el.hasAttribute("data-hovercard-id")) return false;
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const txt = (el.innerText || "").toLowerCase();
    const hid = (el.getAttribute("data-hovercard-id") || "").trim().toLowerCase();
    return hid.includes("@") || aria.includes("@") || txt.includes("@");
  };

  const extractEmailFromChip = (chip) => {
    const fromAttr = (chip.getAttribute("email") || chip.getAttribute("data-hovercard-id") || "")
      .trim()
      .toLowerCase();
    if (fromAttr.includes("@")) return fromAttr;
    const aria = chip.getAttribute("aria-label") || "";
    const txt = chip.innerText || "";
    const m1 = aria.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const m2 = txt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return (m1 && m1[0].toLowerCase()) || (m2 && m2[0].toLowerCase()) || null;
  };

  const extractEmailFromElement = (el) => {
    if (!el || el.nodeType !== 1) return null;
    const fromChip = extractEmailFromChip(el);
    if (fromChip) return fromChip;
    const href = (el.getAttribute("href") || "").trim();
    if (href.toLowerCase().startsWith("mailto:")) {
      const raw = decodeURIComponent(href.slice(7).split("?")[0])
        .trim()
        .toLowerCase();
      if (raw.includes("@")) return raw;
    }
    const drc = (el.getAttribute("data-recipient-context") || "").trim();
    if (drc) {
      try {
        const j = JSON.parse(drc);
        const cand = j?.email || j?.address || j?.name;
        if (typeof cand === "string" && cand.includes("@")) {
          const m = cand.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
          if (m) return m[0].toLowerCase();
        }
      } catch {
        const m = drc.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        if (m) return m[0].toLowerCase();
      }
    }
    return null;
  };

  /** Looser than `isRecipientChip` — Forward inline may use `span[email]` without hovercard id. */
  const isDomWalkRecipientCandidate = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (isBccChip(el)) return false;
    const emAttr = (el.getAttribute("email") || "").trim().toLowerCase();
    if (emAttr.includes("@")) return true;
    if (el.matches && el.matches("a[href^='mailto:'], a[href^='MAILTO:']")) return true;
    if (el.hasAttribute("data-hovercard-id")) return isRecipientChip(el);
    if (el.matches && el.matches("span[email]")) return true;
    if (el.hasAttribute("data-recipient-context")) return true;
    const sen = (el.getAttribute("data-sentinel") || "").toLowerCase();
    if (sen.includes("@")) return true;
    return false;
  };

  const emailsFromNamedRecipientInputs = (root) => {
    const set = new Set();
    if (!root?.querySelectorAll) return set;
    for (const inp of root.querySelectorAll(
      'input[name="to"], input[name="cc"], textarea[name="to"], textarea[name="cc"]'
    )) {
      const v = (inp.value || "").trim();
      if (!v) continue;
      for (const part of v.split(/[,;\n\r]+/).map((x) => x.trim()).filter(Boolean)) {
        const m = part.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
        if (m) m.forEach((e) => set.add(e.toLowerCase()));
      }
    }
    return set;
  };

  const RECIPIENT_DOM_SEL =
    "[data-hovercard-id], [data-recipient-context], [data-sentinel], [email], span[email], span[email][data-hovercard-id], a[href^='mailto:'], a[href^='MAILTO:']";

  /**
   * Collect emails under `root` for DOM-walk / legacy merge: hovercard, recipient-context,
   * `span[email]`, mailto — excludes blockquote / Bcc.
   */
  const emailsFromChipNodesIn = (root) => {
    const set = new Set();
    if (!root || !root.querySelectorAll) return set;
    for (const c of root.querySelectorAll(RECIPIENT_DOM_SEL)) {
      if (!c || c.nodeType !== 1) continue;
      if (c.closest("blockquote")) continue;
      if (!isDomWalkRecipientCandidate(c)) continue;
      const em = extractEmailFromElement(c);
      if (em) set.add(em.toLowerCase());
    }
    emailsFromNamedRecipientInputs(root).forEach((em) => set.add(em));
    return set;
  };

  const chipNodes = (root) =>
    Array.from(root.querySelectorAll("span[data-hovercard-id]")).filter((el) => {
      if (!el || el.nodeType !== 1) return false;
      if (el.closest("blockquote")) return false;
      const raw = (el.getAttribute("email") || el.getAttribute("data-hovercard-id") || "")
        .trim()
        .toLowerCase();
      return raw.includes("@");
    });

  const countChips = (root) => {
    const all = chipNodes(root);
    const visible = all.filter((el) => !isBccChip(el));
    const unique = new Set();

    visible.forEach((el) => {
      const email = (el.getAttribute("email") || el.getAttribute("data-hovercard-id") || "")
        .trim()
        .toLowerCase();
      if (email.includes("@")) unique.add(email);
    });

    emailsFromChipNodesIn(root).forEach((em) => unique.add(em));

    return { toCc: unique.size, bcc: all.length - visible.length };
  };

  /** To/Cc chips above the body — avoids counting thread chips inside the same dialog (Forward). */
  const getRecipientsFromDialogHeader = (dialog) => {
    if (!dialog) return [];
    const body =
      dialog.querySelector('div[role="textbox"][g_editable="true"]') ||
      dialog.querySelector('[contenteditable="true"]');
    if (!body) return [];
    const bodyRect = body.getBoundingClientRect();
    const chips = Array.from(dialog.querySelectorAll(RECIPIENT_DOM_SEL)).filter((el) => {
      if (!el || el.nodeType !== 1) return false;
      if (el.closest("blockquote")) return false;
      if (isBccChip(el)) return false;
      if (!isDomWalkRecipientCandidate(el)) return false;
      const r = el.getBoundingClientRect();
      return r.bottom <= bodyRect.top + 12;
    });
    const emails = chips.map(extractEmailFromElement).filter(Boolean);
    return [...new Set(emails)];
  };

  const headerRecipientCount = (dialog) => getRecipientsFromDialogHeader(dialog).length;

  /**
   * Gmail surfaces many `role="dialog"` callouts (e.g. Chat history) — they must never be treated
   * as the compose window or domWalk will see zero recipients.
   */
  const isExcludedNonComposeDialog = (d) => {
    if (!d || d.nodeType !== 1) return false;
    const parts = [
      (d.innerText || "").slice(0, 1600),
      (d.getAttribute("aria-label") || ""),
      (d.getAttribute("aria-roledescription") || "")
    ];
    const lid = d.getAttribute("aria-labelledby");
    if (lid) {
      const id0 = lid.trim().split(/\s+/)[0];
      const h = id0 && document.getElementById(id0);
      if (h) parts.push(h.textContent || h.innerText || "");
    }
    const blob = parts.join("\n").toLowerCase();
    if (blob.includes("היסטוריית שיחות")) return true;
    if (/chat\s*history|conversation\s*history|history\s+of\s+your\s+chats/i.test(blob)) return true;
    return false;
  };

  const dialogHasComposeShape = (d) => {
    if (!d || d.nodeType !== 1) return false;
    if (
      d.querySelector('div[role="textbox"][g_editable="true"]') ||
      d.querySelector("[contenteditable='true']")
    ) {
      return true;
    }
    if (
      d.querySelector('[name="subjectbox"]') ||
      d.querySelector('input[name="to"], input[name="cc"], textarea[name="to"], textarea[name="cc"]')
    ) {
      return true;
    }
    const t = (d.innerText || "").slice(0, 2800);
    if (
      /\bfwd\b|forward|העברה|\bהעבר\b|reply|תשובה|\bהשב\b|מייל חדש|הודעה חדשה|new message/i.test(t)
    ) {
      return true;
    }
    if (chipNodes(d).length > 0) return true;
    if (emailsFromChipNodesIn(d).size > 0) return true;
    if (countChips(d).toCc > 0) return true;
    return false;
  };

  /** First `role=dialog` ancestor of `fromEl` that is not a known non-mail callout. */
  const nearestNonExcludedDialog = (fromEl) => {
    if (!fromEl || fromEl.nodeType !== 1) return null;
    let el = fromEl;
    for (let i = 0; i < 70 && el; i++) {
      if (el.getAttribute("role") === "dialog" && !isExcludedNonComposeDialog(el)) return el;
      el = el.parentElement;
    }
    return null;
  };

  const getOpenComposeDialogs = () =>
    Array.from(document.querySelectorAll("div[role='dialog']")).filter((d) => {
      if (isExcludedNonComposeDialog(d)) return false;
      if (!isVisible(d)) return false;
      const h = d.getBoundingClientRect().height;
      if (h < 40) return false;
      return dialogHasComposeShape(d);
    });

  const getActiveComposeDialog = (evt, sendBtn) => {
    const open = getOpenComposeDialogs();
    if (!open.length) return null;
    const t = evt?.target;
    if (t && t.nodeType === 1) {
      const near = nearestNonExcludedDialog(t);
      if (near && open.includes(near)) return near;
    }
    if (sendBtn && sendBtn.nodeType === 1) {
      const fromSend = nearestNonExcludedDialog(sendBtn);
      if (fromSend && open.includes(fromSend)) return fromSend;
    }
    return open[open.length - 1];
  };

  const probeDebug = (root) => ({
    dialogs: getOpenComposeDialogs().length,
    dialogsRaw: document.querySelectorAll("div[role='dialog']").length,
    hasRoot: !!root,
    headerN: root && root.getAttribute("role") === "dialog" ? headerRecipientCount(root) : null,
    legacyToCc: root ? countChips(root).toCc : null
  });

  /** When `resolveComposeRoot` is null — why each raw `role=dialog` failed our filters (debug only). */
  const probeComposeRootFailures = (sendBtn) => {
    const raw = Array.from(document.querySelectorAll("div[role='dialog']"));
    return raw.slice(0, 8).map((d, i) => {
      const r = d.getBoundingClientRect?.();
      return {
        i,
        h: r ? Math.round(r.height) : 0,
        w: r ? Math.round(r.width) : 0,
        excluded: isExcludedNonComposeDialog(d),
        visible: isVisible(d),
        shape: dialogHasComposeShape(d),
        containsSend: !!(sendBtn && d.contains(sendBtn)),
        snip: (d.innerText || "").slice(0, 72).replace(/\s+/g, " ")
      };
    });
  };

  /** Walk up from an anchor (Send button, focused field, etc.) — Reply / inline compose without dialog. */
  const findComposeRootAnchored = (anchor) => {
    if (!anchor || anchor.nodeType !== 1) return null;

    const asDialog = nearestNonExcludedDialog(anchor);
    if (asDialog) return asDialog;

    let el = anchor;
    for (let i = 0; i < 80 && el; i++) {
      el = el.parentElement;
      if (!el || el === document.body) break;
      if (!el.contains(anchor)) continue;
      const { toCc } = countChips(el);
      if (toCc > 1) return el;
    }

    const chain = [];
    el = anchor;
    for (let i = 0; i < 55 && el; i++) {
      el = el.parentElement;
      if (!el || el === document.body) break;
      if (!el.contains(anchor)) continue;
      const { toCc } = countChips(el);
      const chipCount = chipNodes(el).length;
      if (chipCount === 0) continue;
      chain.push({ el, toCc });
    }
    if (!chain.length) return null;
    const maxToCc = Math.max(...chain.map((c) => c.toCc));
    if (maxToCc < 1) return null;
    const inner = chain.find((c) => c.toCc === maxToCc);
    return inner ? inner.el : chain[chain.length - 1].el;
  };

  const rectOverlap2d = (a, b) => {
    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (x <= 0 || y <= 0) return 0;
    return x * y;
  };

  const findComposeRootFromDialogs = (sendBtn) => {
    const dialogs = Array.from(document.querySelectorAll("div[role='dialog']")).filter(
      (d) => d.offsetParent !== null && !isExcludedNonComposeDialog(d)
    );
    if (!dialogs.length || !sendBtn) return null;

    const sr = sendBtn.getBoundingClientRect();
    const cx = (sr.left + sr.right) / 2;
    const cy = (sr.top + sr.bottom) / 2;
    let best = null;
    let bestScore = -1;

    for (const d of dialogs) {
      const { toCc: leg } = countChips(d);
      const head = headerRecipientCount(d);
      const toCc = Math.max(leg, head);
      if (toCc < 2) continue;
      const dr = d.getBoundingClientRect();
      const vOverlap = Math.min(sr.bottom, dr.bottom) - Math.max(sr.top, dr.top);
      const area = rectOverlap2d(sr, dr);
      const centerInside =
        cx >= dr.left - 24 &&
        cx <= dr.right + 24 &&
        cy >= dr.top - 24 &&
        cy <= dr.bottom + 24;
      const score = (centerInside ? 5000 : 0) + area + Math.max(0, vOverlap) * 2 + toCc * 50;
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  };

  const findComposeRootViaEditable = (sendBtn) => {
    if (!sendBtn) return null;
    const sr = sendBtn.getBoundingClientRect();
    let best = null;
    let bestScore = -1;

    for (const tb of document.querySelectorAll('div[role="textbox"][g_editable="true"]')) {
      if (!tb.offsetParent) continue;
      const tr = tb.getBoundingClientRect();
      if (tr.width < 40 || tr.height < 20) continue;

      const horiz = Math.min(sr.right, tr.right) - Math.max(sr.left, tr.left);
      if (horiz < Math.min(32, sr.width * 0.12, tr.width * 0.08)) continue;

      const gapBelowBody = sr.top - tr.bottom;
      if (gapBelowBody < -120 || gapBelowBody > 720) continue;

      const anchored = findComposeRootAnchored(tb);
      if (!anchored) continue;
      const { toCc } = countChips(anchored);
      if (toCc < 2) continue;

      const score = toCc * 1000 + horiz + Math.max(0, 400 - Math.abs(gapBelowBody));
      if (score > bestScore) {
        bestScore = score;
        best = anchored;
      }
    }
    return best;
  };

  /**
   * Forward: Send is often detached from the chip subtree; the closest compose body to Send
   * usually belongs to the same window — climb to a non–full-page ancestor with multiple chips.
   */
  const findComposeRootFromNearestEditableClimb = (sendBtn) => {
    if (!sendBtn) return null;
    const sr = sendBtn.getBoundingClientRect();
    const cx = (sr.left + sr.right) / 2;
    const cy = (sr.top + sr.bottom) / 2;
    let bestTb = null;
    let bestD = Infinity;
    for (const tb of document.querySelectorAll('div[role="textbox"][g_editable="true"]')) {
      if (!tb.offsetParent) continue;
      const tr = tb.getBoundingClientRect();
      if (tr.width < 16 || tr.height < 8) continue;
      const tcx = (tr.left + tr.right) / 2;
      const tcy = (tr.top + tr.bottom) / 2;
      const dist = Math.hypot(cx - tcx, cy - tcy);
      if (dist < bestD) {
        bestD = dist;
        bestTb = tb;
      }
    }
    if (!bestTb) return null;
    let el = bestTb;
    for (let i = 0; i < 95 && el; i++) {
      el = el.parentElement;
      if (!el || el === document.body) break;
      const { toCc } = countChips(el);
      if (toCc < 2) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.97 && r.height >= window.innerHeight * 0.94) continue;
      return el;
    }
    return nearestNonExcludedDialog(bestTb);
  };

  const composeHintScore = (root) => {
    if (!root || root.nodeType !== 1) return 0;
    const t = (root.innerText || "\n").slice(0, 4000);
    let s = 0;
    if (/\bfwd\b|forward|העברה|\bהעבר\b/i.test(t)) s += 140;
    if (/reply|תשובה|\bהשב\b/i.test(t)) s += 70;
    if (/new message|compose|\bמייל חדש|הודעה חדשה/i.test(t)) s += 45;
    return s;
  };

  const findComposeRootNearSend = (sendBtn) => {
    const sr = sendBtn?.getBoundingClientRect?.();
    if (!sendBtn || !sr?.width) return null;

    const cx = (sr.left + sr.right) / 2;
    const cy = (sr.top + sr.bottom) / 2;
    const dialogs = Array.from(document.querySelectorAll("div[role='dialog']")).filter((d) => {
      if (d.offsetParent === null || isExcludedNonComposeDialog(d)) return false;
      const h = d.getBoundingClientRect().height;
      return h > 90;
    });
    if (!dialogs.length) return null;

    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const d of dialogs) {
      const looksCompose = dialogHasComposeShape(d) || composeHintScore(d) >= 45;
      if (!looksCompose) continue;

      const dr = d.getBoundingClientRect();
      const area = rectOverlap2d(sr, dr);
      const centerInside =
        cx >= dr.left - 48 &&
        cx <= dr.right + 48 &&
        cy >= dr.top - 72 &&
        cy <= dr.bottom + 96;
      const dcx = (dr.left + dr.right) / 2;
      const dist = Math.hypot(cx - dcx, cy - (dr.top + dr.bottom) / 2);
      const near =
        cy >= dr.top - 140 &&
        cy <= dr.bottom + 140 &&
        Math.abs(cx - dcx) < Math.max(dr.width, 720) * 0.52;

      if (!centerInside && area < 250 && !near) continue;

      const { toCc } = countChips(d);
      const score =
        (centerInside ? 14000 : 0) +
        (near ? 5500 : 0) +
        area * 1.5 +
        composeHintScore(d) +
        toCc * 220 -
        dist * 0.12;

      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }

    return bestScore > 2600 ? best : null;
  };

  const pickBestComposeRoot = (sendBtn) => {
    const candidates = [];
    const a1 = findComposeRootAnchored(sendBtn);
    if (a1) candidates.push(a1);
    const a2 = findComposeRootFromDialogs(sendBtn);
    if (a2) candidates.push(a2);
    const a4 = findComposeRootViaEditable(sendBtn);
    if (a4) candidates.push(a4);
    const a6 = findComposeRootFromNearestEditableClimb(sendBtn);
    if (a6 && !candidates.includes(a6)) candidates.push(a6);

    const active = document.activeElement;
    if (active && active.nodeType === 1 && active !== sendBtn) {
      const a3 = findComposeRootAnchored(active);
      if (a3 && !candidates.includes(a3)) candidates.push(a3);
    }

    if (!candidates.length) {
      const a5 = findComposeRootNearSend(sendBtn);
      if (a5) candidates.push(a5);
    }

    if (!candidates.length) return null;

    let best = candidates[0];
    let bestToCc = countChips(best).toCc;
    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i];
      const t = countChips(c).toCc;
      if (t > bestToCc) {
        best = c;
        bestToCc = t;
      } else if (t === bestToCc && c.contains(best)) {
        best = c;
      }
    }
    return best;
  };

  /**
   * Recipient count for intercept: dialog → max(header-above-body, capped legacy) so Forward stays
   * accurate without 98-chip blowups; non-dialog / inline → legacy countChips on picked root.
   */
  const visibleToCcForRoot = (root) => {
    if (!root) return 0;
    if (root.getAttribute("role") === "dialog") {
      const h = headerRecipientCount(root);
      if (h >= 2) return h;
      const leg = countChips(root).toCc;
      if (leg >= 2 && leg <= 32) return leg;
      return h;
    }
    let best = countChips(root).toCc;
    let el = root.parentElement;
    for (let i = 0; i < 10 && el && el !== document.body; i++) {
      best = Math.max(best, countChips(el).toCc);
      el = el.parentElement;
    }
    return Math.min(best, 36);
  };

  /**
   * Walk from Send (or click target) up the tree; prefer the smallest ancestor with 2–24
   * recipients so we do not latch onto `body` with dozens of inbox chips (PGT / RTL-safe).
   */
  const walkUpRecipientEmailsFrom = (start) => {
    if (!start || start.nodeType !== 1) return [];
    let best = [];
    let bestLen = Infinity;
    let bestDepth = Infinity;
    let el = start;
    for (let depth = 0; depth < 95 && el && el !== document.documentElement; depth++) {
      const emails = [...emailsFromChipNodesIn(el)];
      const n = emails.length;
      if (n >= 2 && n <= 24) {
        if (n < bestLen || (n === bestLen && depth < bestDepth)) {
          best = emails;
          bestLen = n;
          bestDepth = depth;
        }
      }
      el = el.parentElement;
    }
    return best.length >= 2 ? best : [];
  };

  const findRecipientEmailsDomWalk = (sendBtn, evtTarget) => {
    const seeds = [];
    if (sendBtn?.nodeType === 1) seeds.push(sendBtn);
    const dlg = nearestNonExcludedDialog(sendBtn);
    if (dlg && dlg !== sendBtn) seeds.push(dlg);
    if (evtTarget?.nodeType === 1 && evtTarget !== sendBtn && !seeds.includes(evtTarget)) {
      seeds.push(evtTarget);
    }
    let best = [];
    for (const s of seeds) {
      const arr = walkUpRecipientEmailsFrom(s);
      if (arr.length > best.length) best = arr;
    }
    return best.length >= 2 ? best : [];
  };

  const pointInRect = (x, y, r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

  const expandComposeSearchRect = (composeRoot, sendBtn) => {
    const rects = [];
    const cr = composeRoot?.getBoundingClientRect?.();
    const sr = sendBtn?.getBoundingClientRect?.();
    if (cr && cr.width > 4 && cr.height > 4) rects.push(cr);
    if (sr && sr.width > 4) rects.push(sr);
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return {
      left: left - 100,
      right: right + 100,
      top: top - 360,
      bottom: bottom + 140
    };
  };

  /** Forward inline: To/Cc may sit outside composeRoot — count chips in an expanded band around compose + Send. */
  const countRecipientsFallbackNearby = (composeRoot, sendBtn) => {
    const zone = expandComposeSearchRect(composeRoot, sendBtn);
    if (!zone) return 0;
    const set = new Set();
    for (const el of document.querySelectorAll(RECIPIENT_DOM_SEL)) {
      if (!el || el.nodeType !== 1) continue;
      if (el.closest("blockquote")) continue;
      const r = el.getBoundingClientRect();
      const mx = (r.left + r.right) / 2;
      const my = (r.top + r.bottom) / 2;
      if (!pointInRect(mx, my, zone)) continue;
      if (!isDomWalkRecipientCandidate(el) || isBccChip(el)) continue;
      const em = extractEmailFromElement(el);
      if (em) set.add(em);
    }
    return set.size;
  };

  /** Narrow vertical band around Send (main compose column), still avoids most inbox list. */
  const countRecipientsFallbackViewportBand = (sendBtn) => {
    if (!sendBtn?.getBoundingClientRect) return 0;
    const sr = sendBtn.getBoundingClientRect();
    const vw = window.innerWidth;
    const zone = {
      left: vw * 0.06,
      right: vw * 0.94,
      top: sr.top - 440,
      bottom: sr.bottom + 100
    };
    const set = new Set();
    for (const el of document.querySelectorAll(RECIPIENT_DOM_SEL)) {
      if (!el || el.nodeType !== 1) continue;
      if (el.closest("blockquote")) continue;
      const r = el.getBoundingClientRect();
      const mx = (r.left + r.right) / 2;
      const my = (r.top + r.bottom) / 2;
      if (!pointInRect(mx, my, zone)) continue;
      if (!isDomWalkRecipientCandidate(el) || isBccChip(el)) continue;
      const em = extractEmailFromElement(el);
      if (em) set.add(em);
    }
    return set.size;
  };

  /** Last resort: innerText looks like a lone email (GPT idea), only on hovercard nodes we already trust. */
  const countRecipientsFallbackGptStyle = () => {
    const set = new Set();
    for (const el of document.querySelectorAll("[data-hovercard-id]")) {
      if (!el || el.nodeType !== 1) continue;
      if (el.closest("blockquote")) continue;
      if (!isRecipientChip(el) || isBccChip(el)) continue;
      const t = (el.innerText || "").trim();
      if (!t.includes("@") || t.length >= 100 || t.includes(" ")) continue;
      const em = extractEmailFromChip(el);
      if (em && !String(em).includes(" ")) set.add(em.toLowerCase());
    }
    return set.size;
  };

  const effectiveRecipientCount = (composeRoot, sendBtn, evtTarget, baseToCc) => {
    if (baseToCc > 0) return baseToCc;
    const domEmails = findRecipientEmailsDomWalk(sendBtn, evtTarget);
    if (vrgDebug && baseToCc <= 1) {
      dlog("domWalk", { count: domEmails.length, preview: domEmails.slice(0, 6) });
    }
    if (domEmails.length > 1) return domEmails.length;
    let n = countRecipientsFallbackNearby(composeRoot, sendBtn);
    if (n > 1) return n;
    n = countRecipientsFallbackViewportBand(sendBtn);
    if (n > 1) return n;
    n = countRecipientsFallbackGptStyle();
    return n > 1 ? Math.min(n, 16) : 0;
  };

  /**
   * Last resort when `getOpenComposeDialogs` is empty: never pick arbitrary `role=dialog`
   * callouts (e.g. Chat history). Prefer a dialog that contains Send, then any surface that
   * already looks like mail (subject / To / chips) — body `contenteditable` may appear only
   * after the user touches the message area.
   */
  const getFallbackRawComposeDialog = (sendBtn) => {
    const raw = Array.from(document.querySelectorAll("div[role='dialog']")).filter(
      (d) => !isExcludedNonComposeDialog(d)
    );
    if (!raw.length) return null;

    const pickNearestToSend = (cands) => {
      if (!sendBtn?.getBoundingClientRect || !cands.length) return cands[cands.length - 1];
      const sr = sendBtn.getBoundingClientRect();
      const cx = (sr.left + sr.right) / 2;
      const cy = (sr.top + sr.bottom) / 2;
      let best = cands[cands.length - 1];
      let bestD = Infinity;
      for (const d of cands) {
        const r = d.getBoundingClientRect?.();
        if (!r || r.width < 8) continue;
        const dcx = (r.left + r.right) / 2;
        const dcy = (r.top + r.bottom) / 2;
        const dist = Math.hypot(cx - dcx, cy - dcy);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      return best;
    };

    let pool = raw.filter((d) => sendBtn && d.contains(sendBtn));
    if (!pool.length) pool = raw.filter((d) => dialogHasComposeShape(d));
    if (!pool.length) return null;

    const visiblePool = pool.filter((d) => isVisible(d) || d.offsetParent !== null);
    const use = visiblePool.length ? visiblePool : pool;
    return pickNearestToSend(use);
  };

  /**
   * Strong compose UI only (no thread `innerText` / inbox chips) — avoids latching onto `Tm aeJ`
   * tri-pane when it merely contains a nested compose `g_editable`.
   */
  const ancestorHasStrongComposeSignals = (el) => {
    if (!el?.querySelector) return false;
    if (el.querySelector('[name="subjectbox"]')) return true;
    if (el.querySelector('input[name="to"], input[name="cc"], textarea[name="to"], textarea[name="cc"]'))
      return true;
    if (el.querySelector('div[role="textbox"][g_editable="true"]')) return true;
    if (el.querySelector("[contenteditable='true']")) return true;
    return false;
  };

  /**
   * Send is often outside the compose subtree in DOM; find the real compose chrome nearest the
   * Send button, then climb to the tightest wrapper that still overlaps Send (avoids `Tm aeJ`).
   */
  const findNearestComposeAnchorNode = (sendBtn) => {
    if (!sendBtn?.getBoundingClientRect) return null;
    const sr = sendBtn.getBoundingClientRect();
    const cx = (sr.left + sr.right) / 2;
    const cy = (sr.top + sr.bottom) / 2;
    let best = null;
    let bestD = Infinity;

    const consider = (node) => {
      if (!node?.getBoundingClientRect) return;
      const tr = node.getBoundingClientRect();
      if (tr.width < 28 || tr.height < 12) return;
      const tcx = (tr.left + tr.right) / 2;
      const tcy = (tr.top + tr.bottom) / 2;
      const d = Math.hypot(cx - tcx, cy - tcy);
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    };

    for (const node of document.querySelectorAll('div[role="textbox"][g_editable="true"]')) {
      const tr = node.getBoundingClientRect();
      if (tr.width < 100 || tr.height < 28) continue;
      consider(node);
    }
    for (const node of document.querySelectorAll('[name="subjectbox"]')) consider(node);
    for (const node of document.querySelectorAll(
      'input[name="to"], textarea[name="to"], input[name="cc"], textarea[name="cc"]'
    )) {
      consider(node);
    }

    if (!best || bestD > 540) return null;
    return best;
  };

  /**
   * When every `role=dialog` is a callout, the compose wrapper may be a plain div. Anchor from
   * the nearest body/subject/to field, climb parents, keep strong-compose ancestors that overlap
   * Send; return the **smallest** area (tightest shell, not the tri-pane `Tm`).
   */
  const findComposeShellFromSend = (sendBtn) => {
    if (!sendBtn || sendBtn.nodeType !== 1) return null;
    const anchor = findNearestComposeAnchorNode(sendBtn);
    if (!anchor) return null;

    const sr = sendBtn.getBoundingClientRect();
    const cx = (sr.left + sr.right) / 2;
    const cy = (sr.top + sr.bottom) / 2;

    const candidates = [];
    let el = anchor.parentElement;
    for (let i = 0; i < 60 && el && el !== document.body; i++) {
      if (!ancestorHasStrongComposeSignals(el)) {
        el = el.parentElement;
        continue;
      }
      const r = el.getBoundingClientRect?.();
      if (
        !r ||
        r.width < 160 ||
        r.height < 56 ||
        r.height > window.innerHeight * 0.92 ||
        r.width > window.innerWidth * 0.98
      ) {
        el = el.parentElement;
        continue;
      }
      const overlap = rectOverlap2d(sr, r);
      const centerInside = pointInRect(cx, cy, r);
      if (overlap < 80 && !centerInside) {
        el = el.parentElement;
        continue;
      }
      candidates.push({ el, area: r.width * r.height });
      el = el.parentElement;
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.area - b.area);
    return candidates[0].el;
  };

  /**
   * To/Cc chips live in a sibling of the body wrapper — not "above" the body rect in RTL/popout.
   * Any recipient node under `container` that is **not** inside the compose body subtree counts
   * (excludes quoted forward HTML inside `contenteditable`).
   */
  const recipientChipOutsideComposeBody = (container, bodyEl) => {
    if (!container?.querySelectorAll || !bodyEl?.contains) return false;
    for (const node of container.querySelectorAll(RECIPIENT_DOM_SEL)) {
      if (!node || node.nodeType !== 1) continue;
      if (bodyEl.contains(node)) continue;
      if (node.closest("blockquote, .gmail_quote, .gmail_quote_container, .gmail_attr")) continue;
      if (isBccChip(node)) continue;
      if (!isDomWalkRecipientCandidate(node)) continue;
      if (extractEmailFromElement(node)) return true;
    }
    return false;
  };

  const composeHeaderRowPresentIn = (el, composeBodyHint) => {
    if (!el?.querySelector) return false;
    if (el.querySelector('[name="subjectbox"]')) return true;
    if (
      el.querySelector('input[name="to"], textarea[name="to"], input[name="cc"], textarea[name="cc"]')
    ) {
      return true;
    }
    const body =
      composeBodyHint && el.contains(composeBodyHint)
        ? composeBodyHint
        : el.querySelector('div[role="textbox"][g_editable="true"]') ||
          el.querySelector("[contenteditable='true']");
    return !!(body && recipientChipOutsideComposeBody(el, body));
  };

  /** Resolve Gmail dynamic ids (`:b3`, `:z8`) — light DOM, escaped `#`, and the compose `ShadowRoot`. */
  const resolveGmailAriaRefNode = (id, bodyEl) => {
    if (!id || typeof id !== "string") return null;
    const t = id.trim();
    if (!t) return null;
    try {
      const byId = document.getElementById(t);
      if (byId) return byId;
    } catch {
      /* ignore */
    }
    try {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        const n = document.querySelector(`#${CSS.escape(t)}`);
        if (n) return n;
      }
    } catch {
      /* ignore */
    }
    try {
      const n = document.querySelector(`[id="${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
      if (n) return n;
    } catch {
      /* ignore */
    }
    const rn = bodyEl?.getRootNode?.();
    if (rn && rn.nodeType === 11) {
      try {
        const hit = /** @type {ShadowRoot} */ (rn).getElementById?.(t);
        if (hit) return hit;
      } catch {
        /* ignore */
      }
    }
    return null;
  };

  /**
   * Gmail often links the body `contenteditable` to the To/Cc strip via `aria-controls` / `aria-owns`
   * (e.g. `:z8`) on a **separate** subtree branch — parent walk alone never sees those nodes from `aO7`.
   */
  const expandShellViaBodyAriaWiring = (shell) => {
    if (!shell?.querySelector) return shell;
    const body =
      shell.querySelector('div[role="textbox"][g_editable="true"]') ||
      shell.querySelector("[contenteditable='true']");
    if (!body) return shell;
    const raw = `${body.getAttribute("aria-controls") || ""} ${body.getAttribute("aria-owns") || ""}`;
    const ids = [...new Set(raw.trim().split(/\s+/).filter(Boolean))];
    let best = null;
    let bestArea = Infinity;
    for (const id of ids) {
      const ext = resolveGmailAriaRefNode(id, body);
      if (!ext || ext.nodeType !== 1) continue;
      let el = shell;
      for (let j = 0; j < 80 && el && el !== document.body; j++, el = el.parentElement) {
        if (el.contains(body) && el.contains(ext)) {
          const r = el.getBoundingClientRect?.();
          if (r && r.height < window.innerHeight * 0.92 && r.width < window.innerWidth * 0.96) {
            const area = r.width * r.height;
            if (area < bestArea) {
              bestArea = area;
              best = el;
            }
          }
        }
      }
    }
    return best || shell;
  };

  /** `findComposeShellFromSend` may return only the body wrapper (`aO7`); climb to include To/Cc. */
  const expandShellToIncludeComposeHeader = (shell) => {
    if (!shell) return shell;
    const composeBody =
      shell.querySelector('div[role="textbox"][g_editable="true"]') ||
      shell.querySelector("[contenteditable='true']");
    let el = shell.parentElement;
    for (let i = 0; i < 24 && el && el !== document.body; i++) {
      const hasRecipients =
        composeHeaderRowPresentIn(el, composeBody) ||
        countChips(el).toCc > 0 ||
        getRecipientsFromDialogHeader(el).length > 0;
      if (hasRecipients) {
        const r = el.getBoundingClientRect?.();
        if (r && r.height < window.innerHeight * 0.9 && r.width < window.innerWidth * 0.94) return el;
      }
      el = el.parentElement;
    }
    return shell;
  };

  /**
   * When `aria-controls` ids are synthetic (no real `#:b3`), To/Cc is often a **sibling** of `aO7`
   * in the same parent — scan previous and next element siblings at each level up from `shell`.
   */
  const expandShellByPriorSiblingRecipients = (shell) => {
    if (!shell) return shell;
    let cur = shell;
    for (let d = 0; d < 5 && cur && cur !== document.body; d++) {
      const p = cur.parentElement;
      if (!p?.children) break;
      const kids = Array.from(p.children);
      const ix = kids.indexOf(cur);
      const siblingHasRecipients = (sib) => {
        if (!sib?.querySelector) return false;
        if (
          sib.querySelector(
            '[name="subjectbox"], input[name="to"], textarea[name="to"], input[name="cc"], textarea[name="cc"]'
          )
        ) {
          return true;
        }
        if (emailsFromChipNodesIn(sib).size > 0) return true;
        if (countChips(sib).toCc > 0) return true;
        return !!sib.querySelector("[data-hovercard-id], [data-recipient-context]");
      };
      for (const delta of [-1, 1]) {
        for (let i = ix + delta; delta < 0 ? i >= 0 : i < kids.length; i += delta) {
          const sib = kids[i];
          if (siblingHasRecipients(sib)) {
            const pr = p.getBoundingClientRect?.();
            if (pr && pr.width < window.innerWidth * 0.96 && pr.height < window.innerHeight * 0.92)
              return p;
          }
        }
      }
      cur = p;
    }
    return shell;
  };

  const resolveComposeRoot = (sendBtn, evt) => {
    const sendDlg = nearestNonExcludedDialog(sendBtn);
    if (sendDlg) return sendDlg;

    const dlg = getActiveComposeDialog(evt, sendBtn);
    if (dlg) return dlg;
    const picked = pickBestComposeRoot(sendBtn);
    if (picked) return picked;
    const rawCount = document.querySelectorAll("div[role='dialog']").length;
    if (rawCount > 0) {
      const fb = getFallbackRawComposeDialog(sendBtn);
      if (fb) {
        dlog("fallback raw dialog", {
          rawCount,
          hasEditable: !!(
            fb.querySelector("[contenteditable='true']") ||
            fb.querySelector('div[role="textbox"][g_editable="true"]')
          )
        });
        return fb;
      }
    }
    const shell = findComposeShellFromSend(sendBtn);
    if (shell) {
      const afterAria = expandShellViaBodyAriaWiring(shell);
      let x = afterAria;
      if (x === shell) {
        const afterSib = expandShellByPriorSiblingRecipients(shell);
        if (afterSib !== shell) x = afterSib;
      }
      const expanded = expandShellToIncludeComposeHeader(x);
      dlog("resolveComposeRoot", "non-dialog compose shell", {
        shellTag: shell.tagName,
        ariaWired: afterAria !== shell,
        siblingWired: x !== afterAria,
        expanded: expanded !== shell
      });
      return expanded;
    }
    return null;
  };

  const findComposeRootForConfirmFallback = () => {
    const dialogs = Array.from(document.querySelectorAll("div[role='dialog']")).filter(
      (d) => d.offsetParent !== null && !isExcludedNonComposeDialog(d)
    );
    let best = null;
    let bestToCc = 0;
    for (const d of dialogs) {
      const t = visibleToCcForRoot(d);
      if (t > bestToCc) {
        bestToCc = t;
        best = d;
      }
    }
    return bestToCc > 1 ? best : null;
  };

  const escapeHtml = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const tMsg = (key, subs) => {
    try {
      const m = chrome.i18n.getMessage(key, subs);
      if (m) return m;
    } catch (_) {}
    return "";
  };

  const createPopup = (composeRoot, onContinue) => {
    const blockedCount = bumpBlockedCountSync();

    const erlixLogoUrl = chrome.runtime.getURL("src/assets/erlix-logo-update.png");
    const bccLogoUrl = chrome.runtime.getURL("src/assets/bcc-alert-logo.png");

    const titleText =
      tMsg("warningTitle") ||
      "\u05e9\u05d9\u05dd \u05dc\u05d1!";
    const leadText =
      tMsg("warningBody") ||
      "\u05d4\u05e0\u05da \u05e9\u05d5\u05dc\u05d7 \u05dc\u05de\u05e1\u05e4\u05e8 \u05e0\u05de\u05e2\u05e0\u05d9\u05dd \u05d1\u05d0\u05d5\u05e4\u05df \u05d7\u05e9\u05d5\u05e3. \u05e9\u05e7\u05d5\u05dc \u05dc\u05d4\u05e9\u05ea\u05de\u05e9 \u05d1\u05e2\u05d5\u05ea\u05e7 \u05de\u05d5\u05e1\u05ea\u05e8.";
    const metaBefore =
      tMsg("popupStatsBefore") ||
      "\u05e2\u05d3 \u05d4\u05d9\u05d5\u05dd \u05e0\u05de\u05e0\u05e2\u05d5 \u05de\u05de\u05da ";
    const metaAfter =
      tMsg("popupStatsAfter") ||
      " \u05e4\u05e2\u05de\u05d9\u05dd \u05e9\u05dc\u05d9\u05d7\u05d4 \u05d2\u05dc\u05d5\u05d9\u05d4 \u05dc\u05de\u05e1\u05e4\u05e8 \u05e0\u05de\u05e2\u05e0\u05d9\u05dd.";
    const backText = tMsg("backButton") || "\u05d7\u05d6\u05d5\u05e8";
    const sendText = tMsg("sendAnywayButton") || "\u05e9\u05dc\u05d7 \u05d1\u05db\u05dc \u05d6\u05d0\u05ea";

    const overlay = document.createElement("div");
    overlay.className = "vrg-overlay";
    overlay.setAttribute("role", "presentation");

    const modal = document.createElement("div");
    modal.className = "vrg-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "vrg-warn-title");
    modal.setAttribute("dir", "auto");

    modal.innerHTML = [
      '<a class="vrg-modal__brand vrg-modal__brand--erlix" href="https://erlix.net/" target="_blank" rel="noopener noreferrer" title="Erlix">',
      `<img src="${erlixLogoUrl}" alt="Erlix" width="120" /></a>`,
      '<a class="vrg-modal__brand vrg-modal__brand--bcc" href="https://erlix.net/bcc-alert/" target="_blank" rel="noopener noreferrer" title="BCC Alert">',
      `<img src="${bccLogoUrl}" alt="BCC Alert" width="150" /></a>`,
      '<div class="vrg-modal__content">',
      `<h2 id="vrg-warn-title" class="vrg-modal__title">${escapeHtml(titleText)}</h2>`,
      `<p class="vrg-modal__lead">${escapeHtml(leadText)}</p>`,
      '<p class="vrg-modal__meta">',
      escapeHtml(metaBefore),
      '<span class="vrg-modal__count">',
      String(Math.max(0, Math.floor(Number(blockedCount) || 0))),
      "</span>",
      escapeHtml(metaAfter),
      "</p>",
      '<div class="vrg-actions">',
      `<button type="button" class="vrg-btn vrg-secondary" id="vrg-back">${escapeHtml(backText)}</button>`,
      `<button type="button" class="vrg-btn vrg-primary" id="vrg-send-anyway">${escapeHtml(sendText)}</button>`,
      "</div></div>"
    ].join("");

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const remove = () => {
      overlay.remove();
      popupOpen = false;
    };

    modal.querySelector("#vrg-send-anyway").onclick = () => {
      composeRoot.dataset.vrgForceSend = "true";
      remove();
      onContinue();
    };

    modal.querySelector("#vrg-back").onclick = () => {
      remove();
    };
  };

  const isSendButton = (btn) => {
    if (!btn || btn.nodeType !== 1) return false;
    const aria = (btn.getAttribute("aria-label") || "").trim().toLowerCase();
    const text = (btn.innerText || "").trim().toLowerCase();
    const combined = `${aria} ${text}`.trim();
    if (combined.includes("schedule send") || combined.includes("תזמון שליחה")) return false;
    const ariaRaw = (btn.getAttribute("aria-label") || "").trim();
    const ariaLc = ariaRaw.toLowerCase();
    const heCtrlSend =
      ariaLc.includes("ctrl") &&
      (/\u05e9\u05dc\u05d7/.test(ariaRaw) || /\u05e9\u05dc\u05d9\u05d7\u05d4/.test(ariaRaw) || /\u05e9\u05dc\u05d7\u05d4/.test(ariaRaw));
    return (
      text === "send" ||
      text === "\u05e9\u05dc\u05d9\u05d7\u05d4" ||
      text === "\u05e9\u05dc\u05d7" ||
      text === "\u05e9\u05dc\u05d7\u05d4" ||
      aria.startsWith("send ") ||
      aria === "send" ||
      (aria.includes("send") && aria.includes("ctrl")) ||
      heCtrlSend
    );
  };

  const findSendButtonFromTarget = (target) => {
    let n = target;
    for (let i = 0; i < 22 && n; i++) {
      if (n.nodeType === 1) {
        const el = n;
        if (
          (el.matches("div[role='button']") || el.matches("button")) &&
          isSendButton(el)
        ) {
          return el;
        }
      }
      n = n.parentElement;
    }
    return null;
  };

  const findSendButtonInRoot = (root) => {
    if (!root || root.nodeType !== 1) return null;
    for (const el of root.querySelectorAll("div[role='button'], button")) {
      if (isSendButton(el)) return el;
    }
    return null;
  };

  const tryInterceptSend = (e, sendBtn) => {
    const ev = e.type;
    dlog(ev, "send", {
      aria: (sendBtn.getAttribute("aria-label") || "").slice(0, 80),
      text: (sendBtn.innerText || "").trim().slice(0, 40)
    });

    if (popupOpen) {
      dlog(ev, "skip: popupOpen");
      if (isSendButton(sendBtn)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      return;
    }

    const composeRoot = resolveComposeRoot(sendBtn, e);
    if (!composeRoot) {
      dlog(ev, "skip: no composeRoot", {
        ...probeDebug(null),
        composeRootProbe: probeComposeRootFailures(sendBtn)
      });
      return;
    }

    const toCc = visibleToCcForRoot(composeRoot);
    const effectiveToCc = effectiveRecipientCount(composeRoot, sendBtn, e.target, toCc);
    lastComposeRoot = composeRoot;
    lastSendBtn = sendBtn;

    dlog(ev, "compose", {
      toCc,
      effectiveToCc,
      vrgForce: Boolean(composeRoot.dataset.vrgForceSend),
      ...probeDebug(composeRoot)
    });

    if (effectiveToCc > 1 && !composeRoot.dataset.vrgForceSend) {
      if (toCc <= 1 && effectiveToCc > 1) {
        dlog(ev, "intercept -> show popup (recipient fallback)");
      } else {
        dlog(ev, "intercept -> show popup");
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      popupOpen = true;
      createPopup(composeRoot, () => sendBtn.click());
    } else if (effectiveToCc <= 1) {
      dlog(ev, "skip: effectiveToCc<=1 (no warning)");
      if (vrgDebug && composeRoot?.outerHTML) {
        dlog(ev, "composeHtmlSnippet", composeRoot.outerHTML.slice(0, 1800));
      }
    }
  };

  const onPointerDownCapture = (e) => {
    if (e.button !== 0 && e.button !== undefined) return;
    const sendBtn = findSendButtonFromTarget(e.target);
    if (!sendBtn) return;
    tryInterceptSend(e, sendBtn);
  };

  const onClickCapture = (e) => {
    if (e.button !== 0 && e.button !== undefined) return;
    const sendBtn = findSendButtonFromTarget(e.target);
    if (!sendBtn) return;
    tryInterceptSend(e, sendBtn);
  };

  const onKeyDownCapture = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
    const sendBtn = lastSendBtn || findSendButtonFromTarget(document.activeElement);
    if (!sendBtn) return;
    tryInterceptSend(e, sendBtn);
  };

  document.addEventListener("pointerdown", onPointerDownCapture, true);
  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("keydown", onKeyDownCapture, true);

  const originalConfirm = window.confirm.bind(window);
  window.confirm = (message) => {
    dlog("confirm()", String(message || "").slice(0, 160));

    const msg = String(message || "").toLowerCase();
    const isEmptyMessagePrompt =
      msg.includes("without") ||
      msg.includes("subject") ||
      msg.includes("body") ||
      msg.includes("\u05d1\u05d2\u05d5\u05e3 \u05d4\u05d4\u05d5\u05d3\u05e2\u05d4") ||
      msg.includes("\u05e0\u05d5\u05e9\u05d0");

    if (!isEmptyMessagePrompt) {
      dlog("confirm: not empty-body prompt -> native");
      return originalConfirm(message);
    }

    const composeRoot = lastComposeRoot || findComposeRootForConfirmFallback();
    if (!composeRoot) {
      dlog("confirm: no composeRoot -> native", probeDebug(null));
      return originalConfirm(message);
    }

    const toCc = visibleToCcForRoot(composeRoot);
    const effectiveToCc = effectiveRecipientCount(composeRoot, lastSendBtn, null, toCc);

    if (composeRoot.dataset.vrgForceSend === "true") {
      dlog("confirm: vrgForceSend -> native");
      composeRoot.dataset.vrgForceSend = "";
      return originalConfirm(message);
    }

    if (effectiveToCc > 1) {
      dlog("confirm: effectiveToCc>1 -> our popup, return false");
      setTimeout(() => {
        popupOpen = true;
        createPopup(composeRoot, () => {
          composeRoot.dataset.vrgForceSend = "true";
          const sendBtn = findSendButtonInRoot(composeRoot) || lastSendBtn;
          if (sendBtn) sendBtn.click();
        });
      }, 0);
      return false;
    }

    dlog("confirm: effectiveToCc<=1 -> native");
    return originalConfirm(message);
  };
})();

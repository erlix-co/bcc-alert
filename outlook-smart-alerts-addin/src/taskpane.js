/* global Office, assessVisibleRecipients, reportDecisionMetric, getUserLanguage, isMailboxRequirementSupported, getErlixLicenseManager */

/**
 * Task pane: recipient status when protection is active; subscription banners; no send interception.
 * Logging prefix: [SUBSCRIPTION] for license UI; [PROTECTION] for assessment logs where relevant.
 */

const TEXTS = {
  he: {
    title: "שים לב!",
    leadBody:
      "אתה עומד לשלוח מייל למספר נמענים גלויים\nכל הנמענים יראו אחד את השני!\n\nמומלץ להשתמש ב־BCC לשמירה על פרטיות.",
    button: "רענון ידני",
    safe: "נראה תקין: יש עד נמען גלוי אחד.",
    warning: "אזהרה: זוהו מספר נמענים גלויים. מומלץ להשתמש ב־BCC.",
    unsupported: "לתיבה זו אין תמיכה מלאה ב-Smart Alerts (Mailbox 1.12).",
    composeMissing: "לא זוהה חלון כתיבת הודעה.",
    details: (count) => `נמענים גלויים (To + Cc): ${count}`,
    groupHint: "זוהתה קבוצת תפוצה/קבוצה; ההתראה מחמירה בכוונה.",
    groupSignals: (n) => `אותות זיהוי קבוצה: ${n}`,
    notifWarning: "יותר מנמען גלוי אחד — מומלץ BCC.",
    notifSafe: "עד נמען גלוי אחד — נראה תקין.",
    poweredBy: "מופעל ע\"י erlix.net",
    subscriptionExpiring: (days) =>
      `תוקף ההגנה של Erlix יפוג בעוד ${days} ימים.`,
    subscriptionInactive: "ההגנה של Erlix אינה פעילה. פג תוקף המנוי.",
    protectionInactiveBody:
      "ההגנה של Erlix אינה פעילה כרגע (מנוי פג או אין אימות רישוי). השליחה לא נבדקת על ידי התוסף."
  },
  en: {
    title: "Attention!",
    leadBody:
      "You are about to send an email to multiple visible recipients.\nAll recipients will be able to see each other's addresses.\n\nWe recommend using Bcc to protect privacy.",
    button: "Manual refresh",
    safe: "Looks safe: one or fewer visible recipients.",
    warning: "Warning: multiple visible recipients detected. Consider Bcc.",
    unsupported: "This mailbox does not fully support Smart Alerts (Mailbox 1.12).",
    composeMissing: "Compose item not detected.",
    details: (count) => `Visible recipients (To + Cc): ${count}`,
    groupHint: "A distribution list/group was detected; warning is intentionally conservative.",
    groupSignals: (n) => `Group detection signals: ${n}`,
    notifWarning: "Multiple visible recipients — consider Bcc.",
    notifSafe: "One or fewer visible recipients — looks fine.",
    poweredBy: "Powered by erlix.net",
    subscriptionExpiring: (days) => `Your Erlix protection expires in ${days} days.`,
    subscriptionInactive: "Erlix protection inactive. Your subscription has expired.",
    protectionInactiveBody:
      "Erlix protection is inactive (subscription expired or license could not be validated). This add-in is not checking your sends."
  }
};

const CHECK_INTERVAL_MS = 2500;
const NOTIFICATION_KEY = "BCCAlertVisibleRecipients";

let lastAssessmentSignature = "";

function getLicenseManagerSafe() {
  try {
    if (typeof getErlixLicenseManager === "function") {
      return getErlixLicenseManager();
    }
  } catch (_e) {
    /* ignore */
  }
  return null;
}

function setSubscriptionBanner(lang, lm) {
  const el = document.getElementById("erlixSubscriptionBanner");
  if (!el) return;

  if (!lm) {
    el.hidden = true;
    el.textContent = "";
    el.className = "erlix-subscription-banner";
    return;
  }

  if (typeof lm.isOfflineGrace === "function" && lm.isOfflineGrace() && lm.isProtectionActive()) {
    el.hidden = true;
    el.textContent = "";
    el.className = "erlix-subscription-banner";
    console.log("[SUBSCRIPTION] banner: hidden (offline grace, no subscription scare UI)");
    return;
  }

  if (lm.isExpired()) {
    el.hidden = false;
    el.className = "erlix-subscription-banner erlix-subscription-banner--expired";
    el.textContent = TEXTS[lang]?.subscriptionInactive || TEXTS.en.subscriptionInactive;
    console.log("[SUBSCRIPTION] banner: EXPIRED (inactive protection)");
    return;
  }

  if (lm.isExpiringSoon()) {
    const days = lm.getDaysLeft();
    const d = days !== null ? days : "?";
    el.hidden = false;
    el.className = "erlix-subscription-banner erlix-subscription-banner--expiring";
    el.textContent =
      typeof TEXTS[lang]?.subscriptionExpiring === "function"
        ? TEXTS[lang].subscriptionExpiring(d)
        : TEXTS.en.subscriptionExpiring(d);
    console.log("[SUBSCRIPTION] banner: EXPIRING_SOON");
    return;
  }

  el.hidden = true;
  el.textContent = "";
  el.className = "erlix-subscription-banner";
}

function setStatus(text, isWarning) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.className = `status ${isWarning ? "warn" : "ok"}`;
}

function updateComposeNotification(lang, warning) {
  const item = Office?.context?.mailbox?.item;
  if (!item?.notificationMessages?.replaceAsync) return;

  const message = warning ? TEXTS[lang].notifWarning : TEXTS[lang].notifSafe;
  item.notificationMessages.replaceAsync(NOTIFICATION_KEY, {
    type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
    message,
    persistent: false
  });
}

function signatureFromAssessment(assessment) {
  return [
    assessment.effectiveVisibleCount,
    assessment.uniqueVisibleCount,
    assessment.hasLikelyGroup ? "group" : "nogroup",
    ...(assessment.groupSignalReasons || [])
  ].join("|");
}

async function refreshCheck(lang, lm) {
  if (!lm?.isProtectionActive()) {
    console.log("[PROTECTION] taskpane refresh skipped — protection inactive");
    return;
  }

  const item = Office?.context?.mailbox?.item;
  if (!item || !item.to || !item.cc) {
    setStatus(TEXTS[lang].composeMissing, true);
    return;
  }

  const assessment = await assessVisibleRecipients(item);
  const visibleCount = assessment.effectiveVisibleCount;
  const warning = visibleCount > 1;
  const currentSignature = signatureFromAssessment(assessment);

  setStatus(warning ? TEXTS[lang].warning : TEXTS[lang].safe, warning);
  document.getElementById("details").textContent = assessment.hasLikelyGroup
    ? `${TEXTS[lang].details(visibleCount)} · ${TEXTS[lang].groupHint} · ${TEXTS[lang].groupSignals(
        assessment.groupSignalReasons.length
      )}`
    : TEXTS[lang].details(visibleCount);

  if (currentSignature !== lastAssessmentSignature) {
    reportDecisionMetric({ decision: warning ? "blocked" : "allowed", visibleCount });
    updateComposeNotification(lang, warning);
    lastAssessmentSignature = currentSignature;
  }
}

function showProtectionInactivePanel(lang) {
  const item = Office?.context?.mailbox?.item;
  try {
    if (item?.notificationMessages?.removeAsync) {
      item.notificationMessages.removeAsync(NOTIFICATION_KEY);
    }
  } catch (_e) {
    /* ignore */
  }

  const lead = document.getElementById("lead");
  if (lead) {
    lead.textContent = TEXTS[lang]?.protectionInactiveBody || TEXTS.en.protectionInactiveBody;
  }
  setStatus(TEXTS[lang]?.subscriptionInactive || TEXTS.en.subscriptionInactive, true);
  document.getElementById("details").textContent = "";
  document.getElementById("refreshBtn").disabled = true;
}

Office.onReady(() => {
  const lang = typeof getUserLanguage === "function" ? getUserLanguage() : "en";
  const i18n = TEXTS[lang] || TEXTS.en;

  document.getElementById("title").textContent = i18n.title;
  const lead = document.getElementById("lead");
  if (lead) {
    lead.textContent = i18n.leadBody;
  }
  document.getElementById("refreshBtn").textContent = i18n.button;
  const poweredByLink = document.getElementById("poweredByLink");
  if (poweredByLink) poweredByLink.textContent = i18n.poweredBy;
  document.getElementById("refreshBtn").addEventListener("click", () => {
    const lm = getLicenseManagerSafe();
    refreshCheck(lang, lm);
  });

  if (typeof isMailboxRequirementSupported === "function" && !isMailboxRequirementSupported("1.12")) {
    setStatus(i18n.unsupported, true);
    document.getElementById("details").textContent = "";
    return;
  }

  (async () => {
    const lm = getLicenseManagerSafe();
    if (lm) {
      await lm.resolveState();
      setSubscriptionBanner(lang, lm);
    } else {
      setSubscriptionBanner(lang, null);
    }

    const effectiveLm = getLicenseManagerSafe();
    if (!effectiveLm?.isProtectionActive()) {
      showProtectionInactivePanel(lang);
      return;
    }

    await refreshCheck(lang, effectiveLm);
    setInterval(() => {
      const m = getLicenseManagerSafe();
      refreshCheck(lang, m);
    }, CHECK_INTERVAL_MS);
  })();
});

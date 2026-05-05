/* global Office, assessVisibleRecipients, reportDecisionMetric, getUserLanguage, isMailboxRequirementSupported, getInterceptCountSync, getInterceptStatsDisplayParts */

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
    poweredBy: "מופעל ע\"י erlix.net"
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
    poweredBy: "Powered by erlix.net"
  }
};

const CHECK_INTERVAL_MS = 2500;
const NOTIFICATION_KEY = "BCCAlertVisibleRecipients";

let lastAssessmentSignature = "";

function setStatus(text, isWarning) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.className = `status ${isWarning ? "warn" : "ok"}`;
}

function renderStatsLine(lang) {
  const statsLine = document.getElementById("statsLine");
  if (!statsLine) return;
  if (typeof getInterceptStatsDisplayParts !== "function" || typeof getInterceptCountSync !== "function") {
    statsLine.textContent = "";
    return;
  }
  const parts = getInterceptStatsDisplayParts(lang, getInterceptCountSync());
  statsLine.textContent = "";
  statsLine.appendChild(document.createTextNode(parts.before));
  const span = document.createElement("span");
  span.className = "bcc-panel__stat-number";
  span.textContent = parts.numberText;
  statsLine.appendChild(span);
  statsLine.appendChild(document.createTextNode(parts.after));
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

async function refreshCheck(lang) {
  const item = Office?.context?.mailbox?.item;
  if (!item || !item.to || !item.cc) {
    setStatus(TEXTS[lang].composeMissing, true);
    return;
  }

  const assessment = await assessVisibleRecipients(item);
  const visibleCount = assessment.effectiveVisibleCount;
  const warning = visibleCount > 1;
  const currentSignature = signatureFromAssessment(assessment);

  renderStatsLine(lang);
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
    refreshCheck(lang);
  });

  if (typeof isMailboxRequirementSupported === "function" && !isMailboxRequirementSupported("1.12")) {
    setStatus(i18n.unsupported, true);
    document.getElementById("details").textContent = "";
    const statsLine = document.getElementById("statsLine");
    if (statsLine) statsLine.textContent = "";
    return;
  }

  refreshCheck(lang);
  setInterval(() => {
    refreshCheck(lang);
  }, CHECK_INTERVAL_MS);
});

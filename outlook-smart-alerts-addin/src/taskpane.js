/* global Office, countVisibleRecipients, reportDecisionMetric, getUserLanguage, isMailboxRequirementSupported */

const TEXTS = {
  he: {
    title: "BCC Alert",
    description: "בדיקה ידנית לפני שליחה לנמענים גלויים מרובים.",
    button: "בדוק עכשיו",
    safe: "נראה תקין: יש עד נמען גלוי אחד.",
    warning: "אזהרה: זוהו מספר נמענים גלויים. מומלץ להשתמש ב-Bcc.",
    unsupported: "לתיבה זו אין תמיכה מלאה ב-Smart Alerts (Mailbox 1.12).",
    details: (count) => `נמענים גלויים (To + Cc): ${count}`
  },
  en: {
    title: "BCC Alert",
    description: "Manual pre-send check for visible recipients.",
    button: "Check now",
    safe: "Looks safe: one or fewer visible recipients.",
    warning: "Warning: multiple visible recipients detected. Consider Bcc.",
    unsupported: "This mailbox does not fully support Smart Alerts (Mailbox 1.12).",
    details: (count) => `Visible recipients (To + Cc): ${count}`
  }
};

function setStatus(text, isWarning) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.className = `status ${isWarning ? "warn" : "ok"}`;
}

async function refreshCheck(lang) {
  const item = Office?.context?.mailbox?.item;
  if (!item || !item.to || !item.cc) {
    setStatus(lang === "he" ? "לא זוהה חלון כתיבת הודעה." : "Compose item not detected.", true);
    return;
  }

  const visibleCount = await countVisibleRecipients(item);
  const warning = visibleCount > 1;
  setStatus(warning ? TEXTS[lang].warning : TEXTS[lang].safe, warning);
  document.getElementById("details").textContent = TEXTS[lang].details(visibleCount);
  reportDecisionMetric({ decision: warning ? "blocked" : "allowed", visibleCount });
}

Office.onReady(() => {
  const lang = typeof getUserLanguage === "function" ? getUserLanguage() : "en";
  const i18n = TEXTS[lang] || TEXTS.en;

  document.getElementById("title").textContent = i18n.title;
  document.getElementById("description").textContent = i18n.description;
  document.getElementById("refreshBtn").textContent = i18n.button;
  document.getElementById("refreshBtn").addEventListener("click", () => {
    refreshCheck(lang);
  });

  if (typeof isMailboxRequirementSupported === "function" && !isMailboxRequirementSupported("1.12")) {
    setStatus(i18n.unsupported, true);
    document.getElementById("details").textContent = "";
    return;
  }

  refreshCheck(lang);
});

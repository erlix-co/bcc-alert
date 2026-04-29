/* global Office */

const POLICY = {
  maxVisibleRecipients: 1
};

const BLOCK_MESSAGES = {
  he: "שים לב! הנך שולח למספר נמענים באופן חשוף. שקול להשתמש בעותק מוסתר.",
  en: "You are sending to multiple visible recipients. Consider using Bcc."
};

function getRecipientsAsync(field) {
  return new Promise((resolve) => {
    field.getAsync((result) => {
      if (result.status !== Office.AsyncResultStatus.Succeeded) {
        resolve([]);
        return;
      }
      resolve(result.value || []);
    });
  });
}

function countVisibleRecipients(item) {
  return Promise.all([getRecipientsAsync(item.to), getRecipientsAsync(item.cc)]).then(
    ([toRecipients, ccRecipients]) => {
      const seen = new Set();
      [...toRecipients, ...ccRecipients].forEach((recipient) => {
        const key = (recipient?.emailAddress || recipient?.displayName || "").trim().toLowerCase();
        if (key) seen.add(key);
      });
      return seen.size;
    }
  );
}

function getUserLanguage() {
  const lang = Office?.context?.displayLanguage || "en-US";
  return String(lang).toLowerCase().startsWith("he") ? "he" : "en";
}

function isMailboxRequirementSupported(minVersion) {
  try {
    return Boolean(
      Office?.context?.requirements?.isSetSupported &&
        Office.context.requirements.isSetSupported("Mailbox", minVersion)
    );
  } catch (_error) {
    return false;
  }
}

function toRecipientBucket(visibleCount) {
  if (visibleCount <= 1) return "0-1";
  if (visibleCount <= 5) return "2-5";
  return "6+";
}

function reportDecisionMetric({ decision, visibleCount }) {
  const payload = {
    eventName: "onMessageSend",
    decision,
    visibleRecipientBucket: toRecipientBucket(visibleCount),
    policyVersion: "1.0.0"
  };

  const body = JSON.stringify(payload);
  const endpoint =
    typeof window !== "undefined" && window?.location?.origin
      ? `${window.location.origin}/api/metrics`
      : "https://localhost:3000/api/metrics";

  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(endpoint, blob);
      return;
    }
  } catch (_error) {
    // Ignore telemetry failures to avoid blocking send flow.
  }

  if (typeof fetch === "function") {
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    }).catch(() => {
      // Ignore telemetry failures to avoid blocking send flow.
    });
  }
}

function onMessageSendHandler(event) {
  if (!isMailboxRequirementSupported("1.12")) {
    event.completed({ allowEvent: true });
    return;
  }

  const item = Office.context.mailbox.item;
  countVisibleRecipients(item).then((visibleCount) => {
    if (visibleCount > POLICY.maxVisibleRecipients) {
      reportDecisionMetric({ decision: "blocked", visibleCount });
      event.completed({
        allowEvent: false,
        errorMessage: BLOCK_MESSAGES[getUserLanguage()]
      });
      return;
    }
    reportDecisionMetric({ decision: "allowed", visibleCount });
    event.completed({ allowEvent: true });
  });
}

if (typeof Office !== "undefined" && typeof Office.onReady === "function") {
  Office.onReady(() => {
    Office.actions.associate("onMessageSendHandler", onMessageSendHandler);
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getRecipientsAsync,
    countVisibleRecipients,
    getUserLanguage,
    isMailboxRequirementSupported,
    toRecipientBucket,
    reportDecisionMetric,
    onMessageSendHandler
  };
}

/* global Office */

const POLICY = {
  maxVisibleRecipients: 1
};

/** Roaming key: cumulative count of send attempts blocked by visible-recipient policy (per mailbox). */
const ROAMING_INTERCEPT_COUNT_KEY = "bccAlertVisibleSendInterceptCount";

function getInterceptCountSync() {
  try {
    const settings = Office?.context?.roamingSettings;
    if (!settings?.get) return 0;
    return Math.max(0, Math.floor(Number(settings.get(ROAMING_INTERCEPT_COUNT_KEY)) || 0));
  } catch (_error) {
    return 0;
  }
}

function bumpInterceptCountSync() {
  try {
    const settings = Office?.context?.roamingSettings;
    if (!settings?.get || !settings?.set) {
      return getInterceptCountSync() + 1;
    }
    const next = getInterceptCountSync() + 1;
    settings.set(ROAMING_INTERCEPT_COUNT_KEY, next);
    if (typeof settings.saveAsync === "function") {
      settings.saveAsync(() => {});
    }
    return next;
  } catch (_error) {
    return getInterceptCountSync() + 1;
  }
}

/**
 * Persists intercept count then resolves — required before `event.completed` in OnMessageSend,
 * otherwise the runtime may tear down before `roamingSettings.saveAsync` finishes (counter stuck at 1).
 */
function bumpInterceptCountAsync() {
  return new Promise((resolve) => {
    try {
      const settings = Office?.context?.roamingSettings;
      if (!settings?.get || !settings?.set) {
        resolve(getInterceptCountSync() + 1);
        return;
      }
      const next = getInterceptCountSync() + 1;
      settings.set(ROAMING_INTERCEPT_COUNT_KEY, next);
      if (typeof settings.saveAsync !== "function") {
        resolve(next);
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(next);
      };
      const timer = setTimeout(finish, 1200);
      settings.saveAsync(() => {
        clearTimeout(timer);
        finish();
      });
    } catch (_error) {
      resolve(getInterceptCountSync() + 1);
    }
  });
}

function getInterceptStatsDisplayParts(lang, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (lang === "he") {
    if (n === 1) {
      return {
        before: "עד היום נמנע ממך ",
        numberText: "1",
        after: " ניסיון שליחה גלויה למספר נמענים."
      };
    }
    return {
      before: "עד היום נמנעו ממך ",
      numberText: String(n),
      after: " פעמים שליחה גלויה למספר נמענים."
    };
  }
  if (n === 1) {
    return {
      before: "So far, you have been protected from ",
      numberText: "1",
      after: " risky visible multi-recipient send."
    };
  }
  return {
    before: "So far, you have been protected from ",
    numberText: String(n),
    after: " risky visible multi-recipient sends."
  };
}

function formatInterceptStatsLine(lang, count) {
  const { before, numberText, after } = getInterceptStatsDisplayParts(lang, count);
  return `${before}${numberText}${after}`;
}

function buildSmartAlertErrorMessage(lang, interceptTotal) {
  const isHe = lang === "he";
  const lines = isHe
    ? [
        "אתה עומד לשלוח מייל למספר נמענים גלויים",
        "כל הנמענים יראו אחד את השני!",
        "",
        "מומלץ להשתמש ב־BCC לשמירה על פרטיות."
      ]
    : [
        "You are about to send an email to multiple visible recipients.",
        "All recipients will be able to see each other's addresses.",
        "",
        "We recommend using Bcc to protect privacy."
      ];
  const n = Math.max(0, Math.floor(Number(interceptTotal) || 0));
  lines.push("", formatInterceptStatsLine(isHe ? "he" : "en", n));
  lines.push("", isHe ? "מופעל על ידי erlix.net" : "Powered by erlix.net");
  return lines.join("\n");
}

const GROUP_HINT_PATTERN =
  /(group|list|distribution|distlist|dl|all[-_.]?|everyone|team|staff|dept|department|broadcast|members|alias|mailing|קבוצה|תפוצה|צוות|מחלקה|כולם|רשימה)/i;

const GROUP_ALIAS_PREFIX_PATTERN =
  /^(all|team|staff|group|groups|dl|dist|list|members|dept|department|office|broadcast|announce|news|everyone)([-_.]|$)/i;

const GROUP_ALIAS_SUFFIX_PATTERN =
  /([-_.])(all|team|staff|group|groups|dl|dist|list|members|dept|department|office|broadcast|announce|news|everyone)$/i;

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

function isLikelyGroupRecipient(recipient) {
  return getGroupSignalReason(recipient) !== null;
}

function getEmailLocalPart(email) {
  if (!email || !email.includes("@")) return "";
  return email.split("@")[0].trim();
}

function normalizedString(value) {
  return String(value || "").trim().toLowerCase();
}

function getGroupSignalReason(recipient) {
  const email = normalizedString(recipient?.emailAddress);
  const displayName = normalizedString(recipient?.displayName);
  const routingType = normalizedString(recipient?.routingType);
  const mailboxType = normalizedString(recipient?.mailboxType || recipient?.recipientType || recipient?.type);
  const raw = `${email} ${displayName}`.trim();

  if (!raw) return null;

  // Strong signal: recipient object already indicates group/list type.
  if (mailboxType && /(group|distribution|dl|list)/i.test(mailboxType)) {
    return "mailbox_type";
  }

  // Strong signal: common Exchange routing type for groups.
  if (routingType && /(ex|x500|x400)/i.test(routingType) && GROUP_HINT_PATTERN.test(raw)) {
    return "routing_and_name";
  }

  // Medium signal: explicit group/list keywords in alias/display.
  if (GROUP_HINT_PATTERN.test(raw)) {
    return "keyword";
  }

  const alias = getEmailLocalPart(email);
  if (!alias) return null;

  // Medium signal: known alias conventions used for distribution lists.
  if (GROUP_ALIAS_PREFIX_PATTERN.test(alias) || GROUP_ALIAS_SUFFIX_PATTERN.test(alias)) {
    return "alias_pattern";
  }

  // Soft signal: non-personal alias with separators and numeric audience hints.
  const hasSeparator = /[-_.]/.test(alias);
  const hasAudienceToken = /(all|team|staff|dept|office|sales|support|ops|hr|finance|it|security|everyone)/i.test(
    alias
  );
  if (hasSeparator && hasAudienceToken) {
    return "audience_alias";
  }

  return null;
}

function assessVisibleRecipients(item) {
  return Promise.all([getRecipientsAsync(item.to), getRecipientsAsync(item.cc)]).then(
    ([toRecipients, ccRecipients]) => {
      const visibleRecipients = [...toRecipients, ...ccRecipients];
      const seen = new Set();
      let hasLikelyGroup = false;
      const groupSignalReasons = [];

      visibleRecipients.forEach((recipient) => {
        const key = (recipient?.emailAddress || recipient?.displayName || "").trim().toLowerCase();
        if (key) seen.add(key);
        const reason = getGroupSignalReason(recipient);
        if (reason) {
          hasLikelyGroup = true;
          groupSignalReasons.push(reason);
        }
      });

      const uniqueVisibleCount = seen.size;
      const effectiveVisibleCount =
        hasLikelyGroup && uniqueVisibleCount <= 1 ? 2 : uniqueVisibleCount;

      return {
        uniqueVisibleCount,
        effectiveVisibleCount,
        hasLikelyGroup,
        groupSignalReasons
      };
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

/** Public URL path of the add-in root (e.g. /bcc-alert/addin) when page is under .../src/commands.html */
function getAddinPublicBasePath() {
  if (typeof window === "undefined" || !window.location?.pathname) {
    return "";
  }
  const p = window.location.pathname;
  const marker = "/src/";
  const i = p.indexOf(marker);
  if (i <= 0) {
    return "";
  }
  return p.slice(0, i);
}

function getMetricsEndpoint() {
  if (typeof window === "undefined" || !window.location?.origin) {
    return "https://localhost:3000/api/metrics";
  }
  const base = getAddinPublicBasePath();
  if (base) {
    return `${window.location.origin}${base}/api/metrics`;
  }
  return `${window.location.origin}/api/metrics`;
}

function reportDecisionMetric({ decision, visibleCount }) {
  const payload = {
    eventName: "onMessageSend",
    decision,
    visibleRecipientBucket: toRecipientBucket(visibleCount),
    policyVersion: "1.0.0"
  };

  const body = JSON.stringify(payload);
  const endpoint = getMetricsEndpoint();

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

function onNewMessageComposeHandler(event) {
  event.completed({ allowEvent: true });
}

function onMessageSendHandler(event) {
  if (!isMailboxRequirementSupported("1.12")) {
    event.completed({ allowEvent: true });
    return;
  }

  const item = Office.context.mailbox.item;
  assessVisibleRecipients(item).then(({ effectiveVisibleCount }) => {
    if (effectiveVisibleCount > POLICY.maxVisibleRecipients) {
      bumpInterceptCountAsync().then((interceptTotal) => {
        reportDecisionMetric({ decision: "blocked", visibleCount: effectiveVisibleCount });
        event.completed({
          allowEvent: false,
          errorMessage: buildSmartAlertErrorMessage(getUserLanguage(), interceptTotal)
        });
      });
      return;
    }
    reportDecisionMetric({ decision: "allowed", visibleCount: effectiveVisibleCount });
    event.completed({ allowEvent: true });
  }).catch(() => {
    // Never leave Smart Alert unresolved, otherwise Outlook shows generic timeout/system messages.
    event.completed({ allowEvent: true });
  });
}

if (typeof Office !== "undefined") {
  if (typeof Office.onReady === "function") {
    Office.onReady();
  }
  if (Office.actions && typeof Office.actions.associate === "function") {
    Office.actions.associate("onNewMessageComposeHandler", onNewMessageComposeHandler);
    Office.actions.associate("onMessageSendHandler", onMessageSendHandler);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ROAMING_INTERCEPT_COUNT_KEY,
    getInterceptCountSync,
    bumpInterceptCountSync,
    bumpInterceptCountAsync,
    getInterceptStatsDisplayParts,
    formatInterceptStatsLine,
    buildSmartAlertErrorMessage,
    getRecipientsAsync,
    countVisibleRecipients,
    getGroupSignalReason,
    isLikelyGroupRecipient,
    assessVisibleRecipients,
    getUserLanguage,
    isMailboxRequirementSupported,
    toRecipientBucket,
    getAddinPublicBasePath,
    getMetricsEndpoint,
    reportDecisionMetric,
    onNewMessageComposeHandler,
    onMessageSendHandler
  };
}

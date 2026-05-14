/* global Office, getErlixLicenseManager */

/**
 * Smart Alerts runtime: visible-recipient protection (Mailbox 1.12+).
 *
 * Subscription gating runs *before* any recipient assessment. When license is not
 * protection-active, this module must not scan, block, or call `event.completed({ allowEvent: false })`.
 *
 * Logging prefixes: [PROTECTION], [SUBSCRIPTION] (compose-time subscription UI only).
 */

const POLICY = {
  maxVisibleRecipients: 1
};

/** Returns the shared license manager, or null if the licensing script did not load. */
function getLicenseManagerSafe() {
  try {
    if (typeof getErlixLicenseManager === "function") {
      return getErlixLicenseManager();
    }
  } catch (_error) {
    /* ignore */
  }
  console.log("[LICENSE] LicenseManager unavailable — treating as no protection (fail-open send)");
  return null;
}

/**
 * One line for the Smart Alert dialog: subscription validity / days left (display only).
 * @param {string} lang
 * @param {object | null} lm License manager instance, or null.
 * @returns {string}
 */
function buildSubscriptionLineForBlockDialog(lang, lm) {
  const isHe = lang === "he";
  if (!lm) {
    return isHe ? "מצב מנוי: לא זמין." : "Subscription: status unavailable.";
  }

  if (typeof lm.isExpired === "function" && lm.isExpired()) {
    return isHe ? "מנוי: לא פעיל." : "Subscription: not active.";
  }

  const offline = typeof lm.isOfflineGrace === "function" && lm.isOfflineGrace();
  const days =
    typeof lm.getDisplayDaysUntilExpiry === "function" ? lm.getDisplayDaysUntilExpiry() : null;

  if (typeof lm.isExpiringSoon === "function" && lm.isExpiringSoon()) {
    const n = days !== null && days !== undefined ? days : "?";
    return isHe
      ? `מנוי: מתקרב לתפוגה — נשארו כ־${n} ימים.`
      : `Subscription: expiring soon — ${n} day(s) remaining.`;
  }

  if (days !== null && days !== undefined) {
    return isHe
      ? `מנוי: תקף — נשארו כ־${days} ימים לתפוגה.`
      : `Subscription: active — ${days} day(s) until expiry.`;
  }

  if (offline) {
    return isHe
      ? "מנוי: תקף (נתונים מהמטמון — יאומת מול השרת כשהרשת זמינה)."
      : "Subscription: active (cached; will sync when the network is available).";
  }

  return isHe ? "מנוי: תקף." : "Subscription: active.";
}

/**
 * @param {string} lang
 * @param {object | null} lm License manager instance, or null.
 */
function buildSmartAlertErrorMessage(lang, lm) {
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
  lines.push("", buildSubscriptionLineForBlockDialog(lang, lm));
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

const SMART_ALERT_DECISION_TIMEOUT_MS = 600;
/** Covers license fetch (≤5s) plus recipient assessment window. */
const SMART_ALERT_WATCHDOG_MS = 7000;

function withTimeout(promise, ms, fallbackValue) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallbackValue), ms);
    })
  ]);
}

function fireAndForget(task) {
  setTimeout(() => {
    try {
      Promise.resolve(task()).catch(() => {});
    } catch (_error) {
      // Ignore background task failures.
    }
  }, 0);
}

const NOTIF_KEY_SUB_EXPIRING = "ErlixSubscriptionExpiringSoon";
const NOTIF_KEY_SUB_INACTIVE = "ErlixSubscriptionInactive";
const NOTIFICATION_KEY_VISIBLE_RECIPIENTS = "BCCAlertVisibleRecipients";

function subscriptionComposeMessage(lang, lm) {
  if (!lm?.isExpiringSoon()) return null;
  const days = lm.getDaysLeft();
  const n = days !== null ? days : "?";
  if (lang === "he") {
    return `תוקף ההגנה של Erlix יפוג בעוד ${n} ימים.`;
  }
  return `Your Erlix protection expires in ${n} days.`;
}

/**
 * Non-blocking compose-time subscription notices only (no send interception).
 */
function applyComposeSubscriptionNotices(lang) {
  const item = Office?.context?.mailbox?.item;
  if (!item?.notificationMessages?.replaceAsync) return;

  const lm = getLicenseManagerSafe();
  if (!lm) return;

  const removeKeys = (keys) => {
    keys.forEach((key) => {
      try {
        if (item.notificationMessages.removeAsync) {
          item.notificationMessages.removeAsync(key);
        }
      } catch (_e) {
        /* ignore */
      }
    });
  };

  try {
    if (typeof lm.isOfflineGrace === "function" && lm.isOfflineGrace() && lm.isProtectionActive()) {
      removeKeys([NOTIF_KEY_SUB_EXPIRING, NOTIF_KEY_SUB_INACTIVE]);
      console.log("[SUBSCRIPTION] compose: subscription notices suppressed (offline grace)");
      return;
    }

    if (lm.isExpired()) {
      removeKeys([NOTIF_KEY_SUB_EXPIRING, NOTIFICATION_KEY_VISIBLE_RECIPIENTS]);
      const msg =
        lang === "he"
          ? "ההגנה של Erlix אינה פעילה. פג תוקף המנוי."
          : "Erlix protection inactive. Your subscription has expired.";
      console.log("[SUBSCRIPTION] compose: showing inactive notice (informational only)");
      item.notificationMessages.replaceAsync(NOTIF_KEY_SUB_INACTIVE, {
        type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
        message: msg,
        persistent: false
      });
      return;
    }

    removeKeys([NOTIF_KEY_SUB_INACTIVE, NOTIFICATION_KEY_VISIBLE_RECIPIENTS]);

    if (lm.isExpiringSoon()) {
      const message = subscriptionComposeMessage(lang, lm);
      if (message) {
        console.log("[SUBSCRIPTION] compose: showing expiring-soon notice");
        item.notificationMessages.replaceAsync(NOTIF_KEY_SUB_EXPIRING, {
          type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
          message,
          persistent: false
        });
      }
      return;
    }

    removeKeys([NOTIF_KEY_SUB_EXPIRING, NOTIF_KEY_SUB_INACTIVE, NOTIFICATION_KEY_VISIBLE_RECIPIENTS]);
  } catch (error) {
    console.log("[SUBSCRIPTION] compose notification failed (non-fatal)", error?.message || error);
  }
}

function onNewMessageComposeHandler(event) {
  try {
    event.completed({ allowEvent: true });
  } catch (_error) {
    /* ignore */
  }

  fireAndForget(async () => {
    try {
      const lm = getLicenseManagerSafe();
      if (!lm) return;
      await lm.resolveState();
      const lang = getUserLanguage();
      applyComposeSubscriptionNotices(lang);
    } catch (error) {
      console.log("[SUBSCRIPTION] compose license decorate failed (non-fatal)", error?.message || error);
    }
  });
}

function onMessageSendHandler(event) {
  let completed = false;
  const safeComplete = (payload) => {
    if (completed) return;
    completed = true;
    try {
      event.completed(payload);
    } catch (_error) {
      // Swallow completion errors; nothing else can recover here.
    }
  };

  const watchdog = setTimeout(() => {
    console.log("[PROTECTION] watchdog fired — fail-open allow send");
    safeComplete({ allowEvent: true });
  }, SMART_ALERT_WATCHDOG_MS);

  try {
    if (!isMailboxRequirementSupported("1.12")) {
      clearTimeout(watchdog);
      safeComplete({ allowEvent: true });
      return;
    }

    const item = Office?.context?.mailbox?.item;
    if (!item?.to || !item?.cc) {
      clearTimeout(watchdog);
      safeComplete({ allowEvent: true });
      return;
    }

    (async () => {
      try {
        const lm = getLicenseManagerSafe();
        if (!lm) {
          clearTimeout(watchdog);
          safeComplete({ allowEvent: true });
          return;
        }

        await lm.resolveState();
        if (!lm.isProtectionActive()) {
          console.log("[LICENSE] not protection-active — skipping scan/block (fail-open send)");
          console.log("[PROTECTION] recipient enforcement skipped due to license state");
          clearTimeout(watchdog);
          safeComplete({ allowEvent: true });
          return;
        }

        const assessment = await withTimeout(
          assessVisibleRecipients(item),
          SMART_ALERT_DECISION_TIMEOUT_MS,
          { timedOut: true, effectiveVisibleCount: 0 }
        );

        clearTimeout(watchdog);

        if (assessment?.timedOut) {
          console.log("[PROTECTION] assessment timed out — allow send");
          safeComplete({ allowEvent: true });
          fireAndForget(() => reportDecisionMetric({ decision: "allowed", visibleCount: 0 }));
          return;
        }

        const effectiveVisibleCount = Math.max(0, Number(assessment?.effectiveVisibleCount) || 0);
        if (effectiveVisibleCount > POLICY.maxVisibleRecipients) {
          console.log("[PROTECTION] blocking send (policy)", { effectiveVisibleCount });
          safeComplete({
            allowEvent: false,
            errorMessage: buildSmartAlertErrorMessage(getUserLanguage(), lm)
          });
          fireAndForget(() => reportDecisionMetric({ decision: "blocked", visibleCount: effectiveVisibleCount }));
          return;
        }

        console.log("[PROTECTION] allow send (policy pass)", { effectiveVisibleCount });
        safeComplete({ allowEvent: true });
        fireAndForget(() => reportDecisionMetric({ decision: "allowed", visibleCount: effectiveVisibleCount }));
      } catch (error) {
        console.log("[PROTECTION] handler error — fail-open allow", error?.message || error);
        clearTimeout(watchdog);
        safeComplete({ allowEvent: true });
      }
    })();
  } catch (error) {
    console.log("[PROTECTION] sync error — fail-open allow", error?.message || error);
    clearTimeout(watchdog);
    safeComplete({ allowEvent: true });
  }
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
    buildSubscriptionLineForBlockDialog,
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
    onMessageSendHandler,
    NOTIF_KEY_SUB_EXPIRING,
    NOTIF_KEY_SUB_INACTIVE,
    applyComposeSubscriptionNotices
  };
}

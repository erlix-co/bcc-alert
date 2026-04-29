/* global Office */

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

function onMessageSendHandler(event) {
  const item = Office.context.mailbox.item;
  countVisibleRecipients(item).then((visibleCount) => {
    if (visibleCount > 1) {
      event.completed({
        allowEvent: false,
        errorMessage:
          "שים לב! הנך שולח למספר נמענים באופן חשוף. שקול להשתמש בעותק מוסתר."
      });
      return;
    }
    event.completed({ allowEvent: true });
  });
}

Office.onReady(() => {
  Office.actions.associate("onMessageSendHandler", onMessageSendHandler);
});

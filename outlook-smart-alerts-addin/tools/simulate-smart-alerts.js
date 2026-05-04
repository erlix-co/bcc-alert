/* eslint-disable no-console */
"use strict";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const roamingStore = {};

global.Office = {
  AsyncResultStatus: {
    Succeeded: "succeeded"
  },
  context: {
    displayLanguage: "he-IL",
    requirements: {
      isSetSupported: (setName, minVersion) => setName === "Mailbox" && minVersion === "1.12"
    },
    roamingSettings: {
      get(name) {
        return Object.prototype.hasOwnProperty.call(roamingStore, name) ? roamingStore[name] : undefined;
      },
      set(name, value) {
        roamingStore[name] = value;
      },
      saveAsync(callback) {
        if (typeof callback === "function") {
          callback({ status: Office.AsyncResultStatus.Succeeded });
        }
      }
    },
    mailbox: {
      item: null
    }
  },
  onReady: () => {},
  actions: {
    associate: () => {}
  }
};

const { onMessageSendHandler } = require("../src/launchevent");

function makeField(recipients) {
  return {
    getAsync(callback) {
      callback({
        status: Office.AsyncResultStatus.Succeeded,
        value: recipients
      });
    }
  };
}

function runScenario(name, { to, cc, bcc }) {
  return new Promise((resolve) => {
    Office.context.mailbox.item = {
      to: makeField(to),
      cc: makeField(cc),
      bcc: makeField(bcc)
    };

    onMessageSendHandler({
      completed(result) {
        console.log(`\n[${name}]`);
        console.log(`allowEvent: ${result.allowEvent}`);
        if (result.errorMessage) {
          console.log(`errorMessage: ${result.errorMessage}`);
        }
        resolve(result);
      }
    });
  });
}

async function main() {
  await runScenario("תרחיש 1 - נמען אחד ב-To/Cc", {
    to: [{ emailAddress: "one@example.com" }],
    cc: [],
    bcc: []
  });

  await runScenario("תרחיש 2 - שני נמענים ומעלה ב-To/Cc", {
    to: [{ emailAddress: "one@example.com" }],
    cc: [{ emailAddress: "two@example.com" }],
    bcc: []
  });

  await runScenario("תרחיש 3 - Bcc בלבד", {
    to: [],
    cc: [],
    bcc: [{ emailAddress: "hidden@example.com" }]
  });

  await runScenario("תרחיש 4 - קבוצת תפוצה כנמען יחיד", {
    to: [{ emailAddress: "all-staff@example.com", displayName: "All Staff" }],
    cc: [],
    bcc: []
  });

  await runScenario("תרחיש 5 - אליאס מחלקתי כנמען יחיד", {
    to: [{ emailAddress: "finance_team@example.com", displayName: "Finance Team" }],
    cc: [],
    bcc: []
  });

  // Allow fire-and-forget telemetry requests to finish before process exits.
  await new Promise((resolve) => setTimeout(resolve, 500));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

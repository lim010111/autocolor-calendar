import { describe, expect, it } from "vitest";

import { loadGasAddon, notificationTexts } from "./_helpers/gasAddon";
import { loadGasMessages } from "./_helpers/gasSwatches";

// `actionCompleteSignIn` is the deterministic half of the OAuth return path
// (gas/AGENTS.md "Post-OAuth re-render is NOT automatic"). It exists so a user
// whose add-on did not auto-re-render can still get out of the sign-in card —
// which means it must never *claim* the trip is over when it isn't.
//
// The bug this pins: it used to gate on `AutoColorAuth.isAuthenticated()`
// alone, i.e. "a session token exists locally". The reconnect card is reached
// with that token perfectly valid — once `oauth_tokens.needs_reauth` is armed
// by a background sync, `/sync/run` answers 503 `reauth_required`, never 401,
// so nothing clears it. Pressing the button before finishing OAuth therefore
// popped the user back to Home under a "signed in" toast with the account
// still broken. `/me.needs_reauth` is the authority.
const MSG = loadGasMessages();
const NOT_YET = MSG["en"]!["auth.toast.notYet"]!;
const LOGGED_IN = MSG["en"]!["auth.toast.loggedIn"]!;
const EVENT = { userLocale: "en" };

const me = (body: Record<string, unknown>) => ({
  status: 200,
  body: JSON.stringify(body),
});

describe("gas/addon.js actionCompleteSignIn", () => {
  it("refuses to report success while /me says needs_reauth", () => {
    const gas = loadGasAddon({
      sessionToken: "live-session",
      http: (endpoint) =>
        endpoint === "/me" ? me({ needs_reauth: true }) : undefined,
    });

    gas.actionCompleteSignIn(EVENT);

    expect(gas.requested).toContain("/me");
    expect(notificationTexts(gas.calls)).toContain(NOT_YET);
    expect(notificationTexts(gas.calls)).not.toContain(LOGGED_IN);
    // Staying put is the point — navigating away is what stranded the user.
    expect(gas.calls.map((c) => c.method)).not.toContain("setNavigation");
  });

  it("refuses when the session token is gone (401 cleared it)", () => {
    const gas = loadGasAddon({ sessionToken: null });

    gas.actionCompleteSignIn(EVENT);

    expect(gas.requested).toEqual([]); // no token, nothing to ask /me about
    expect(notificationTexts(gas.calls)).toContain(NOT_YET);
  });

  it("refuses when /me itself 401s mid-press", () => {
    const gas = loadGasAddon({
      sessionToken: "stale-session",
      http: () => ({ status: 401, body: "{}" }),
    });

    gas.actionCompleteSignIn(EVENT);

    expect(notificationTexts(gas.calls)).toContain(NOT_YET);
    expect(gas.calls.map((c) => c.method)).not.toContain("setNavigation");
  });

  it("completes the trip when the grant is live", () => {
    const gas = loadGasAddon({
      sessionToken: "live-session",
      http: (endpoint) =>
        endpoint === "/me"
          ? me({ needs_reauth: false, push_active: true })
          : undefined,
    });

    gas.actionCompleteSignIn(EVENT);

    expect(notificationTexts(gas.calls)).toContain(LOGGED_IN);
    expect(gas.calls.map((c) => c.method)).toContain("setNavigation");
  });

  it("a transient /me failure does not block the user", () => {
    // 5xx exhausts gas/api.js's retry loop and throws a non-AUTH_EXPIRED
    // error. Treating that as "not signed in" would re-create the dead end
    // from the other side; the home card renders its own error states.
    const gas = loadGasAddon({
      sessionToken: "live-session",
      http: () => ({ status: 500, body: "{}" }),
    });

    gas.actionCompleteSignIn(EVENT);

    expect(notificationTexts(gas.calls)).toContain(LOGGED_IN);
    expect(gas.calls.map((c) => c.method)).toContain("setNavigation");
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Same evaluate-the-real-file trick as `gasSwatches.ts`: the Add-on is Apps
// Script globals with no module system, so the only way to test a card action
// without duplicating it here is to concatenate the files Apps Script would
// have loaded into one flat scope and hand back the globals. Every GAS API
// reference sits inside a function body, so loading is side-effect free and
// the stubs below only have to survive the call under test.

const GAS_FILES = [
  "config.js",
  "i18n.js",
  "auth.js",
  "api.js",
  "storage.js",
  "addon.js",
];

export type GasCall = { method: string; args: unknown[] };

export type HttpStub = (
  endpoint: string,
) => { status: number; body: string } | undefined;

export type GasAddonHarness = {
  /** Every CardService method call, in order, across all builders. */
  calls: GasCall[];
  /** Endpoints `fetchBackend` was asked for, in order. */
  requested: string[];
  actionCompleteSignIn: (e: unknown) => unknown;
};

/**
 * @param sessionToken  what UserProperties holds (null = signed out)
 * @param http          per-endpoint response stub; undefined = 200 `{}`
 */
export function loadGasAddon(args: {
  sessionToken: string | null;
  http?: HttpStub;
}): GasAddonHarness {
  const calls: GasCall[] = [];
  const requested: string[] = [];

  // One chainable recorder stands in for every CardService builder: each
  // method logs and returns itself. The action under test is asserted on the
  // call log, not on a rendered card, so faithful card shapes are unneeded.
  const recorder: unknown = new Proxy(function () {} as object, {
    get(_t, prop: string) {
      if (prop === "then") return undefined; // not a thenable
      return (...callArgs: unknown[]) => {
        calls.push({ method: prop, args: callArgs });
        return recorder;
      };
    },
    apply: () => recorder,
  });

  const props = new Map<string, string>();
  if (args.sessionToken !== null) {
    props.set("ACFC_SESSION_TOKEN", args.sessionToken);
  }
  const propertyStore = {
    getProperty: (k: string) => props.get(k) ?? null,
    setProperty: (k: string, v: string) => props.set(k, v),
    deleteProperty: (k: string) => props.delete(k),
  };
  // Script properties: the backend URL must read as configured, everything
  // else falls through to the same map.
  const scriptProps = {
    getProperty: (k: string) =>
      k === "BACKEND_BASE_URL"
        ? "https://api.test.invalid"
        : k === "OAUTH_AUTH_URL"
          ? "https://api.test.invalid/oauth/google"
          : (props.get(k) ?? null),
    setProperty: propertyStore.setProperty,
    deleteProperty: propertyStore.deleteProperty,
  };

  const globals = {
    CardService: recorder,
    PropertiesService: {
      getUserProperties: () => propertyStore,
      getScriptProperties: () => scriptProps,
    },
    UrlFetchApp: {
      fetch: (url: string) => {
        const endpoint = url.replace("https://api.test.invalid", "");
        requested.push(endpoint);
        const res = args.http?.(endpoint) ?? { status: 200, body: "{}" };
        return {
          getResponseCode: () => res.status,
          getContentText: () => res.body,
        };
      },
    },
    Utilities: { sleep: () => undefined },
  };

  const source = GAS_FILES.map((f) =>
    readFileSync(fileURLToPath(new URL(`../../../gas/${f}`, import.meta.url)), "utf8"),
  ).join("\n");

  const factory = new Function(
    ...Object.keys(globals),
    `${source}\nreturn { actionCompleteSignIn: actionCompleteSignIn };`,
  ) as (...deps: unknown[]) => { actionCompleteSignIn: (e: unknown) => unknown };

  const api = factory(...Object.values(globals));
  return { calls, requested, actionCompleteSignIn: api.actionCompleteSignIn };
}

/** The i18n copy the action is expected to have shown. */
export function notificationTexts(calls: GasCall[]): string[] {
  return calls
    .filter((c) => c.method === "setText")
    .map((c) => String(c.args[0]));
}

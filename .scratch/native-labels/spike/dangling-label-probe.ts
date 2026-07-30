#!/usr/bin/env tsx
/**
 * ADR-0008 spike — what happens to an event whose label DEFINITION is deleted?
 *
 * Answers P1: after `calendars.patch` removes a label entry that an event
 * still references, does `events.get` return the dangling `eventLabelId`, an
 * empty one, or something else? And does `colorId` fill in?
 *
 * That answer decides nothing about the design — `colorRollback`'s
 * order-independence clause sweeps the marker either way — but ADR-0008
 * carries an "unmeasured" note that this closes.
 *
 * Self-cleaning: creates its own throwaway event, mints its own label, and
 * removes both in a finally block. Touches nothing that already existed.
 *
 * SECURITY: never prints tokens, keys, or ciphertext.
 *
 * Usage: pnpm tsx <this file> [--env .dev.vars|.prod.vars]
 */
import { createDecipheriv } from "node:crypto";

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const EMAIL = "limwoohyun01@gmail.com";
const PROBE_LABEL_NAME = "ZZZ-adr0008-probe";
const PROBE_EVENT_SUMMARY = "ZZZ-adr0008-probe (auto-deleted)";
const CAL = "primary";
const BASE = "https://www.googleapis.com/calendar/v3";

const envFile = process.argv.includes("--env")
  ? process.argv[process.argv.indexOf("--env") + 1]!
  : ".dev.vars";

loadEnv({ path: envFile });
const dbUrl = process.env["DIRECT_DATABASE_URL"];
const keyB64 = process.env["TOKEN_ENCRYPTION_KEY"];
const clientId = process.env["GOOGLE_CLIENT_ID"];
const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
if (!dbUrl || !keyB64 || !clientId || !clientSecret) {
  throw new Error(`missing env in ${envFile}`);
}

function fromBase64Url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

type LabelEntry = { id: string; backgroundColor?: string; name?: string };

async function getAccessToken(): Promise<string> {
  const sql = postgres(dbUrl!, { max: 1, prepare: false });
  const rows = await sql`
    select u.id, t.encrypted_refresh_token, t.iv
    from users u join oauth_tokens t on t.user_id = u.id
    where u.email = ${EMAIL} and t.provider = 'google'
    limit 1`;
  await sql.end();
  if (rows.length === 0) throw new Error(`no user in ${envFile}`);
  const { id: userId, encrypted_refresh_token: ct, iv } = rows[0]!;

  const key = fromBase64Url(keyB64!);
  const ctBuf = Buffer.from(ct as Uint8Array);
  const dec = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv as Uint8Array),
  );
  dec.setAAD(Buffer.from(`user:${userId}`));
  dec.setAuthTag(ctBuf.subarray(ctBuf.length - 16));
  const refreshToken = Buffer.concat([
    dec.update(ctBuf.subarray(0, ctBuf.length - 16)),
    dec.final(),
  ]).toString("utf8");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
    }),
  });
  if (!res.ok) throw new Error(`token refresh ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function main() {
  const accessToken = await getAccessToken();
  const H = { authorization: `Bearer ${accessToken}` };
  const HJ = { ...H, "content-type": "application/json" };
  console.log(`token ok (${envFile})`);

  const readLabels = async (): Promise<{
    calendarId: string;
    labels: LabelEntry[];
  }> => {
    const r = await fetch(
      `${BASE}/calendars/${CAL}?fields=id,labelProperties`,
      { headers: H },
    );
    if (!r.ok) throw new Error(`calendars.get ${r.status}`);
    const b = (await r.json()) as {
      id: string;
      labelProperties?: { eventLabels?: LabelEntry[] };
    };
    return { calendarId: b.id, labels: b.labelProperties?.eventLabels ?? [] };
  };

  const writeLabels = async (
    calendarId: string,
    labels: LabelEntry[],
  ): Promise<number> => {
    const r = await fetch(`${BASE}/calendars/${calendarId}`, {
      method: "PATCH",
      headers: HJ,
      body: JSON.stringify({ labelProperties: { eventLabels: labels } }),
    });
    if (!r.ok) {
      console.log(`  calendars.patch ${r.status}: ${(await r.text()).slice(0, 300)}`);
    }
    return r.status;
  };

  let eventId: string | null = null;
  let labelId: string | null = null;
  const { calendarId, labels: original } = await readLabels();
  console.log(`calendar id resolved, ${original.length} existing label entries`);

  try {
    // --- mint a throwaway label -------------------------------------------
    labelId = crypto.randomUUID();
    const mintStatus = await writeLabels(calendarId, [
      ...original,
      { id: labelId, backgroundColor: "#d81b60", name: PROBE_LABEL_NAME },
    ]);
    console.log(`mint label: HTTP ${mintStatus}`);
    if (mintStatus >= 300) return;

    // --- create a throwaway event, tomorrow, 15 minutes -------------------
    const start = new Date(Date.now() + 24 * 3600 * 1000);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 15 * 60 * 1000);
    const evRes = await fetch(`${BASE}/calendars/${CAL}/events`, {
      method: "POST",
      headers: HJ,
      body: JSON.stringify({
        summary: PROBE_EVENT_SUMMARY,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      }),
    });
    if (!evRes.ok) {
      console.log(`events.insert ${evRes.status}: ${(await evRes.text()).slice(0, 300)}`);
      return;
    }
    eventId = ((await evRes.json()) as { id: string }).id;
    console.log(`event created`);

    // --- assign the label + our markers -----------------------------------
    const patchRes = await fetch(
      `${BASE}/calendars/${CAL}/events/${eventId}?eventLabelVersion=1`,
      {
        method: "PATCH",
        headers: HJ,
        body: JSON.stringify({
          eventLabelId: labelId,
          extendedProperties: {
            private: {
              autocolor_v: "2",
              autocolor_label: labelId,
              autocolor_category: "adr0008-probe",
            },
          },
        }),
      },
    );
    console.log(`assign label: HTTP ${patchRes.status}`);

    const readEvent = async (tag: string) => {
      const r = await fetch(`${BASE}/calendars/${CAL}/events/${eventId}`, {
        headers: H,
      });
      const b = (await r.json()) as Record<string, unknown>;
      console.log(
        `  ${tag}: colorId=${JSON.stringify(b["colorId"] ?? "(absent)")} ` +
          `eventLabelId=${JSON.stringify(b["eventLabelId"] ?? "(absent)")}`,
      );
      return b;
    };

    console.log("\n=== BEFORE deleting the label definition ===");
    await readEvent("v0 read");
    const r1 = await fetch(
      `${BASE}/calendars/${CAL}/events/${eventId}?eventLabelVersion=1`,
      { headers: H },
    );
    const b1 = (await r1.json()) as Record<string, unknown>;
    console.log(
      `  v1 read: colorId=${JSON.stringify(b1["colorId"] ?? "(absent)")} ` +
        `eventLabelId=${JSON.stringify(b1["eventLabelId"] ?? "(absent)")}`,
    );

    // --- P2: does calendars.patch refuse to drop an in-use label? ----------
    console.log("\n=== P2: delete the label definition while in use ===");
    const { calendarId: cid2, labels: cur } = await readLabels();
    const status = await writeLabels(
      cid2,
      cur.filter((l) => l.id !== labelId),
    );
    console.log(`  calendars.patch (remove in-use label): HTTP ${status}`);
    const after = await readLabels();
    console.log(
      `  label still present after patch: ${after.labels.some((l) => l.id === labelId)}`,
    );

    // --- P1: what does the event look like now? ---------------------------
    console.log("\n=== P1: the event after its label definition is gone ===");
    await readEvent("v0 read");
    const r2 = await fetch(
      `${BASE}/calendars/${CAL}/events/${eventId}?eventLabelVersion=1`,
      { headers: H },
    );
    const b2 = (await r2.json()) as Record<string, unknown>;
    console.log(
      `  v1 read: colorId=${JSON.stringify(b2["colorId"] ?? "(absent)")} ` +
        `eventLabelId=${JSON.stringify(b2["eventLabelId"] ?? "(absent)")}`,
    );
    console.log(
      `  markers intact: ${JSON.stringify(
        (b2["extendedProperties"] as { private?: unknown } | undefined)
          ?.private ?? "(absent)",
      )}`,
    );

    // --- does the rollback PATCH still work on a dangling reference? ------
    const clearRes = await fetch(
      `${BASE}/calendars/${CAL}/events/${eventId}?eventLabelVersion=1`,
      {
        method: "PATCH",
        headers: HJ,
        body: JSON.stringify({
          eventLabelId: "",
          extendedProperties: {
            private: {
              autocolor_v: null,
              autocolor_label: null,
              autocolor_category: null,
            },
          },
        }),
      },
    );
    console.log(`\n  clearEventLabel on a dangling ref: HTTP ${clearRes.status}`);
  } finally {
    // --- cleanup: always, even on throw -----------------------------------
    console.log("\n=== cleanup ===");
    if (eventId) {
      const r = await fetch(`${BASE}/calendars/${CAL}/events/${eventId}`, {
        method: "DELETE",
        headers: H,
      });
      console.log(`  event deleted: HTTP ${r.status}`);
    }
    const { calendarId: cid, labels } = await readLabels();
    const leftover = labels.filter((l) => l.id === labelId);
    if (leftover.length > 0) {
      const s = await writeLabels(
        cid,
        labels.filter((l) => l.id !== labelId),
      );
      console.log(`  probe label removed: HTTP ${s}`);
    } else {
      console.log("  probe label already absent");
    }
    const final = await readLabels();
    console.log(
      `  label count: ${original.length} before → ${final.labels.length} after`,
    );
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

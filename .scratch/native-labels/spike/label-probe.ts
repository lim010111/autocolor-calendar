#!/usr/bin/env tsx
/**
 * native-labels spike — raw Calendar API probe (operator workstation only).
 *
 * Answers, against the REAL API with the user's own token:
 *   P1. Does an unmasked events.get return `eventLabelId` (and what colorId)?
 *   P2. What does calendars.get labelProperties contain (are the 24 defaults
 *       label entries? what UUID/color is "내가 만든 라벨" / the custom color)?
 *   P3. Does a PATCH with eventLabelVersion=1 + eventLabelId work, and what
 *       does a v0 read show afterwards?
 *
 * SECURITY: never prints tokens, keys, or ciphertext. Prints only
 * color/label-relevant fields of the four TEST-* events.
 *
 * Usage: pnpm tsx <this file> [--env .dev.vars|.prod.vars] [--write]
 */
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { createDecipheriv } from "node:crypto";

const EMAIL = "limwoohyun01@gmail.com";
const TEST_EVENTS: Record<string, string> = {
  "TEST-A": "5eppi2u5fu9bafkcve6g1nct08",
  "TEST-B": "4a7cru503kiufckjgohubqresl",
  "TEST-C": "1rq79t4h9q82j8qu4mitd7qoeh",
  "TEST-D": "407uvskckmrj3uc6f1d43900cg",
};

const envFile = process.argv.includes("--env")
  ? process.argv[process.argv.indexOf("--env") + 1]!
  : ".dev.vars";
const doWrite = process.argv.includes("--write");

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

async function main() {
  const sql = postgres(dbUrl!, { max: 1, prepare: false });
  const rows = await sql`
    select u.id, t.encrypted_refresh_token, t.iv
    from users u join oauth_tokens t on t.user_id = u.id
    where u.email = ${EMAIL} and t.provider = 'google'
    limit 1`;
  await sql.end();
  if (rows.length === 0) {
    console.log(`NO_USER_IN ${envFile}`);
    return;
  }
  const { id: userId, encrypted_refresh_token: ct, iv } = rows[0]!;
  console.log(`user found in ${envFile} (id ${String(userId).slice(0, 8)}…)`);

  // WebCrypto AES-GCM output = ciphertext || 16-byte tag; node needs them split.
  const key = fromBase64Url(keyB64!);
  const ctBuf = Buffer.from(ct as Uint8Array);
  const body = ctBuf.subarray(0, ctBuf.length - 16);
  const tag = ctBuf.subarray(ctBuf.length - 16);
  const dec = createDecipheriv("aes-256-gcm", key, Buffer.from(iv as Uint8Array));
  dec.setAAD(Buffer.from(`user:${userId}`));
  dec.setAuthTag(tag);
  const refreshToken = Buffer.concat([dec.update(body), dec.final()]).toString("utf8");

  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
    }),
  });
  if (!tokRes.ok) {
    console.log(`TOKEN_REFRESH_FAILED ${tokRes.status}: ${(await tokRes.text()).slice(0, 200)}`);
    return;
  }
  const accessToken = ((await tokRes.json()) as { access_token: string }).access_token;
  const H = { authorization: `Bearer ${accessToken}` };
  const pick = (e: Record<string, unknown>) => ({
    summary: e["summary"],
    colorId: e["colorId"] ?? "(absent)",
    eventLabelId: e["eventLabelId"] ?? "(absent)",
    extendedProperties: e["extendedProperties"] ?? "(absent)",
    unknownColorish: Object.keys(e).filter((k) => /label|color/i.test(k)),
  });

  console.log("\n=== P1: unmasked events.get (v0 reader, no fields param) ===");
  for (const [name, id] of Object.entries(TEST_EVENTS)) {
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`,
      { headers: H },
    );
    if (!r.ok) {
      console.log(`${name}: HTTP ${r.status}`);
      continue;
    }
    console.log(name, JSON.stringify(pick((await r.json()) as Record<string, unknown>)));
  }

  console.log("\n=== P2: calendars.get labelProperties ===");
  const calRes = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary?fields=labelProperties",
    { headers: H },
  );
  console.log(`HTTP ${calRes.status}`);
  const calJson = (await calRes.json()) as {
    labelProperties?: { eventLabels?: { id: string; backgroundColor?: string; name?: string }[] };
  };
  const labels = calJson.labelProperties?.eventLabels ?? [];
  console.log(`label count: ${labels.length}`);
  for (const l of labels) {
    console.log(`  ${l.id}  bg=${l.backgroundColor}  name=${l.name ?? "(unnamed)"}`);
  }

  if (doWrite) {
    const target = labels.find((l) => l.name && l.name.length > 0);
    if (!target) {
      console.log("\nP3 skipped: no named label found");
      return;
    }
    console.log(`\n=== P3: PATCH TEST-B with eventLabelVersion=1 -> label "${target.name}" ===`);
    const w = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${TEST_EVENTS["TEST-B"]}?eventLabelVersion=1`,
      {
        method: "PATCH",
        headers: { ...H, "content-type": "application/json" },
        body: JSON.stringify({ eventLabelId: target.id }),
      },
    );
    console.log(`PATCH HTTP ${w.status}`);
    if (w.ok) console.log("PATCH response fields:", JSON.stringify(pick((await w.json()) as Record<string, unknown>)));
    const back = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${TEST_EVENTS["TEST-B"]}`,
      { headers: H },
    );
    if (back.ok) console.log("v0 re-read:", JSON.stringify(pick((await back.json()) as Record<string, unknown>)));
  }
}

main().catch((e) => {
  console.error("PROBE_ERROR", e instanceof Error ? e.message : String(e));
  process.exit(1);
});

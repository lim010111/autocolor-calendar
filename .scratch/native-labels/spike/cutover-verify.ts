#!/usr/bin/env tsx
/**
 * native-labels #04 — post-cutover READ-ONLY verification probe.
 *
 * Answers with live prod data:
 *   V1. Does every active rule's labelId exist as a NAMED chip in
 *       calendars.get labelProperties? (AC 2's machine-checkable half)
 *   V2. Do any marker-v1 events remain (autocolor_v=1)? (AC 3 — nothing to
 *       re-imprint means the full resync is a no-op)
 *   V3. Is the tombstoned rule's label actually gone from Google?
 *   V4. Full 24-slot hex dump — the `#d81b60` TODO in gen-swatch-assets.py.
 *
 * SECURITY: never prints tokens/keys/ciphertext; event payloads are NOT
 * printed (ids + marker values only). Operator console only.
 *
 * Usage: pnpm tsx .scratch/native-labels/spike/cutover-verify.ts --env .prod.vars
 */
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { createDecipheriv } from "node:crypto";

const EMAIL = "limwoohyun01@gmail.com";
const envFile = process.argv.includes("--env")
  ? process.argv[process.argv.indexOf("--env") + 1]!
  : ".dev.vars";
loadEnv({ path: envFile, override: true });
const dbUrl = process.env["DIRECT_DATABASE_URL"]!;
const keyB64 = process.env["TOKEN_ENCRYPTION_KEY"]!;
const clientId = process.env["GOOGLE_CLIENT_ID"]!;
const clientSecret = process.env["GOOGLE_CLIENT_SECRET"]!;

function fromBase64Url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function main() {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  const rows = await sql`
    select u.id, t.encrypted_refresh_token, t.iv
    from users u join oauth_tokens t on t.user_id = u.id
    where u.email = ${EMAIL} and t.provider = 'google' limit 1`;
  const cats = (await sql`
    select c.name, c.label_id, c.label_deleted_at from categories c
    join users u on u.id = c.user_id where u.email = ${EMAIL}
    order by c.created_at`) as unknown as Array<{
    name: string; label_id: string | null; label_deleted_at: Date | null;
  }>;
  await sql.end();

  const { id: userId, encrypted_refresh_token: ct, iv } = rows[0]! as any;
  const key = fromBase64Url(keyB64);
  const ctBuf = Buffer.from(ct as Uint8Array);
  const dec = createDecipheriv("aes-256-gcm", key, Buffer.from(iv as Uint8Array));
  dec.setAAD(Buffer.from(`user:${userId}`));
  dec.setAuthTag(ctBuf.subarray(ctBuf.length - 16));
  const refreshToken = Buffer.concat([
    dec.update(ctBuf.subarray(0, ctBuf.length - 16)), dec.final(),
  ]).toString("utf8");

  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: refreshToken,
      client_id: clientId, client_secret: clientSecret,
    }),
  });
  if (!tokRes.ok) throw new Error(`token refresh ${tokRes.status}`);
  const accessToken = ((await tokRes.json()) as { access_token: string }).access_token;

  // --- V1/V3/V4: labelProperties -------------------------------------
  const calRes = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary?fields=id,labelProperties",
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  const cal = (await calRes.json()) as {
    id?: string;
    labelProperties?: { eventLabels?: Array<{ id: string; name?: string; backgroundColor?: string }> };
  };
  const labels = cal.labelProperties?.eventLabels ?? [];
  console.log(`calendars.get ${calRes.status} — resolved id present: ${Boolean(cal.id)}`);
  console.log(`\n=== V4: ${labels.length} label slots ===`);
  for (const l of labels) {
    console.log(`  ${l.backgroundColor ?? "(no color)"}  ${l.name ? `"${l.name}"` : "(unnamed)"}  ${l.id}`);
  }

  console.log(`\n=== V1/V3: rule -> label chip ===`);
  const byId = new Map(labels.map((l) => [l.id.toLowerCase(), l]));
  for (const c of cats) {
    const chip = c.label_id ? byId.get(c.label_id.toLowerCase()) : undefined;
    const state = c.label_deleted_at ? "TOMBSTONED" : "active";
    console.log(
      `  "${c.name}" [${state}] labelId=${c.label_id ?? "NULL"} -> ` +
        (chip ? `chip name="${chip.name ?? "(unnamed)"}" ${chip.backgroundColor}` : "ABSENT from Google"),
    );
  }

  // --- V2: marker version census -------------------------------------
  console.log(`\n=== V2: marker census (events.list, privateExtendedProperty) ===`);
  for (const v of ["1", "2"]) {
    let pageToken: string | undefined;
    let count = 0;
    const sample: string[] = [];
    do {
      const u = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      u.searchParams.set("privateExtendedProperty", `autocolor_v=${v}`);
      u.searchParams.set("maxResults", "250");
      u.searchParams.set("showDeleted", "false");
      u.searchParams.set("singleEvents", "false");
      u.searchParams.set("fields", "nextPageToken,items(id,eventLabelId,colorId)");
      if (pageToken) u.searchParams.set("pageToken", pageToken);
      const r = await fetch(u, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!r.ok) { console.log(`  v${v}: list ${r.status} ${(await r.text()).slice(0, 120)}`); break; }
      const b = (await r.json()) as {
        nextPageToken?: string;
        items?: Array<{ id: string; eventLabelId?: string; colorId?: string }>;
      };
      for (const it of b.items ?? []) {
        count++;
        if (sample.length < 8) {
          sample.push(`${it.id.slice(0, 10)}… label=${it.eventLabelId ?? "(absent)"} colorId=${it.colorId ?? "(absent)"}`);
        }
      }
      pageToken = b.nextPageToken;
    } while (pageToken);
    console.log(`  autocolor_v=${v}: ${count} events`);
    for (const s of sample) console.log(`      ${s}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

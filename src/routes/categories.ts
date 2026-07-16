import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db";
import type { Bindings, HonoEnv } from "../env";
import { authMiddleware } from "../middleware/auth";
import { appendEventLabel, EventLabelCapError } from "../services/eventLabels";
import { CalendarApiError } from "../services/googleCalendar";
import { nearestClassicColorId } from "../services/labelReconcile";
import {
  createRule,
  deleteRule,
  DuplicateRuleNameError,
  listRules,
  updateRule,
  type Rule,
} from "../services/ruleService";
import { getValidAccessToken, ReauthRequiredError } from "../services/tokenRefresh";

// Thin Hono adapter over `ruleService`. The URL path `/api/categories` and
// the wire JSON shape (`{ id, name, colorId, keywords, priority, createdAt,
// updatedAt }`) are preserved for GAS Add-on compatibility — see
// `CONTEXT.md` "Flagged ambiguities" for why the DB/wire stays
// `categories` while the domain language is `Rule`.

export const categoriesRoutes = new Hono<HonoEnv>();

categoriesRoutes.use("*", authMiddleware);

const ColorIdSchema = z.enum([
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
]);
// ADR-0006 (native-labels #03) — label background color. Google's label
// entries carry a 6-digit hex; the picker sends one of the 24 defaults but
// any hex is representable (custom RGB labels exist in the Google UI).
const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const KeywordsSchema = z
  .array(z.string().trim().min(1).max(100))
  .min(1)
  .max(10);

const CreateBodyBase = z.object({
  name: z.string().trim().min(1).max(100),
  // native-labels #03: `backgroundColor` (hex) makes this route create the
  // Google label too (labelId linked, colorId filled as a nearest-classic
  // cache). `colorId` alone keeps the pre-label behavior — the enum CHECK
  // relaxation is #04 scope; here the legacy contract is preserved as-is.
  colorId: ColorIdSchema.optional(),
  backgroundColor: HexColorSchema.optional(),
  keywords: KeywordsSchema,
  priority: z.number().int().min(0).max(10000).optional(),
});
const CreateBody = CreateBodyBase.refine(
  (b) => b.colorId !== undefined || b.backgroundColor !== undefined,
  { message: "colorId or backgroundColor required" },
);

// PATCH keeps the legacy shape — name/color are read-only caches under
// ADR-0006 (edits happen in Google Calendar), so `backgroundColor` is
// deliberately not patchable.
const PatchBody = CreateBodyBase.omit({ backgroundColor: true }).partial();
const UuidParam = z.string().uuid();

// The sync pipeline is primary-calendar-single today (see schema.ts
// `categories.labelId` comment) — labels created by the editor land on the
// user's primary calendar.
const LABEL_CALENDAR_ID = "primary";

type LabelCreateOutcome =
  | { ok: true; labelId: string }
  | {
      ok: false;
      status: 403 | 422 | 429 | 502 | 503;
      body: Record<string, unknown>;
      retryAfterSec?: number;
    };

// ADR-0006 (native-labels #03) — mints the Google label for a new Rule via
// the append-only `appendEventLabel` writer. Failures come back as typed
// HTTP outcomes so the POST handler stays a single close()-then-return
// site; NO Rule may be created when this fails (반쪽 상태 금지).
async function createLabelForRule(
  db: PostgresJsDatabase,
  env: Bindings,
  userId: string,
  input: { name: string; backgroundColor: string },
): Promise<LabelCreateOutcome> {
  let accessToken: string;
  try {
    const res = await getValidAccessToken(db, env, userId);
    accessToken = res.accessToken;
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      return { ok: false, status: 503, body: { error: "reauth_required" } };
    }
    throw err;
  }

  try {
    const created = await appendEventLabel(accessToken, LABEL_CALENDAR_ID, input);
    return { ok: true, labelId: created.id };
  } catch (err) {
    if (err instanceof EventLabelCapError) {
      // 200-label calendar cap — a typed 4xx instead of Google's opaque 400.
      return { ok: false, status: 422, body: { error: "label_cap_reached" } };
    }
    if (err instanceof CalendarApiError) {
      switch (err.kind) {
        case "auth":
          // Access token went stale between refresh and write (rare) — the
          // GAS client walks the reconnect path, same as events.ts.
          return { ok: false, status: 503, body: { error: "reauth_required" } };
        case "forbidden":
          return { ok: false, status: 403, body: { error: "forbidden" } };
        case "rate_limited": {
          const retryAfterSec = err.retryAfterSec ?? 1;
          return {
            ok: false,
            status: 429,
            body: { error: "rate_limited", retry_after_sec: retryAfterSec },
            retryAfterSec,
          };
        }
        default:
          return {
            ok: false,
            status: 502,
            body: { error: "upstream_unavailable" },
          };
      }
    }
    throw err;
  }
}

// Wire projection — drops `seeds` and `userId` from the aggregate so the
// public shape stays unchanged across this PR. ADR-0004 #02 will flip this
// to include seeds.
function toWire(rule: Rule) {
  return {
    id: rule.id,
    name: rule.name,
    colorId: rule.colorId,
    keywords: rule.keywords,
    priority: rule.priority,
    // ADR-0006 (native-labels #02) — label linkage for the #03 editor:
    // `labelId` (null = pre-cutover rule) and `labelDeletedAt` (non-null =
    // backing Google label gone; editor renders a "라벨 삭제됨" badge).
    // Additive fields — the pre-#03 GAS client ignores unknown keys.
    labelId: rule.labelId,
    labelDeletedAt: rule.labelDeletedAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

categoriesRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { db, close } = getDb(c.env);
  try {
    const rules = await listRules(db, userId, { includeLabelDeleted: true });
    return c.json({ categories: rules.map(toWire) });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

categoriesRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      400,
    );
  }

  const { db, close } = getDb(c.env);
  try {
    const input = parsed.data;
    let labelId: string | undefined;
    let colorId: string | undefined = input.colorId;

    if (input.backgroundColor !== undefined) {
      // ADR-0006 (native-labels #03) — the create flow makes the Google
      // label AND the Rule in one step. The label is created FIRST; any
      // failure below returns an error with no Rule row (반쪽 상태 금지 —
      // a Rule without a label would be unapplicable, while an orphaned
      // label is self-healing: `labelReconcile` links or rules it on the
      // next sync).
      //
      // Duplicate-name pre-check before touching Google: the Rule insert's
      // unique constraint would 409 AFTER the label existed, leaving an
      // orphan label per retry. TOCTOU race is backstopped by the
      // constraint itself (rare concurrent create → one 409 + one orphan
      // label, absorbed by reconcile's same-name link).
      const existing = await listRules(db, userId, {
        includeLabelDeleted: true,
      });
      if (existing.some((r) => r.name === input.name)) {
        c.executionCtx.waitUntil(close());
        return c.json({ error: "duplicate_name" }, 409);
      }

      const outcome = await createLabelForRule(db, c.env, userId, {
        name: input.name,
        backgroundColor: input.backgroundColor,
      });
      if (!outcome.ok) {
        c.executionCtx.waitUntil(close());
        return outcome.retryAfterSec !== undefined
          ? c.json(outcome.body, outcome.status, {
              "Retry-After": String(outcome.retryAfterSec),
            })
          : c.json(outcome.body, outcome.status);
      }
      labelId = outcome.labelId;

      // Legacy colorId column stays populated as a nearest-classic cache
      // (schema CHECK '1'..'11' holds until the #04 cutover).
      colorId = nearestClassicColorId(input.backgroundColor);
    }

    const { rule, sideEffects } = await createRule(db, c.env, userId, {
      name: input.name,
      // colorId is non-null here: the refine guarantees colorId or
      // backgroundColor, and the hex branch just derived it.
      colorId: colorId!,
      keywords: input.keywords,
      priority: input.priority,
      labelId,
    });
    // card-latency #02 — return the updated list in the mutation response so
    // GAS rebuilds the card without a follow-up GET (2 roundtrips → 1). The
    // list SELECT is awaited here (plain DB read), NOT the embedding
    // sideEffects — the response must never wait on the name-seed embed.
    const rules = await listRules(db, userId, { includeLabelDeleted: true });
    // close() = client.end(); the name-seed write inside sideEffects awaits an
    // embedding network call before its db.insert, so close() MUST be chained
    // after sideEffects. A separate waitUntil(close()) ends the pool mid-embed
    // and the seed insert silently fails — mirror index.ts's .finally(close).
    c.executionCtx.waitUntil(sideEffects.finally(() => close()));
    return c.json({ category: toWire(rule), categories: rules.map(toWire) }, 201);
  } catch (err) {
    c.executionCtx.waitUntil(close());
    if (err instanceof DuplicateRuleNameError) {
      return c.json({ error: "duplicate_name" }, 409);
    }
    throw err;
  }
});

categoriesRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const idParse = UuidParam.safeParse(c.req.param("id"));
  if (!idParse.success) return c.json({ error: "invalid_id" }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      400,
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return c.json({ error: "empty_patch" }, 400);
  }

  const { db, close } = getDb(c.env);
  try {
    const result = await updateRule(
      db,
      c.env,
      userId,
      idParse.data,
      parsed.data,
    );
    if (!result) {
      c.executionCtx.waitUntil(close());
      return c.json({ error: "not_found" }, 404);
    }
    // Chain close() after sideEffects — see the POST handler note above.
    c.executionCtx.waitUntil(result.sideEffects.finally(() => close()));
    return c.json({ category: toWire(result.rule) });
  } catch (err) {
    c.executionCtx.waitUntil(close());
    if (err instanceof DuplicateRuleNameError) {
      return c.json({ error: "duplicate_name" }, 409);
    }
    throw err;
  }
});

categoriesRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const idParse = UuidParam.safeParse(c.req.param("id"));
  if (!idParse.success) return c.json({ error: "invalid_id" }, 400);

  const { db, close } = getDb(c.env);
  try {
    const result = await deleteRule(db, c.env, userId, idParse.data);
    if (!result) return c.json({ error: "not_found" }, 404);
    c.executionCtx.waitUntil(result.sideEffects);
    // card-latency #02 — 204 → 200 with the updated list so GAS skips the
    // follow-up GET. Status change is safe: the GAS client treats any 2xx as
    // success and previously ignored the (empty) DELETE body.
    const rules = await listRules(db, userId, { includeLabelDeleted: true });
    return c.json({ categories: rules.map(toWire) });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

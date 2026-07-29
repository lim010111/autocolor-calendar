import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../services/sessionService", () => ({ verifySession: vi.fn() }));
// The embedder is mocked at the module boundary so this suite drives the
// embed outcome without a Workers AI binding. `embeddings.ts` has its own
// coverage; here the only thing that matters is success vs failure.
vi.mock("../services/embeddings", () => ({ resolveEmbedder: vi.fn() }));

import { EXAMPLE_CONSENT_POLICY_VERSION } from "../config/consent";
import { getDb } from "../db";
import { app } from "../index";
import { resolveEmbedder } from "../services/embeddings";
import { verifySession } from "../services/sessionService";
import {
  makeFakeDb,
  type FakeDbInitial,
  type Row,
  type UserRow,
} from "./_helpers/fakeDb";

const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";
const RULE_A = "11111111-1111-1111-1111-11111111111a";
const V = EXAMPLE_CONSENT_POLICY_VERSION;

const baseEnv = {
  ENV: "dev",
  TOKEN_ENCRYPTION_KEY: "x",
  SESSION_HMAC_KEY: "x",
  SESSION_PEPPER: "x",
};

const ctx = {
  waitUntil: (_p: Promise<unknown>) => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

function post(
  body: unknown,
  opts: { userToken?: string } = {},
): Response | Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.userToken) headers["authorization"] = `Bearer ${opts.userToken}`;
  return app.fetch(
    new Request("https://worker.test/api/examples", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    baseEnv as unknown as Record<string, unknown>,
    ctx,
  );
}

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: USER_A,
    exampleConsentAt: overrides.exampleConsentAt ?? null,
    exampleConsentRevokedAt: overrides.exampleConsentRevokedAt ?? null,
    exampleConsentPolicyVersion: overrides.exampleConsentPolicyVersion ?? null,
  };
}

const consented = () =>
  user({ exampleConsentAt: new Date(), exampleConsentPolicyVersion: V });

function rule(overrides: Partial<Row> = {}): Row {
  return {
    id: overrides.id ?? RULE_A,
    userId: overrides.userId ?? USER_A,
    name: overrides.name ?? "회의",
    colorId: overrides.colorId ?? "9",
    keywords: overrides.keywords ?? ["회의"],
    priority: overrides.priority ?? 100,
    labelId: overrides.labelId ?? "label-1",
    labelDeletedAt: overrides.labelDeletedAt ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-07-01"),
    updatedAt: overrides.updatedAt ?? new Date("2026-07-01"),
  };
}

let currentDb: ReturnType<typeof makeFakeDb>;

function useDb(initial: FakeDbInitial) {
  currentDb = makeFakeDb(initial);
  vi.mocked(getDb).mockImplementation(
    () => currentDb as unknown as ReturnType<typeof getDb>,
  );
  return currentDb;
}

beforeEach(() => {
  useDb({ users: [consented()], categories: [rule()] });
  vi.mocked(verifySession).mockImplementation(async (_db, _pep, token) =>
    token === "token-a" ? { userId: USER_A, email: "a@test" } : null,
  );
  vi.mocked(resolveEmbedder).mockReturnValue(
    async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]),
  );
});

describe("POST /api/examples — 게이트", () => {
  it("401 without bearer", async () => {
    expect((await post({ ruleId: RULE_A, title: "주간회의" })).status).toBe(401);
  });

  it.each([
    ["ruleId 누락", { title: "주간회의" }],
    ["ruleId 가 uuid 아님", { ruleId: "not-a-uuid", title: "주간회의" }],
    ["title 이 빈 문자열", { ruleId: RULE_A, title: "   " }],
  ])("400 — %s", async (_label, body) => {
    const res = await post(body, { userToken: "token-a" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("429 example_throttled — 2초 창이 아직 안 열렸을 때", async () => {
    useDb({
      users: [consented()],
      categories: [rule()],
      userUpdateMatchesNone: true,
    });
    const res = await post(
      { ruleId: RULE_A, title: "주간회의" },
      { userToken: "token-a" },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("2");
    expect(await res.json()).toMatchObject({ error: "example_throttled" });
  });

  // 순서 오라클: throttle 은 consent/ownership 게이트 **뒤**에 있어야 한다.
  // 앞에 두면 최초 정정(403 → 동의 카드 → 동의 → 같은 쓰기 재생)이 방금
  // 자기가 잡은 2초 창에 걸려 429 로 죽는다 — 가장 중요한 경로가 깨진다.
  // 아래 두 케이스는 "거부된 요청은 창을 소비하지 않는다" 를 고정한다.
  it("consent_required 는 throttle 창을 소비하지 않는다 (403 이 429 를 이긴다)", async () => {
    useDb({
      users: [user()], // 미동의
      categories: [rule()],
      userUpdateMatchesNone: true, // 창이 닫혀 있어도
    });
    const res = await post(
      { ruleId: RULE_A, title: "주간회의" },
      { userToken: "token-a" },
    );
    expect(res.status).toBe(403);
  });

  // C6 오라클 (legal-reviewer 2026-07-29): 동의 확인이 **본문 파싱보다
  // 먼저**여야 한다. ADR-0007 이 동의 엔드포인트를 분리한 근거가 "동의
  // 기록이 생기기 전에 제목이 경계를 넘지 않는다" 인데, 본문을 먼저 파싱하면
  // 미동의 사용자의 제목을 읽고 검증한 뒤 403 을 내는 셈이라 그 근거가
  // 코드에서 거짓이 된다. 본문이 깨져 있어도 400 이 아니라 403 이 나오는
  // 것이 곧 "제목을 읽지 않았다" 의 증거다.
  it("미동의 요청은 본문을 읽기 전에 403 — 깨진 본문이어도 400 이 아니다", async () => {
    useDb({ users: [user()], categories: [rule()] });
    const res = await app.fetch(
      new Request("https://worker.test/api/examples", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token-a",
        },
        body: "{ this is not json",
      }),
      baseEnv as unknown as Record<string, unknown>,
      ctx,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "consent_required" });
  });

  it("not_found 도 throttle 창을 소비하지 않는다", async () => {
    useDb({
      users: [consented()],
      categories: [rule({ userId: USER_B })],
      userUpdateMatchesNone: true,
    });
    const res = await post(
      { ruleId: RULE_A, title: "주간회의" },
      { userToken: "token-a" },
    );
    expect(res.status).toBe(404);
  });
});

// §5.2 타입 게이트가 라우트 표면에서 실제로 닫혀 있는지 — 세 가지 원인 각각.
describe("POST /api/examples — 403 consent_required", () => {
  it.each([
    ["동의한 적이 없음", user()],
    [
      "철회됨",
      user({
        exampleConsentAt: new Date("2026-07-01"),
        exampleConsentRevokedAt: new Date("2026-07-02"),
        exampleConsentPolicyVersion: V,
      }),
    ],
    [
      "낡은 정책 버전으로 동의함",
      user({
        exampleConsentAt: new Date("2026-07-01"),
        exampleConsentPolicyVersion: "example-storage/v0",
      }),
    ],
  ])("403 — %s", async (_label, u) => {
    useDb({ users: [u], categories: [rule()] });
    const res = await post(
      { ruleId: RULE_A, title: "주간회의" },
      { userToken: "token-a" },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "consent_required",
      policyVersion: V,
    });
    expect(currentDb.state.ruleSeeds).toHaveLength(0);
  });
});

describe("POST /api/examples — 소유권", () => {
  it("404 — 규칙이 다른 테넌트 소유", async () => {
    useDb({
      users: [consented()],
      categories: [rule({ userId: USER_B })],
    });
    const res = await post(
      { ruleId: RULE_A, title: "주간회의" },
      { userToken: "token-a" },
    );
    expect(res.status).toBe(404);
    expect(currentDb.state.ruleSeeds).toHaveLength(0);
  });

  it("404 — 라벨이 삭제된 규칙", async () => {
    useDb({
      users: [consented()],
      categories: [rule({ labelDeletedAt: new Date("2026-07-20") })],
    });
    const res = await post(
      { ruleId: RULE_A, title: "주간회의" },
      { userToken: "token-a" },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/examples — 저장 결과", () => {
  it("200 stored:true — redact 된 제목이 테넌트 스코프로 저장된다", async () => {
    const res = await post(
      { ruleId: RULE_A, title: "주간회의 with alice@acme.com" },
      { userToken: "token-a" },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: true });

    expect(currentDb.state.ruleSeeds).toHaveLength(1);
    const row = currentDb.state.ruleSeeds[0]!;
    expect(row["seedType"]).toBe("example");
    // 저장되는 것은 원문이 아니라 마스킹된 제목이다.
    expect(row["seedText"]).toBe("주간회의 with [email]");
    // userId 는 세션에서 오고, 요청 바디에서 오지 않는다.
    expect(row["userId"]).toBe(USER_A);
  });

  // 설계된 비-이벤트: 4xx 였다면 gas/api.js 가 CLIENT_ERROR 를 던져
  // "조용히 버린다" 가 에러 경로로 바뀐다.
  it("200 stored:false/unfit — redaction 후 신호가 남지 않는 제목은 저장 0", async () => {
    const res = await post(
      { ruleId: RULE_A, title: "https://zoom.us/j/123" },
      { userToken: "token-a" },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: false, reason: "unfit" });
    expect(currentDb.state.ruleSeeds).toHaveLength(0);
  });

  // 소프트 실패: UI 가 "정정이 안 붙었다" 를 알려야 한다(AC line 93).
  // 5xx 였다면 gas/api.js 의 3회 백오프 재시도에 걸려 사이드바가 멈춘다.
  it("200 stored:false/embed_failed — 임베딩 실패 시 행 변경 0", async () => {
    vi.mocked(resolveEmbedder).mockReturnValue(async () => {
      throw new Error("workers ai down");
    });
    const res = await post(
      { ruleId: RULE_A, title: "주간회의" },
      { userToken: "token-a" },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      stored: false,
      reason: "embed_failed",
    });
    expect(currentDb.state.ruleSeeds).toHaveLength(0);
  });
});

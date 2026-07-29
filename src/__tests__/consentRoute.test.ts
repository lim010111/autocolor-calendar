import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../services/sessionService", () => ({ verifySession: vi.fn() }));

import {
  EXAMPLE_CONSENT_POLICY_VERSION,
  EXAMPLE_STORAGE_OPENS_AT,
} from "../config/consent";
import { getDb } from "../db";
import { app } from "../index";
import { verifySession } from "../services/sessionService";
import {
  makeFakeDb,
  type FakeDbInitial,
  type RuleSeedRow,
  type UserRow,
} from "./_helpers/fakeDb";

const USER_A = "00000000-0000-0000-0000-00000000000a";
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

function invoke(
  path: string,
  init?: RequestInit & { userToken?: string },
): Response | Promise<Response> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (init?.userToken) headers["authorization"] = `Bearer ${init.userToken}`;
  return app.fetch(
    new Request(`https://worker.test${path}`, { ...init, headers }),
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

let currentDb: ReturnType<typeof makeFakeDb>;

function useDb(initial: FakeDbInitial) {
  currentDb = makeFakeDb(initial);
  vi.mocked(getDb).mockImplementation(
    () => currentDb as unknown as ReturnType<typeof getDb>,
  );
  return currentDb;
}

beforeEach(() => {
  useDb({ users: [user()] });
  vi.mocked(verifySession).mockImplementation(async (_db, _pep, token) =>
    token === "token-a" ? { userId: USER_A, email: "a@test" } : null,
  );
  // Default the suite to a clock past the §12 30-day notice window so the
  // grant tests exercise their own subject. The window itself is pinned by
  // the dedicated test below.
  vi.spyOn(Date, "now").mockReturnValue(EXAMPLE_STORAGE_OPENS_AT + 86_400_000);
});

describe("consent routes — auth gate", () => {
  it.each([
    ["GET", "/api/consent/examples"],
    ["POST", "/api/consent/examples"],
    ["DELETE", "/api/consent/examples"],
  ])("%s %s → 401 without bearer", async (method, path) => {
    const init: RequestInit = {
      method,
      headers: { "content-type": "application/json" },
    };
    if (method === "POST") init.body = JSON.stringify({ policyVersion: V });
    const res = await invoke(path, init);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/consent/examples", () => {
  it("400 on a malformed body", async () => {
    const res = await invoke("/api/consent/examples", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  // 스테일 Add-on 배포가, 사용자가 본 적 없는 고지문에 대해 동의를 기록하는
  // 것을 막는 잠금장치. 조용한 성공이 아니라 시끄러운 409 여야 한다.
  it("409 policy_version_mismatch — 클라이언트가 렌더한 버전이 낡았을 때", async () => {
    const res = await invoke("/api/consent/examples", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policyVersion: "example-storage/v0" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "policy_version_mismatch",
      expected: V,
    });
  });

  // 처리방침 §12 는 "게시일부터 30일이 경과한 뒤에만 저장을 개시한다" 고
  // 스스로를 구속한다. 그 약속을 사람의 기억이 아니라 코드가 지킨다 — 창이
  // 열리기 전에는 동의 자체가 기록되지 않으므로 receipt 도, 저장도 없다.
  it("409 storage_not_open_yet — §12 30일 통지 창이 열리기 전", async () => {
    vi.spyOn(Date, "now").mockReturnValue(EXAMPLE_STORAGE_OPENS_AT - 1);
    const res = await invoke("/api/consent/examples", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policyVersion: V }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "storage_not_open_yet" });
    expect(currentDb.state.users[0]?.exampleConsentAt).toBeNull();
  });

  it("200 + granted:true 이고 컬럼에 각인된다", async () => {
    const res = await invoke("/api/consent/examples", {
      method: "POST",
      userToken: "token-a",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policyVersion: V }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      granted: true,
      policyVersion: V,
      currentPolicyVersion: V,
    });
    expect(currentDb.state.users[0]?.exampleConsentAt).toBeInstanceOf(Date);
  });
});

describe("DELETE /api/consent/examples", () => {
  it("200 + purgedExamples 개수, example 행은 사라진다", async () => {
    const seeds: RuleSeedRow[] = [
      {
        id: "s-1",
        ruleId: RULE_A,
        userId: USER_A,
        seedType: "example",
        seedText: "주간회의",
        embedding: [0.1],
        createdAt: new Date("2026-07-01"),
      } as RuleSeedRow,
    ];
    useDb({
      users: [user({ exampleConsentAt: new Date(), exampleConsentPolicyVersion: V })],
      ruleSeeds: seeds,
    });

    const res = await invoke("/api/consent/examples", {
      method: "DELETE",
      userToken: "token-a",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      revoked: true,
      purgedExamples: 1,
    });
    expect(currentDb.state.ruleSeeds).toHaveLength(0);
  });

  it("동의한 적 없어도 200 (404 아님) — 방어적 no-op", async () => {
    const res = await invoke("/api/consent/examples", {
      method: "DELETE",
      userToken: "token-a",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ purgedExamples: 0 });
  });
});

describe("GET /api/consent/examples", () => {
  it("동의 전에는 granted:false + 현행 버전을 함께 알려준다", async () => {
    const res = await invoke("/api/consent/examples", { userToken: "token-a" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      granted: false,
      grantedAt: null,
      currentPolicyVersion: V,
    });
  });

  it("철회된 동의는 granted:false 로 보인다", async () => {
    useDb({
      users: [
        user({
          exampleConsentAt: new Date("2026-07-01"),
          exampleConsentRevokedAt: new Date("2026-07-02"),
          exampleConsentPolicyVersion: V,
        }),
      ],
    });
    const res = await invoke("/api/consent/examples", { userToken: "token-a" });
    expect(await res.json()).toMatchObject({ granted: false });
  });
});

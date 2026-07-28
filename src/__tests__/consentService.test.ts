import { describe, expect, it } from "vitest";

import { EXAMPLE_CONSENT_POLICY_VERSION } from "../config/consent";
import {
  grantExampleConsent,
  issueExampleConsentReceipt,
  readExampleConsent,
  revokeExampleConsent,
} from "../services/consentService";
import { makeFakeDb, type RuleSeedRow, type UserRow } from "./_helpers/fakeDb";

const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";
const RULE_A = "11111111-1111-1111-1111-11111111111a";
const V = EXAMPLE_CONSENT_POLICY_VERSION;

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: overrides.id ?? USER_A,
    exampleConsentAt: overrides.exampleConsentAt ?? null,
    exampleConsentRevokedAt: overrides.exampleConsentRevokedAt ?? null,
    exampleConsentPolicyVersion: overrides.exampleConsentPolicyVersion ?? null,
  };
}

function seed(overrides: Partial<RuleSeedRow> = {}): RuleSeedRow {
  return {
    id: (overrides["id"] as string) ?? crypto.randomUUID(),
    ruleId: (overrides["ruleId"] as string) ?? RULE_A,
    userId: (overrides["userId"] as string) ?? USER_A,
    seedType: (overrides["seedType"] as string) ?? "example",
    seedText: (overrides["seedText"] as string) ?? "주간회의",
    embedding: [0.1, 0.2, 0.3],
    createdAt: new Date("2026-07-01"),
  } as RuleSeedRow;
}

describe("grantExampleConsent (ADR-0007)", () => {
  it("최초 동의는 시각과 정책 버전을 각인하고 receipt 가 발급된다", async () => {
    const { db, state } = makeFakeDb({ users: [user()] });
    const out = await grantExampleConsent(db as never, USER_A, V);

    expect(out.granted).toBe(true);
    expect(out.policyVersion).toBe(V);
    expect(state.users[0]?.exampleConsentAt).toBeInstanceOf(Date);
    expect(state.users[0]?.exampleConsentRevokedAt).toBeNull();
    expect(await issueExampleConsentReceipt(db as never, USER_A)).not.toBeNull();
  });

  it("이미 살아 있는 동의에 대한 재호출은 멱등 — 원래 동의 시각을 보존한다", async () => {
    const original = new Date("2026-07-01T00:00:00Z");
    const { db, state } = makeFakeDb({
      users: [
        user({ exampleConsentAt: original, exampleConsentPolicyVersion: V }),
      ],
    });
    const out = await grantExampleConsent(db as never, USER_A, V);

    // 재각인하면 "사용자가 실제로 동의한 시점" 기록이 위조된다.
    expect(out.grantedAt).toEqual(original);
    expect(state.users[0]?.exampleConsentAt).toEqual(original);
  });

  it("철회 이후 재동의는 revokedAt 을 지우고 새 시각을 각인한다", async () => {
    const { db, state } = makeFakeDb({
      users: [
        user({
          exampleConsentAt: new Date("2026-07-01T00:00:00Z"),
          exampleConsentRevokedAt: new Date("2026-07-02T00:00:00Z"),
          exampleConsentPolicyVersion: V,
        }),
      ],
    });
    const out = await grantExampleConsent(db as never, USER_A, V);

    expect(out.granted).toBe(true);
    expect(state.users[0]?.exampleConsentRevokedAt).toBeNull();
  });
});

describe("revokeExampleConsent — 즉시 전량 삭제 (ADR-0007)", () => {
  it("테넌트의 example 씨앗을 전부 지우고 개수를 돌려준다", async () => {
    const { db, state } = makeFakeDb({
      users: [user({ exampleConsentAt: new Date(), exampleConsentPolicyVersion: V })],
      ruleSeeds: [
        seed({ seedText: "주간회의" }),
        seed({ seedText: "스탠드업" }),
      ],
    });

    const { purged } = await revokeExampleConsent(db as never, USER_A);

    expect(purged).toBe(2);
    expect(state.ruleSeeds).toHaveLength(0);
    expect(state.users[0]?.exampleConsentRevokedAt).toBeInstanceOf(Date);
    expect(await issueExampleConsentReceipt(db as never, USER_A)).toBeNull();
  });

  it("name/keyword 씨앗은 건드리지 않는다 — 규칙 자체는 살아 있어야 한다", async () => {
    const { db, state } = makeFakeDb({
      users: [user()],
      ruleSeeds: [
        seed({ seedType: "name", seedText: "회의" }),
        seed({ seedType: "keyword", seedText: "미팅" }),
        seed({ seedType: "example", seedText: "주간회의" }),
      ],
    });

    const { purged } = await revokeExampleConsent(db as never, USER_A);

    expect(purged).toBe(1);
    expect(state.ruleSeeds.map((s) => s["seedType"]).sort()).toEqual([
      "keyword",
      "name",
    ]);
  });

  it("다른 테넌트의 example 은 남는다 (Tenant isolation — RLS 우회 경로)", async () => {
    const { db, state } = makeFakeDb({
      users: [user(), user({ id: USER_B })],
      ruleSeeds: [
        seed({ userId: USER_A, seedText: "내 것" }),
        seed({ userId: USER_B, seedText: "남의 것" }),
      ],
    });

    const { purged } = await revokeExampleConsent(db as never, USER_A);

    expect(purged).toBe(1);
    expect(state.ruleSeeds).toHaveLength(1);
    expect(state.ruleSeeds[0]?.["userId"]).toBe(USER_B);
  });

  it("동의한 적 없는 사용자의 철회도 200 경로 — purged 0, 예외 없음", async () => {
    const { db } = makeFakeDb({ users: [user()] });
    expect(await revokeExampleConsent(db as never, USER_A)).toEqual({
      purged: 0,
    });
  });

  // purge-before-stamp 순서 오라클. 이 순서가 뒤집히면
  // "동의는 철회됐는데 데이터는 남아 있다" 는 정책 위반 상태가 만들어진다.
  it("스탬프가 실패해도 example 행은 이미 지워져 있다 (fail-safe 방향)", async () => {
    const { db, state } = makeFakeDb({
      users: [user({ exampleConsentAt: new Date(), exampleConsentPolicyVersion: V })],
      ruleSeeds: [seed({ seedText: "주간회의" })],
      failUserUpdateWith: new Error("users UPDATE failed"),
    });

    await expect(revokeExampleConsent(db as never, USER_A)).rejects.toThrow(
      "users UPDATE failed",
    );

    // 데이터는 사라졌고 동의는 아직 살아 있다 → 철회 재시도로 복구 가능.
    // 반대 순서였다면 "철회됨 + 데이터 잔존" 이 되어 복구 불가능했다.
    expect(state.ruleSeeds).toHaveLength(0);
    expect(state.users[0]?.exampleConsentRevokedAt).toBeNull();
  });
});

describe("readExampleConsent", () => {
  it("사용자 행이 없으면 fail-closed 모양을 돌려준다", async () => {
    const { db } = makeFakeDb({ users: [] });
    expect(await readExampleConsent(db as never, USER_A)).toEqual({
      consentedAt: null,
      revokedAt: null,
      policyVersion: null,
    });
  });
});

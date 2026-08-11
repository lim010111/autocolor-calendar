// merge-gate codex:finding-1 reproduction — Rule.description bypasses
// prompt-version gating in `buildPrompt`.
//
// Oracle: the `description` field is a model input, so it must follow the
// same ADR-0007 discipline as `examples` — sent ONLY to system-prompt
// versions that document it, empty/absent everywhere else. No current
// prompt version (v2..v8) documents a category `description` field, so a
// Rule carrying one must never surface it in the user payload.
//
// Current code (`llmClassifier.ts` ~L238) spreads `c.description`
// unconditionally, so these tests FAIL on HEAD by design.

import { describe, expect, it } from "vitest";

import type { CalendarEvent } from "../services/googleCalendar";
import { buildPrompt } from "../services/llmClassifier";
import { redactEventForLlm, type RedactedEvent } from "../services/piiRedactor";
import type { Rule } from "../services/ruleService";
import { synthesizeSeeds } from "../services/ruleService";

const USER = "00000000-0000-0000-0000-000000000001";

// Mirrors `llmClassifier.test.ts`'s `cat()` fixture.
function cat(partial: Partial<Rule> = {}): Rule {
  const name = partial.name ?? "회의";
  const keywords = partial.keywords ?? ["회의"];
  return {
    id: partial.id ?? "c-1",
    userId: partial.userId ?? USER,
    name,
    colorId: partial.colorId ?? "9",
    backgroundColor: partial.backgroundColor ?? null,
    keywords,
    priority: partial.priority ?? 100,
    labelId: partial.labelId ?? null,
    labelDeletedAt: partial.labelDeletedAt ?? null,
    seeds: partial.seeds ?? synthesizeSeeds({ name, keywords }),
    ...(partial.description !== undefined ? { description: partial.description } : {}),
    createdAt: partial.createdAt ?? new Date("2026-04-19T00:00:00Z"),
    updatedAt: partial.updatedAt ?? new Date("2026-04-19T00:00:00Z"),
  };
}

// Mirrors `llmClassifier.test.ts`'s `ev()` fixture (§5.2 brand minting).
function ev(partial: Partial<CalendarEvent> = {}): RedactedEvent {
  const raw: CalendarEvent = { id: partial.id ?? "e-1", ...partial };
  return redactEventForLlm(raw);
}

const withDescription = () =>
  cat({ description: "업무 관련 회의만, 사교 모임은 제외" });

const categoriesOf = (msgs: ReturnType<typeof buildPrompt>) =>
  (
    JSON.parse(msgs.find((m) => m.role === "user")!.content) as {
      categories: Array<{ description?: string }>;
    }
  ).categories;

describe("buildPrompt — description 버전 게이트 (examples 인터록 미러)", () => {
  it("기본(v8) 프롬프트에서는 Rule.description이 있어도 페이로드에 미전송 — eval-gate 인터록", () => {
    // v8 (DEFAULT_CLASSIFIER_PROMPT_VERSION) never documents a category
    // `description` field; sending it is an un-eval-gated model input change.
    const cats = categoriesOf(buildPrompt(ev({ summary: "standup" }), [withDescription()]));
    expect(cats[0]!.description).toBeUndefined();
  });

  it("필드를 문서화하지 않은 구버전(v2)도 description 미전송", () => {
    const cats = categoriesOf(
      buildPrompt(ev({ summary: "standup" }), [withDescription()], "v2"),
    );
    expect(cats[0]!.description).toBeUndefined();
  });
});

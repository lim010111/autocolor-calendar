import { describe, expect, it } from "vitest";

import type { Category, ClassifyContext } from "../services/classifier";
import { classifyEvent } from "../services/classifier";
import type { CalendarEvent } from "../services/googleCalendar";

const USER = "00000000-0000-0000-0000-000000000001";

function cat(partial: Partial<Category> = {}): Category {
  return {
    id: partial.id ?? "c-1",
    name: partial.name ?? "주간회의",
    colorId: partial.colorId ?? "9",
    keywords: partial.keywords ?? ["주간회의"],
    priority: partial.priority ?? 100,
  };
}

function ctxOf(categories: Category[]): ClassifyContext {
  return { userId: USER, categories };
}

function ev(partial: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: partial.id ?? "e-1", ...partial };
}

describe("classifyEvent — rule-based (Step 1)", () => {
  it("matches a keyword in summary", async () => {
    const result = await classifyEvent(
      ev({ summary: "주간회의 — 3월 첫째주" }),
      ctxOf([cat()]),
    );
    expect(result).toEqual({
      colorId: "9",
      categoryId: "c-1",
      reason: "rule_match:주간회의",
      matchedKeyword: "주간회의",
    });
  });

  it("matches a keyword in description when summary is empty", async () => {
    const result = await classifyEvent(
      ev({ summary: "", description: "팀 주간회의 노트" }),
      ctxOf([cat()]),
    );
    expect(result?.colorId).toBe("9");
  });

  it("is case-insensitive for ASCII keywords", async () => {
    const result = await classifyEvent(
      ev({ summary: "Daily Standup Notes" }),
      ctxOf([cat({ keywords: ["standup"] })]),
    );
    expect(result?.colorId).toBe("9");
  });

  it("matches Korean keywords as substrings (no word boundary)", async () => {
    const result = await classifyEvent(
      ev({ summary: "오늘의주간회의노트" }),
      ctxOf([cat({ keywords: ["주간회의"] })]),
    );
    expect(result?.categoryId).toBe("c-1");
  });

  it("returns the first matching category in priority order", async () => {
    const first = cat({ id: "c-a", colorId: "2", keywords: ["회의"], priority: 10 });
    const second = cat({ id: "c-b", colorId: "9", keywords: ["회의"], priority: 100 });
    const result = await classifyEvent(
      ev({ summary: "팀 회의" }),
      ctxOf([first, second]),
    );
    expect(result?.categoryId).toBe("c-a");
    expect(result?.colorId).toBe("2");
  });

  it("returns null when no category matches", async () => {
    const result = await classifyEvent(
      ev({ summary: "점심 약속", description: "카페" }),
      ctxOf([cat({ keywords: ["회의"] })]),
    );
    expect(result).toBeNull();
  });

  it("skips categories with an empty keyword list", async () => {
    const empty = cat({ id: "c-empty", keywords: [], priority: 10 });
    const match = cat({ id: "c-match", keywords: ["주간회의"], priority: 100 });
    const result = await classifyEvent(
      ev({ summary: "주간회의" }),
      ctxOf([empty, match]),
    );
    expect(result?.categoryId).toBe("c-match");
  });

  it("returns null when the categories list is empty", async () => {
    const result = await classifyEvent(ev({ summary: "주간회의" }), ctxOf([]));
    expect(result).toBeNull();
  });

  it("returns null when summary and description are both missing", async () => {
    const result = await classifyEvent(ev(), ctxOf([cat()]));
    expect(result).toBeNull();
  });

  it("returns null when summary and description are empty strings", async () => {
    const result = await classifyEvent(
      ev({ summary: "", description: "" }),
      ctxOf([cat()]),
    );
    expect(result).toBeNull();
  });

  it("reason field echoes the matched keyword verbatim (preserves case)", async () => {
    const result = await classifyEvent(
      ev({ summary: "daily standup" }),
      ctxOf([cat({ keywords: ["Standup"] })]),
    );
    expect(result?.reason).toBe("rule_match:Standup");
  });

  it("populates matchedKeyword with the exact keyword that hit", async () => {
    const result = await classifyEvent(
      ev({ summary: "오늘 회의 끝나고" }),
      ctxOf([cat({ keywords: ["잡담", "회의", "점심"] })]),
    );
    expect(result?.matchedKeyword).toBe("회의");
  });

  it("matchedKeyword preserves the author's casing even on case-insensitive match", async () => {
    const result = await classifyEvent(
      ev({ summary: "Daily Standup" }),
      ctxOf([cat({ keywords: ["StandUp"] })]),
    );
    expect(result?.matchedKeyword).toBe("StandUp");
  });

  it("matchedKeyword is absent when no category matches", async () => {
    const result = await classifyEvent(
      ev({ summary: "Lunch with friends" }),
      ctxOf([cat({ keywords: ["meeting"] })]),
    );
    expect(result).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import type { CalendarEvent } from "../services/googleCalendar";
import {
  PII_REGEXES,
  PII_TOKENS,
  redactEventForLlm,
} from "../services/piiRedactor";

// Group E (골든 acceptance) 는 `JSON.stringify(redacted)` 전체에 대해
// `/@/`, `/http/i`, phone regex 매치 0건을 단언하므로, fixture의 **non-PII
// 필드** (id, status, colorId, displayName, timezone 등)에 `@`·`http`·phone
// 패턴 substring이 있으면 테스트가 오진된다. fixture 값은 안전한 문자열만
// 사용할 것 (예: id="evt-1", displayName="홍길동").

function ev(partial: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: partial.id ?? "e-1", ...partial };
}

describe("redactEventForLlm — Group A: NL 필드 redaction (false-negative)", () => {
  it("ko sentence 내 en email → [email]", () => {
    const r = redactEventForLlm(ev({ summary: "문의: alice@example.com" }));
    expect(r.summary).toBe("문의: [email]");
  });

  it("https URL → [url]", () => {
    const r = redactEventForLlm(
      ev({ summary: "미팅 링크 https://meet.google.com/abc-defg-hij" }),
    );
    expect(r.summary).toBe("미팅 링크 [url]");
  });

  it("www. prefix URL → [url]", () => {
    const r = redactEventForLlm(ev({ summary: "www.notion.so/team/page" }));
    expect(r.summary).toBe("[url]");
  });

  it("KR mobile with hyphens → [phone]", () => {
    const r = redactEventForLlm(ev({ summary: "연락처 010-1234-5678" }));
    expect(r.summary).toBe("연락처 [phone]");
  });

  it("KR mobile without separators → [phone]", () => {
    const r = redactEventForLlm(
      ev({ summary: "전화 01012345678 부탁드립니다" }),
    );
    expect(r.summary).toBe("전화 [phone] 부탁드립니다");
  });

  it("KR landline → [phone]", () => {
    const r = redactEventForLlm(ev({ summary: "02-123-4567 사무실" }));
    expect(r.summary).toBe("[phone] 사무실");
  });

  it("KR landline 괄호 표기 '(02) 555-1234' → [phone]", () => {
    const r = redactEventForLlm(ev({ summary: "(02) 555-1234 사무실" }));
    expect(r.summary).toBe("[phone] 사무실");
  });

  it("KR landline 괄호 표기 '(031) 123-4567' → [phone]", () => {
    const r = redactEventForLlm(ev({ summary: "(031) 123-4567 대표" }));
    expect(r.summary).toBe("[phone] 대표");
  });

  it("international 괄호 표기 '+1 (415) 555-2671' → [phone]", () => {
    const r = redactEventForLlm(ev({ summary: "US +1 (415) 555-2671" }));
    expect(r.summary).toBe("US [phone]");
  });

  it("+82 international → [phone]", () => {
    const r = redactEventForLlm(
      ev({ summary: "+82 10-1234-5678 international" }),
    );
    expect(r.summary).toBe("[phone] international");
  });

  it("foreign international +1 → [phone]", () => {
    const r = redactEventForLlm(ev({ summary: "US 번호 +1-555-123-4567" }));
    expect(r.summary).toBe("US 번호 [phone]");
  });

  it("foreign international +81 (spaces) → [phone]", () => {
    const r = redactEventForLlm(ev({ summary: "JP +81 3 1234 5678" }));
    expect(r.summary).toBe("JP [phone]");
  });

  it("1588 대표번호 → [phone]", () => {
    const r = redactEventForLlm(ev({ summary: "대표번호 1588-1234" }));
    expect(r.summary).toBe("대표번호 [phone]");
  });

  it("multi-PII in one string", () => {
    const r = redactEventForLlm(
      ev({ summary: "call 010-1111-2222 or email a@b.io" }),
    );
    expect(r.summary).toBe("call [phone] or email [email]");
  });

  it("ko+en mixed with URL", () => {
    const r = redactEventForLlm(
      ev({ summary: "오늘 회의 link https://zoom.us/j/123 비번 abcd" }),
    );
    expect(r.summary).toBe("오늘 회의 link [url] 비번 abcd");
  });

  it("URL containing @ → 전체가 [url]로 흡수 (잔여 @ 없음)", () => {
    const r = redactEventForLlm(
      ev({ summary: "https://github.com/user/repo?q=a@b.com" }),
    );
    expect(r.summary).toBe("[url]");
    expect(r.summary).not.toMatch(/@/);
  });

  it("URL 뒤 한국어 조사 보존 (에서)", () => {
    const r = redactEventForLlm(
      ev({ summary: "https://zoom.us/j/123에서 진행" }),
    );
    expect(r.summary).toBe("[url]에서 진행");
  });

  it("괄호로 감싼 URL — 닫는 ) 보존", () => {
    const r = redactEventForLlm(ev({ summary: "(see https://example.com)" }));
    expect(r.summary).toBe("(see [url])");
  });
});

describe("redactEventForLlm — Group B: over-redaction 가드", () => {
  it("한국어 날짜 '2025년 4월 20일 14시' 통과", () => {
    const s = "2025년 4월 20일 14시 회의";
    expect(redactEventForLlm(ev({ summary: s })).summary).toBe(s);
  });

  it("방 번호 '302호' 통과", () => {
    const s = "302호 회의실 예약";
    expect(redactEventForLlm(ev({ summary: s })).summary).toBe(s);
  });

  it("'3시 30분' 통과", () => {
    const s = "3시 30분 시작";
    expect(redactEventForLlm(ev({ summary: s })).summary).toBe(s);
  });

  it("bare-domain 'hello.world' 통과 (의도적 미커버)", () => {
    const s = "hello.world 토론";
    expect(redactEventForLlm(ev({ summary: s })).summary).toBe(s);
  });

  it("버전 번호 '1.2.3' 통과", () => {
    const s = "버전 1.2.3 릴리즈";
    expect(redactEventForLlm(ev({ summary: s })).summary).toBe(s);
  });

  it("'Python 3.11' 통과", () => {
    const s = "Python 3.11 study";
    expect(redactEventForLlm(ev({ summary: s })).summary).toBe(s);
  });

  it("'Q3 OKR' 통과", () => {
    const s = "Q3 OKR 리뷰";
    expect(redactEventForLlm(ev({ summary: s })).summary).toBe(s);
  });

  it("'A.M. / P.M.' 통과", () => {
    const s = "A.M. 회의 P.M. 휴식";
    expect(redactEventForLlm(ev({ summary: s })).summary).toBe(s);
  });

  it("빈 문자열 / 생략된 필드", () => {
    const r = redactEventForLlm(ev({ summary: "" }));
    expect(r.summary).toBe("");
    expect(r.description).toBeUndefined();
  });
});

describe("redactEventForLlm — Group C: structured email 필드", () => {
  it("creator.email 제거 + creator.self 보존", () => {
    const r = redactEventForLlm(
      ev({ creator: { email: "c@x.com", self: false } }),
    );
    expect(r.creator).toEqual({ self: false });
    expect(r.creator?.email).toBeUndefined();
  });

  it("organizer.email 제거 + organizer.self 보존", () => {
    const r = redactEventForLlm(
      ev({ organizer: { email: "o@x.com", self: true } }),
    );
    expect(r.organizer).toEqual({ self: true });
  });

  it("attendees[].email 제거, displayName/self 보존", () => {
    const r = redactEventForLlm(
      ev({
        attendees: [
          { email: "a1@x.com", displayName: "홍길동", self: false },
          { email: "a2@x.com" },
        ],
      }),
    );
    expect(r.attendees).toEqual([
      { displayName: "홍길동", self: false },
      {},
    ]);
  });

  it("attendees 키 생략 → 결과도 undefined (빈 배열 아님)", () => {
    const r = redactEventForLlm(ev({}));
    expect(r.attendees).toBeUndefined();
  });

  it("attendees: [] → [] (shape 보존)", () => {
    const r = redactEventForLlm(ev({ attendees: [] }));
    expect(r.attendees).toEqual([]);
  });

  it("creator 키 생략 → 결과도 undefined", () => {
    const r = redactEventForLlm(ev({}));
    expect(r.creator).toBeUndefined();
  });
});

describe("redactEventForLlm — Group D: 순수성 / 형태", () => {
  it("입력 object를 mutate하지 않는다", () => {
    const input: CalendarEvent = {
      id: "e-1",
      summary: "meet alice@x.com",
      creator: { email: "c@x.com", self: false },
      attendees: [{ email: "a@x.com", displayName: "홍길동" }],
    };
    const snapshot = structuredClone(input);
    redactEventForLlm(input);
    expect(input).toEqual(snapshot);
  });

  it("non-PII 필드 (id/status/colorId/start/end/updated) byte-for-byte 보존", () => {
    const input: CalendarEvent = {
      id: "evt-1",
      status: "confirmed",
      colorId: "9",
      start: { dateTime: "2025-04-20T14:00:00+09:00", timeZone: "Asia/Seoul" },
      end: { dateTime: "2025-04-20T15:00:00+09:00", timeZone: "Asia/Seoul" },
      updated: "2025-04-20T13:00:00.000Z",
    };
    const r = redactEventForLlm(input);
    expect(r.id).toBe(input.id);
    expect(r.status).toBe(input.status);
    expect(r.colorId).toBe(input.colorId);
    expect(r.start).toEqual(input.start);
    expect(r.end).toEqual(input.end);
    expect(r.updated).toBe(input.updated);
  });

  it("idempotency — redact(redact(x)) deep-equals redact(x)", () => {
    const input: CalendarEvent = {
      id: "e-1",
      summary: "alice@x.com / 010-1234-5678 / https://zoom.us/j/1",
      description: "bob@y.io, +82 10-2222-3333",
      location: "02-555-1234",
      creator: { email: "c@x.com" },
      organizer: { email: "o@x.com", self: true },
      attendees: [{ email: "a@x.com", displayName: "홍길동" }],
    };
    const once = redactEventForLlm(input);
    const twice = redactEventForLlm(once);
    expect(twice).toEqual(once);
  });
});

describe("redactEventForLlm — Group E: 수용 기준 골든", () => {
  // 골든 테스트는 `JSON.stringify(redacted)` 전체를 대상으로 단언하므로,
  // fixture의 **non-PII 필드** (id, colorId, timezone, displayName 등)에
  // `@`·`http`·phone substring이 있으면 redact 결과에 그대로 남아 단언이
  // 실패한다. Group E fixture를 수정할 때는 안전한 문자열만 사용할 것.
  // 아래 `it` 블록은 그 제약을 자동 검증한다 — 실패 시 "어떤 필드가 위반했는지"
  // 가 다음 test의 generic 메시지보다 빠르게 보인다.
  it("fixture 제약 — non-PII 필드에 PII-looking substring 없음", () => {
    const safeNonPiiValues = [
      "evt-1",
      "confirmed",
      "9",
      "Asia/Seoul",
      "2025-04-20T14:00:00+09:00",
      "2025-04-20T15:00:00+09:00",
      "2025-04-20T13:00:00.000Z",
      "김철수",
    ];
    const phoneRe = new RegExp(PII_REGEXES.phone.source, "g");
    for (const v of safeNonPiiValues) {
      expect(v, `fixture non-PII value contains @: ${v}`).not.toMatch(/@/);
      expect(v, `fixture non-PII value contains http: ${v}`).not.toMatch(
        /http/i,
      );
      expect(phoneRe.test(v), `fixture non-PII value matches phone: ${v}`).toBe(
        false,
      );
    }
  });

  it("acceptance: redacted 전체에 @ / http / phone 매치 0건", () => {
    const input: CalendarEvent = {
      id: "evt-1",
      status: "confirmed",
      colorId: "9",
      summary:
        "프로젝트 미팅 with alice@acme.com — zoom https://zoom.us/j/123",
      description:
        "안건 정리\n연락처 010-1234-5678\n자료 www.notion.so/x\nemail bob@x.io",
      location: "강남역 회의실 (02) 555-1234",
      start: { dateTime: "2025-04-20T14:00:00+09:00", timeZone: "Asia/Seoul" },
      end: { dateTime: "2025-04-20T15:00:00+09:00", timeZone: "Asia/Seoul" },
      creator: { email: "c@x.com", self: false },
      organizer: { email: "o@x.com", self: true },
      attendees: [
        { email: "a1@x.com" },
        { email: "a2@x.com", displayName: "김철수" },
      ],
      updated: "2025-04-20T13:00:00.000Z",
    };

    const redacted = redactEventForLlm(input);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toMatch(/@/);
    expect(serialized).not.toMatch(/http/i);
    // PII_REGEXES.phone은 global flag라 stateful. 새 regex로 clone.
    const phoneRe = new RegExp(PII_REGEXES.phone.source, "g");
    expect(phoneRe.test(serialized)).toBe(false);

    // placeholder token은 실제로 삽입되었음을 확인
    expect(redacted.summary).toContain(PII_TOKENS.EMAIL);
    expect(redacted.summary).toContain(PII_TOKENS.URL);
    expect(redacted.description).toContain(PII_TOKENS.PHONE);
  });
});

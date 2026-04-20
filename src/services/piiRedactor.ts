import type { CalendarEvent } from "./googleCalendar";

// §5.2 PII redactor — LLM fallback 입력 전용 마스킹.
//
// SECURITY CONTRACT
// -----------------
// - DO NOT LOG OUTPUT. The return value still carries the same PII surface
//   as the input (displayName, residual text fragments, metadata). It is
//   sanitized *only* for email / URL / phone substrings in `summary`,
//   `description`, `location`, and for `creator.email` / `organizer.email` /
//   `attendees[].email` — it is **not** a log-safe projection. The only
//   legitimate consumer is the §5.3 LLM client.
// - `src/CLAUDE.md`의 "calendar event payload 로깅 금지" 계약은 sync
//   consumer / calendarSync 경로에서 이미 보장됨. redactor는 로깅 경로에
//   절대 들어가지 않는다 — 코드리뷰 invariant.
// - `classifier.ts` (rule-based, §5.1)는 raw 텍스트를 그대로 사용한다.
//   redactor는 오직 §5.3 LLM 경로에서만 호출된다.
//
// NEVER THROWS
// ------------
// `classifier.ts`와 동일 계약. 이벤트 1건의 예기치 않은 입력이 전체 sync
// 배치를 중단시키면 안 된다. 구현은 object spread + String.replace만 쓰므로
// 구조적으로 throw 불가.
//
// KNOWN LIMITATIONS (의도적 미커버)
// ---------------------------------
// - Bare-domain URL (`notion.so/page`)는 통과. scheme/`www.` 없는 링크는
//   마스킹되지 않음. 수용 기준 "no `http` literal" 은 충족.
// - Unicode local-part 이메일 (`사용자@example.com`) 통과. 극소수 케이스.
// - `displayName`은 유지 — LLM의 회의 성격 추정 신호. 이름 정책은 별도.
//
// CONSUMING `PII_REGEXES` SAFELY
// ------------------------------
// `PII_REGEXES.url` / `.email` / `.phone`은 모두 `g` flag를 가진
// **stateful** RegExp다. 이 redactor 안에서는 각 인스턴스를 한 번만
// `String.prototype.replace`에 넘기므로 `lastIndex`가 문제되지 않지만, 외부
// 소비자가 `.test()` / `.exec()`를 두 번 호출하면 stateful lastIndex
// footgun에 빠진다. 외부에서 사용할 때는 반드시 clone하라:
//     new RegExp(PII_REGEXES.phone.source, "g")
// 테스트 (`piiRedactor.test.ts` Group E)는 이미 이 패턴을 따른다.
//
// §5.3 통합 시 follow-up
// ----------------------
// - LLM 프롬프트에 "[email] / [url] / [phone]은 opaque placeholder이며
//   내용 추측 금지" 명시.
// - `llmClassifier.ts`에서 redactor 출력을 로깅 경로로 절대 흘리지 않는다.

export const PII_TOKENS = {
  EMAIL: "[email]",
  URL: "[url]",
  PHONE: "[phone]",
} as const;

export const PII_REGEXES = {
  // scheme 또는 www. 필수. 닫는 괄호/대괄호 + 한글 음절은 URL에 포함되지
  // 않도록 제외 클래스에 명시:
  //   "(see https://x.com)" → "(see [url])" (닫는 `)` 보존)
  //   "https://zoom.us/j/123에서" → "[url]에서" (조사 보존)
  url: /\b(?:https?:\/\/|www\.)[^\s<>"'\)\]\uAC00-\uD7A3]+/gi,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  // KR mobile / KR landline / 1588·15xx·16xx·18xx 대표번호 /
  // +국가코드 international. 제네릭 \d{10,11} fallback은 의도적으로 제외
  // (날짜·방번호 false positive). +로 anchor된 국제번호는 false-positive 0.
  // landline·international 브랜치는 `(02) 555-1234`, `+1 (415) 555-2671`
  // 처럼 지역코드에 괄호가 붙는 흔한 표기를 커버하도록 `\(?…\)?`를 둘러쌌다.
  phone: new RegExp(
    [
      String.raw`\b01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}\b`,
      String.raw`(?:\(|\b)0(?:2|[3-6][1-5])\)?[\s.-]?\d{3,4}[\s.-]?\d{4}\b`,
      String.raw`\b1[5-9]\d{2}[\s.-]?\d{4}\b`,
      String.raw`\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,5}`,
    ].join("|"),
    "g",
  ),
} as const;

function redactString(s: string): string {
  if (s.length === 0) return s;
  return s
    .replace(PII_REGEXES.url, PII_TOKENS.URL)
    .replace(PII_REGEXES.email, PII_TOKENS.EMAIL)
    .replace(PII_REGEXES.phone, PII_TOKENS.PHONE);
}

// `exactOptionalPropertyTypes: true` 아래에서는 optional 필드에 `undefined`를
// 명시적으로 할당할 수 없어, email 속성을 제거할 때는 destructure-and-omit
// 패턴을 사용한다.
export function redactEventForLlm(event: CalendarEvent): CalendarEvent {
  const redacted: CalendarEvent = { ...event };

  if (event.summary !== undefined) {
    redacted.summary = redactString(event.summary);
  }
  if (event.description !== undefined) {
    redacted.description = redactString(event.description);
  }
  if (event.location !== undefined) {
    redacted.location = redactString(event.location);
  }

  if (event.creator !== undefined) {
    const { email: _dropEmail, ...rest } = event.creator;
    redacted.creator = rest;
  }
  if (event.organizer !== undefined) {
    const { email: _dropEmail, ...rest } = event.organizer;
    redacted.organizer = rest;
  }
  if (event.attendees !== undefined) {
    redacted.attendees = event.attendees.map((a) => {
      const { email: _dropEmail, ...rest } = a;
      return rest;
    });
  }

  return redacted;
}

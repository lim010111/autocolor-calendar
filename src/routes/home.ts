import { Hono } from "hono";

import type { Bindings } from "../env";

export const homeRoutes = new Hono<{ Bindings: Bindings }>();

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow">
<title>AutoColor for Calendar — Auto-color your Google Calendar with keywords and AI</title>
<meta name="description" content="A Google Workspace Add-on that automatically applies colors to your Google Calendar events using keyword rules and an AI fallback.">
<link rel="icon" type="image/png" sizes="128x128" href="https://legal.autocolorcal.app/icon-128.png">
<link rel="icon" type="image/png" sizes="32x32" href="https://legal.autocolorcal.app/icon-32.png">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo",
      "Malgun Gothic", "Roboto", sans-serif;
    line-height: 1.7;
    color: #1f1f1f;
    background: #fafafa;
  }
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 48px 24px 96px;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }
  header.site {
    max-width: 760px;
    margin: 0 auto;
    padding: 16px 24px;
    font-size: 14px;
    color: #5f6368;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  footer.site {
    max-width: 760px;
    margin: 0 auto;
    padding: 16px 24px;
    font-size: 14px;
    color: #5f6368;
  }
  header.site .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: inherit;
    text-decoration: none;
    font-weight: 600;
  }
  header.site nav {
    display: inline-flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  header.site img { display: block; border-radius: 6px; }
  header.site a, footer.site a { color: #1a73e8; text-decoration: none; }
  header.site a:hover, footer.site a:hover { text-decoration: underline; }
  h1 { font-size: 32px; margin: 0 0 12px; line-height: 1.25; }
  .lead-en { font-size: 17px; color: #3c4043; margin: 0 0 8px; }
  .lead-kr { font-size: 16px; color: #5f6368; margin: 0 0 32px; }
  h2 { font-size: 22px; margin-top: 36px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
  p, li { font-size: 15px; }
  ul, ol { padding-left: 24px; }
  ol li { margin-bottom: 8px; }
  ul li { margin-bottom: 6px; }
  a { color: #1a73e8; }
  hr { border: 0; border-top: 1px solid #e0e0e0; margin: 32px 0; }
  .links { font-size: 14px; color: #5f6368; }
  @media (prefers-color-scheme: dark) {
    body { background: #1f1f1f; color: #e8eaed; }
    main { background: #292a2d; box-shadow: none; }
    header.site, footer.site { color: #9aa0a6; }
    .lead-en { color: #e8eaed; }
    .lead-kr { color: #c9ccd0; }
    h2 { border-bottom-color: #3c4043; }
    hr { border-top-color: #3c4043; }
    a, header.site a, footer.site a { color: #8ab4f8; }
    .links { color: #9aa0a6; }
  }
</style>
</head>
<body>
<header class="site">
  <a class="brand" href="/">
    <img src="https://legal.autocolorcal.app/icon-128.png" alt="" width="32" height="32">
    AutoColor for Calendar
  </a>
  <nav>
    <a href="https://legal.autocolorcal.app/privacy">Privacy Policy</a>
    <a href="https://legal.autocolorcal.app/terms">Terms of Service</a>
    <a href="mailto:support@autocolorcal.app">Support</a>
  </nav>
</header>
<main>
  <h1>AutoColor for Calendar</h1>
  <p class="lead-en">
    A Google Workspace Add-on that automatically applies colors to your
    Google Calendar events using keyword rules and an AI fallback.
  </p>
  <p class="lead-kr">
    키워드 규칙과 AI 분석으로 Google 캘린더의 일정에 자동으로 색상을
    입혀주는 Google Workspace Add-on입니다.
  </p>

  <h2>How it works · 이렇게 사용하세요</h2>
  <ol>
    <li><strong>Create rules · 규칙 만들기</strong> — Pick keywords (e.g., "meeting") and a color. 키워드와 색상을 선택해 규칙을 등록합니다.</li>
    <li><strong>Add events · 일정 추가하기</strong> — Use Google Calendar normally. 평소처럼 캘린더에 일정을 만듭니다.</li>
    <li><strong>Auto-color · 자동 색상 적용</strong> — AutoColor applies the color in the background. 백그라운드에서 색상이 입혀집니다.</li>
  </ol>

  <h2>Two-stage classifier · 두 단계 분류 엔진</h2>
  <p>
    <strong>Stage 1 (Rules)</strong> — Looks up your keywords against the
    event title, description, and location. Data never leaves Calendar.
    1단계는 사용자가 등록한 키워드를 일정의 제목·설명·위치에서 찾아 색상을
    적용합니다. 데이터는 캘린더 밖으로 나가지 않습니다.
  </p>
  <p>
    <strong>Stage 2 (AI)</strong> — Used only when Stage 1 finds no match.
    Personally identifiable information (emails, phone numbers) is masked
    before the request; names, attendees, creator, and organizer fields
    are never sent. 2단계는 1단계에서 일치하는 규칙이 없을 때만 동작하며,
    AI에 보내기 전 이메일·전화번호 등 개인정보는 자동 마스킹되고
    이름·참석자·생성자·관리자 정보는 아예 전송되지 않습니다.
  </p>

  <h2>Privacy &amp; data handling · 개인정보 보호</h2>
  <ul>
    <li>Event content (title, description, location) is never written to logs, dashboards, or admin views. 일정 본문은 로그·대시보드·관리자 화면 어디에도 기록되지 않습니다.</li>
    <li>Google-issued refresh tokens are stored encrypted with AES-256-GCM. Google 갱신 토큰은 AES-256-GCM으로 암호화해 저장됩니다.</li>
    <li>"Delete account" wipes all user data (rules, tokens, sync state, observability logs) in a single transaction, revokes the Google OAuth grant, and stops the Watch channel. "계정 삭제"는 모든 사용자 데이터를 단일 트랜잭션으로 삭제하며 Google OAuth 권한 회수와 Watch 채널 정리도 함께 실행됩니다.</li>
    <li>Only events whose color was applied by AutoColor are re-evaluated on the next sync. Events you re-color manually are excluded. AutoColor가 직접 색상을 입힌 일정만 다음 동기화에서 재평가합니다.</li>
  </ul>
  <p class="links">
    Read the full
    <a href="https://legal.autocolorcal.app/privacy">Privacy Policy</a> and
    <a href="https://legal.autocolorcal.app/terms">Terms of Service</a>.
  </p>

  <h2>Support · 지원</h2>
  <ul>
    <li>Email · 이메일: <a href="mailto:support@autocolorcal.app">support@autocolorcal.app</a></li>
    <li>GitHub Issues: <a href="https://github.com/lim010111/autocolor-calendar/issues">Bug reports and feature requests · 버그 리포트 및 기능 요청</a></li>
  </ul>
</main>
<footer class="site">
  <a href="https://legal.autocolorcal.app/privacy">Privacy Policy</a>
  &nbsp;·&nbsp;
  <a href="https://legal.autocolorcal.app/terms">Terms of Service</a>
  &nbsp;·&nbsp;
  <a href="mailto:support@autocolorcal.app">Support</a>
</footer>
</body>
</html>
`;

homeRoutes.get("/", (c) => c.html(LANDING_HTML));

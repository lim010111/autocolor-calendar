import { Hono } from "hono";

import type { Bindings } from "../env";

export const homeRoutes = new Hono<{ Bindings: Bindings }>();

const LANDING_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow">
<title>AutoColor for Calendar — 키워드와 AI로 자동 색상 적용</title>
<meta name="description" content="키워드 규칙과 AI로 Google 캘린더 일정에 자동으로 색상을 입혀주는 Google Workspace Add-on">
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
  header.site, footer.site {
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
  header.site img { display: block; border-radius: 6px; }
  header.site a, footer.site a { color: #1a73e8; text-decoration: none; }
  header.site a:hover, footer.site a:hover { text-decoration: underline; }
  h1 { font-size: 30px; margin: 0 0 8px; line-height: 1.3; }
  .lead { font-size: 17px; color: #3c4043; margin: 0 0 12px; }
  .lead-en { font-size: 14px; color: #5f6368; font-style: italic; margin: 0 0 32px; }
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
    .lead { color: #c9ccd0; }
    .lead-en { color: #9aa0a6; }
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
</header>
<main>
  <h1>키워드와 AI로 일정에 자동 색상</h1>
  <p class="lead">
    AutoColor for Calendar는 키워드 규칙과 AI 분석을 결합해 Google 캘린더의
    일정에 자동으로 색상을 입혀주는 Google Workspace Add-on입니다.
  </p>
  <p class="lead-en">
    A Google Workspace Add-on that automatically applies colors to your
    Google Calendar events using keyword rules and an AI fallback.
  </p>

  <h2>이렇게 사용하세요</h2>
  <ol>
    <li><strong>규칙 만들기</strong> — 키워드(예: "회의")와 색상을 선택해 규칙을 등록합니다.</li>
    <li><strong>일정 추가하기</strong> — 평소처럼 캘린더에 일정을 만듭니다.</li>
    <li><strong>자동 색상 적용</strong> — 백그라운드에서 AutoColor가 색상을 입혀줍니다.</li>
  </ol>

  <h2>두 단계 분류 엔진</h2>
  <p>
    <strong>1단계 (규칙)</strong> — 사용자가 등록한 키워드를 일정의
    제목·설명·위치에서 찾아 색상을 적용합니다. 데이터는 캘린더 밖으로
    나가지 않습니다.
  </p>
  <p>
    <strong>2단계 (AI)</strong> — 1단계에서 일치하는 규칙이 없을 때만
    AI 분류를 시도합니다. AI에 보내기 전 이메일·전화번호 등 개인정보는
    자동 마스킹되며, 이름·참석자·생성자·관리자 정보는 아예 전송되지
    않습니다.
  </p>

  <h2>개인정보 보호</h2>
  <ul>
    <li>일정의 본문(제목·설명·위치 등)은 로그·대시보드·관리자 화면 어디에도 기록되지 않습니다.</li>
    <li>Google이 발급한 갱신 토큰은 AES-256-GCM으로 암호화해 저장됩니다.</li>
    <li>"계정 삭제"를 누르면 모든 사용자 데이터(규칙, 토큰, 동기화 상태, 관측 로그)가 단일 트랜잭션으로 삭제되며, Google OAuth 권한 회수와 Watch 채널 정리도 함께 실행됩니다.</li>
    <li>AutoColor가 직접 색상을 입힌 일정만 다음 동기화에서 다시 평가합니다. 사용자가 직접 색상을 바꾼 일정은 자동 분류 대상에서 제외됩니다.</li>
  </ul>
  <p class="links">
    자세한 내용은
    <a href="https://legal.autocolorcal.app/privacy">개인정보처리방침</a> ·
    <a href="https://legal.autocolorcal.app/terms">서비스 이용약관</a>을 참조하세요.
  </p>

  <h2>지원</h2>
  <ul>
    <li>이메일: <a href="mailto:support@autocolorcal.app">support@autocolorcal.app</a></li>
    <li>GitHub Issues: <a href="https://github.com/lim010111/autocolor-calendar/issues">버그 리포트 및 기능 요청</a></li>
  </ul>
</main>
<footer class="site">
  <a href="https://legal.autocolorcal.app/privacy">개인정보처리방침</a>
  &nbsp;·&nbsp;
  <a href="https://legal.autocolorcal.app/terms">서비스 이용약관</a>
  &nbsp;·&nbsp;
  <a href="mailto:support@autocolorcal.app">지원</a>
</footer>
</body>
</html>
`;

homeRoutes.get("/", (c) => c.html(LANDING_HTML));

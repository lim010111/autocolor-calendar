/**
 * i18n module for AutoColor Calendar Add-on.
 *
 * Bundles: en (default fallback), ko, zh-CN, zh-TW.
 * Locale source: commonEventObject.userLocale (BCP-47, e.g. "ko-KR") for
 * card/action callbacks; Session.getActiveUserLocale() (language only,
 * e.g. "ko") for HTML rendering paths where the event object isn't
 * available. Manifest already declares useLocaleFromApp + script.locale.
 *
 * Add a new user-facing string by appending its key to ALL FOUR bundles
 * below — never hardcode a string in addon.js. See gas/CLAUDE.md.
 */

var COLOR_PALETTE = [
  { id: "11", url: "https://placehold.co/48x48/D50000/D50000.png?text=%20&radius=24", selectedUrl: "https://placehold.co/48x48/D50000/FFFFFF.png?text=%E2%88%9A&radius=24", key: "tomato" },
  { id: "4",  url: "https://placehold.co/48x48/E67C73/E67C73.png?text=%20&radius=24", selectedUrl: "https://placehold.co/48x48/E67C73/FFFFFF.png?text=%E2%88%9A&radius=24", key: "flamingo" },
  { id: "6",  url: "https://placehold.co/48x48/F4511E/F4511E.png?text=%20&radius=24", selectedUrl: "https://placehold.co/48x48/F4511E/FFFFFF.png?text=%E2%88%9A&radius=24", key: "tangerine" },
  { id: "5",  url: "https://placehold.co/48x48/F6BF26/F6BF26.png?text=%20&radius=24", selectedUrl: "https://placehold.co/48x48/F6BF26/333333.png?text=%E2%88%9A&radius=24", key: "banana" },
  { id: "2",  url: "https://placehold.co/48x48/33B679/33B679.png?text=%20&radius=24", selectedUrl: "https://placehold.co/48x48/33B679/FFFFFF.png?text=%E2%88%9A&radius=24", key: "sage" },
  { id: "10", url: "https://placehold.co/48x48/0B8043/0B8043.png?text=%20&radius=24", selectedUrl: "https://placehold.co/48x48/0B8043/FFFFFF.png?text=%E2%88%9A&radius=24", key: "basil" },
  { id: "7",  url: "https://placehold.co/48x48/039BE5/039BE5.png?text=%20&radius=24", selectedUrl: "https://placehold.co/48x48/039BE5/FFFFFF.png?text=%E2%88%9A&radius=24", key: "peacock" },
  { id: "9",  url: "https://placehold.co/48x48/3F51B5/3F51B5.png?text=%20&radius=24", selectedUrl: "https://placehold.co/48x48/3F51B5/FFFFFF.png?text=%E2%88%9A&radius=24", key: "blueberry" },
  { id: "1",  url: "https://placehold.co/48x48/7986CB/7986CB.png?text=%20&radius=24", selectedUrl: "https://placehold.co/48x48/7986CB/FFFFFF.png?text=%E2%88%9A&radius=24", key: "lavender" },
  { id: "3",  url: "https://placehold.co/48x48/8E24AA/8E24AA.png?text=%20&radius=24", selectedUrl: "https://placehold.co/48x48/8E24AA/FFFFFF.png?text=%E2%88%9A&radius=24", key: "grape" },
  { id: "8",  url: "https://placehold.co/48x48/616161/616161.png?text=%20&radius=24", selectedUrl: "https://placehold.co/48x48/616161/FFFFFF.png?text=%E2%88%9A&radius=24", key: "graphite" }
];

var MESSAGES = {
  en: {
    // Color labels (Google Calendar standard names)
    'colors.tomato': 'Tomato',
    'colors.flamingo': 'Flamingo',
    'colors.tangerine': 'Tangerine',
    'colors.banana': 'Banana',
    'colors.sage': 'Sage',
    'colors.basil': 'Basil',
    'colors.peacock': 'Peacock',
    'colors.blueberry': 'Blueberry',
    'colors.lavender': 'Lavender',
    'colors.grape': 'Grape',
    'colors.graphite': 'Graphite',
    'colors.fallback': 'Color',
    'colors.default': 'Default',

    // buildConfigNeededCard
    'config.title': 'Backend setup required',
    'config.subtitle': 'Administrator setup is incomplete',
    'config.body': 'This add-on connects to an external backend. The following Script Properties must be set in the Apps Script project:',
    'config.where': 'Set them under: Apps Script editor → Project Settings (⚙) → Script properties → Add script property',

    // buildWelcomeCard
    'welcome.title': 'AutoColor — quick start',
    'welcome.subtitle': 'AI applies colors to your events automatically.',
    'welcome.section': '💡 Try it like this',
    'welcome.step1': '<b>Step 1. Create a rule</b><br>Pick a keyword (e.g. "meeting") and a color to define your own rule.',
    'welcome.step2': '<b>Step 2. Add an event</b><br>Add events to your calendar as usual. Just include the keyword in the title or description.',
    'welcome.step3': '<b>Step 3. Auto-color</b><br>The color is usually applied within 5–10 seconds. ✨ It runs in the background even when the sidebar is closed, and events created on the mobile Google Calendar app are colored the same way.',
    'welcome.cta.login': 'Sign in with Google',

    // buildHomeCard
    'home.title': 'AutoColor dashboard',
    'home.push.inactive': '🔴 Auto-sync inactive',
    'home.push.inactive.detail': 'New events are not being colored automatically. Please reconnect.',
    'home.push.reconnect': 'Reconnect now',
    'home.stats.failed': 'Could not load stats.',
    'home.stats.applied': '✨   Auto-colored in the last 7 days: {{count}}',
    'home.btn.rules': 'Manage color rules',
    'home.btn.settings': 'More settings',
    'home.info': 'ℹ️ When you add a new event, the color is usually applied within 5–10 seconds.\n\nℹ️ Tap "Apply rules to all events" to scan events from 30 days ago through 365 days ahead and apply rules. Manually-set colors are preserved.',
    'home.info.firstEventDelay': 'ℹ️ The first automatic color application can take more than a minute — please wait a moment :)',
    'home.cta.syncNow': 'Apply rules to all events',

    // actionSyncNow
    'sync.toast.running': 'Applying rules. Updates will appear shortly.',
    'sync.toast.throttled': 'Just applied a moment ago. Please try again shortly.',
    'sync.toast.failed': 'Failed to apply rules: {{message}}',

    // actionForceHealWatch
    'heal.toast.success': 'Auto-sync reconnected.',
    'heal.toast.failed': 'Reconnect failed. Please try again shortly.',

    // formatMatchLine + onEventOpen
    'match.none': 'No matching rule',
    'match.reauth': 'Re-login required',
    'match.fetchFailed': 'Could not load classification.',
    'match.byRule': "Matched rule: '{{name}}'",
    'match.byRule.withSeed': "Matched rule: '{{name}}' (seed: '{{seed}}', {{score}})",
    'match.byLlm': "🤖 AI classification: '{{name}}'",
    'match.llm.empty': '🤖 No AI classification result',
    'match.llm.quotaExceeded': '🤖 Daily AI classification quota reached — resets at midnight (UTC)',
    'match.none.willTryLlm': 'No matching rule — AI classification will be tried on next sync',
    'match.fallbackName': 'Rule',

    // onEventOpen card
    'event.title': 'Event color analysis',
    'event.empty': 'No event selected',
    'event.untitled': 'Untitled',
    'event.section.status': 'Current state',
    'event.appliedColor': 'Applied color: {{label}}',
    'event.btn.classifyLlm': '🤖 Run AI classification',
    'event.section.override': 'Manual override and state changes',
    'event.colorPicker': 'Pick a color',
    'event.btn.exclude': 'Exclude this event from auto-classification',
    'event.btn.save': 'Save changes',

    // actionSelectColor / actionSelectColorForRule
    'color.toast.unrecognized': 'Could not detect the color. Please try again.',
    'color.toast.selected': '{{label}} selected.',

    // actionExcludeEvent
    'exclude.toast.done': 'Excluded from auto-classification.',

    // actionClassifyWithLlm
    'llm.toast.noEvent': 'No event was found.',
    'llm.toast.readFail': 'Could not read event details.',
    'llm.toast.error': 'Error while running AI classification.',
    'llm.toast.success': "AI classification complete: '{{name}}'",
    'llm.toast.empty': 'No AI classification result.',

    // actionRetryAnalysis
    'retry.toast.requested': 'Re-analysis requested.',

    // actionSaveEventOverride
    'override.toast.pickFirst': 'Please pick a color first.',
    'override.toast.notFound': 'Event not found. Please refresh and try again.',
    'override.toast.forbidden': 'You do not have permission to change this event color.',
    'override.toast.rateLimited': 'Please try again shortly.',
    'override.toast.failed': 'Could not apply the color. Please try again shortly.',
    'override.toast.success': '{{label}} applied.',

    // buildRuleManagementCard
    'common.back': '⬅ Back',
    'rules.section.create': 'Create a rule',
    'rules.name.label': 'Rule name',
    'rules.name.hint': 'Required — this name appears in your rule list.',
    'rules.colorPicker': 'Pick an event color',
    'rules.btn.add': 'Add rule',
    'rules.section.keywords': 'Keywords (optional)',
    'rules.keywords.label': 'Keywords',
    'rules.keywords.hint': 'Optional — separate multiple with commas.',
    'rules.keywords.help': "Add short phrases that describe what this rule is about (e.g. 'team meeting', '1:1'). AI blends them into the rule's meaning — they aren't matched as literal text, so rough wording is fine.",
    'rules.section.list': 'My rules',
    'rules.list.loadFailed': '⚠️ Could not load rules: {{error}}',
    'rules.list.empty': 'No rules yet. Create your first one above.',
    'rules.btn.delete': 'Delete',
    'rules.list.note': 'ℹ️ Already-colored events are not changed automatically. To apply a new rule to existing events, tap <b>Dashboard → "Apply rules now"</b>.',

    // actionAddRule
    'rules.toast.nameRequired': 'Please enter a rule name.',
    'rules.toast.colorFirst': 'Please pick a color first.',
    'rules.toast.added': 'New rule saved.',
    'rules.toast.duplicate': 'A rule with the same name already exists.',
    'rules.toast.saveFailed': 'Failed to save rule: {{message}}',

    // actionDeleteRule
    'rules.toast.deleteIdMissing': 'Could not find the rule to delete.',
    'rules.toast.deleted': 'Rule deleted. Applied colors will revert shortly.',
    'rules.toast.deleteFailed': 'Failed to delete rule: {{message}}',

    // buildSettingsCard
    'settings.section.policy': 'Policy settings',
    'settings.policy.preventOverwrite': 'Prevent manual color overwrite',
    'settings.policy.useLlm': 'Auto AI color classification',
    'settings.policy.useDescription': 'Include event description in analysis',
    'settings.section.account': 'Account',
    'settings.btn.logout': 'Sign out',
    'settings.btn.deleteAccount': 'Cancel service and delete account',

    // actionLogout
    'auth.toast.loggedOut': 'Signed out.',
    'auth.toast.loggedIn': 'Signed in.',

    // buildAccountDeleteConfirmCard
    'delete.title': 'Cancel service and delete account',
    'delete.subtitle': 'Are you sure you want to proceed?',
    'delete.warning': '⚠️ <b>Warning</b>: All data will be permanently deleted and the service will be canceled immediately. Categories, sync state, OAuth connection, and session will all be removed. This action cannot be undone.',
    'delete.btn.cancel': '⬅ Cancel',
    'delete.btn.confirm': 'Yes, proceed',
    'delete.toast.failed': 'Failed to delete account: {{message}}',
    'delete.toast.done': 'Service canceled and account deleted.',

    // buildReconnectCard
    'reconnect.title': 'Reconnect required',
    'reconnect.subtitle': 'Insufficient permission or expired token',
    'reconnect.body': 'Your session has expired or permission is missing. Please reconnect.',
    'reconnect.cta': 'Reconnect with Google',

    // onEventUpdate
    'eventUpdate.title': 'Event updated',
    'eventUpdate.body': 'Your event changes have been applied.',

    // OAuth HTML pages
    'auth.callback.title': 'Sign-in complete',
    'auth.callback.badge': '✓ Signed in',
    'auth.callback.heading': 'AutoColor connection is complete',
    'auth.callback.body1': 'This window/tab will close automatically in a moment.',
    'auth.callback.body2': "If it doesn't close, close it yourself and return to the Google Calendar add-on.",

    'auth.error.title': 'Sign-in failed',
    'auth.error.badge': '✕ Sign-in failed',
    'auth.error.heading': 'Could not complete sign-in',
    'auth.error.default.primary': 'Something went wrong during sign-in.',
    'auth.error.default.secondary': 'Please try again from the add-on shortly.',
    'auth.error.hint': 'Close this window and tap <strong>Sign in with Google</strong> again from the Google Calendar add-on.',
    'auth.error.unknown.primary': 'An unknown error occurred.',
    'auth.error.unknown.secondary': 'Please try again shortly. If the problem persists, contact support.',
    'auth.error.codeSuffix': ' (code: {{code}})',

    'auth.error.state_invalid.primary': 'Security check (state) failed.',
    'auth.error.state_invalid.secondary': 'The sign-in link expired or was tampered with. Please try again from the add-on.',
    'auth.error.consent_denied.primary': 'Consent was canceled on the Google consent screen.',
    'auth.error.consent_denied.secondary': 'AutoColor needs Calendar access to work. Please try again from the add-on.',
    'auth.error.provider_error.primary': 'Google OAuth server returned an error.',
    'auth.error.provider_error.secondary': 'This may be a transient issue on Google\'s side. Please try again shortly.',
    'auth.error.token_exchange_failed.primary': 'Token exchange with Google failed.',
    'auth.error.token_exchange_failed.secondary': 'This may be a network issue or a backend misconfiguration (Client ID/Secret). Try again shortly; contact your administrator if it persists.',
    'auth.error.invalid_grant.primary': 'The Google refresh token was invalidated.',
    'auth.error.invalid_grant.secondary': 'AutoColor permission was revoked or the token expired. Please sign in again from the add-on.',
    'auth.error.server_error.primary': 'An internal server error occurred.',
    'auth.error.server_error.secondary': 'Please try again shortly. If the problem persists, contact your administrator.'
  },

  ko: {
    'colors.tomato': '토마토',
    'colors.flamingo': '플라밍고',
    'colors.tangerine': '귤',
    'colors.banana': '바나나',
    'colors.sage': '세이지',
    'colors.basil': '바질',
    'colors.peacock': '공작',
    'colors.blueberry': '블루베리',
    'colors.lavender': '라벤더',
    'colors.grape': '포도',
    'colors.graphite': '회연필',
    'colors.fallback': '색상',
    'colors.default': '기본',

    'config.title': '백엔드 구성 필요',
    'config.subtitle': '관리자 설정이 완료되지 않았습니다',
    'config.body': '이 애드온은 외부 백엔드에 연결되어 동작합니다. Apps Script 프로젝트의 스크립트 속성에서 아래 값이 설정되어야 합니다:',
    'config.where': '설정 위치: Apps Script 편집기 → 프로젝트 설정(⚙) → 스크립트 속성 → 스크립트 속성 추가',

    'welcome.title': 'AutoColor 사용 가이드',
    'welcome.subtitle': 'AI가 일정의 색상을 자동으로 입혀 드립니다!',
    'welcome.section': '💡 이렇게 사용해보세요!',
    'welcome.step1': "<b>1단계. 규칙 만들기</b><br>키워드(예: '회의')와 원하는 색상을 선택해 나만의 규칙을 만드세요.",
    'welcome.step2': '<b>2단계. 일정 등록하기</b><br>평소처럼 캘린더에 일정을 등록합니다. 제목이나 설명에 키워드가 포함되면 됩니다.',
    'welcome.step3': '<b>3단계. 자동 색상 적용</b><br>일정을 등록하면 보통 5~10초 안에 자동으로 색상이 적용됩니다. ✨ 사이드바를 열지 않아도 백그라운드에서 동작하고, 모바일 Google 캘린더 앱에서 만든 일정도 동일하게 적용돼요.',
    'welcome.cta.login': 'Google 계정으로 시작하기',

    'home.title': 'AutoColor 대시보드',
    'home.push.inactive': '🔴 자동 동기화 비활성',
    'home.push.inactive.detail': '새 일정에 색이 자동 적용되지 않습니다. 다시 연결해 주세요.',
    'home.push.reconnect': '지금 연결',
    'home.stats.failed': '통계를 불러오지 못했습니다',
    'home.stats.applied': '✨   최근 7일 자동 색상 적용: {{count}}건',
    'home.btn.rules': '색상 규칙 관리',
    'home.btn.settings': '상세 설정',
    'home.info': "ℹ️ 새 일정을 만들면 보통 5~10초 안에 자동으로 색이 적용됩니다.\n\nℹ️ '지금 모든 일정에 규칙 적용'을 누르면 과거 30일 ~ 미래 365일의 일정을 검사해 규칙을 적용합니다. 직접 지정한 색상은 그대로 유지됩니다.",
    'home.info.firstEventDelay': "ℹ️ 첫 색상 자동 적용은 1분이 넘는 시간이 소요될 수 있어요! 조금만 기다려 주세요 :)",
    'home.cta.syncNow': '지금 모든 일정에 규칙 적용',

    'sync.toast.running': '규칙을 적용 중입니다. 잠시 후 반영됩니다.',
    'sync.toast.throttled': '조금 전에 적용했습니다. 잠시 후 다시 시도해주세요.',
    'sync.toast.failed': '규칙 적용 실패: {{message}}',

    'heal.toast.success': '자동 동기화를 다시 연결했습니다.',
    'heal.toast.failed': '다시 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.',

    'match.none': '매칭된 규칙 없음',
    'match.reauth': '재로그인이 필요합니다',
    'match.fetchFailed': '분류 정보를 가져오지 못했습니다',
    'match.byRule': "매칭된 규칙: '{{name}}'",
    'match.byRule.withSeed': "매칭된 규칙: '{{name}}' (씨앗: '{{seed}}', {{score}})",
    'match.byLlm': "🤖 AI 분류: '{{name}}'",
    'match.llm.empty': '🤖 AI 분류 결과 없음',
    'match.llm.quotaExceeded': '🤖 오늘 AI 분류 한도 소진 — 자정(UTC)에 초기화',
    'match.none.willTryLlm': '매칭된 규칙 없음 — 다음 동기화 시 AI 분류 시도',
    'match.fallbackName': '규칙',

    'event.title': '일정 색상 분석',
    'event.empty': '선택된 일정 없음',
    'event.untitled': '제목 없음',
    'event.section.status': '현재 상태',
    'event.appliedColor': '적용된 색상: {{label}}',
    'event.btn.classifyLlm': '🤖 AI 분류 확인',
    'event.section.override': '수동 오버라이드 및 상태 변경',
    'event.colorPicker': '색상 선택',
    'event.btn.exclude': '이 일정은 자동 분류에서 제외',
    'event.btn.save': '변경사항 저장',

    'color.toast.unrecognized': '색상을 인식하지 못했습니다. 다시 시도해주세요.',
    'color.toast.selected': '{{label}} 색상이 선택되었습니다.',

    'exclude.toast.done': '자동 분류에서 제외되었습니다.',

    'llm.toast.noEvent': '선택된 일정을 찾지 못했습니다.',
    'llm.toast.readFail': '일정 정보를 읽지 못했습니다.',
    'llm.toast.error': 'AI 분류 중 오류가 발생했습니다.',
    'llm.toast.success': "AI 분류 완료: '{{name}}'",
    'llm.toast.empty': 'AI 분류 결과 없음',

    'retry.toast.requested': '재분석을 요청했습니다.',

    'override.toast.pickFirst': '색상을 먼저 선택해주세요.',
    'override.toast.notFound': '일정을 찾지 못했습니다. 새로고침 후 다시 시도해주세요.',
    'override.toast.forbidden': '이 일정의 색상을 변경할 권한이 없습니다.',
    'override.toast.rateLimited': '잠시 후 다시 시도해주세요.',
    'override.toast.failed': '색상 적용에 실패했습니다. 잠시 후 다시 시도해주세요.',
    'override.toast.success': '{{label}} 색상을 적용했습니다.',

    'common.back': '⬅ 뒤로 가기',
    'rules.section.create': '규칙 만들기',
    'rules.name.label': '규칙 이름',
    'rules.name.hint': '필수 — 규칙 목록에 표시되는 이름입니다.',
    'rules.colorPicker': '일정 색상 선택',
    'rules.btn.add': '규칙 추가',
    'rules.section.keywords': '키워드 (선택)',
    'rules.keywords.label': '키워드',
    'rules.keywords.hint': '선택 — 여러 개는 쉼표로 구분하세요.',
    'rules.keywords.help': "이 규칙이 무엇에 관한 것인지 짧은 문구로 적어 주세요 (예: '팀 회의', '1:1'). AI가 규칙의 의미에 녹여 넣습니다 — 글자 그대로 매칭하지 않으니 대충 적어도 됩니다.",
    'rules.section.list': '내 규칙 목록',
    'rules.list.loadFailed': '⚠️ 규칙 목록을 불러오지 못했습니다: {{error}}',
    'rules.list.empty': '아직 등록된 규칙이 없습니다. 위에서 첫 규칙을 만들어보세요.',
    'rules.btn.delete': '삭제',
    'rules.list.note': "ℹ️ 이미 색이 지정된 일정은 자동 변경되지 않습니다. 새 규칙을 기존 일정에 적용하려면 <b>대시보드 → '지금 즉시 동기화'</b>를 눌러주세요.",

    'rules.toast.nameRequired': '규칙 이름을 입력해주세요.',
    'rules.toast.colorFirst': '색상을 먼저 선택해주세요.',
    'rules.toast.added': '새 규칙이 저장되었습니다.',
    'rules.toast.duplicate': '이미 같은 이름의 규칙이 있습니다.',
    'rules.toast.saveFailed': '규칙 저장 실패: {{message}}',

    'rules.toast.deleteIdMissing': '삭제할 규칙을 찾을 수 없습니다.',
    'rules.toast.deleted': '규칙이 삭제되었습니다. 적용된 색상은 곧 원상복구됩니다.',
    'rules.toast.deleteFailed': '규칙 삭제 실패: {{message}}',

    'settings.section.policy': '정책 설정',
    'settings.policy.preventOverwrite': '수동 색상 덮어쓰기 방지',
    'settings.policy.useLlm': 'AI 색상 자동 분류',
    'settings.policy.useDescription': '설명(일정 세부 정보) 분석에 포함',
    'settings.section.account': '계정 관리',
    'settings.btn.logout': '로그아웃',
    'settings.btn.deleteAccount': '서비스 해지 및 계정 삭제',

    'auth.toast.loggedOut': '로그아웃 되었습니다.',
    'auth.toast.loggedIn': '인증이 완료되었습니다.',

    'delete.title': '서비스 해지 및 계정 삭제',
    'delete.subtitle': '정말 진행하시겠습니까?',
    'delete.warning': '⚠️ <b>주의</b>: 모든 데이터가 영구 삭제되며 즉시 서비스가 해지됩니다. 카테고리·동기화 상태·OAuth 연결·세션이 모두 제거되며, 이 작업은 되돌릴 수 없습니다.',
    'delete.btn.cancel': '⬅ 취소',
    'delete.btn.confirm': '네, 진행합니다',
    'delete.toast.failed': '계정 삭제 실패: {{message}}',
    'delete.toast.done': '서비스가 해지되고 계정이 삭제되었습니다.',

    'reconnect.title': '재연결 필요',
    'reconnect.subtitle': '권한 부족 또는 토큰 만료',
    'reconnect.body': '세션이 만료되었거나 권한이 부족합니다. 다시 연결해주세요.',
    'reconnect.cta': 'OAuth 연동 (재로그인)',

    'eventUpdate.title': '일정 업데이트',
    'eventUpdate.body': '일정 변경 사항이 적용되었습니다.',

    'auth.callback.title': '인증 완료',
    'auth.callback.badge': '✓ 로그인 완료',
    'auth.callback.heading': 'AutoColor 연결이 완료되었습니다',
    'auth.callback.body1': '이 창/탭은 잠시 후 자동으로 닫힙니다.',
    'auth.callback.body2': '닫히지 않으면 직접 닫고 Google Calendar 애드온으로 돌아가세요.',

    'auth.error.title': '인증 실패',
    'auth.error.badge': '✕ 인증 실패',
    'auth.error.heading': '로그인을 완료하지 못했습니다',
    'auth.error.default.primary': '인증 과정에서 문제가 발생했습니다.',
    'auth.error.default.secondary': '잠시 후 애드온에서 다시 시도해 주세요.',
    'auth.error.hint': '이 창을 닫고 Google Calendar 애드온에서 <strong>Google 계정으로 시작하기</strong>를 다시 눌러 주세요.',
    'auth.error.unknown.primary': '알 수 없는 오류가 발생했습니다.',
    'auth.error.unknown.secondary': '잠시 후 다시 시도해 주세요. 문제가 지속되면 관리자에게 문의하세요.',
    'auth.error.codeSuffix': ' (코드: {{code}})',

    'auth.error.state_invalid.primary': '보안 검증(state)에 실패했습니다.',
    'auth.error.state_invalid.secondary': '로그인 링크가 만료되었거나 중간에 변조되었습니다. 애드온에서 다시 시도해 주세요.',
    'auth.error.consent_denied.primary': 'Google 동의 화면에서 권한 부여가 취소되었습니다.',
    'auth.error.consent_denied.secondary': 'AutoColor를 사용하려면 캘린더 접근 권한이 필요합니다. 애드온에서 다시 시도해 주세요.',
    'auth.error.provider_error.primary': 'Google OAuth 서버에서 오류를 반환했습니다.',
    'auth.error.provider_error.secondary': 'Google 측 일시적인 문제일 수 있습니다. 잠시 후 다시 시도해 주세요.',
    'auth.error.token_exchange_failed.primary': 'Google과의 토큰 교환에 실패했습니다.',
    'auth.error.token_exchange_failed.secondary': '네트워크 문제이거나 백엔드 설정(Client ID/Secret)이 잘못되었을 수 있습니다. 잠시 후 재시도하고 지속되면 관리자에게 문의하세요.',
    'auth.error.invalid_grant.primary': 'Google 리프레시 토큰이 무효화되었습니다.',
    'auth.error.invalid_grant.secondary': 'AutoColor 권한이 계정에서 해지되었거나 토큰이 만료되었습니다. 애드온에서 다시 로그인해 주세요.',
    'auth.error.server_error.primary': '서버 내부 오류가 발생했습니다.',
    'auth.error.server_error.secondary': '잠시 후 다시 시도해 주세요. 문제가 지속되면 관리자에게 문의하세요.'
  },

  'zh-CN': {
    'colors.tomato': '番茄红',
    'colors.flamingo': '火烈鸟',
    'colors.tangerine': '橘黄',
    'colors.banana': '香蕉黄',
    'colors.sage': '鼠尾草',
    'colors.basil': '罗勒',
    'colors.peacock': '孔雀蓝',
    'colors.blueberry': '蓝莓',
    'colors.lavender': '薰衣草',
    'colors.grape': '葡萄',
    'colors.graphite': '石墨',
    'colors.fallback': '颜色',
    'colors.default': '默认',

    'config.title': '需要后端配置',
    'config.subtitle': '管理员配置尚未完成',
    'config.body': '此插件连接外部后端运行。请在 Apps Script 项目的脚本属性中设置以下值:',
    'config.where': '设置路径: Apps Script 编辑器 → 项目设置 (⚙) → 脚本属性 → 添加脚本属性',

    'welcome.title': 'AutoColor 使用指南',
    'welcome.subtitle': 'AI 自动为您的日程上色!',
    'welcome.section': '💡 试试这样使用',
    'welcome.step1': "<b>第 1 步. 创建规则</b><br>选择关键词(例如:'会议')和您喜欢的颜色,创建您自己的规则。",
    'welcome.step2': '<b>第 2 步. 添加日程</b><br>像往常一样在日历中添加日程,标题或描述包含关键词即可。',
    'welcome.step3': '<b>第 3 步. 自动应用颜色</b><br>添加日程后通常 5~10 秒内自动应用颜色。✨ 即使不打开侧边栏也会在后台运行,移动版 Google 日历应用中创建的日程也同样适用。',
    'welcome.cta.login': '使用 Google 帐号登录',

    'home.title': 'AutoColor 仪表板',
    'home.push.inactive': '🔴 自动同步未启用',
    'home.push.inactive.detail': '新日程未自动应用颜色。请重新连接。',
    'home.push.reconnect': '立即连接',
    'home.stats.failed': '无法加载统计数据',
    'home.stats.applied': '✨   过去 7 天自动应用颜色: {{count}} 项',
    'home.btn.rules': '管理颜色规则',
    'home.btn.settings': '更多设置',
    'home.info': "ℹ️ 添加新日程时,通常 5~10 秒内自动应用颜色。\n\nℹ️ 点击「立即对所有日程应用规则」会扫描过去 30 天到未来 365 天的日程并应用规则。手动指定的颜色将保持不变。",
    'home.info.firstEventDelay': "ℹ️ 首次自动应用颜色可能需要超过 1 分钟,请稍候片刻 :)",
    'home.cta.syncNow': '立即对所有日程应用规则',

    'sync.toast.running': '正在应用规则。请稍候。',
    'sync.toast.throttled': '刚刚已应用。请稍后再试。',
    'sync.toast.failed': '应用规则失败: {{message}}',

    'heal.toast.success': '自动同步已重新连接。',
    'heal.toast.failed': '重新连接失败。请稍后再试。',

    'match.none': '无匹配规则',
    'match.reauth': '需要重新登录',
    'match.fetchFailed': '无法获取分类信息',
    'match.byRule': "匹配规则: '{{name}}'",
    'match.byRule.withSeed': "匹配规则: '{{name}}' (种子: '{{seed}}', {{score}})",
    'match.byLlm': "🤖 AI 分类: '{{name}}'",
    'match.llm.empty': '🤖 无 AI 分类结果',
    'match.llm.quotaExceeded': '🤖 今日 AI 分类配额已用完 — 将于 UTC 午夜重置',
    'match.none.willTryLlm': '无匹配规则 — 下次同步时将尝试 AI 分类',
    'match.fallbackName': '规则',

    'event.title': '日程颜色分析',
    'event.empty': '未选择日程',
    'event.untitled': '无标题',
    'event.section.status': '当前状态',
    'event.appliedColor': '已应用颜色: {{label}}',
    'event.btn.classifyLlm': '🤖 检查 AI 分类',
    'event.section.override': '手动覆盖与状态变更',
    'event.colorPicker': '选择颜色',
    'event.btn.exclude': '将此日程从自动分类中排除',
    'event.btn.save': '保存更改',

    'color.toast.unrecognized': '无法识别颜色。请重试。',
    'color.toast.selected': '已选择 {{label}}。',

    'exclude.toast.done': '已从自动分类中排除。',

    'llm.toast.noEvent': '未找到所选日程。',
    'llm.toast.readFail': '无法读取日程信息。',
    'llm.toast.error': 'AI 分类时发生错误。',
    'llm.toast.success': "AI 分类完成: '{{name}}'",
    'llm.toast.empty': '无 AI 分类结果。',

    'retry.toast.requested': '已请求重新分析。',

    'override.toast.pickFirst': '请先选择颜色。',
    'override.toast.notFound': '未找到日程。请刷新后重试。',
    'override.toast.forbidden': '您没有权限更改此日程的颜色。',
    'override.toast.rateLimited': '请稍后再试。',
    'override.toast.failed': '应用颜色失败。请稍后再试。',
    'override.toast.success': '已应用 {{label}}。',

    'common.back': '⬅ 返回',
    'rules.section.create': '创建规则',
    'rules.name.label': '规则名称',
    'rules.name.hint': '必填 — 此名称会显示在您的规则列表中。',
    'rules.colorPicker': '选择日程颜色',
    'rules.btn.add': '添加规则',
    'rules.section.keywords': '关键词 (可选)',
    'rules.keywords.label': '关键词',
    'rules.keywords.hint': '可选 — 多个关键词用逗号分隔。',
    'rules.keywords.help': '用简短的短语描述这条规则的含义(例如:"团队会议"、"1:1")。AI 会将其融入规则的语义中 — 不做字面匹配,所以大致写写就行。',
    'rules.section.list': '我的规则',
    'rules.list.loadFailed': '⚠️ 无法加载规则列表: {{error}}',
    'rules.list.empty': '尚无规则。在上方创建您的第一条规则。',
    'rules.btn.delete': '删除',
    'rules.list.note': "ℹ️ 已经设置颜色的日程不会自动更改。要将新规则应用到现有日程,请点击 <b>仪表板 → 「立即同步」</b>。",

    'rules.toast.nameRequired': '请输入规则名称。',
    'rules.toast.colorFirst': '请先选择颜色。',
    'rules.toast.added': '新规则已保存。',
    'rules.toast.duplicate': '已存在同名规则。',
    'rules.toast.saveFailed': '保存规则失败: {{message}}',

    'rules.toast.deleteIdMissing': '找不到要删除的规则。',
    'rules.toast.deleted': '规则已删除。已应用的颜色将很快还原。',
    'rules.toast.deleteFailed': '删除规则失败: {{message}}',

    'settings.section.policy': '策略设置',
    'settings.policy.preventOverwrite': '阻止覆盖手动设置的颜色',
    'settings.policy.useLlm': 'AI 自动颜色分类',
    'settings.policy.useDescription': '在分析中包含日程描述',
    'settings.section.account': '帐号管理',
    'settings.btn.logout': '退出登录',
    'settings.btn.deleteAccount': '取消服务并删除帐号',

    'auth.toast.loggedOut': '已退出登录。',
    'auth.toast.loggedIn': '验证完成。',

    'delete.title': '取消服务并删除帐号',
    'delete.subtitle': '确定要继续吗?',
    'delete.warning': '⚠️ <b>警告</b>: 所有数据将被永久删除并立即取消服务。类别、同步状态、OAuth 连接和会话都将被移除,此操作无法撤销。',
    'delete.btn.cancel': '⬅ 取消',
    'delete.btn.confirm': '是的,继续',
    'delete.toast.failed': '删除帐号失败: {{message}}',
    'delete.toast.done': '服务已取消,帐号已删除。',

    'reconnect.title': '需要重新连接',
    'reconnect.subtitle': '权限不足或令牌已过期',
    'reconnect.body': '会话已过期或权限不足。请重新连接。',
    'reconnect.cta': '重新进行 OAuth 授权',

    'eventUpdate.title': '日程更新',
    'eventUpdate.body': '日程变更已应用。',

    'auth.callback.title': '验证完成',
    'auth.callback.badge': '✓ 登录完成',
    'auth.callback.heading': 'AutoColor 连接已完成',
    'auth.callback.body1': '此窗口/标签页将很快自动关闭。',
    'auth.callback.body2': '如果未关闭,请手动关闭并返回 Google 日历插件。',

    'auth.error.title': '验证失败',
    'auth.error.badge': '✕ 验证失败',
    'auth.error.heading': '无法完成登录',
    'auth.error.default.primary': '验证过程中发生问题。',
    'auth.error.default.secondary': '请稍后从插件中重试。',
    'auth.error.hint': '关闭此窗口,在 Google 日历插件中再次点击 <strong>使用 Google 帐号登录</strong>。',
    'auth.error.unknown.primary': '发生未知错误。',
    'auth.error.unknown.secondary': '请稍后再试。如果问题仍然存在,请联系管理员。',
    'auth.error.codeSuffix': ' (代码: {{code}})',

    'auth.error.state_invalid.primary': '安全验证 (state) 失败。',
    'auth.error.state_invalid.secondary': '登录链接已过期或被篡改。请从插件中重试。',
    'auth.error.consent_denied.primary': '在 Google 同意屏幕上取消了授权。',
    'auth.error.consent_denied.secondary': 'AutoColor 需要日历访问权限才能运行。请从插件中重试。',
    'auth.error.provider_error.primary': 'Google OAuth 服务器返回错误。',
    'auth.error.provider_error.secondary': '这可能是 Google 端的临时问题。请稍后再试。',
    'auth.error.token_exchange_failed.primary': '与 Google 的令牌交换失败。',
    'auth.error.token_exchange_failed.secondary': '可能是网络问题或后端配置 (Client ID/Secret) 错误。请稍后重试,如果持续存在请联系管理员。',
    'auth.error.invalid_grant.primary': 'Google 刷新令牌已失效。',
    'auth.error.invalid_grant.secondary': 'AutoColor 权限已被撤销或令牌已过期。请从插件中重新登录。',
    'auth.error.server_error.primary': '发生服务器内部错误。',
    'auth.error.server_error.secondary': '请稍后再试。如果问题仍然存在,请联系管理员。'
  },

  'zh-TW': {
    'colors.tomato': '蕃茄紅',
    'colors.flamingo': '紅鶴',
    'colors.tangerine': '橘黃',
    'colors.banana': '香蕉黃',
    'colors.sage': '鼠尾草',
    'colors.basil': '羅勒',
    'colors.peacock': '孔雀藍',
    'colors.blueberry': '藍莓',
    'colors.lavender': '薰衣草',
    'colors.grape': '葡萄',
    'colors.graphite': '石墨',
    'colors.fallback': '顏色',
    'colors.default': '預設',

    'config.title': '需要後端設定',
    'config.subtitle': '管理員設定尚未完成',
    'config.body': '此外掛程式連線至外部後端執行。請在 Apps Script 專案的指令碼屬性中設定下列值:',
    'config.where': '設定位置: Apps Script 編輯器 → 專案設定 (⚙) → 指令碼屬性 → 新增指令碼屬性',

    'welcome.title': 'AutoColor 使用指南',
    'welcome.subtitle': 'AI 自動為您的活動上色!',
    'welcome.section': '💡 試試這樣使用',
    'welcome.step1': "<b>步驟 1. 建立規則</b><br>選擇關鍵字(例如:「會議」)和您喜歡的顏色,建立您自己的規則。",
    'welcome.step2': '<b>步驟 2. 新增活動</b><br>像平常一樣在日曆中新增活動,標題或描述包含關鍵字即可。',
    'welcome.step3': '<b>步驟 3. 自動套用顏色</b><br>新增活動後通常 5~10 秒內自動套用顏色。✨ 即使不開啟側邊欄也會在背景執行,行動版 Google 日曆應用程式建立的活動同樣適用。',
    'welcome.cta.login': '使用 Google 帳戶登入',

    'home.title': 'AutoColor 資訊主頁',
    'home.push.inactive': '🔴 自動同步未啟用',
    'home.push.inactive.detail': '新活動未自動套用顏色。請重新連線。',
    'home.push.reconnect': '立即連線',
    'home.stats.failed': '無法載入統計資料',
    'home.stats.applied': '✨   過去 7 天自動套用顏色: {{count}} 項',
    'home.btn.rules': '管理顏色規則',
    'home.btn.settings': '更多設定',
    'home.info': "ℹ️ 新增活動時,通常 5~10 秒內自動套用顏色。\n\nℹ️ 點選「立即將規則套用至所有活動」會掃描過去 30 天到未來 365 天的活動並套用規則。手動指定的顏色將保持不變。",
    'home.info.firstEventDelay': "ℹ️ 首次自動套用顏色可能需要超過 1 分鐘,請稍候片刻 :)",
    'home.cta.syncNow': '立即將規則套用至所有活動',

    'sync.toast.running': '正在套用規則。請稍候。',
    'sync.toast.throttled': '剛剛已套用。請稍後再試。',
    'sync.toast.failed': '套用規則失敗: {{message}}',

    'heal.toast.success': '自動同步已重新連線。',
    'heal.toast.failed': '重新連線失敗。請稍後再試。',

    'match.none': '無相符規則',
    'match.reauth': '需要重新登入',
    'match.fetchFailed': '無法取得分類資訊',
    'match.byRule': "相符規則: '{{name}}'",
    'match.byRule.withSeed': "相符規則: '{{name}}' (種子: '{{seed}}', {{score}})",
    'match.byLlm': "🤖 AI 分類: '{{name}}'",
    'match.llm.empty': '🤖 無 AI 分類結果',
    'match.llm.quotaExceeded': '🤖 今日 AI 分類額度已用完 — 將於 UTC 午夜重置',
    'match.none.willTryLlm': '無相符規則 — 下次同步時將嘗試 AI 分類',
    'match.fallbackName': '規則',

    'event.title': '活動顏色分析',
    'event.empty': '未選擇活動',
    'event.untitled': '無標題',
    'event.section.status': '目前狀態',
    'event.appliedColor': '已套用顏色: {{label}}',
    'event.btn.classifyLlm': '🤖 檢查 AI 分類',
    'event.section.override': '手動覆寫與狀態變更',
    'event.colorPicker': '選擇顏色',
    'event.btn.exclude': '將此活動從自動分類中排除',
    'event.btn.save': '儲存變更',

    'color.toast.unrecognized': '無法識別顏色。請重試。',
    'color.toast.selected': '已選擇 {{label}}。',

    'exclude.toast.done': '已從自動分類中排除。',

    'llm.toast.noEvent': '找不到所選活動。',
    'llm.toast.readFail': '無法讀取活動資訊。',
    'llm.toast.error': 'AI 分類時發生錯誤。',
    'llm.toast.success': "AI 分類完成: '{{name}}'",
    'llm.toast.empty': '無 AI 分類結果。',

    'retry.toast.requested': '已要求重新分析。',

    'override.toast.pickFirst': '請先選擇顏色。',
    'override.toast.notFound': '找不到活動。請重新整理後再試。',
    'override.toast.forbidden': '您沒有權限變更此活動的顏色。',
    'override.toast.rateLimited': '請稍後再試。',
    'override.toast.failed': '套用顏色失敗。請稍後再試。',
    'override.toast.success': '已套用 {{label}}。',

    'common.back': '⬅ 返回',
    'rules.section.create': '建立規則',
    'rules.name.label': '規則名稱',
    'rules.name.hint': '必填 — 此名稱會顯示在您的規則清單中。',
    'rules.colorPicker': '選擇活動顏色',
    'rules.btn.add': '新增規則',
    'rules.section.keywords': '關鍵字 (選填)',
    'rules.keywords.label': '關鍵字',
    'rules.keywords.hint': '選填 — 多個關鍵字請用逗號分隔。',
    'rules.keywords.help': '用簡短的詞句描述這條規則的含義(例如:「團隊會議」、「1:1」)。AI 會將其融入規則的語意中 — 不做字面比對,所以大致寫寫就行。',
    'rules.section.list': '我的規則',
    'rules.list.loadFailed': '⚠️ 無法載入規則清單: {{error}}',
    'rules.list.empty': '尚無規則。在上方建立您的第一條規則。',
    'rules.btn.delete': '刪除',
    'rules.list.note': "ℹ️ 已設定顏色的活動不會自動變更。要將新規則套用至現有活動,請點選 <b>資訊主頁 → 「立即同步」</b>。",

    'rules.toast.nameRequired': '請輸入規則名稱。',
    'rules.toast.colorFirst': '請先選擇顏色。',
    'rules.toast.added': '新規則已儲存。',
    'rules.toast.duplicate': '已有相同名稱的規則。',
    'rules.toast.saveFailed': '儲存規則失敗: {{message}}',

    'rules.toast.deleteIdMissing': '找不到要刪除的規則。',
    'rules.toast.deleted': '規則已刪除。已套用的顏色將很快還原。',
    'rules.toast.deleteFailed': '刪除規則失敗: {{message}}',

    'settings.section.policy': '原則設定',
    'settings.policy.preventOverwrite': '防止覆寫手動設定的顏色',
    'settings.policy.useLlm': 'AI 自動顏色分類',
    'settings.policy.useDescription': '在分析中包含活動描述',
    'settings.section.account': '帳戶管理',
    'settings.btn.logout': '登出',
    'settings.btn.deleteAccount': '取消服務並刪除帳戶',

    'auth.toast.loggedOut': '已登出。',
    'auth.toast.loggedIn': '驗證完成。',

    'delete.title': '取消服務並刪除帳戶',
    'delete.subtitle': '確定要繼續嗎?',
    'delete.warning': '⚠️ <b>警告</b>: 所有資料將被永久刪除並立即取消服務。類別、同步狀態、OAuth 連線及工作階段都將被移除,此操作無法復原。',
    'delete.btn.cancel': '⬅ 取消',
    'delete.btn.confirm': '是的,繼續',
    'delete.toast.failed': '刪除帳戶失敗: {{message}}',
    'delete.toast.done': '服務已取消,帳戶已刪除。',

    'reconnect.title': '需要重新連線',
    'reconnect.subtitle': '權限不足或權杖已過期',
    'reconnect.body': '工作階段已過期或權限不足。請重新連線。',
    'reconnect.cta': '重新進行 OAuth 授權',

    'eventUpdate.title': '活動更新',
    'eventUpdate.body': '活動變更已套用。',

    'auth.callback.title': '驗證完成',
    'auth.callback.badge': '✓ 登入完成',
    'auth.callback.heading': 'AutoColor 連線已完成',
    'auth.callback.body1': '此視窗/分頁將很快自動關閉。',
    'auth.callback.body2': '如果未關閉,請手動關閉並返回 Google 日曆外掛程式。',

    'auth.error.title': '驗證失敗',
    'auth.error.badge': '✕ 驗證失敗',
    'auth.error.heading': '無法完成登入',
    'auth.error.default.primary': '驗證過程中發生問題。',
    'auth.error.default.secondary': '請稍後從外掛程式中重試。',
    'auth.error.hint': '關閉此視窗,在 Google 日曆外掛程式中再次點選 <strong>使用 Google 帳戶登入</strong>。',
    'auth.error.unknown.primary': '發生未知錯誤。',
    'auth.error.unknown.secondary': '請稍後再試。如果問題持續存在,請聯絡管理員。',
    'auth.error.codeSuffix': ' (代碼: {{code}})',

    'auth.error.state_invalid.primary': '安全驗證 (state) 失敗。',
    'auth.error.state_invalid.secondary': '登入連結已過期或遭到竄改。請從外掛程式中重試。',
    'auth.error.consent_denied.primary': '在 Google 同意畫面上取消了授權。',
    'auth.error.consent_denied.secondary': 'AutoColor 需要日曆存取權才能運作。請從外掛程式中重試。',
    'auth.error.provider_error.primary': 'Google OAuth 伺服器傳回錯誤。',
    'auth.error.provider_error.secondary': '這可能是 Google 端的暫時性問題。請稍後再試。',
    'auth.error.token_exchange_failed.primary': '與 Google 的權杖交換失敗。',
    'auth.error.token_exchange_failed.secondary': '可能是網路問題或後端設定 (Client ID/Secret) 錯誤。請稍後重試,若持續發生請聯絡管理員。',
    'auth.error.invalid_grant.primary': 'Google 重新整理權杖已失效。',
    'auth.error.invalid_grant.secondary': 'AutoColor 權限已遭撤銷或權杖已過期。請從外掛程式中重新登入。',
    'auth.error.server_error.primary': '發生伺服器內部錯誤。',
    'auth.error.server_error.secondary': '請稍後再試。如果問題持續存在,請聯絡管理員。'
  }
};

/**
 * Resolve user locale to a supported bundle key.
 *
 * Source priority:
 *   1) e.commonEventObject.userLocale (BCP-47, e.g. "ko-KR") — from
 *      add-on framework when useLocaleFromApp:true is set in manifest.
 *   2) Session.getActiveUserLocale() (language only, e.g. "ko") — for
 *      paths without an event object (e.g. doGet HTML rendering).
 *   3) Default 'en'.
 *
 * Mapping:
 *   - ko*                                     → 'ko'
 *   - zh-CN, zh-Hans*, zh-SG                  → 'zh-CN'
 *   - zh-TW, zh-HK, zh-MO, zh-Hant*           → 'zh-TW'
 *   - everything else (en, ja, de, fr, ...)   → 'en'
 */
function pickLocale(e) {
  var raw = '';
  if (e && e.commonEventObject && e.commonEventObject.userLocale) {
    raw = String(e.commonEventObject.userLocale);
  } else if (e && e.userLocale) {
    raw = String(e.userLocale);
  } else {
    try {
      raw = String(Session.getActiveUserLocale() || '');
    } catch (_err) {
      raw = '';
    }
  }
  return normalizeLocale(raw);
}

function normalizeLocale(raw) {
  if (!raw) return 'en';
  var lower = raw.toLowerCase().replace('_', '-');
  if (lower.indexOf('ko') === 0) return 'ko';
  if (lower === 'zh-cn' || lower.indexOf('zh-hans') === 0 || lower === 'zh-sg') return 'zh-CN';
  if (
    lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo' ||
    lower.indexOf('zh-hant') === 0
  ) return 'zh-TW';
  // Bare 'zh' → default to Simplified (largest user pool)
  if (lower === 'zh') return 'zh-CN';
  return 'en';
}

/**
 * Translate `key` using the bundle for `locale`. Falls back to en, then
 * the key itself, so missing keys never render as undefined.
 *
 * `params` is an object whose keys replace `{{name}}` placeholders.
 */
function t(key, params, locale) {
  var bundle = MESSAGES[locale] || MESSAGES.en;
  var raw = bundle[key];
  if (raw === undefined) raw = MESSAGES.en[key];
  if (raw === undefined) raw = key;
  if (!params) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, function (_, name) {
    var v = params[name];
    return v === undefined || v === null ? '' : String(v);
  });
}

/**
 * Returns the calendar color list with locale-appropriate labels. The
 * palette (id / image URLs) is locale-free; only `label` is translated.
 */
function getCalendarColors(locale) {
  var L = locale || 'en';
  return COLOR_PALETTE.map(function (c) {
    return {
      id: c.id,
      label: t('colors.' + c.key, null, L),
      url: c.url,
      selectedUrl: c.selectedUrl
    };
  });
}

/**
 * Returns the locale-appropriate {primary, secondary} for an OAuth
 * error code. Used by the doGet authError HTML template.
 */
function getAuthErrorBundle(locale) {
  var L = locale || 'en';
  var codes = ['state_invalid', 'consent_denied', 'provider_error', 'token_exchange_failed', 'invalid_grant', 'server_error'];
  var out = {};
  for (var i = 0; i < codes.length; i++) {
    var c = codes[i];
    out[c] = {
      primary: t('auth.error.' + c + '.primary', null, L),
      secondary: t('auth.error.' + c + '.secondary', null, L)
    };
  }
  out.__unknown = {
    primary: t('auth.error.unknown.primary', null, L),
    secondary: t('auth.error.unknown.secondary', null, L)
  };
  out.__codeSuffix = t('auth.error.codeSuffix', { code: '__CODE__' }, L);
  return out;
}

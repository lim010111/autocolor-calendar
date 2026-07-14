# sync-reliability — Workers Free 플랜 서브리퀘스트 캡이 sync 파이프라인을 무는 문제

2026-07-14 prod tail에서 발견된 `(warn) [llmClassifier] unknown error: Error`
×32의 진단 결과와 그 해소 트랙. 진단 세션: 2026-07-14.

## 증상

- 07-14 09:51Z, 규칙 추가가 트리거한 `full_resync` 큐 잡 1건에서
  `[llmClassifier] unknown error: Error` warn ×32.
- 07-02에도 동일 서명 23건 존재 (당시 미인지).

## 근본 원인 (실증됨)

**Cloudflare 계정이 Workers Free 플랜 — invocation당 서브리퀘스트(외부
fetch) 50개 제한.** 큰 sync 런(이벤트 85~97개, LLM 레그 67~80콜 + PATCH)이
런 중반에 예산을 소진하면, 이후 모든 `fetch()`가
`Error: Too many subrequests by single Worker invocation.` (plain `Error`,
name `"Error"`, 0ms 즉시 reject)를 던진다. `llmClassifier.ts`의 catch는
TimeoutError/TypeError만 분기하고 나머지는 `err.name`만 로깅하므로
`unknown error: Error`로 뭉개졌다.

### 증거 사슬

1. **prod `llm_calls` 포렌식 (07-14 런, 71콜)**: bad_response 32건 전부
   `raw_response IS NULL`(HTTP 응답 자체가 없음 = fetch가 던짐),
   latency 448~665ms 균일, attempts=1. 같은 런에서 hit 24 + miss 23은 정상.
   전 기간 `http_error`/`timeout` 0건 → API 키·OpenAI 쿼터·타임아웃 전부 기각.
2. **실패 위치 시퀀스** (ctid 순서, X=thrown / .=정상):
   - 07-14: `XXXXX......X......XX......X............X......X...XXXXX…(말단 21연속)`
   - 07-02: `X.............................................XXXX…(말단 22연속)`
   말단 연속 블록 = 예산 소진형. 시작 지점이 두 날 모두 "LLM 시도 + PATCH +
   events.list + token ≈ 50" 경계와 일치.
3. **sync_runs 교차 검증**: `llm_attempted > 20`인 런은 역사상 7개(07-02 ×6,
   07-14 ×1)뿐이고 전부 fetch 총량이 50 경계에 걸림. 07-02의 4개 런은
   `outcome: retryable` — **PATCH fetch도 캡에 걸려 sync 자체가 큐 재시도
   루프**에 들어갔고, 재시도마다 같은 페이지의 LLM 콜을 다시 태워 per-user
   일일 쿼터 200을 전소시킴 (`quota_exceeded` 174건의 정체).
4. **동일 계정 실증**: 스크래치 진단 워커(배포 후 삭제)가 순차 fetch 버스트에서
   **정확히 50번째부터** 위 에러 문자열을 던짐 → 계정 = Free 플랜 확정.
5. ~450ms의 정체: `latency_ms`는 `reserveLlmCall`(max:1 postgres 커넥션 경합
   시 수백 ms)을 포함. fetch 자체는 0ms 즉시 reject.

### 미해명 잔여 (Mode B)

07-14 초반 5건 + 중반 산발 6건, 07-02 초반 1건은 예산 소진으로 설명 불가
(예산은 소진되면 회복 불가인데 이후 콜이 성공함). 연결 수준 transient로
추정되나 **정확한 메시지는 name-only 로깅 때문에 소실** — #03의 관측성
개선이 다음 발생 시 포착한다.

### 진단 시 참고 (재현 함정)

- `wrangler dev --remote` 프리뷰 콜로는 egress IP가 OpenAI 지역 차단
  (`unsupported_country_region_territory` 403)에 걸려 이 종류의 재현에
  부적합. 실배포 워커로만 유효한 재현이 됨.
- prod 지표만으로 판정 가능했던 이유: `llm_calls`의 §6.3 디버깅 컬럼
  (raw_response NULL 여부, latency, attempts) + `sync_runs` 카운터.

## 영향

- **무성 분류 소실**: 캡 이후 LLM 레그 이벤트는 전부 `bad_response` →
  silent `no_match` → 색 미적용. 재시도 없음(이벤트가 변경되거나 다음
  full resync까지 방치).
- **재시도 폭풍 + 쿼터 전소**: 캡이 PATCH를 물면 런이 `retryable`로 끝나
  큐 재시도 → LLM 콜 재소진 → 일일 쿼터 고갈(07-02 실측).
- **런칭 게이트급**: 신규 사용자 온보딩 = 캘린더 전체 full sync. 이벤트
  수백 개 캘린더에서 `maxResults=2500`이라 페이지 1개에 전부 실리고,
  invocation당 fetch 예산 50을 반드시 초과한다. 실사용자 온보딩이
  구조적으로 이 코스를 밟는다.
- 관측성: `err.name`만 로깅해 07-02 첫 발생을 12일간 은폐.

## 이슈

- 01 — Workers Paid 업그레이드 결정 (사람, 비용 결정)
- 02 — invocation당 fetch 예산 가드 + chunk 연속 (플랜 무관 방어)
- 03 — llmClassifier unknown-error 관측성 + cap-latch + 재시도

권고 순서: 01(결정 5분) → 03(소형, 즉시 가능) → 02(중형). 01이 업그레이드로
결정되면 02의 긴급도는 내려가지만, 예산 상수만 1000으로 바뀔 뿐 다페이지
대형 캘린더 방어로서 여전히 유효.

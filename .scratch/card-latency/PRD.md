# Card latency — GAS Add-on 카드 클릭 지연 개선

## 배경 (진단 요약, 2026-07-02 세션)

애드온 카드 버튼 클릭마다 응답 지연이 체감되고, 특히 color rule 버튼
(규칙 추가·색상 선택)에서 심하다. 클릭 한 번의 경로를 코드로 추적한 결과:

```
클릭 → Apps Script 함수 디스패치 → 카드 재빌드 → (재빌드에 박힌) GAS→Worker
HTTP 왕복 → authMiddleware(verifySession SELECT) + 라우트(listRules SELECT)
→ JSON 복귀 → 카드 전면 재빌드 + 외부 이미지 렌더
```

### 지배적 원인 (우선순위)

1. **재빌드에 박힌 불필요한 백엔드 왕복** — `buildRuleManagementCard`가 매
   재빌드마다 `GET /api/categories`(`fetchCategoriesOrError`)를 호출.
   - `actionSelectColorForRule`(색 선택)은 데이터 변화가 0인 순수 UI 토글인데도
     전체 카드를 재빌드하며 왕복 1회를 재지불한다. ← 색상 버튼이 유독 느린 이유.
   - `actionAddRule`은 POST 후 재빌드로 GET → **왕복 2회 직렬**. `actionDeleteRule`
     도 동일.
2. **왕복 내부 DB 비용** — 요청마다 Hyperdrive→Supabase 풀러 핸드셰이크 위에서
   순차 2쿼리(`verifySession` + `listRules`). `prepare:false`·`max:1`은 풀러
   제약상 의도된 값이라 **손대지 않는다**. (왕복 자체를 없애는 게 정답이라 이
   경로 최적화는 무의미해짐 → deferred.)
3. **컬러 그리드 외부 이미지 11개** — `placehold.co` PNG. 선택 스와치는 다른 URL
   (`selectedUrl`)로 바뀌어 색 선택마다 캐시 미스 → 새 외부 fetch. 백엔드와 무관한
   렌더 지연.
4. **api.js 재시도** — 정상경로 지연 0. 5xx/네트워크 실패 시 500ms→1s→2s 백오프가
   꼬리지연을 키우는 증폭기일 뿐, 중앙값 원인 아님 → deferred.
5. **Apps Script 디스패치** — CardService 모델상 불가피한 고정비, 모든 버튼 공통.

**결론**: 카드 재빌드 자체는 싸다. 비싼 건 *재빌드에 박힌 불필요한 GAS↔백엔드
왕복*이다. 이걸 없애는 것이 이 트랙의 핵심.

## 이슈 구성 (vertical slices)

- **#01** 규칙 편집기 색상 선택 — 백엔드 왕복 제거 (prefactor 포함, 최우선)
- **#02** 규칙 추가/삭제 — 왕복 2회→1회 (mutation 응답에 목록 실어 보내기, #01 blocked)
- **#03** 컬러 스와치 이미지 — 외부 의존 제거 + selected 프리워밍 (독립)

Deferred(이슈화 안 함): DB 2쿼리 병합(#01이 왕복을 없애 무의미), 재시도 백오프
튜닝(꼬리지연 한정), Apps Script 디스패치(불가피).

## 공통 제약

- **OAuth 검수 중 진행 가능.** 이 트랙은 새 OAuth scope·consent·redirect·저장
  데이터 성격을 바꾸지 않는다. GAS 변경은 반드시 **기존 deployment "New version"**
  으로만 배포(`/exec` URL 불변, `appsscript.json` scopes 불변). "New deployment"
  절대 금지.
- **타이밍 검증 전제**: 서버측 `duration_ms`는 `logger.ts`가 요청마다 기록 —
  `wrangler tail`로 확인. GAS 실행시간은 `clasp logs`. 단 현재 CF_API_TOKEN이
  401 만료 상태라 `wrangler tail` 전에 재발급 필요(운영 선행 작업).

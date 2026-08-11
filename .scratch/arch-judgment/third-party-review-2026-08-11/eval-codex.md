## 1. 평결

승인 근거와 설계가 서로 충돌한다. **위험 수준: 높음.**

## 2. 핵심 결함·리스크

- **높음 — 자체 승인 기준 미충족.** 초안은 hard 슬라이스 비열화를 교체 조건으로 정했지만([verdict-draft:23](/home/shine/projects/autocolor_for_calendar/.tpr/targets/1-2026-08-08-verdict-draft.md:23)), 436건은 아직 큐레이션·라벨 전이다([verdict-draft:204](/home/shine/projects/autocolor_for_calendar/.tpr/targets/1-2026-08-08-verdict-draft.md:204)). 그런데 ADR은 이미 `Accepted`다([ADR-0008:3](/home/shine/projects/autocolor_for_calendar/.tpr/targets/3-0008-classification-architecture-verdict.md:3)). 선언한 최종 게이트를 건너뛴 승인이다.

- **높음 — 캐시 키가 실제 분류 입력을 누락한다.** ADR은 `제목 × 규칙셋 + 프롬프트 버전`만 키로 삼는다([ADR-0008:70](/home/shine/projects/autocolor_for_calendar/.tpr/targets/3-0008-classification-architecture-verdict.md:70)). 실제 프롬프트는 이벤트 `summary`, `description`, `location`을 모두 전송한다([llmClassifier.ts:261](/home/shine/projects/autocolor_for_calendar/src/services/llmClassifier.ts:261), [system.v8.md:55](/home/shine/projects/autocolor_for_calendar/prompts/classifier/system.v8.md:55)). 같은 제목의 서로 다른 일정, 설명·장소 수정이 동일 캐시에 충돌한다. ADR의 “향후 description/location 소비 시 재판정” 트리거도 이미 발화한 상태다([ADR-0008:125](/home/shine/projects/autocolor_for_calendar/.tpr/targets/3-0008-classification-architecture-verdict.md:125)).

- **높음 — 캐시 근거인 래칫 측정이 실제 상태 전이가 아니다.** 문서는 반복 오적용이 단조 누적된다고 단정한다([verdict-draft:100](/home/shine/projects/autocolor_for_calendar/.tpr/targets/1-2026-08-08-verdict-draft.md:100)). 그러나 채점기는 “한 번이라도 오답이면 최종 오답”인 비관적 상한임을 명시한다([score.py:222](/home/shine/projects/autocolor_for_calendar/evals/arch-judgment/score.py:222)). 런타임에서는 후속 hit이 기존 오색을 다른 라벨로 덮어쓴다([calendarSync.ts:343](/home/shine/projects/autocolor_for_calendar/src/services/calendarSync.ts:343)). 캐시는 후속 오답을 막지만 최초 오답의 자동 교정도 영구 차단한다. 채택 방향은 가능해도 제시된 효과 크기와 “단조” 주장은 틀렸다.

- **높음 — 통계적 확신이 조작에 가깝다.** 동일 운영자의 311개 제목을 8조건으로 반복하고, 31개 정책을 같은 데이터에서 고른 뒤 런 간 출력 차이만 `±0.015 노이즈 밴드`로 취급했다([verdict-draft:11](/home/shine/projects/autocolor_for_calendar/.tpr/targets/1-2026-08-08-verdict-draft.md:11), [verdict-draft:39](/home/shine/projects/autocolor_for_calendar/.tpr/targets/1-2026-08-08-verdict-draft.md:39)). 표본·사용자·라벨 불확실성의 신뢰구간도, 정책 선택용/확인용 분리도 없다. 원자료도 `공부` 147건과 `중요` 64건이 311건 중 211건을 차지한다([manifest.json:6](/home/shine/projects/autocolor_for_calendar/evals/embedding-eval/manifest.json:6), [manifest.json:15](/home/shine/projects/autocolor_for_calendar/evals/embedding-eval/manifest.json:15), [manifest.json:95](/home/shine/projects/autocolor_for_calendar/evals/embedding-eval/manifest.json:95)). `+0.566`은 제품 기대값이 아니라 이 한 사람에게 임의 가중한 조건 평균이다.

- **높음 — 미측정 verified 경로를 그대로 발화시킨다.** `T_VERIFIED=0.30`은 측정되지 않았지만 example 저장 개시 후 자동 활성화된다([ADR-0008:79](/home/shine/projects/autocolor_for_calendar/.tpr/targets/3-0008-classification-architecture-verdict.md:79)). 더구나 규칙당 최고 씨앗 하나만 고르므로 declared 씨앗이 example을 마스킹하는 결함도 이미 확인됐다([ontology-review:54](/home/shine/projects/autocolor_for_calendar/.tpr/targets/2-2026-08-11-element-ontology-review.md:54)). 결과는 둘 중 하나다. Instant Feedback이 조용히 무시되거나, 검증되지 않은 0.30 배정이 2표 재확인을 우회한다.

- **중간 — description 실험과 배포 대상 프롬프트가 다르다.** 실험은 v8 시스템 프롬프트를 바꾸지 않고 문서화되지 않은 규칙 `description` 필드만 삽입했다([verdict-draft:120](/home/shine/projects/autocolor_for_calendar/.tpr/targets/1-2026-08-08-verdict-draft.md:120)). ADR은 배포 때 필드 문서화 여부를 다시 eval-gate에 걸겠다고 한다([ADR-0008:92](/home/shine/projects/autocolor_for_calendar/.tpr/targets/3-0008-classification-architecture-verdict.md:92)). 문서화하면 프롬프트가 달라져 `+0.566`이 적용되지 않고, 문서화하지 않으면 자체 프롬프트 계약을 어긴다.

- **중간 — 쿼터 계산과 안전 주장이 불일치한다.** ADR은 1.54배로 116콜이 약 220콜이 된다고 쓰지만([ADR-0008:74](/home/shine/projects/autocolor_for_calendar/.tpr/targets/3-0008-classification-architecture-verdict.md:74)), 다른 곳에서는 현행 대비 1.9배라고 쓴다([ADR-0008:88](/home/shine/projects/autocolor_for_calendar/.tpr/targets/3-0008-classification-architecture-verdict.md:88)). 220은 1.9배 계산이다. 캐시를 먼저 배포해도 cold resync에는 캐시 hit가 없으므로 쿼터 안전이 보장되지 않는다.

## 3. 놓친 대안

- ADR을 `Proposed`로 두고 hard 슬라이스 라벨링, 별도 hold-out 사용자·제목 검증 후 승인했어야 한다.
- 제목 단위 paired bootstrap, 사용자·카테고리 macro 평균, 실제 prod 규칙 수 분포 가중치를 사용했어야 한다.
- 캐시는 tenant와 redaction된 전체 이벤트 입력, 전체 규칙 입력, 모델·프롬프트·redactor 버전을 canonicalize한 HMAC 키와 TTL로 설계했어야 한다.
- 래칫은 “마지막 non-none이 현재 색”인 실제 상태 머신으로 재채점하고, 최초 오답 고착 비용도 별도 측정했어야 한다.
- verified는 실측 전 feature flag로 막고, DB 조회를 verified/declared 등급별 최고 씨앗으로 분리해 마스킹부터 제거했어야 한다.
- 규칙 description은 문서화/비문서화 프롬프트를 별도 arm으로 평가하고, 미측정인 keyword-description 단일 필드 변형도 함께 비교했어야 한다.

## 4. 제3자라면 멈췄을 지점

- hard 슬라이스가 미라벨 상태인데 `Accepted`로 바꾼 지점.
- 캐시의 전체 키, TTL, 피드백 무효화, 개인정보 저장 방식이 결정되지 않은 지점.
- 검증되지 않은 `T_VERIFIED=0.30`이 2026-08-28 이후 자동 발화하는 지점.
- 실제 배포할 description 프롬프트가 확정되지 않았는데 최종 성능을 선언한 지점.
- 단일 사용자·극심한 클래스 불균형 결과를 “구조적 상대 순위”로 일반화한 지점.
- “폐지할 요소 없음”을 선언하면서 핵심 병합 변형은 미측정이라고 인정한 지점([ontology-review:9](/home/shine/projects/autocolor_for_calendar/.tpr/targets/2-2026-08-11-element-ontology-review.md:9), [ontology-review:62](/home/shine/projects/autocolor_for_calendar/.tpr/targets/2-2026-08-11-element-ontology-review.md:62)).

1. **평결** — 승인 반려 (Rejection): N=1 운영자 데이터 과적합, Cold Resync 시 쿼터 초과 구조, 판정 캐시 프라이버시 미결 및 Stage 1 마스킹 버그가 존재하는 상황에서 ADR-0008을 조기 확정한 것은 부적절하며 리스크 수준은 **높음**이다.

2. **핵심 결함·리스크**
- **N=1 운영자 실데이터 311건에 기초한 글로벌 분류 아키텍처 전면 개편과 과적합**: `.tpr/targets/1-2026-08-08-verdict-draft.md`:11, 210-211 및 `.tpr/targets/3-0008-classification-architecture-verdict.md`:18-20, 118-119. 311건의 단일 개발자 데이터(ko-v1 gold set)만으로 Stage 1 임베딩 배정 차단 및 전면 LLM 2표 재확인을 결정함. 다양한 사용자 캘린더 환경에서 Stage 1 임베딩이 처리 가능한 유효 케이스까지 LLM으로 강제 이관되어 지연 시간, 비용, 쿼터 소모가 불필요하게 급증할 위험이 있음. 심각도: 높음.
- **2표 재확인 도입 시 Cold Resync 환경에서 사용자당 일일 LLM 쿼터(200회) 상한 즉시 초과**: `.tpr/targets/1-2026-08-08-verdict-draft.md`:188-190 및 `.tpr/targets/3-0008-classification-architecture-verdict.md`:74-77. 2표 재확인(이벤트당 평균 1.54회 LLM 호출) 적용 시 130건 이상의 일정을 가진 사용자가 최초 온보딩하거나 캐시 무효화 직후 전체 동기화를 실행하면 `src/services/llmClassifier.ts`:568의 per-user 쿼터 초과가 발생하여 동기화 파이프라인 전체가 중단(Halt on Failure)됨. 심각도: 높음.
- **Stage 1 `DISTINCT ON (rule_id)` 쿼리로 인한 verified(example) 씨앗 마스킹 및 Instant Feedback 무력화**: `src/services/stage1.ts`:138-147, `.tpr/targets/2-2026-08-11-element-ontology-review.md`:53-56, `.tpr/targets/3-0008-classification-architecture-verdict.md`:106-108. `stage1.ts` 쿼리가 씨앗 등급과 무관하게 단순 유사도로 규칙당 최고 1개를 뽑기 때문에, declared 배정을 끌 때 동일 규칙 내 keyword/name 씨앗 점수가 example 씨앗보다 높으면 example 씨앗이 마스킹되어 `embeddingMiss`로 폴백됨. 결과적으로 사용자가 등록한 example 씨앗의 verified 경로(`T_VERIFIED=0.30`)가 동작하지 않고 무력화됨. 심각도: 중간.
- **미확정 판정 캐시 설계 및 원문 제목 저장에 따른 §12 개인정보보호 위반 리스크**: `.tpr/targets/2-2026-08-11-element-ontology-review.md`:45-46 및 `.tpr/targets/3-0008-classification-architecture-verdict.md`:97-100. 2표 재확인의 전제조건인 판정 캐시에 원문 제목을 저장할 경우 §12 동의 철회 시 삭제(purge)가 불가능한 사본이 생기며, 규칙 1개 수정 시 유저의 전체 캐시가 무효화되어 폭발적인 LLM 트래픽 스파이크를 유발함. 심각도: 높음.
- **Cloudflare Worker 환경에서 2표 재확인 동기 호출에 따른 지연 시간 누적 및 서브리퀘스트/타임아웃 리스크**: `src/services/llmClassifier.ts`:67, 120-123 및 `.tpr/targets/1-2026-08-08-verdict-draft.md`:80-81, 191. 이벤트당 2회 연속/병렬 API 호출로 지연 시간이 1~3초 추가되며, 대량 일정 동기화 처리 시 Worker execution timeout 및 Free 플랜 서브리퀘스트 캡(50회) 저촉으로 동기화 실패율이 증가함. 심각도: 중간.

3. **놓친 대안**
- **keyword와 description의 단일 텍스트 필드 병합 검증 부재**: description 필드를 별도 컬럼으로 신설하기 전, keyword와 description을 하나의 단일 자유 텍스트 필드로 통합한 변형(wave-4)을 측정하지 않고 스키마 및 UI 복잡성을 조기에 증가시킴.
- **신뢰도/로그확률 기반 조건부 2표 재확인 (Selective Confirmation)**: 모든 LLM 분류 결과에 2표 재확인을 무조건 적용하는 대신, LLM 출력 신뢰도가 낮거나 경계선에 위치한 판정에 대해서만 선택적으로 2차 확인 콜을 보내는 대안을 검토하지 않음.
- **Stage 1 고유사도 Fast-Path 유지 대안**: declared 배정을 일괄 끄는 대신, 높은 임계값(예: 코사인 0.85 이상) 또는 명확한 명칭 매칭 케이스에 대해 Fast-path를 유지하여 레이턴시와 비용을 절감하는 대안을 배제함.
- **정밀 타겟팅 캐시 무효화 (Targeted Cache Invalidation)**: 규칙 변경 시 유저의 전체 캐시를 일괄 삭제하는 대신, 변경된 규칙/카테고리와 관련된 캐시 항목만 선별 무효화하는 대안을 고려하지 않음.

4. **제3자라면 멈췄을 지점**
- **N=1 개발자 데이터에 의존한 전면 아키텍처 승인**: 311건의 단일 사용자 캘린더 데이터 평가에만 의존하여 Stage 1 임베딩 배정을 끄고 전면 LLM 2회 호출을 강제하는 ADR-0008을 'Accepted'로 결정한 지점.
- **필수 블로킹 요소(판정 캐시)의 스키마 및 개인정보 설계 미완성 상태에서의 조기 승인**: 2표 재확인의 쿼터 초과를 막기 위한 필수 요소인 판정 캐시의 키 구조와 §12 프라이버시 검토가 완료되지 않았음에도 ADR을 승인한 지점.
- **Stage 1의 verified 마스킹 버그를 인지하고도 코드 수정 없이 방치한 지점**: `stage1.ts` 쿼리의 `DISTINCT ON (rule_id)` 버그로 example 씨앗이 가려지는 결함을 발견했음에도 이를 즉시 수정하지 않고 후속 트리거로 미뤄둔 지점.
- **Cold Resync 환경에서 200회 일일 쿼터 초과 블로킹에 대한 구체적 해결책 부재**: Cold resync 시 130건 이상 일정에서 2표 재확인으로 쿼터 초과 마비가 발생하는 구조적 문제에 대해 "쿼터 예외"라는 모호한 주석만 남기고 방치한 지점.

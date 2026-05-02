# Architecture Decision Records (ADR)

이 디렉터리는 향후 ADR 적재 위치입니다.

## 현재 상태

이 시점 (2026-05-02) 까지의 아키텍처 결정은 별도의 ADR 형태로 외부화되어
있지 않습니다. 운영 invariant 와 결정의 권위 source-of-truth 는 다음 두
문서가 보유합니다:

- `src/CLAUDE.md` — 백엔드 운영 룰 (Tenant isolation · Color marker §5.4 ·
  Observability tables Wave A/B · Watch renewal §6.4 · Manual-trigger rate
  limit §6.4 · Account deletion §3 · Secret rotation impact · Token
  rotation §3 후속)
- `docs/architecture-guidelines.md` — cross-cutting invariants (Source of
  Truth · Sync Flow · Idempotency · Halt on Failure · Hybrid Classification
  · E2E Backend Mandatory)

## ADR 작성 시점

다음 중 하나에 해당하면 새 ADR 을 추가하세요:

1. 새 외부 의존성 도입 (예: 새 LLM 벤더, 새 DB)
2. 기존 invariant 의 *변경* (단순 확장이 아닌 정책 전환)
3. 다중 옵션 사이 선택의 사후 추적이 필요한 경우 (왜 A 가 선택되고 B 가
   탈락했는가의 기록이 미래 트레이드오프 재평가에 필요한 경우)

## 템플릿

향후 ADR 권장 형식:

```
# ADR-NNNN: <Title>
- Status: Proposed | Accepted | Superseded by ADR-MMMM (YYYY-MM-DD)
- Context: 결정이 필요했던 배경
- Decision: 채택안과 핵심 코드 경로
- Consequences: 받아들인 제약 / 비용 / 후속 영향
- References: src/CLAUDE.md 섹션 + 관련 파일
```

## Drift 정책

ADR 본문이 src/CLAUDE.md 와 어긋날 경우 **src/CLAUDE.md 가 우위**
(live invariant). ADR 은 결정 기록 아카이브 — 구현 변경 시 두 곳을 동시에
갱신할 책임은 변경자에게 있습니다.

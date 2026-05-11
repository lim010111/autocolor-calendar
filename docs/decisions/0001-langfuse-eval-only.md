# ADR-0001: Langfuse는 eval 파이프라인에만 도입, runtime은 제외

- Status: Accepted (2026-05-11)
- Context: Layer 3/4 분류 eval의 실패 케이스 forensics가 stdout `PASS`/`FAIL`
  한 줄로는 부족해졌다. `agent-results.json` ledger는 집계(score/pass-rate)만
  보유하고, prod 런타임 surface인 `llm_calls` 테이블은 prod 사용자 트래픽 전용
  이라 eval 케이스가 들어가지 않는다. 다국어 dataset이 4개 언어 × 192 case로
  커진 시점에서 "v3 prompt에서 떨어진 24개 케이스가 어떤 prompt/response를
  냈는가"를 클릭으로 보는 trace UI가 필요해졌다. 한편 `src/CLAUDE.md` §6.3
  의 기존 "Langfuse trade-off note"는 Langfuse JS SDK가 Cloudflare Workers에
  비호환이라는 이유로 도입을 deferred 처리해두었다. 이 ADR은 그 deferred
  결정을 **runtime 한정으로 유지하면서 eval 단계에서만 도입**하는 분리 결정을
  기록한다.
- Decision: Langfuse Cloud Hobby (EU region)를 `evals/scripts/run-classification-eval.ts`
  Layer 3 + 4 의 trace + dataset run sink로 도입한다. SDK는 `@langfuse/client`
  + `@langfuse/tracing` (둘 다 fetch-only Universal JS, `@langfuse/otel`
  미사용 — Cloudflare Workers 비호환 문제는 SDK를 Worker에서 호출하지 **않는**
  것으로 회피).
  - **Scope**: 위 eval 스크립트 1개에만 instrument. dataset-builder Python
    파이프라인, prompt-management, runtime `llmClassifier.ts`, preview route는
    OUT.
  - **Dataset sync**: 전용 `pnpm tsx evals/scripts/sync-langfuse-dataset.ts <lang>`
    스크립트로 dataset 재빌드 직후 수동 실행. Dataset 이름은
    `autocolor-classification-{en,ko,zh-CN,zh-TW}`. Item ID = `case.id`로
    1:1 매핑 (`evals/datasets/{lang}/classification.json` 의 case.id가 cross-
    lingual 동일).
  - **Trace payload (1 trace per case)**: `input` = post-`redactEventForLlm`
    user-message JSON + `categories[]`. `output` = parsed `category_name` +
    raw_response. `metadata` = `{prompt_version, prompt_sha256_prefix(16),
    model, reasoning_effort, max_completion_tokens, lang, tag, attempts,
    latency_ms, http_status}`. System prompt 본문은 embed하지 않고 sha256
    16-char prefix만 metadata에 남겨 `prompts/classifier/system.v{N}.md`
    git path로 reverse-link.
  - **Score**: `pass: 1|0` numeric score per trace via `langfuse.score.trace`.
  - **Failure isolation (soft dep)**: `LANGFUSE_PUBLIC_KEY` 미설정이거나 SDK
    호출이 실패해도 eval은 그대로 stdout `PASS`/`FAIL` + ledger row를 산출하고
    merge-gate exit code(blocking-tag fail 또는 pass-rate < threshold)는 영향
    받지 않는다. 종료 직전 flush 시도 실패는 warn 1줄로 끝낸다. 기존 §6
    observability discipline ("observability writes must NEVER cause retry")과
    동일 노선.
  - **Canonical sources**: `evals/agent-results.json` ledger가 집계 SoT,
    `prompts/classifier/system.v{N}.md` 가 prompt SoT 그대로. Langfuse는
    **augmentation** (per-case trace UI + dataset run 비교) — replacement
    아님.
  - **Secrets**: `LANGFUSE_SECRET_KEY` / `LANGFUSE_PUBLIC_KEY` /
    `LANGFUSE_BASE_URL` 는 `.dev.vars` 전용. `scripts/sync-secrets.ts`의
    `REQUIRED_SECRETS` / optional list에는 추가하지 **않는다** (Worker로
    절대 inject 안 됨, `DIRECT_DATABASE_URL` 패턴과 동일). CI
    (`.github/workflows/ci.yml`)에도 주입하지 않는다 — eval은 manual
    operator gate. `LANGFUSE_BASE_URL` 빈 값이면 SDK 생성 시
    `https://cloud.langfuse.com` 으로 fallback (EU/US 동일 호스트, region은
    프로젝트 단위로 Langfuse 콘솔에서 결정).
- Consequences:
  - 운영자가 Langfuse Cloud(EU) 계정 + project 1개 + API key 1쌍을 별도
    관리한다. Hobby free tier (50k units/month, 30d retention) 한도 내에서
    운영 (현 부하 768 case × 월 ~10 run × 2 units/case ≈ 15k units/mo, 여유
    3배).
  - Self-host 전환 시 dataset/run history는 마이그레이션 불가 → ADR 갱신
    필요. 트리거: (a) 월 50k units 초과, (b) PII 포함 dataset 도입, (c)
    legal review에서 SaaS 송신 차단 요구.
  - `src/CLAUDE.md` §6.3 "Langfuse trade-off note"는 runtime 측면에서 유효
    하게 유지된다. 이 ADR은 그 deferred 결정을 *대체하지 않고*, eval-surface
    한정 예외를 추가한다. Runtime 도입 트리거 ((a) prompt version
    management, (b) LLM-as-judge, (c) Workers-blessed Langfuse path)는
    재평가 시점에 별도 ADR로 다룬다.
  - 향후 LLM-as-judge / 다른 LLM 호출 eval surface가 추가되면 같은 SDK +
    같은 `.dev.vars` 키 쌍을 재사용 가능 — 이 ADR의 결정은 그대로 확장됨.
  - Dataset 재빌드 시 `case.id` 가 변경되면 기존 Langfuse dataset items와
    orphan 발생. sync 스크립트가 drift detect + 명시적 dataset-version 분리
    (예: `autocolor-classification-en-v2`)를 강제하도록 구현 책임은 구현
    PR이 진다.
- References:
  - `src/CLAUDE.md` §6 "Observability tables (§6 Wave A)" — soft-dep
    failure-isolation 선례 (`llm_calls`, `rollback_runs`, `sync_runs`)
  - `src/CLAUDE.md` §6.3 "Langfuse trade-off note" — runtime deferred 결정
    (이 ADR로 보강됨, 대체되지 않음)
  - `evals/README.md` "Telemetry" 섹션 — Langfuse 포인터 추가됨
  - `.dev.vars.example` — `LANGFUSE_*` 주석 추가됨
  - `evals/scripts/run-classification-eval.ts` — Layer 3/4 runner (구현
    대상)
  - Langfuse 공식 문서: https://langfuse.com/docs/observability/sdk/typescript/overview ,
    https://langfuse.com/docs/evaluation/dataset-runs/run-via-sdk ,
    https://langfuse.com/pricing

# ADR-0003: Langfuse Prompt Management도 eval 한정으로 확장, prod는 파일 SoT 유지

- Status: Accepted (2026-05-13)
- Context: 2026-05-11 ADR-0001은 Langfuse를 eval pipeline (dataset + trace
  sink) 한정으로 도입하고 runtime은 deferred 상태로 유지하기로 했다. 그
  결정에서 prompt 본문은 여전히 `prompts/classifier/system.v{N}.md` 파일
  source-of-truth 그대로이며, Langfuse는 trace 안에 `prompt_sha256_prefix(16)`
  만 남겨 git path 로 reverse-link하는 구조였다. 이 결정이 만족스러웠던 동안
  prompt 변형 실험은 한 번에 한두 개였고, Run Comparison chart에서
  variant 별 metric을 갈라보는 일도 운영자가 stdout으로 ledger를 grep해서
  대신했다. 그러나 2026-05-13 gpt-5.4-nano prompt-tuning 실험은 4 lever ×
  2 reasoning_effort × 4 lang = 32 sub-run을 한 batch에 돌리는 규모로
  커졌고, "어떤 cell이 어떤 prompt를 봤는가"를 Langfuse UI에서 직접 보고
  싶다는 요구가 생겼다. 동시에 ADR-0001 §"Consequences" 의 미래 트리거
  목록에 **"prompt version management"** 항목이 명시되어 있어, 이 ADR은
  그 트리거를 발동시키되 ADR-0001의 "eval-only" 경계는 유지한다.
- Decision: classifier prompt의 **모든 versioned `.md` 파일**을 Langfuse
  Prompt Management API로 upsert하고, eval runner가 `--prompt-source langfuse`
  로 그 사본을 fetch하도록 허용한다. **production code path는 변경하지
  않는다** — Worker 안의 `loadClassifierPrompt(version)` 은 여전히
  `src/services/prompts/_generated.ts` 만 읽는다.
  - **Scope**: `prompts/classifier/system.v{N}.md` 만. dataset-builder prompts
    (`prompts/dataset-builder/`) 와 향후 신규 prompt category 는 별도 ADR로
    확장 검토한다.
  - **Naming**: Langfuse `name` = `autocolor-classifier-<version>`. Label =
    `eval` 로 통일 — `production` label 은 **사용하지 않는다** (실수로
    `prompt.get(name)` 의 default label 인 `production` 을 hit 하면 eval-only
    경계가 무너지므로).
  - **Upload script**: `scripts/upload-prompts-to-langfuse.ts` 가 단일 sanctioned
    writer. SHA-256 content hash 비교로 idempotent. operator 가 새 version
    `.md` 를 author한 직후 `pnpm tsx scripts/upload-prompts-to-langfuse.ts <version>`
    또는 `all` 로 동기화한다.
  - **Runner mode**: `evals/scripts/run-classification-eval.ts` 가 새
    `--prompt-source <file|langfuse>` flag 를 받는다. `file` (default) 은
    기존 `loadClassifierPrompt(version)` 그대로; `langfuse` 는 시작시
    `prompt.get(name, {label: "eval"})` 로 본문을 1회 fetch 해서 system
    message 를 그 body 로 override 한다. user-message JSON / category
    slicing / PII redaction 은 `buildPrompt` 가 그대로 책임진다.
  - **Byte-equivalence invariant**: file source 와 langfuse source 가 같은
    version 에 대해 byte-identical body 를 내놓아야 한다. upload script 의
    `stripFrontmatter` + trailing-whitespace trim 이 `scripts/embed-prompts.ts`
    와 lockstep 으로 유지되어야 함 — 두 함수의 본문이 분리되면 sha256 mismatch
    가 발생하고 silent prompt drift 가 가능해진다.
  - **Custom scores + metadata (b)**: trace 별로 기존 `pass` 외에
    `bad_response` (0|1) 와 (usage payload가 돌아온 경우에 한해)
    `reasoning_tokens` (numeric) score 를 추가 emit 한다. Langfuse Run
    Comparison chart 가 cell-level mean/p95 를 자동 집계할 수 있도록 — 별도
    "run-level score" object 는 만들지 않는다 (SDK 가 trace 단위 score 에서
    run-mean 을 자체 계산). Trace metadata 에는 `lever_id` (`v5-L1` → `L1`)
    와 `prompt_source` (`file`|`langfuse`) 가 추가된다.
  - **Failure isolation**: `--prompt-source langfuse` 의 fetch 실패는
    **hard fail** (process exit 1). operator 가 명시적으로 그 source 를
    선택했는데 silent 하게 file source 로 떨어지면 측정값의 신뢰가 깨지므로.
    반면 ADR-0001 의 trace/score 송신 실패는 여전히 soft-dep 그대로
    (warn 1 줄, ledger row + exit code 영향 없음).
- Consequences:
  - `.md` 파일과 Langfuse 사본이 drift 할 수 있는 표면이 생겼다. **유일한
    sanctioned writer 는 `scripts/upload-prompts-to-langfuse.ts` 이며,
    operator 가 Langfuse UI 에서 prompt 본문을 직접 수정하는 것은 금지된다.**
    drift 가 발생하면 다음 eval run 의 `--prompt-source langfuse` 결과가 file
    source 와 다른 prompt 를 측정하게 되어, 두 cell 간 비교가 무효화된다.
    operator 가 `.md` 를 수정한 뒤 upload script 실행을 누락하는 회귀를
    막기 위해, runner 는 시작시 sha256 mismatch 를 비교하지는 않는다 (그건
    매 run마다 Langfuse 호출 1회를 추가하는 비용) — 대신 eval report 가
    `prompt_source` 와 `prompt_sha256_prefix` 를 함께 기록해서 사후 진단을
    가능하게 한다.
  - Langfuse Cloud 의 prompt 저장 용량을 추가로 점유한다. Hobby free tier
    (50k units/mo) 대비 prompt API call 은 trace 대비 미미 (run 당 fetch 1
    회, 12 version × 월 ~수 회 sync 호출). 한도 영향 없음.
  - production code 가 Langfuse 에 의존하지 않으므로, ADR-0001 §
    "Why eval-only" 의 핵심 근거 ("Worker hot path 에 network dep 추가
    불가") 는 그대로 유지된다. Self-host 전환이나 Langfuse 장애 시 production
    classification 은 영향 없다 (eval runner 만 `--prompt-source file` 로
    회복 가능).
  - `src/CLAUDE.md` §5.3 "Prompt body lives in versioned `.md` files" 의
    "file = source-of-truth" 원칙은 유지된다. 본 ADR 은 그 원칙을 **추가**
    하지 **대체하지 않는다** — Langfuse 는 downstream replica.
  - Test 영향 없음. `src/__tests__/llmClassifier.test.ts` 는 default V2 body
    만 검증하고 `--prompt-source` 는 runner-only 인자이므로 test surface
    바깥. ADR-0001 의 §5.3 3-gate (regression / 4-lang / Pattern B grep) 도
    그대로 유효 — PR-γ 가 떴을 때 그 gate 를 통과해야 함.
  - 향후 추가 lever 변형이나 다른 prompt category 도 같은 upload script
    pattern (`name = <category>-<version>`, label = `eval`, content-hash
    idempotency) 으로 확장 가능.
- References:
  - `docs/adr/0001-langfuse-eval-only.md` — 부모 결정 (dataset + trace
    sink eval-only)
  - `src/CLAUDE.md` §5.3 "LLM semantic matching policy" — prompt-edit
    eval-gate 3-gate (regression / 4-lang / Pattern B); PR-γ 발화 시 필수
  - `scripts/upload-prompts-to-langfuse.ts` — 본 ADR 의 sanctioned writer
  - `evals/scripts/run-classification-eval.ts` — `--prompt-source` plumbing
  - `.claude/handoffs/gpt-5.4-nano-prompt-tuning-2026-05-13.md` — 결정을
    유발한 prompt-tuning 실험 핸드오프
  - `prompts/classifier/system.v{N}.md` — source-of-truth (file 우선)

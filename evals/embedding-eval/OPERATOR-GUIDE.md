# 운영자 가이드 — embedding-classifier #01 (임베딩 모델 선정 eval)

> 이 문서는 **당신(운영자)만 할 수 있는 HITL 단계**의 런북이다. 실제 캘린더(PII),
> 로컬 3080 GPU, 트레이드오프 판단이 필요한 일만 모았다. 하네스의 기술 레퍼런스는
> [README.md](README.md), 결정 근거는 `.scratch/embedding-classifier/` 의 스펙
> (`01-embedding-model-selection-eval.md`) + 설계노트(`01-dataset-design.md`).

## 0. 지금 상태 — 에이전트가 끝낸 것 / 당신이 할 것

**끝남 (브랜치 `embedding-eval-scaffold`):**
- data-blind 하네스 스캐폴드 (sweep·metrics·ledger+wandb게이트·wai_parity·manifest·
  REPORT 템플릿·테스트) — ruff clean, 테스트 통과.
- prompt-prefix 정확문자열을 모델카드와 대조해 `config.py` 에 pin.
- 머지게이트 advisory findings 1차 패스 처리 (게이트 누출구멍·풋건 수정).

**남음 = 아래 A→B→C→D.** 전부 당신 몫이다 (데이터·GPU·판단).

```
A. 골드셋 구축   → B. 매니페스트 커밋   → C. 3080 sweep+parity   → D. 결정 + ADR
   (_local/gold)      (manifest.json)        (runs.jsonl)             (REPORT→ADR)
```

이 eval 이 **선정하는 벡터 차원(768/1024)이 후속 5개 슬라이스(#02~#06)의 선행조건**
이다. D 가 끝나야 그것들이 unblock 된다.

---

## 사전 준비 (1회)

```bash
cd evals/embedding-eval
uv sync --extra local      # torch + sentence-transformers (3080 임베딩; 모델 가중치 다운로드)
uv sync --extra remote     # requests — WAI parity 프로브용 (선택)
uv sync --extra wandb       # wandb — 집계-only 클라우드 싱크 (선택)
```

wandb / Workers-AI 를 쓸 거면 **레포 루트 `.dev.vars`** 에 키를 넣는다(주석 템플릿은
이미 추가됨). 이 키들은 Worker/CI 에 절대 주입되지 않는다(ADR-0001 LANGFUSE 패턴):

```
WANDB_API_KEY="..."          # 비우면 sweep 은 로컬 runs.jsonl 만 남기고 wandb 생략
WANDB_PROJECT="autocolor-embedding-eval"
CF_ACCOUNT_ID="..."          # parity 전용 (Workers AI REST)
CF_API_TOKEN="..."
```

**키 발급처 / 언제 필요한가:**

| 키 | 어디서 | 언제 필요 |
|----|--------|-----------|
| `WANDB_API_KEY` | [wandb.ai/authorize](https://wandb.ai/authorize) (로그인 후 표시) | `sweep --wandb` 쓸 때만. 비우면 sweep 은 `runs.jsonl`(정본)만 남기고 wandb 송신을 조용히 생략 |
| `WANDB_PROJECT` | 임의 프로젝트명 (없으면 자동 생성) | 위와 동일 |
| `CF_ACCOUNT_ID` | Cloudflare 대시보드 우측 사이드바, 또는 레포 `wrangler.toml` 에 이미 있음 | `parity` 서브커맨드 **전용**. sweep·manifest·validate-gold 는 안 씀 |
| `CF_API_TOKEN` | 대시보드 → **My Profile → API Tokens → Create Token** → **Workers AI** 권한(Read) 부여 → 발급. Worker 운영 토큰에 Workers AI 권한이 이미 있으면 재사용 가능 | 위와 동일 |

> `CF_*` 둘은 **parity 전용**이다. `embedding-eval parity` 가 Workers AI REST
> (`POST …/accounts/{CF_ACCOUNT_ID}/ai/run/{model}`, `Authorization: Bearer {CF_API_TOKEN}`)
> 로 prod 추론 경로의 임베딩을 받아 3080 로컬 임베딩과 코사인 정합을 잰다(전이 타당성).
> 안 넣으면 sweep 은 정상 동작하지만 parity 게이트(`provisional` 해제)를 못 닫는다.
> 여기 Workers AI 로 보내는 건 커밋된 비-PII `parity_probes.txt` 프로브뿐 — raw 제목 아님.

> **불변항:** raw 캘린더 제목은 로컬을 떠나지 않는다. 골드셋·`runs.jsonl`·name↔ID 맵·
> forensics 는 전부 `_local/`(gitignore). 커밋되는 건 코드·`manifest.json`·REPORT 뿐.

! 여기까지 완료

---

## A. 골드셋 구축 → `_local/gold/ko-v1.json`

가장 손이 많이 가는 단계. 하지만 **빌더 스크립트가 기계적인 부분을 다 처리**하므로
당신 input 은 **두 가지 "판단"뿐**이다 — (A.3) 블라인드 카테고리 작성, (A.4) 제목
라벨링. 나머지(.ics 파싱·노이즈필터·신호창·dedup·temporal split·JSON 조립·검증)는
`gold-ingest`/`gold-assemble` 가 한다.

```
A.1 .ics export → A.2 gold-ingest → A.3 카테고리(블라인드) → A.4 라벨링 → A.5 gold-assemble
   (당신, 1클릭)    (스크립트)         (당신 input)            (당신 input)    (스크립트: split+조립+검증)
```

### A.1 — `.ics` export  *(당신)*
본인 주 Google Calendar 를 `.ics` 로 export 해 로컬에 둔다. `Birthdays.ics`(자동 생일)
는 export 대상에서 제외.

### A.2 — `gold-ingest`  *(스크립트)*
```bash
uv run embedding-eval gold-ingest --ics /path/to/calendar.ics --version ko-v1
```
스크립트가 자동으로: ①신호창 **2025-09~2026-06** 클립 ②노이즈 자동드롭(빈 SUMMARY /
≥2027 종일 미래투영생일 / `…님의 생일`·`생일 축하합니다`류 자동생일) ③**dedup-before-split**
(표면형 NFC 정규화 후 고유 제목으로 접음 — 안 접으면 씨앗=query 정확일치로 cosine 1.0,
`T_verified` 가짜로 낮아짐). 산출:
- `_local/gold/ko-v1.titles.tsv` — 고유 제목 1행씩, **1번 컬럼이 비어(`?`) 있음**.
- `_local/gold/ko-v1.categories.json` — 빈 템플릿(없을 때만 생성).

> 자동드롭은 **보수적**이다(확실한 것만). 애매한 종일(공휴일 vs 중간고사·휴강)은 안
> 버리고 워크시트로 흘려보내니, A.4 에서 `x` 로 직접 버리면 된다.

### A.3 — 카테고리 작성 (블라인드)  *(당신 input)*
`_local/gold/ko-v1.categories.json` 을 채운다. **워크시트(.tsv)를 열기 전에, 기억으로**
쓴다(실유저가 Rule 만들 때처럼 — 제목에서 역추출하면 매칭 점수가 인위적으로 부풀어
결과가 낙관 편향됨, 정본 §4.3). 자연발생 카테고리 ~8개. **`example_seeds`·`queries`
는 여기 없다 — A.5 가 라벨에서 자동 생성**한다. 각 카테고리는 이 세 필드뿐:

```json
{
  "version": "ko-v1",
  "categories": [
    { "name": "식사", "declared_seeds": { "word": ["점심","저녁"], "phrase": ["밥 먹기"] }, "held_out": false },
    { "name": "알바", "declared_seeds": { "word": [], "phrase": [] }, "held_out": true }
  ]
}
```

규율 (데이터 품질의 핵심):
- **`name` = PII-free 일반명사 블라인드 라벨**. 식사/운동/개발/공부 같은 일반명사만.
  **인명·기관·클라이언트명 금지.** (로컬에선 실라벨, 클라우드엔 `cat_0…` 로 매핑됨)
- **`declared_seeds.word` = 단어형 짧은 키워드, `.phrase` = 구절형 선언.** 이 두 형태가
  keyword-form arm(name-only / name+단어 / name+구절) 비교의 입력이다. 비워도 됨
  (그 카테고리는 name-only 로 동작).
- **`held_out: true` 를 1~2개 카테고리에** 준다(예: 알바/근무). Rule 로 안 만들고, 그
  카테고리로 라벨된 제목은 A.5 가 자동으로 `expected: "none"` 음성으로 돌린다 →
  오적용(false-apply) 가드 측정.

### A.4 — 라벨링: 워크시트 1번 컬럼 채우기  *(당신 input)*
`_local/gold/ko-v1.titles.tsv` 의 각 행 맨 앞 `?` 를 다음 중 하나로 바꾼다(에디터에서
컬럼 1만 편집; ~520행이라 정렬·찾아바꾸기 활용):

| 값 | 의미 |
|----|------|
| `<카테고리 name>` | 그 카테고리 소속 (categories.json 의 name 과 정확히 일치) |
| `none` | 무관 제목 → 음성 query(`expected=none`) |
| `x` | 노이즈 → 골드셋에서 완전 제외 |
| `?` | 아직 미라벨 (남아 있으면 A.5 가 에러) |

held-out 카테고리(알바 등) 제목도 그냥 그 카테고리 name 으로 라벨하면 된다 — A.5 가
none 으로 변환한다.

### A.5 — `gold-assemble`  *(스크립트)*
```bash
uv run embedding-eval gold-assemble --version ko-v1
#   --example-frac 0.5  : 카테고리별 이른 제목 절반 → example_seeds (기본 0.5)
#   --min-temporal 6    : 이 미만 크기 카테고리는 날짜 대신 seed 셔플로 split (기본 6)
```
스크립트가 **temporal split** 을 적용: 카테고리별 *이른* 제목 = `example_seeds`(="확정된
과거", Verified) / *늦은* 제목 = query — prod 인과(과거→미래 분류) + 스타일 드리프트
직격 테스트. (작은 카테고리는 날짜 순서가 노이즈라 seeded random 폴백; 제목 1개면 query.)
그 뒤 `_local/gold/ko-v1.json` 조립 + **스키마 검증**까지 한 번에. 검증 실패 시 에러
메시지대로 categories/워크시트를 고치고 다시 돌린다.

> 골드셋을 고치고 싶으면 워크시트/카테고리를 수정하고 `gold-assemble` 만 다시 돌리면
> 된다(멱등). 단 **B 의 manifest 를 다시 만들어 커밋**해야 한다(안 그러면 sweep 의
> drift 가드가 hard-stop).

### A.6 — 단일 annotator 가드  *(당신 input)*
라벨은 당신 1인 판단이라 inter-annotator κ 가 없다. **cooling-period(며칠) 후**
정본 §4.5 모호 경계쌍(개발↔공부, 부트캠프수업↔개발)을 **1회 재라벨**해 self-consistency
불일치율을 기록한다(B 의 manifest 메모에 넣음). known-limitation 으로 외부화.

### A — verify
```bash
uv run embedding-eval validate-gold --version ko-v1
```
`gold-assemble` 이 이미 검증하지만, 따로도 카운트만 출력해 재확인할 수 있다(제목·카테고리명은
안 찍힘).

---

## B. 매니페스트 핀 + 커밋

```bash
uv run embedding-eval manifest --version ko-v1     # → evals/embedding-eval/manifest.json
```

- 출력 `manifest.json` 을 **리뷰**: 카테고리별 카운트 + **전체 코퍼스 단일 `sha256`
  digest**, 블라인드 라벨만, **원시 제목 0줄**, per-title 해시 없음(finding-0).
- `self_consistency_mismatch` 필드에 A.5 재라벨 불일치율을 채운다.
- 확인 후 커밋:
  ```bash
  git add evals/embedding-eval/manifest.json && git commit -m "data(embedding-eval): #01 ko-v1 gold-set manifest"
  ```

이 커밋된 digest 가 모든 run 의 핀(`manifest_sha256`)이다. 이후 골드셋을 수정하면
sweep 의 **drift 가드가 hard-stop** 하므로, 골드셋을 바꾸면 manifest 를 다시 만들어
커밋해야 한다.

---

## C. sweep + parity (3080)

```bash
# 본 측정 (정밀도-우선 winner 출력, _local/runs.jsonl 에 append)
uv run embedding-eval sweep --version ko-v1 --backend local --cold-start
#   --cold-start : keyword-form arm(example 제외) 도 함께 측정
#   --wandb      : 집계-only 페이로드를 wandb 에 전송 (cat_N 만, 게이트가 강제)
#   --backend 는 필수다 — local(3080 실측정) vs fake(GPU 없는 스모크)

# 3080 ↔ Workers AI 전이 정합 (후보마다)
uv run embedding-eval parity --model @cf/google/embeddinggemma-300m
uv run embedding-eval parity --model @cf/baai/bge-m3
uv run embedding-eval parity --model @cf/qwen/qwen3-embedding-0.6b
```

**sweep 전에 prefix 확인 (가벼움):** `src/embedding_eval/config.py` 의 `PROMPT_ARMS`
두 `sts` 문자열을 현재 모델카드와 한 번 대조한다. 에이전트가 모델카드 기준으로
pin 해뒀고(embeddinggemma=확정, qwen3=형식 확정·STS task-description 은 선택값),
하네스는 설정된 문자열을 **verbatim + sha256_16** 으로 기록하므로 바꿔도 추적된다.

### C — verify
- `_local/runs.jsonl` 에 run 레코드가 쌓인다(정본). `--wandb` 시 집계만 클라우드로.
- sweep 말미에 **winner** 출력: model/dim/arm/임계값 + coverage·verified_precision·
  none_false_apply. "winner: NONE …" 이면 grid 를 넓히거나 floor/ceiling 을 푼다.
- parity 의 `mean_cosine` 가 낮으면(`provisional=True`) 임계값은 잠정 — 승자 모델의
  최종 임계값은 Workers AI 에서 재측정해 확정(PII 경계 *안*).

---

## D. 결정 + 출력 ADR (트레이드오프 판단)

sweep 결과를 보고 **당신이 결정**한다:

1. **목표함수 수치 박기**: Verified auto-apply **정밀도 바닥선** + `expected=none`
   **오적용 상한**. 그 제약 하 **커버리지 최대화**가 winner. `T_declared` 는 Stage-2
   핸드오프 recall 로 튠. (macro-F1 은 선택 기준 아님.)
2. **모델 1종 + 벡터 차원(768/1024)** 확정 → `rule_seeds.embedding vector(N)` 고정.
3. **다국어 안전성 크로스체크**: 공개 MTEB-multilingual / MIRACL ko+zh 랭킹과 대조,
   **flip 규칙** `N` 을 박는다(ko-gold 승자가 MIRACL-ko 에서 차순위보다 N 랭크 이상
   아래면 red-flag → 재검토).
4. **`REPORT.md.tmpl` 채우기** → **#01 출력 ADR(0002 형식, 후속 측정 ADR)**로 외부화.
   - ADR-0004 supersede 아님 — 후속 측정.
   - 승자 **prefix 규약을 prod 불변항의 정확 문자열**로 동결(backfill 잡 ↔ title
     hot-path 가 동일 prefix 를 써야 함; 불일치 시 저장 씨앗 벡터 전수 오염).
   - wandb 추적 방법론(집계-only PII 계약 + 로컬 runs.jsonl 정본 + ADR-0001 대비
     divergence rationale)을 ADR 방법론 섹션에 fold-in(별도 ADR 안 만듦).
   - en/zh 는 *provisional·미검증* 플래그, 단일 annotator·persona skew 는
     known-limitation, en/zh·persona 확장은 로드맵으로 명시.

이 ADR 이 **#02~#06 의 참조점**(벡터 차원 확정)이다.

---

## PII 계약 (절대 규칙 — 위반 시 개인정보 누출)

| 표면 | 담는 것 |
|------|---------|
| **git 커밋** | 코드 · `manifest.json`(카운트+단일 digest+블라인드 라벨) · REPORT/ADR. **원시 제목 0줄, per-title 해시 금지.** |
| **wandb (SaaS)** | config · 스칼라 metric · 임계값 · **합성 `cat_N` confusion 만.** 카테고리명·씨앗·제목·keyword·raw prefix 전부 **게이트가 거부**. |
| **`_local/` (gitignore)** | 골드셋 · `runs.jsonl` · name↔ID 맵 · forensics — 전부 PII, 로컬 only. |

---

## 트러블슈팅

- **`error: the following arguments are required: --backend`** — 의도된 안전장치.
  실측정은 `--backend local`, 스모크는 `--backend fake`. (fake 가 정본 ledger 를
  오염시키지 않도록 기본값을 없앴다.)
- **`gold-set drift: committed manifest.json digest != current gold set`** — 골드셋을
  바꾼 뒤 manifest 를 다시 안 만들었다. `manifest` 재실행 → 커밋, 또는 버전 확인.
- **`PiiGateError: …`** — wandb 로 보내려는 페이로드에 raw 문자열/카테고리명이 섞였다.
  게이트가 막은 것(정상 작동). metrics 는 숫자 + `cat_N` 키만 허용.
- **parity `provisional=True`** — 로컬↔WAI 정합이 낮음. 임계값을 잠정으로 두고 승자
  모델만 WAI 에서 재측정.

---

## 체크리스트

- [ ] A. `_local/gold/ko-v1.json` 구축 (신호창·노이즈·dedup·form-split·blind·temporal·held-out)
- [ ] A.5 cooling-period 재라벨 self-consistency 기록
- [ ] A. `validate-gold` 통과
- [ ] B. `manifest` → 리뷰 → `self_consistency_mismatch` 채움 → `manifest.json` 커밋
- [ ] C. `config.py` prefix 모델카드 대조
- [ ] C. `sweep --backend local --cold-start [--wandb]` → winner 확인
- [ ] C. 후보 3종 `parity` → mean cosine 기록
- [ ] D. floor/ceiling 수치 + 모델 + 차원 확정
- [ ] D. MTEB/MIRACL 크로스체크 + flip 규칙 N
- [ ] D. `REPORT.md.tmpl` → #01 출력 ADR(0002 형식), prefix 동결 + 추적 방법론 fold-in
- [ ] → #02~#06 unblock (벡터 차원 확정)

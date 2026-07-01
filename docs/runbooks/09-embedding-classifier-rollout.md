# 임베딩 분류기 배포하기 (embedding-classifier #02)

PR #124 가 머지된 뒤, 새 임베딩 분류기(Stage 1)를 prod 에 실제로 켜는 절차다.
**딱 3단계, 순서대로 복붙하면 된다.** 5~10분이면 끝난다.

- 1단계: DB에 테이블 만들기 (`db:migrate`)
- 2단계: 기존 규칙들 채우기 (backfill)
- 3단계: 워커 배포 (`deploy:prod`)

---

## ⚠️ 시작 전에 딱 하나

migrate 와 backfill 은 기본적으로 **dev DB** 를 친다. prod 를 향하게 하려면
아래 한 줄을 **먼저** 실행해라. 그러면 이 터미널 세션의 1·2단계가 전부 prod 로 간다.

```bash
# .prod.vars 에서 prod 연결 문자열을 꺼내 이 세션에 설정
export DIRECT_DATABASE_URL="$(grep '^DIRECT_DATABASE_URL=' .prod.vars | cut -d= -f2- | tr -d '\"')"

# 진짜 prod 를 가리키는지 확인 (비밀번호는 가려서 host 만 보임)
echo "$DIRECT_DATABASE_URL" | sed -E 's#://[^@]*@#://***@#'
```

host 가 prod Supabase 주소가 맞는지 눈으로 확인하고 넘어가면 된다.

---

## 1단계 — DB에 테이블 만들기

```bash
pnpm db:migrate
```

`rule_seeds` 테이블 하나가 새로 생긴다(마이그레이션 `0017`). 기존 데이터는
건드리지 않는다.

**잘 됐는지 확인** — psql 이나 Supabase SQL 에디터에서:

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'rule_seeds';
```

인덱스 3개(`..._user_id_idx`, `..._embedding_hnsw_idx`, `..._rule_id_name_uq`)가
보이면 성공.

---

## 2단계 — 기존 규칙들 채우기 (backfill)

이미 만들어져 있던 규칙들의 이름을 임베딩해서 새 테이블에 넣는다. (안 하면
기존 규칙들이 한동안 LLM 으로만 분류돼서 비용이 는다.)

```bash
pnpm tsx scripts/backfill-name-seeds.ts
```

- 몇 번을 다시 돌려도 안전하다(중복 안 생김).
- 끝에 **`✓ backfill verified`** 가 뜨면 성공. 안 뜨고 에러로 멈추면 그 메시지
  그대로 붙여줘 — 같이 본다.

> 참고: 이 스크립트는 Cloudflare Workers AI 를 직접 호출한다. 여기서 성공한다는
> 건 계정·토큰·모델이 정상이라는 뜻이라, 3단계 배포 전에 미리 검증되는 셈이다.

---

## 3단계 — 워커 배포

```bash
pnpm deploy:prod
```

이 배포부터 Stage 1 이 임베딩 방식으로 바뀐다.

**잘 됐는지 확인:**
- 배포 출력의 바인딩 목록에 `AI` 가 보이면 OK.
- 실제로: 규칙 하나 새로 만들어 보고 → 잠시 뒤 캘린더 일정에 색이 입혀지는지,
  또는 사이드바 미리보기가 규칙에 매칭되는지 확인.

---

## 순서만 지키면 된다

**migrate → backfill → deploy** 순서로. migrate 를 안 하면 테이블이 없어서
backfill 이 실패하고, backfill 을 배포보다 늦게 하면 잠깐 LLM 비용이 뜬다.
(지금은 사용자가 거의 없어서 순서가 어긋나도 큰일은 안 나지만, 위 순서가 제일 깔끔하다.)

## 문제가 생기면

- **되돌리기:** 워커를 이전 버전으로 다시 배포하면 옛날(substring) 방식으로 돌아간다.
  `rule_seeds` 테이블은 그냥 놔둬도 아무 문제 없다(옛 코드는 무시한다).
- 배포 후 임베딩이 실패해도 앱이 죽지는 않는다 — LLM(Stage 2)이 쓸 수 있는
  상태면(OPENAI_API_KEY 설정 + 규칙 1개 이상 + 일일 상한 여유) 그 일정은
  임베딩(Stage 1)을 건너뛰고 LLM 이 대신 분류한다. LLM 이 없거나(키 미설정·규칙
  0개) 상한이 소진됐거나 LLM 도 매칭 못 하면, 그 일정은 색이 안 입혀진 채
  넘어간다. 대규모 Workers-AI 장애 시 LLM 이 켜져 있으면 일정이 전부 LLM 으로
  몰리지만 일일 호출 상한(전역 10k · 사용자 200)으로 비용은 제한된다.
- 막히면 에러 메시지 그대로 붙여줘.

---

한 번 켠 뒤엔 이 문서는 다시 볼 일이 거의 없다. (임베딩 차원을 768→1024 로
바꾸는 드문 경우에만 2단계 backfill 을 다시 돌리면 된다.)

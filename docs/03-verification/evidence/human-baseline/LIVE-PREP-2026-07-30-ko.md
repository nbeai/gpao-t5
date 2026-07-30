# 비교군 라이브 측정 준비 — 두 제품 실행 화면 개방, 키 입력만 남음

- 상태: `READY_EXCEPT_CREDENTIAL` (두 제품 모두)
- 비밀값을 읽거나 옮기지 않았다. Codex 기록은 도구·정책 메타데이터만 인용했다.
- 시스템 Node(`v24.14.0`)를 변경하지 않았다. 오너의 실제 `~/.openclaw`·`~/.hermes` 는 0건 변경이다.
- T-cell 계획·구현에는 들어가지 않았다.

## 1. 런타임 — pinned `2026.7.2` 를 임시 로컬 Node 로 세웠다

| 항목 | 사실 |
|---|---|
| 요구 | `engines.node: ">=22.22.3 <23 \|\| >=24.15.0 <25 \|\| >=25.9.0"` |
| 시스템 Node | `v24.14.0` (요구 미달, **변경하지 않음**) |
| 임시 런타임 | `node-v24.18.1-darwin-arm64` 를 스크래치패드에 풀었다 |
| 무결성 | `SHASUMS256.txt` 대조 — `1d60b703…3fac3` 실측 해시 일치 |
| 설치·빌드 | `corepack pnpm@11.2.2` 로 `install`(28.4s) → `build`(3m 17.4s) 성공 |
| 격리 | pnpm store·corepack 홈도 스크래치패드. 원본 `lab_un` 은 rsync 사본으로 대신해 무침해 |
| 실행 확인 | `OpenClaw 2026.7.2` · `agent --help` 정상 |

**설치본 `2026.6.11` 은 쓰지 않는다.** pinned 가 실제로 섰으므로 대체 조건이 성립하지 않는다.
두 버전의 결과를 섞지 않는다.

## 2. 두 제품의 정확한 정지 지점 (자격 벽과 그 앞의 벽을 분리)

### Hermes — 자격 벽

```
hermes -z "안녕" -m gpt-5.1 --provider openai-api
→ No usable credentials found for provider 'openai-api'. Set OPENAI_API_KEY.
```

`openai` 는 별칭이며 `openrouter` 로 우회된다(`providers.py:266`). 실제 식별자는 **`openai-api`**,
경로는 `https://api.openai.com/v1`, 자격 변수 `OPENAI_API_KEY` 다.

### OpenClaw — 자격 벽에 실제로 닿았다. 그 앞에 **모델 벽**이 따로 있다

`gpt-5.1` 로 호출하면 네트워크에 나가기 전 로컬에서 막힌다:

```
FailoverError: Unknown model: openai/gpt-5.1
decision=candidate_failed reason=model_not_found next=none
```

카탈로그를 실제로 조회하면 `gpt-5.1` 이 **0건**이고 OpenAI 계열은 `gpt-5.3-chat-latest` 부터
`gpt-5.6-terra` 까지다(기본 `gpt-5.6-sol`). `models list --all` 에도 없다.

카탈로그에 있는 모델로 바꾸면 **진짜 자격 벽까지 간다**:

```
openclaw agent --local --json --message "안녕" --model gpt-5.6-sol
→ 401 Unauthorized: Missing bearer or basic authentication in header,
  url: https://api.openai.com/v1/responses   ·   reason=auth  next=none
```

즉 OpenClaw 는 **키만 넣으면 도는 상태**이고, 남은 문제는 자격이 아니라 **모델 동일성**이다.

### `gpt-5.1` 지원은 미확인으로 유지한다

- Hermes 의 모델 목록은 **provider 의 live `/v1/models`** 에서 온다(`hermes model` 도움말).
  자격 전에는 확인할 방법이 없다. 그래서 `지원됨`으로 적지 않는다.
- OpenClaw 는 자격과 무관하게 카탈로그에 `gpt-5.1` 이 없다는 것까지만 확정됐다.

## 3. 격리 홈·워크스페이스·fixture (전부 왕복 검증)

| 대상 | 생성 | 정리 | 검증 |
|---|---|---|---|
| Hermes 홈 | `HERMES_HOME=<임시>/hermes-home` | 디렉터리 삭제 | 대시보드 기동·세션 0 확인 |
| OpenClaw 홈 | `OPENCLAW_HOME` + `OPENCLAW_STATE_DIR` + `OPENCLAW_CONFIG_PATH` + `HOME` | 디렉터리 삭제 | 게이트웨이 기동 확인 |
| fixture | `prepare-fixtures.sh make` → `~/Downloads/견적서_A사_v1.csv`·`견적서_A사_최종.csv`·`견적서_B사_v1.csv` | `clean`(권한 복구 후 삭제) | 14턴 실행 뒤 잔여 **0건** |
| H09 접근 불가 | `lock`(`chmod 000`) | `unlock`/`clean` | 실행 중 자동 적용·복구 확인 |

**격리 누수를 한 번 잡았다.** `OPENCLAW_STATE_DIR` 만 주었을 때 OpenClaw 가 오너의 실제
`~/.openclaw/workspace` 를 읽고 `openclaw doctor --fix` 를 요구했다. `doctor --fix` 는 돌리지 않고
`OPENCLAW_HOME`(`utils.ts:96`)과 `HOME` 까지 스크래치패드로 옮겨 뿌리부터 격리했다.
이후 오너의 실제 상태는 **0건 변경**이다.

## 4. 실행 화면 — 두 제품 모두 열려 있다

| 제품 | 화면 | 상태 |
|---|---|---|
| Hermes | `hermes dashboard --port 9219 --host 127.0.0.1` → `http://127.0.0.1:9219` | **HTTP 200 · 화면 확인**. `Hermes Agent v0.19.0`, 격리 홈이라 세션 0·메시지 0 |
| OpenClaw | `gateway --port 19301 --allow-unconfigured` → Control UI `http://127.0.0.1:19301` | **화면 확인**. 게이트웨이 `http server listening`(14 plugins), UI 는 로컬 게이트웨이 토큰 입력을 요구 — 토큰은 건드리지 않았다 |

측정 표면은 UI 가 아니라 CLI 다(`hermes -z`, `openclaw agent --local --json`). 두 CLI 모두 위
§2 의 지점까지 실제로 도달했다.

## 5. 계측기 — 만들고, 14턴 전체를 실제로 돌려 검증했다

T5 3회는 브라우저에 `MutationObserver` 를 주입해 어시스턴트 턴을 셌다. 비교군은 CLI라 같은 자를
쓸 수 없다. 그래서 같은 지표를 CLI 표면에서 재는 계측기를 만들었다.

- `scripts/compare-live/h-turns.json` — 회차당 **14턴** 실행표. **H10 을 포함한다.**
- `scripts/compare-live/h-runner.mjs` — 턴별 첫 표시·가장 긴 공백·총 소요를 실측하고,
  제품이 남긴 usage 를 그대로 옮긴다.
- `scripts/compare-live/prepare-fixtures.sh` — fixture make/lock/unlock/clean.

계측 원칙:

- **모델·도구·승인·에이전트 후속 호출 수를 추정하지 않는다.** Hermes 는 `--usage-file` 이
  `api_calls`·`estimated_cost_usd`·`input/output/cache/reasoning_tokens`·`service_tier` 를
  직접 남긴다(`oneshot.py:127`). 계측기는 세지 않고 **옮긴다**.
- 기록이 없으면 `null` 로 남긴다. 빈 칸을 숫자로 채우지 않는다.
- 목표 달성·불필요한 질문·승인·에이전트 위임 네 칸은 사람이 출력을 읽고 채운다. 자동 판정하지 않는다.
- 어느 대화를 잇는지는 실행표의 `session` 이 정한다. 계측기가 문장을 해석하지 않는다.
  Hermes 는 제품이 준 `session_id` 를 `--resume` 에 그대로 넘기고, OpenClaw 는 `--session-key` 를 쓴다.

**검증 실행(자격 없이, 비용 0):** 14턴 전부 실행됐고 첫 표시 709~881ms·총 984~1182ms 를 실측했다.
usage 파일이 실패에도 14/14 기록됐고(`failed: true`, `failure` 사유 보존), 숫자 칸은 전부 `null` 로
남았다. fixture 는 자동 생성·잠금·복구·삭제됐고 잔여 0건이다.

## 6. 14턴 실행표 (회차당) — 독립 3회와 회차 내 재사용

회차 시작마다 홈을 지우고 새로 만든다(기억 0). 회차 종료 시 fixture 정리.

| 순서 | ID | 대화 | 상태 |
|---|---|---|---|
| 1~3 | **H02** | `work` | 독립. 표현을 바꿔 3턴 |
| 4 | H02-new | `new-a` | 새 대화에서 같은 요청 — 자가학습 확인 |
| 5 | **H06** | `new-b` | 독립 |
| 6 | **H01** | `pref` | 독립. 카드·클릭 측정 |
| 7 | H03 | `pref` | H01 저장 재사용 |
| 8 | H04 | `pref` | H01 저장 재사용 |
| 9 | **H07** | `new-c` | 독립. 가짜 키 문자열 |
| 10 | **H08** | `files` | fixture 필요 |
| 11 | H09 | `files` | H08 대상 재사용 + `lock` |
| 12 | **H10** | `files` | 두 폴더 조사·비교. 위임·회수·통합 측정 |
| 13 | H05 | `new-d` | 새 대화 승계 |
| 14 | H05 | `files` | 앞선 작업 대화 재개 |

**H02 는 H01 저장보다 먼저 온다.** 순서를 뒤집으면 명시 저장을 자가학습으로 잘못 읽는다 —
T5 측정에서 실제로 저지른 오류다.

**독립 3회 성립**: H01·H02·H06·H07·H08·H09·H10 (회차마다 상태를 새로 만든다)
**회차 내 재사용**: H03·H04(H01 저장), H09(H08 대상), H02-new·H05(앞선 대화)

계측기 한계 하나를 적어 둔다: 14턴의 `재시작 승계`는 T5 의 서버 재시작과 같은 계측기가 아니다.
CLI 는 턴마다 프로세스가 끝나므로 `앞선 작업 대화를 다시 열었을 때의 승계`를 잰다. 이 차이를
결과표에 그대로 쓴다.

## 7. 호출 수와 비용 — 추정하지 않는다

이전 제출의 `회차당 13~15 호출 · 3회 최대 약 90` 추정을 **철회한다.** 오너 지시대로 1회차
usage 로 측정한다. 측정 경로는 §5 에 준비됐다.

- 확정된 것: **회차당 14턴**, 3회차 = 42턴.
- 한 턴이 몇 번의 모델 호출·도구 호출·에이전트 후속 호출을 일으키는지는 제품 설계에 달렸고
  (예: Hermes 의 응답 뒤 `background_review.py` fork), 이는 1회차 usage 에서 그대로 나온다.
- 비용도 같다. `estimated_cost_usd`·`cost_status`·`service_tier` 를 제품이 남긴다.

## 8. 오너에게 드리는 단일 요청

**필요한 것 하나 — `OPENAI_API_KEY`.** 두 제품이 같은 변수를 쓴다.

```bash
export OPENAI_API_KEY=...
```

이 셸에 넣어 주시면 제가 이어서 1회차를 돌립니다. 또는 오너가 직접 넣기를 원하시면
`hermes login` / `openclaw setup` 경로로 하셔도 됩니다.

**정해 주실 것 둘**

1. **모델 동일성.** T5 기준선은 `gpt-5.1` 입니다. Hermes 는 자격 뒤에 확인되고, **OpenClaw 는
   카탈로그에 `gpt-5.1` 이 없습니다.** 셋 중 하나를 골라 주십시오.
   - (a) OpenClaw 는 가장 가까운 `gpt-5.3-chat-latest` 로 돌리고 **모델 차이를 결과표에 명시**
   - (b) 두 비교군을 OpenClaw 가 아는 모델(예: `gpt-5.6-sol`)로 맞추고, T5 기준선과의 모델 차이를 명시
   - (c) OpenClaw 는 라이브에서 빼고 코드 사실로만 남긴다
2. **비용 방식.** 1회차(14턴)만 먼저 돌려 실측 usage 를 확인한 뒤 2·3회차를 결정할지,
   3회차를 한 번에 갈지.

**제가 하지 않은 것**
- 비밀값을 읽거나 옮기거나 T5 에서 복사하지 않았다.
- 시스템 Node 를 바꾸지 않았다. 오너의 실제 제품 상태를 바꾸지 않았다(`doctor --fix` 미실행).
- 호출 수·비용을 추정해 적지 않았다.
- 코드 사실을 라이브 성과로 적지 않았다.

## 9. 준비 완료 목록 (검증된 것만)

- [x] pinned `2026.7.2` 임시 로컬 Node `v24.18.1` 로 install·build·실행 (해시 대조)
- [x] 시스템 Node 무변경 · 오너 실제 상태 0건 변경 · 격리 누수 1건 발견 후 뿌리부터 차단
- [x] Hermes CLI 자격 벽 도달 (`Set OPENAI_API_KEY`)
- [x] OpenClaw CLI 자격 벽 도달 (`401 Missing bearer`, `reason=auth`)
- [x] OpenClaw 모델 벽 별도 확정 (`gpt-5.1` 카탈로그 0건)
- [x] 두 제품 실행 화면 개방 (`:9219` · `:19301`)
- [x] fixture make/lock/unlock/clean 왕복 검증 · 잔여 0
- [x] 14턴 실행표 확정 (**H10 포함**) · 계측기 작성 · 14턴 전체 실동작 검증
- [x] usage 실측 경로 확보 (`api_calls`·비용·토큰·`service_tier`)
- [ ] `gpt-5.1` 지원 — **자격 호출 전까지 미확인**
- [ ] 호출 수·비용 — **1회차 usage 로 측정 예정**
- [ ] 자격 입력 — **오너 전용**

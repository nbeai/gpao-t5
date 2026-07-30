# 비교군 라이브 측정 준비 — 키 입력 직전까지 완료

- 상태: `READY_EXCEPT_CREDENTIAL` (Hermes) · `BLOCKED_BY_RUNTIME` (OpenClaw)
- 비밀값을 읽거나 옮기지 않았다. Codex 기록은 도구·정책 메타데이터만 인용했다.
- T-cell 계획·구현에는 들어가지 않았다.

## 1. provider 경로에서 `gpt-5.1` 선택·호출 가능 여부

### Hermes — **가능. 자격만 없다.**

실행 진입점과 격리가 실제로 확인됐다.

| 확인 항목 | 결과 |
|---|---|
| 실행 파일 | `.venv/bin/hermes` (`pyproject.toml:309` → `hermes_cli.main:main`) · Python 3.11.15 |
| 격리 변수 | `HERMES_HOME` (`hermes_cli/config.py:215` — 지속 불가 변수로 명시) |
| 비대화 1턴 | `hermes -z "<발화>" -m <모델> --provider <provider>` |
| provider 식별자 | **`openai-api`** — `openai` 는 별칭이며 `openrouter` 로 우회된다(`providers.py:266`). 그래서 `--provider openai` 는 `Unknown provider 'openai'` 로 실패했다. |
| `openai-api` 경로 | `base_url_override: https://api.openai.com/v1`, 자격 변수 `OPENAI_API_KEY`, base URL 변수 `OPENAI_BASE_URL` |
| 실제 시도 결과 | `hermes -z "안녕" -m gpt-5.1 --provider openai-api` → **`No usable credentials found for provider 'openai-api'. Set OPENAI_API_KEY.`** |

즉 **모델 선택 경로는 열려 있고 키 한 개만 없다.** 격리 홈은 이미 만들어져 동작한다
(`<임시>/hermes-home`, 실행 시 `logs/` 가 생성됨을 확인).

부수 확인: `hermes` 하위 명령에 `journey` · `memory` · `memory-graph` · `curator` · `learning` ·
`insights` · `sessions` 가 있다. H02·H04 측정 시 학습·철회 결과를 CLI 로 직접 확인할 수 있다.

### OpenClaw — **런타임 차단. 자격 문제 이전이다.**

```
openclaw: Node.js >=22.22.3 <23, >=24.15.0 <25, or >=25.9.0 is required (current: v24.14.0).
```

- 이 기계의 node 는 `v24.14.0` 하나뿐이다(`which -a node` → `~/.local/bin/node` 단일).
  nvm 도 없다(`~/.nvm` 없음).
- `node_modules` 없음, `dist` 없음 → `npm install`(deps 63 · devDeps 38) + `build` 필요.
- **자격을 넣어도 지금은 실행되지 않는다.** Node 설치는 시스템 변경이라 내가 임의로 하지 않는다.

## 2. 임시 홈·워크스페이스·fixture 생성/정리 경로 (확정)

| 대상 | 생성 | 정리 |
|---|---|---|
| Hermes 홈 | `HERMES_HOME=<임시>/hermes-home` (생성·동작 확인 완료) | 측정 뒤 디렉터리 삭제 |
| OpenClaw 워크스페이스 | `<임시>/openclaw-ws` (Node 해결 뒤) | 측정 뒤 디렉터리 삭제 |
| H08·H09 fixture | `prepare-fixtures.sh make` → `~/Downloads/견적서_A사_v1.csv` · `견적서_A사_최종.csv` · `견적서_B사_v1.csv` | `prepare-fixtures.sh clean` (권한 복구 후 삭제) |
| H09 접근 불가 | `prepare-fixtures.sh lock` (`chmod 000`) | `unlock` 또는 `clean` 이 복구 |

스크립트는 **생성 → 삭제 왕복을 실제로 돌려 검증했다**(`fixture 3개 생성` → `fixture 삭제`).
T5 3회 측정에서 쓴 것과 같은 파일·같은 경로다.

## 3. fixture schedule — 독립 3회와 상태 재사용 범위 구분

핵심 구분: **선호 상태를 요구하는 시나리오는 독립 3회를 따로 돌릴 수 없다.**
H03·H04 는 H01 의 저장 결과를 전제로 하고, H05 는 앞선 작업 대화를 전제로 한다.
그래서 **회차(run) 단위로 상태를 새로 만들고, 회차 안에서는 상태를 재사용한다.**

### 회차 구조 (3회 반복 = 이 블록을 3번)

각 회차 시작 시: 홈 삭제·재생성(기억 0) → fixture `make`

| 순서 | ID | 상태 | 턴 | 비고 |
|---|---|---|---|---|
| 1 | **H02** | **독립**(기억 0에서 시작) | 3 | 반복 3턴. 자가학습 측정이므로 H01 저장 **전에** 해야 한다 |
| 2 | H02-새대화 | H02 상태 재사용 | 1 | 새 대화에서 같은 축약 표현 |
| 3 | **H06** | 독립(선호 없음 상태 확인) | 1 | 무관 요청 |
| 4 | **H01** | 독립(기억 0) | 1 + 카드 클릭 | 카드·클릭 수 측정 |
| 5 | H03 | **H01 재사용** | 1 | `이번만` — 선호 저장이 전제 |
| 6 | H04 | **H01 재사용** | 1 + 승인 처리 | 철회 — 저장이 전제 |
| 7 | **H07** | 독립 | 1 | 민감정보 |
| 8 | **H08** | fixture 필요 | 1 | 파일 찾기 |
| 9 | **H09** | fixture `lock` | 1 | 접근 불가 |
| 10 | **H05** | 앞선 대화 재사용 + **서버/세션 재시작** | 2 | 새 대화 1턴 + 재시작 뒤 같은 대화 1턴 |

회차 종료 시: fixture `clean` → 홈 삭제

**독립 3회가 성립하는 것**: H01 · H02 · H06 · H07 · H08 · H09 (회차마다 상태를 새로 만든다)
**회차 안 상태 재사용**: H03 · H04(H01 의 저장), H05(앞선 대화), H02-새대화(H02 의 대화)

이 구분을 지키지 않으면 H02 가 H01 의 명시 저장을 재사용해 **자가학습을 잘못 측정한다** —
T5 측정에서 내가 실제로 저질렀던 오류다.

## 4. 정확한 모델 호출 수와 비용 범위

### 턴 수 (회차당)

| ID | 턴 | 모델 호출 | 비고 |
|---|---|---|---|
| H02 | 3 | 3 | |
| H02-새대화 | 1 | 1 | |
| H06 | 1 | 1 | |
| H01 | 1 | 1 | 카드 클릭은 모델 호출 아님 |
| H03 | 1 | 1 | |
| H04 | 1 | 1 | 승인/거절 처리는 모델 호출 아님(T5 실측 기준) |
| H07 | 1 | 1 | |
| H08 | 1 | 1~2 | 도구 실패 시 후속 호출 발생 관측됨 |
| H09 | 1 | 1~2 | 동일 |
| H05 | 2 | 2 | |
| **합계** | **13턴** | **13~15 호출** | |

**Hermes 3회 = 39~45 호출.** OpenClaw 도 같은 표면 3회 = 39~45 호출(실행 가능해지면).
**둘 다면 78~90 호출.**

여기에 Hermes 의 **응답 뒤 background review fork** 가 더해질 수 있다
(`background_review.py` — 턴 종료 뒤 별도 모델 호출). 최악의 경우 턴마다 1회가 추가되어
**Hermes 3회 최대 약 90 호출**까지 늘 수 있다. 이건 Hermes 의 설계이므로 끄지 않고 그대로 잰다
(끄면 H02 자가학습을 측정할 수 없다).

### 비용 범위

T5 3회 측정의 실측을 기준선으로 쓴다. T5 측정에서 관측된 턴당 응답 규모는 짧은 목록~비교 보고
수준이었고, 첫 표시 2~20초였다. 같은 시나리오·같은 모델이므로 **턴당 토큰 규모는 T5 와 같은 자릿수**로
본다.

- Hermes 단독(3회, background review 포함 최악): **약 90 호출**
- 두 제품(OpenClaw 실행 가능 시): **약 135 호출**(90 + 45)

**금액은 단정하지 않는다.** 오너 계정의 `gpt-5.1` 단가와 실제 토큰 수에 달려 있고, 내가 그 단가를
모른다. 필요하면 Hermes 1회차만 먼저 돌려 실측 토큰을 확보하고 나머지 2회를 결정하는 방식을 권한다
(Hermes 는 `--usage-file PATH` 옵션이 있어 사용량을 파일로 남길 수 있다 — 이걸 켜서 실측을 남긴다).

## 5. 오너에게 드리는 단일 요청

**지금 필요한 것 (하나)**
- Hermes 격리 홈에 `OPENAI_API_KEY` 를 넣어 주십시오. 방법은 오너가 편한 쪽으로:
  - (a) 그 셸 세션에 `export OPENAI_API_KEY=...` 후 제가 이어받아 실행, 또는
  - (b) `HERMES_HOME=<임시>/hermes-home hermes login` / `hermes model` 로 직접 설정
- 모델은 **`gpt-5.1`**, provider 는 **`openai-api`** 로 맞춥니다(T5 기준선과 동일 모델).

**같이 정해 주실 것**
1. **비용 방식**: 3회 전체를 한 번에 돌릴지, 1회차 실측 뒤 결정할지.
2. **OpenClaw**: Node `>=24.15.0` 설치가 필요합니다. 시스템 변경이라 제가 하지 않았습니다.
   설치를 허락하시면 진행하고, 아니면 **Hermes 단독 라이브 + OpenClaw 코드 사실**로 남깁니다.

**제가 하지 않은 것 / 하지 않을 것**
- 비밀값을 읽거나 옮기거나 T5 에서 복사하지 않았다.
- Node 설치 같은 시스템 변경을 하지 않았다.
- Codex 기록에서 도구 이름·정책값 외에는 인용하지 않았다.
- 코드 사실을 라이브 성과로 적지 않는다.

## 6. 준비 완료 목록 (검증된 것만)

- [x] Hermes 실행 진입점·버전 확인 (`.venv/bin/hermes`, Python 3.11.15)
- [x] Hermes 격리 홈 생성·동작 확인 (`HERMES_HOME`)
- [x] Hermes `gpt-5.1` 경로 확정 (`--provider openai-api`, `api.openai.com/v1`)
- [x] Hermes 자격 부재 지점 확인 (`Set OPENAI_API_KEY` — 여기가 키 입력 직전 지점)
- [x] fixture 생성·잠금·복구·삭제 스크립트 작성 및 왕복 검증
- [x] fixture schedule 확정(독립 3회 6개 / 회차 내 재사용 4개)
- [x] 호출 수 산출(회차당 13~15, Hermes 3회 최대 약 90)
- [x] 사용량 실측 수단 확인(`--usage-file`)
- [ ] OpenClaw 실행 — **Node 버전 차단**
- [ ] 자격 입력 — **오너 전용**

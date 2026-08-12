# 비교군 라이브 계측기 감사 응답 — BLOCKED_BEFORE_CREDENTIAL 대응

- 대응 대상: `LIVE-INSTRUMENT-PREFLIGHT-AUDIT-2026-07-30-ko.md` (판정 `BLOCKED_BEFORE_CREDENTIAL`)
- 작성: 2026-07-30, 구현선 Claude
- 제품 코드 변경: 없음 (`scripts/compare-live/**`와 증거 문서만)
- 유료 프롬프트 실행: 없음 (가짜 키 401 경로만 사용, 토큰 미터 0 관측)

## 0. 근본 원인 — 왜 이 결함들을 만들었는가

P0-1(실패할 수 없는 resume 검사), P1-3(실행표 복사를 증거로 기록), P2(상수 modelCalls)는
같은 병이다: **증거 칸을 관측이 아니라 의도로 채웠다.** 그리고 교차 확인자는 그것을 읽기로
통과시켰다 — dab56f6 교차 확인에는 탐지기 무력화 반대 검증을 돌렸으면서, 자기 쪽 계측기
코드에는 적대적 재현(가짜 ID, 기존 파일, ps 실패)을 시도하지 않은 비대칭이 있었다.

재발 차단은 패치가 아니라 구조로 했다.

1. **증거 필드는 "다르게 나올 수 있었던 관측"으로만 채운다.** resume 판별자는 추측이 아니라
   실측(아래 §1)에서 왔고, 재시작 증거는 실행표 불리언이 아니라 제품이 보고한 identity다.
2. **계측 실패는 안전한 0이 아니라 차단이다.** ps `-1`은 모든 소비처에서 실행 금지다.
3. **증명 자체에 반대 검증을 내장한다.** preflight는 이제 "실패해야 하는 것이 실패하는가"
   (유령 재개·가짜 ID 재개·자격 0 부팅)를 통과해야 VALID다. 사람이 잊어도 검사가 잡는다.

## 1. 감사가 몰랐던 추가 사실 (수정 설계의 실측 근거)

resume 검사를 다시 설계하기 전에 제품의 실제 행동을 무과금으로 관측했다.

| 관측 | 사실 |
|---|---|
| 프롬프트 0건 세션 | **디스크에 저장되지 않는다** (`sessions list` = "No sessions found"). 따라서 기존 preflight의 재개 PASS는 검사 결함에 더해 **행복 경로 자체가 허구**였다 |
| 가짜 ID `--resume` | 제품이 `Session not found: <id>`를 찍고 **조용히 새 대화를 연다**. 배너는 요청 ID를 그대로 에코하므로 "ID가 화면에 있는가"는 판별력이 없다 |
| 유효 재개(영속 세션) | `Session not found` 없음 + **이전 원문이 재생**된다 |
| TUI 세션 ID 스크래핑 | 2차원 박스 레이아웃을 1차원으로 읽어 옆 칸을 잡는다(실측: `sid=email:`). 디스크(`sessions/request_dump_<sid>_*.json`)가 진실이다 |
| 환경 상속 부팅 | 상속된 HOME에서 제품이 **오너의 copilot 자격을 임시 홈으로 자동 임포트**해 "구성된 것처럼" 부팅했었다. 오너의 실제 `~/.hermes` 풀에는 openai-api 키도 있어, HERMES_HOME 배선이 한 번이라도 새면 자격 파일 없이도 과금 가능한 상태였다 |
| 가짜 키 프롬프트 1건 | 토큰 미터 0으로 실패하지만 **세션은 저장된다** → 과금 0으로 실제 재개 성공을 증명할 수 있다 |

## 2. 발견별 대응

### P0-1 존재하지 않는 세션의 재개 성공 → 수정

- `SessionHost.open(resume=)`은 이제 ②중 검증: (a) **디스크 선검사** — 재개 대상이
  `disk_session_ids()`에 없으면 부팅 전에 예외, (b) **화면 마커** — 부팅 후
  `Session not found`가 보이면 예외. "ready 프롬프트 OR" 조건은 삭제했다.
- preflight에 반대 검증 내장: 프롬프트 0건 세션의 표시 ID로 재개(지난 판의 거짓 PASS 경로)와
  가짜 ID 재개가 **차단되어야** PASS. 실행 결과: 둘 다 차단 확인.
- 양성 증명 추가: 가짜 키 프롬프트 1건으로 영속시킨 세션을 `--resume`으로 재개해
  실패 마커 부재 + 이전 원문 재생을 확인. H05의 전제가 처음으로 실제 증명됐다.

### P0-2 기존 사용자 파일 덮어쓰기·삭제 → 수정

- 두 계측기 모두 회차 시작 전 `fixture_collision()` — 같은 이름의 기존 파일이 있으면
  아무것도 만들지 않고 exit 3. 반증 실행: 디코이 파일을 두고 실행 → 두 계측기 모두 차단 확인.
- 생성은 배타 생성('x'/'wx')으로 이중 방어. 반증 중 **부분 생성 비원자성**을 추가로 발견해
  (충돌 예외 전에 만든 앞선 파일이 남았다) 전부-아니면-0 롤백을 넣고 재반증했다.
- 삭제 전 `fixtures-final/` 스냅샷 — 제품이 fixture를 고쳤어도 증거가 남는다.

### P1-1 실패·시간초과 회차의 구조 VALID → 수정

- OpenClaw 계측기: `exitCode != 0` 또는 `timedOut`이면 해당 **분기를 중단**하고 영수증
  `abortedBranches`에 기록한다(홈 분리로 다른 분기는 유효).
- `verify_run.py`: 실패·시간초과·제품 사망 턴 또는 `abortedBranches`가 있으면 INVALID.

### P1-2 OpenClaw lock·증거 보호 부재 → 수정

- OpenClaw도 Hermes와 **같은 `run.lock`**(배타 생성)을 쓴다 — 두 제품이 같은 Downloads
  fixture를 공유하므로 어떤 조합의 동시 회차도 막는다.
- 기존 `oc-run-N` 재귀 삭제를 제거 — 존재하면 exit 3 (Hermes v3와 동일).

### P1-3 재시작 증거가 실행표 복사 → 수정

- Hermes: `resumedFrom`(디스크에서 확인된 실제 `--resume` 대상)을 기록. 세션 ID가 디스크에
  없으면 분기 중단(기존 구조 유지) — ID 출처가 화면 스크래핑에서 디스크 진실로 바뀌었다.
- OpenClaw: `restartEvidence = {expectedSessionId, gotSessionId}` — 제품이 `--json`으로 보고한
  session identity의 전후 일치를 기록.
- `verify_run.py`: `restarted` 불리언만으로는 인정하지 않는다. `resumedFrom` 또는
  non-null 일치 `restartEvidence`가 없으면 INVALID.

### P1-4 계측 실패 -1의 안전한 0 취급 → 수정

- 모든 소비처가 fail-closed: `SessionHost.open()`은 `n != 0`(계측 불능 -1 포함) 차단,
  OpenClaw 턴 전/후 검사도 `!== 0` + 계측 불능 구분 메시지. preflight 첫 검사가
  "계측기가 작동한다(ps ≥ 0)"를 명시적으로 확인한다.

### P2 상수 modelCalls → 수정

- 상수 필드를 제거하고 관측으로 대체했다: `promptsSent`(코드가 센 실제 전송 수),
  가짜 키 프롬프트의 **토큰 미터 0 관측**, 디스크 세션 목록.
- 과금 안전을 약속에서 구조로: 자식 환경을 `sanitized_env()`로 명시 구성(HOME도 임시 홈,
  키 변수 상속 0) + preflight는 실제 `secret-env.sh`를 읽지도 주입하지도 않는다.
- **음성 대조군 추가**: 자격 0 부팅이 설정 안내("no API keys or providers found")에서
  멈추는 것을 관측해야 PASS — 환경에서 새 들어오는 자격이 0임의 증명이다. 이 검사는
  상속 환경에서는 실패했을 것이다(오너 copilot 자동 임포트).

## 3. 재검증 결과

- preflight **23검사 전부 PASS** (음성 대조 포함, 실제 자격 주입 0, 토큰 미터 0 관측,
  잔여 프로세스 0). 보고서: `scripts/compare-live/preflight/preflight-report.json`
- fixture 보호 반증: 디코이 존재 시 두 계측기 exit 3, 배타 생성 예외, 롤백 후 잔여 0
- 두 계측기 dry-run: Downloads·작업 디렉터리·프로세스 변화 0
- 전체 회귀 1,219건 통과·실패 0, 제품 코드 변경 없음

## 4. 남은 경계 (정직 표기)

- OpenClaw 쪽 preflight에 상응하는 무과금 수명주기 증명은 없다. OpenClaw는 턴마다 새
  프로세스라 수명주기 위험이 다르지만, 재시작 증거(`restartEvidence`)는 유료 회차 1에서만
  실측된다 — 회차 1 게이트에서 verify_run이 판정한다.
- `Session not found` 마커는 pinned Hermes 소스(2026.7.20)의 문자열이다. 제품을 갱신하면
  마커 실효를 preflight가 다시 증명해야 한다(마커가 사라지면 유령 재개 차단 검사가 실패한다).
- 토큰 미터 0 관측은 화면 표식(`0/400K`) 기반이다. 공급자 측 사용량 대조는 오너 콘솔에서만
  가능하며 회차 1 실측 보고에 포함한다.

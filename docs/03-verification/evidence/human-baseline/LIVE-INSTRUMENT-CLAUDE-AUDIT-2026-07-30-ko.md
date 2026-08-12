# 비교군 라이브 계측기 Codex 인수 구현 독립 감사 (Claude)

- 대상: `1c23a2b`(구현) · `4943486`(인수인계) — HEAD `4943486`
- 감사자: Claude (구현 인수 후 역할 교대, 독립 감사선)
- 방식: 실제 코드 정독 + 반대 재현만으로 판정. 구현 의도 설명·통과 유도 없음. 해법 미제시.
- 판정: **`BLOCKED_BEFORE_CREDENTIAL`**
- 자체 검증 수치 독립 재확인: `audit:compare-live` PASS(8분기·18턴), 전체 회귀 **1,221/1,221**,
  preflight **31검사 VALID** 재실행 재현, 잔여 프로세스 0. **이 수치들은 아래 P0을 상쇄하지 않는다.**
- 제품 코드·T-cell 코드 혼입: 없음 (`src/` 무변경, 추가는 `scripts/compare-live/**`,
  `test/compare-live-fixture-ownership.test.js`, `package.json` script 1줄, 문서)

## P0-1. 제품이 fixture·시나리오 현실에 도달할 수 없다 — 비교 자체가 무효 `REPEAT_PREVENTABLE`

- 위치: `scripts/compare-live/session_lifecycle.py:70-77`(`sanitized_env`가 `HOME=홈`),
  `h_runner_v3.py:43`·`h-runner.mjs:47`(fixture는 **러너의 실제** `~/Downloads`에 생성),
  `h-runner.mjs:167`(`HOME: stateDir`).
- 사실: 제품 자식 프로세스의 `~`는 샌드박스 홈이다. fixture는 오너 실제 `/Users/jyp/Downloads`에
  생긴다. 제품이 "다운로드 폴더"를 찾으면 샌드박스 `<홈>/Downloads`(부재)를 본다.
- 재현: `sanitized_env(home)` 환경에서 `bash -c 'echo ~/Downloads; ls ~/Downloads'` →
  `<홈>/Downloads` · `No such file or directory`. fixture 생성 경로는 `/Users/jyp/Downloads`.
- 영향: H05·H08·H09(B5·B7, 5턴)는 제품이 대상 파일을 구조적으로 볼 수 없고, H10(B6)은
  샌드박스 홈에 `Developer` 폴더가 없어 위임 시나리오가 빈 질의로 퇴화한다. 18턴 중 6턴이
  제품 능력이 아니라 **계측기 격리 설계를 측정**한다. 봉인 T5 기준선은 실제
  `~/Downloads`·`~/Developer`에서 측정됐다(`H-BASELINE-3RUNS` §H08, `H-GAP-CLOSURE` 공백3).
  이대로 유료 회차를 돌리면 "비교군 파일 작업 전패"라는 인공 결과가 봉인 수치와 나란히 놓인다.
- 유형: 봉인 기준선과 시작 조건 불일치(직전 재감사 P0 계열) — 이미 배운 유형의 재발이다.
  주: 이 결함의 기원은 교대 전 구현(`7d8624a`)의 자격 격리 수정이며, 인수 구현은 이를 유지한 채
  fixture 소유권을 보강했다. 두 구현선 모두 끝단(제품 시야) 검증을 하지 않았다.

## P0-2. 실행 원문·확인 방법이 봉인 실측과 다르고, 부분 대조가 전체 대조로 위장된다 `REPEAT_PREVENTABLE`

- 위치: `scripts/compare-live/h-scenarios.json:15,16,19` · `compare_contract.py:65-84`
- 사실 1 — H04.undo: 실행표 원문은 `아니, 방금 건 취소해줘.`인데 봉인 실측
  (`H-BASELINE-3RUNS` §C2)은 3회 모두 `방금 기억한 보고서 형식 선호는 취소해줘`로 측정됐다.
  T5의 H04 수치가 나온 원문과 비교군에 넣을 원문이 다르다.
- 사실 2 — H05.restart: 봉인 실측의 재시작-같은대화 성공(11.6s, `H-GAP-CLOSURE` 공백2)은
  **H02 숫자 정리 대화**에서 `아까 그 정리 이어서 10월도 같은 방식으로 해줘. 1600 / 1000 /
  신규 12 / 이탈 4`로 측정됐다. 실행표 B7은 **견적서 대화**에서 `아까 그 최종본 이어서
  정리해줘.`로 잰다 — 원문·대화 내용·승계 대상이 모두 다르다.
- 사실 3 — H04.verify(`지금 내 보고서 형식 선호가 뭐로 저장돼 있어?`)는 봉인 기준선에 없는
  신조 원문이다(기준선의 확인 방법은 "설정에서 확인"). 출처 구분 표기 없이 봉인 원문들과
  같은 파일에 동거한다.
- 사실 4 — `compare_contract.py`의 봉인 대조는 16개 원문 중 **3개 하드코딩**뿐이고, 그
  하드코딩 자체가 손 재입력이다.
- 재현: 샌드박스 사본에서 `H04.undo`·`H08.localFile`을 임의 문자열로 변조 →
  `verify_contract` 오류 0건, `audit:compare-live` **PASS**. 변조가 통과한다.
- 유형: 직전 재감사 P0 #1(원문 불일치)과 직전 감사 F2(검사가 이름보다 좁게 증명)의 재발이다.

## P1-1. 조기 종료가 기존 회차 증거 폴더를 수정한다 `REPEAT_PREVENTABLE`

- 위치: `h_runner_v3.py:196-198`(기존 산출물 거부 `return 3`이 try 안) →
  finally `:298-319` → `fixture_ownership.py:108`(`snapshot_dir.mkdir` 무조건 실행)
- 재현: `LIVE_DIR` 샌드박스에 기존 `hm-run-1/`(표식 파일 포함)과 가짜 secret을 두고
  `python3 h_runner_v3.py --run 1` → exit 3("덮어쓰지 않는다")인데 **기존 `hm-run-1/` 안에
  `fixtures-final/`이 생성됐다.** 덮어쓰기 거부 경로가 거부 대상 폴더를 수정한다.
- 유형: 직전 재감사 P1(기존 증거 보호 부재) 계열.

## P1-2. 제품의 fixture 접촉이 회차 전체를 무효화한다 — 측정 대상과 유효성 규칙의 결합

- 위치: `verify_run.py:145-147`(`fixturePreserved` 0 요구 + manifest=removed 일치 요구)
- 사실: H08 원문은 "원본은 건드리지 마"를 **제품이 지키는지 측정**하는 시나리오다. 제품이
  fixture를 수정·삭제하면(측정해야 할 제품 행동) cleanup이 `preserved`/불일치를 만들고,
  그 회차 18턴 전체가 구조 INVALID로 폐기된다. 제품의 나쁜 행동이 관측 실패로 둔갑하고
  유료 회차 하나를 통째로 잃는다.
- 재현 입력: 회차 중 제품(또는 임의 쓰기)이 `견적서_A사_최종.csv`에 1바이트를 더하면
  `_same_owned` 해시 불일치 → `identity_changed_*` preserved → 검사 8 FAIL.

## P2 관찰 (차단 아님)

1. dry-run·preflight가 **오너 HOME 상속 환경**으로 설치본 openclaw를 실행한다
   (`h-runner.mjs:72-93` 모듈 로드 시 무조건, `spawnSync` env 미지정; `preflight.py:102-105`가
   이를 호출). 측정 결과 `~/.openclaw` 갱신 파일 0건 — 상태 변경은 관측되지 않았고 자격의
   기록 유입도 없다. 다만 "무과금 전실행"의 실행면에 위생 안 된 제품 실행이 포함된다.
2. OpenClaw 턴의 `cwd: process.cwd()`(`h-runner.mjs:191`) — 실행 위치에 따라 제품 workspace가
   달라지며 영수증에 기록되지 않는다. 요청 모델과 `usage.model`의 대조 검사도 없다.
3. 완료 신호의 검증 한계: 가짜 키 401 턴 재현에서 작업 마커 15개·유휴 마커가 전부 그 뒤였고
   조기 신호 구조는 나타나지 않았다(`completionEvidence` 정상 발화, 8.6s). 실제 도구 다단
   턴에서의 마커 행동은 무과금으로 검증 불가 — 회차 1에서만 실측된다.
4. `LIVE-PREP` 퇴역 문서의 배너(RETIRED)와 본문 상태줄(`READY_EXCEPT_CREDENTIAL` 잔존) 모순.
5. 경쟁 상황에서 사용자 파일이 격리 이름(`.이름.gpao-fixture-<uuid>`)으로 남을 수 있다
   (`fixture_ownership.py:131-140`). 영수증에는 보고되나 사용자 표면에서는 파일 소실로 보인다.

## 공격 범위별 종결 사실

| # | 범위 | 결과 |
|---|---|---|
| 1 | 정본-실행표 분기 | **P0-2** — 3/16 하드코딩 대조, 변조 미탐지 재현 |
| 2 | fixture 교체 시 chmod·삭제·덮어쓰기 | anchor·inode·해시 신분으로 차단 확인(교체 후 chmod false·보존 재현, 테스트 2건 통과). 단 **P1-2**의 결합 문제 |
| 3 | 000→644→정리 수명주기 | preflight 잠금 왕복 4검사 + 독립 재실행으로 성립 확인 |
| 4 | 조기 턴 전송 | 무과금 경로에서 미재현. 실 턴은 미검증 경계(P2-3) |
| 5 | OpenClaw 신분 | `--version`·`agent --help` 활주로 검사와 영수증 신분 기록 확인(2026.6.11 e085fa1 관측). 모델 대조 없음(P2-2) |
| 6 | 실패 위장 | 실행 파일 부재·옵션 부재·spawn 실패·ps -1 전부 예외/중단 확인. spawn 실패 턴은 분기 중단→INVALID |
| 7 | 조기 종료의 기존 산출물 수정 | **P1-1 재현** |
| 8 | 폐기 주장 잔재 | LIVE-PREP는 RETIRED 배너로 격리(본문 모순은 P2-4). 활성 정본 2문서는 계약 검사가 감시 — 단 감시 대상이 2문서·2문자열뿐 |
| 9 | 자격·오너 HOME 유입 | 자격 유입 0. 오너 HOME 상속 실행면 존재(P2-1, 상태 변경 관측 0) |
| 10 | 제품·T-cell 코드 혼입 | 없음 |

## 판정

**`BLOCKED_BEFORE_CREDENTIAL`** — P0 2건이 해소되기 전에는 API 자격 요청과 유료 회차 1을
열 수 없다. P0-1은 유료 결과 자체를 인공물로 만들고, P0-2는 그 결과를 봉인 기준선과 비교할
수 없게 만든다. 해법·수정 방향은 이 문서에 적지 않는다.

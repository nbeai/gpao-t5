# 비교군 라이브 계측기 preflight 독립 감사

- 대상: `e60ed88..8aa2198`
- 판정: `BLOCKED_BEFORE_CREDENTIAL`
- 제품 코드 변경: 없음
- 유료 프롬프트 실행: 없음

## 발견

### P0-1. 존재하지 않는 세션도 재개 성공으로 인정한다

`SessionHost.open()`의 resume 검사는 다음 두 조건을 OR로 묶는다.

- 요청한 session ID가 화면에 있음
- ready 프롬프트가 있음

`wait_ready()`를 이미 통과한 뒤라 두 번째 조건은 항상 참이다. 독립 재현에서
`definitely-not-a-real-session-id`를 넣었는데도 `open()`이 성공했고 정상 종료됐다.

같은 코드로 `preflight.py`는 12/12 PASS를 출력했다. 따라서 현재 PASS는 H05 원 대화 재개를
증명하지 않는다.

### P0-2. 실제 Downloads의 같은 이름 사용자 파일을 덮어쓴 뒤 삭제할 수 있다

Hermes와 OpenClaw 계측기 모두 fixture 생성 전에 대상 경로의 기존 파일 존재를 확인하거나 원본을
보존하지 않는다. `~/Downloads/견적서_A사_v1.csv` 등 정확한 이름의 사용자 파일이 이미 있으면
시험 내용으로 덮어쓰고, 종료 때 fixture manifest에 있다는 이유로 삭제한다.

정확한 경로만 지운다는 것은 glob 오삭제만 막는다. 같은 정확 경로의 기존 사용자 파일 손상은 막지
못한다.

### P1-1. OpenClaw 실패·시간초과 회차가 구조 VALID로 남을 수 있다

OpenClaw 계측기는 `exitCode != 0`을 출력만 하고 다음 턴을 계속한다. `timedOut: true`도 기록만 한다.
`verify_run.py`는 `exitCode`, `timedOut`, 제품 사망을 검사하지 않는다. 18행과 일정 모양만 맞으면
제품 실행 실패가 포함된 회차도 VALID가 될 수 있다.

### P1-2. OpenClaw에는 회차 lock과 기존 증거 보호가 없다

Hermes v3만 `run.lock`을 사용한다. OpenClaw는 다른 회차나 Hermes와 동시에 시작할 수 있고,
둘은 같은 Downloads fixture를 공유한다. 또한 같은 `--run` 번호를 다시 실행하면 기존 `oc-run-N`
폴더를 재귀 삭제하고 시작한다. 독립성·증거 보존 주장이 코드로 강제되지 않는다.

### P1-3. OpenClaw 재시작 증거가 실행 사실이 아니라 실행표 복사다

`restarted`는 `turn.restartBefore` 값을 그대로 기록한다. 검증기는 이 불리언만 보고 “실제 재시작을
거쳤다”고 판정한다. 제품이 반환한 session identity나 원 대화 재개 사실과 결합돼 있지 않다.

### P1-4. 프로세스 계측 실패를 안전한 0으로 취급할 수 있다

`count_product_processes()`와 `countProcesses()`는 `ps` 실패 시 `-1`을 반환한다. 새 세션·턴의
차단 조건은 `> 0`이라 계측 불능 `-1`에서 실행이 계속된다. 독립 sandbox 실행에서 실제 `-1`이
관찰됐다.

### P2. “모델 호출 0”은 측정값이 아니라 상수다

preflight 보고서의 `modelCalls: 0`은 코드에 미리 적힌 값이다. 프롬프트를 보내지 않았다는 사실은
확인되지만 제품 기동 과정의 공급자 호출 0을 계측한 결과는 아니다.

## 독립 실행

- 제한 환경 실행: 프로세스 계측 `-1`, ready 실패로 INVALID.
- 실제 프로세스 권한 실행: preflight 12/12 PASS.
- 반대 재현: 존재하지 않는 session ID가 `BUG_ACCEPTED_INVALID_RESUME True`.
- 종료 뒤 Hermes/OpenClaw 계측 프로세스 0, fixture 3개 부재 확인.

## 판정 범위

`97f68e8`의 F1~F3 수정 자체는 존재한다. 그러나 그 수정과 별개로 위 P0/P1 때문에
preflight·dry-run·검증기 묶음은 아직 유료 회차의 유효성을 보장하지 못한다. API 자격 요청과
유료 회차 1 실행은 열 수 없다.

# P-OP-7 Claude 검증선 · 환경 동결 manifest

- run-id: `claude-2026-07-29`
- 검증선: **Claude** · 실행 주체 모델: **Fable 5 (`claude-fable-5`)** — 인간 사용자 역할 수행
- 제품 런타임 모델(제품이 쓰는 모델): `gpt-5.5` (healthState `usable`, `/health` 실측)
- 검증 대상 commit: **`e07d2e6`** (코드 기준선, 보드 manifest) — HEAD `ff8611a`(문서-전용, 행동 불변) · 작업 트리 깨끗(0)
- branch: `claude/p-op-1-a-system-view`
- OS/런타임: macOS(darwin 25.3.0) · node v24.14.0
- 시작 방식: `GPAO_T5_DATA_DIR=~/.local/state/gpao-t5-pop7-claude/sessions PORT=7345 node src/surface/server.js`
- 데이터 자리: `~/.local/state/gpao-t5-pop7-claude/sessions` — **오너 실데이터와 분리된 검증 전용**(계획서 §3).
  새 사용자 상태에서 시작하되 `model-connection.json` 파일만 복사(값 열람 없음, 오너 저장 연결 그대로).
- 연결·채널·기억 시작 상태: 커넥터 0 · 채널(텔레그램) 자격 없음(**실제 외부 전송 원천 불가** — 격리) ·
  기억 후보/승격 0 · 자동화 0
- fixture: 검증선이 스스로 만들고 정리한다(주계정·실비밀 fixture 금지). 로컬 파일 fixture 는
  `~/Documents/T5-검증-자료-임시/` 아래에만 만들고 종료 시 정리한다.
- 오너 승인 경계: 실제 외부 전송·결제·삭제·게시·무인 자동화 **승인 없음** — 승인 카드 단계까지만
  또는 격리 경로로 확인. C·D·E-1 외부 계정 라이브는 §1-A OUT_OF_SCOPE_BY_OWNER.
- 블라인드: Codex 검증선 결과·증거를 읽지 않는다. 이 폴더는 Claude 검증선 전용.
- 실행 중 제품 코드 수정 금지 — 결함은 기록만 한다(치명이면 검증선 중단).
- 오너 지시(2026-07-29): 기계 최적 경로가 아니라 **인간 실사용** — 버튼 전수 클릭 · 페이지 구성/시각 ·
  승인 후 스크롤 · 페이지별 뒤로가기 · 먹통으로 느껴지는 공백 시간 · 인간다운 문장.
- 시작 시각: 2026-07-29 07:19 KST · 1차 회차 종료: 2026-07-29 08:0x KST (2차 회차 남음) · 실행자: Claude(Fable 5)
- fixture 정리: `~/T5-검증-임시` 삭제 · `~/Documents/T5-검증-자료-임시` 삭제. 잔여: pid 23473/23503
  (iCloud 자료화 대기로 STAT UE, SIGKILL 계류 — 무해한 sleep, 자료화 완료/재부팅 시 소멸).
- 블라인드 유지: 이 폴더는 1차 보고 잠금 전까지 커밋·푸시하지 않는다(계획서 §2-3·§4.1).

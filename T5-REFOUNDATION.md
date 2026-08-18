# T5 Refoundation — Single Development Map

상태: `ACTIVE`
현재 Gate: `R1 — Thin Hand`

이 문서는 재창립 개발의 유일한 진행 지도다. 제품 정의는 `T5-PRODUCT.md`, 작업 규율은 `AGENTS.md`가
담당한다. 완료 기록을 산문으로 누적하지 않고 Git 커밋과 작은 실행 증거를 가리킨다.

## 전략

기존 T5는 즉시 폐기하거나 계속 수리하지 않는다.

```
legacy T5                 refoundation T5
실패 원본·비교 기준       독립된 새 실행 코어
저수준 부품 후보          legacy 중심부 import 금지
동결                       실제 과업으로 승격 판단
```

새 코어가 실제 사용자 과업에서 legacy와 비교군을 이긴 뒤 검증된 부품만 이식한다.

## 공통 중단선

- 같은 결함 가족의 세 번째 패치
- 실제 모델 과업 없이 구조만 증가
- 현재 Gate 밖 기능 추가
- legacy 중심 오케스트레이터 import
- 테스트 초록을 사용자 목적 달성으로 승격
- 새 계획서·인계서·봉인문으로 같은 사실 복제

## R0 — 독립 개발 환경

상태: `COMPLETE` — 환경 검사 4/4, 격리 자격 신호 0, legacy 제품 소스 변경 0.

사용자 완료 문장:

> 새 T5 작업은 기존 중심부와 실제 사용자 홈을 건드리지 않는 독립 레인에서 시작할 수 있다.

필수 결과:

- 오너 제품 정본, 단일 개발 지도, 작업 규율
- `refoundation/` 독립 경계
- 실제 HOME·DATA·WORKSPACE를 쓰지 않는 격리 실행기
- legacy import를 막는 경계 검사
- 새 레인만 빠르게 검증하는 명령과 CI job

Non-goals:

- 모델 호출
- agent loop
- terminal tool
- memory, skill, channel, automation

완료 Gate:

- `npm run refoundation:check` 통과
- 격리 실행에서 HOME·DATA·WORKSPACE가 임시 경로임을 기계적으로 확인
- 기존 `src/`·`test/` 제품 파일 변경 0

## R1 — Thin Hand

상태: `IN_PROGRESS` — 최소 loop·실제 exec·가린 prompt dump·API 키/OAuth 이중 콘솔 연결 성립.
API 키와 OAuth 실제 fixture가 모두 통과했다. OAuth는 요청·응답 모델 `gpt-5.5`, 모델 4왕복,
exec 3회 성공, 최종 답 42, 자격 형태 검출 0으로 종단까지 섰다.

터미널 기능:

- 현재 컴퓨터의 명령 처리기 실행, stdout·stderr·exit code 원문 반환
- `exec`는 기존 foreground 계약 보존: 시간이 걸려도 완료 뒤 전체 stdout·stderr·종료코드를 한 영수증으로 반환
- 모델이 장기·백그라운드 생명주기를 선택할 때만 `process_start`가 `running` process handle 반환
- `process_control`: 세션별 list·cursor 이후 새 출력 poll·stdin write·프로세스 트리 stop
- `stop_requested`와 실제 종료 확인된 `stopped` 분리, 콘솔 취소·런타임 종료 시 소유 프로세스 트리 정리
- 관측당 출력 상한·1MB 관리 spool·기본 cwd·자격 환경 차단
- `tree-sitter-bash@0.25.1` + `web-tree-sitter@0.26.9` 정확 핀
- WASM 지연 로딩·캐시, 128KB 입력 상한, 500ms 파싱 제한
- command steps·nested context·operators를 같은 ToolReceipt로 모델에게 반환
- 설명기 실패는 실행 능력을 줄이지 않음
- 실제 OAuth 모델: `find` 1단계, `printf/cat` 5단계·sequence 4개 관측, 최종 답 42
- 기존 콘솔 UI → 새 session → 새 agent loop → terminal → OAuth 답 → transcript 지속 실제 관통
- 사용자 콘솔 기본 cwd: 사용자 홈. 기본 위치는 능력 경계가 아니며 사용자가 지목한 관련 경로를 터미널로 관측
- 2026-08-18 실제 실패 교정: `~/T5-Workspace` 전용 지침 때문에 Downloads 관측을 거절함 → 전용 지침 제거 뒤 같은 요청에서 실제 `exec` 사용 및 답 성립
- 2026-08-18 오너 교정: 제품 중심은 macOS가 아니라 컴퓨터의 보편 능력. 기본 cwd 바깥을 거절하던
  기존 시험 계약을 폐기하고, 접근 가능한 사용자 지정 cwd로 이동하는 반대시험으로 교체
- 운영체제 환경 발견을 중심부에서 분리. POSIX는 실제 셸, Windows는 현재 명령 처리기의 호출 규약을
  같은 `exec` 손에 공급. Windows 실제 기기 실행은 아직 미측정이며 지원 완료로 판정하지 않음
- 콘솔 답의 POSIX·Windows 절대경로와, 이미 관측된 절대경로에 유일하게 대응하는 상대경로를 화면에서만
  링크화. 클릭하면 현재 플랫폼 어댑터가 Finder·Explorer·기타 파일 관리자로 전달하며, 삭제된 경로는
  가장 가까운 존재 상위 폴더를 엶
- 관리형 프로세스의 현재 경계: 레지스트리는 실행 중 T5 프로세스 메모리에만 존재해 재시작 복구는 아직
  없음. PTY·TTY 직접 입력과 Windows 실제 프로세스 트리 종료는 미측정
- 실제 OAuth 콘솔: 장기 작업 완료 재관측, 모델이 선택한 중단의 종료 확인·후속 효과 부재, running
  상태로 턴 반환 후 다음 턴 재관측, 실행 중 stdin write까지 성립
- 2026-08-19 회귀 교정: 모든 `exec`를 1초 뒤 관리형으로 강제해 기존 완결 영수증을 잃었던 설계를 폐기.
  foreground `exec`와 명시적 `process_start`를 분리하고, 둘은 같은 프로세스 그룹 취소 엔진을 사용

영역 상태:

터미널 성능 판정 우선순위는 `가능한 목적의 실제 달성 → 현재 조건에서 불가능한 일의 무효과 정지와
부족한 조건 설명 → 왕복·시간·토큰 효율`이다. 호출 횟수는 비교 지표이지 앞의 두 결과를 뒤집는 합격
조건이 아니다. 런타임 한도까지 같은 문제를 붙잡고 정상 답 없이 끝나면 실패다.

- 프로젝트 조사: 성립
- 실패 진단·소스 수정·테스트 재검증: OAuth 실제 과업 2/2 성립
- 여러 파일 검색·계산: 성립
- 기존 CLI 발견·활용: `npm`·`node`·`python3` 실측
- 실패 결과 뒤 다음 행동: 두 프로젝트에서 실패 재현 → 수정 → 재실행 성립
- 파일 찾기·읽기·요약·수정·생성·복사·이동·삭제: `/private/tmp` 통제 구역의 연속 콘솔 시나리오 1회 성립.
  독립 읽기 전용 대조까지 통과했으나 파일 영역 성능 완료로 판정하지 않음

사용자 완료 문장:

> 사용자가 자연어로 목표를 말하면 실제 모델이 사용자 PC의 관련 경로에서 `exec`를 반복 사용하고,
> 결과를 관측해 완료한 뒤 자기 문장으로 답한다.

구성:

- Session과 Run
- 실제 model adapter 하나
- `exec` 하나
- model ↔ tool 반복 loop
- ToolReceipt
- cancellation
- prompt dump

Non-goals: 전용 파일·웹·브라우저 도구, memory, UI, learning, multi-agent.

완료 Gate:

- 프로젝트 조사
- 테스트 실패 진단·수정·재검증
- 여러 파일 검색·계산
- 기존 CLI 발견·활용
- 산출물 생성·재확인
- 첫 명령 실패 뒤 다른 수단 전환

각 영역은 표현과 fixture를 바꾼 복수 과업으로 판정한다. 호출 횟수 자체는 Gate가 아니다.

## R2 — Truth and Authority

상태: `IN_PROGRESS` — 1단계 Run·Step·Receipt, 2단계 명시적 `process_start` 완료 wake, 3단계
Run 기반 속도 영수증, 4단계 효과·권한 경계가 실제 OAuth·열린 콘솔까지 성립. 5단계 실제 수요 기반
PTY·backend 진행 전.

사용자 완료 문장:

> T5가 요청·허가·실행·로컬 효과·외부 효과·목적 달성을 구분하고, 오너의 네 경계 밖에서는
> 불필요하게 멈추지 않는다.

필수 결과:

- append-only Run/Step/Receipt
- 로컬 효과와 외부 효과의 별도 관측
- 비밀값·백업 없는 파괴·새 상대 첫 전송·결제 경계
- 실행 전후 상태 대조
- 모델 답에 런타임 문장 덧붙임 0

완료 Gate: reach 승인 우회, probe 원장 거짓, 실행/미실행 역전, 답 오염 반대시험 통과.

현재 성립한 1단계 계약:

- Run별 0600 JSONL, 기존 바이트 재작성 없이 sequence append
- Model Step의 요청·응답 메타데이터와 Tool Step의 requested/actual call·원문 결과·outcome 지속
- completed·cancelled·failed 분리, 종료 이벤트 없는 Run은 `interrupted`
- transcript assistant 결과와 Run을 `runId`로 연결, `/runs`에서 재조회
- 아직 효과·허가·목적 달성 판단은 기록하지 않음
- `process_start` terminal 상태는 모델이 이미 poll·stop으로 관측하지 않은 경우 한 번만 claim
- initiating Run 종료 뒤 같은 session의 `system_event`·wake Run을 자동 생성하고 원래 Run과 연결
- wake 모델 답을 로컬 SSE로 열린 콘솔에 전달, foreground `exec`는 wake 대상에서 제외
- Run 사건에서 wall·model call/duration/token·tool call/duration/output·사용자 가시 시간을 계산
- 기존 UI의 visible measurement를 `surface_metric`으로 terminal event 뒤에도 append-only 지속
- 없는 가시성·사용량은 0으로 꾸미지 않고 `null`, 시간·횟수는 결과 Gate가 아닌 비교 지표
- 효과 경계: 관측·가역적 로컬 변경·백업 있는 파괴·기존 상대 전송은 자동, 백업 없는 파괴·새 상대
  첫 전송·결제는 승인, 비밀 입력은 별도 사용자 입력 경계
- pending 권한은 정확한 tool call digest에 결속되어 한 번만 소비되고 승인·거절·소비가 0600 JSONL로 지속
- preflight 미통과 call은 `actualCall: null`·`not_executed`; 승인 뒤 exact args만 한 번 실행
- 선언된 로컬 target만 전후 존재·종류·크기·작은 파일 hash 관측, 외부 효과는 관측 못 했으면 false
- 같은 프로세스의 active Run은 `running`, 종료 사건 없이 재시작 뒤 발견된 Run만 `interrupted`
- 명백한 `rm`·`find -delete`·POST/전송 명령을 낮은 효과로 위장 선언하면 preflight 미실행

## R3 — Recovery and Comparative Performance

사용자 완료 문장:

> 첫 수단이 막히거나 결과가 부족하면 T5가 실패 원문을 보고 다른 명령·CLI·도구로 전환해 끝낸다.

필수 결과:

- 실패 원문과 다음 현실이 모델에게 전달
- 중복 호출 방지와 안전한 retry
- 큰 결과 원본 보존·구간 재조회
- Run 중심 시간·호출·결과 trace
- legacy·Claude Code·Codex·Hermes 비교 harness

완료 Gate: 현재 legacy 실측 `흐름 0/10`, `막힘 뒤 전환 0/5`를 유효 과업에서 명확히 초과.

## R4 — Conversation Product Slice

사용자 완료 문장:

> 사용자는 agent, tool, model을 고르지 않고 평소 말로 과업을 끝내며 필요한 결과물과 결정만 본다.

필수 결과:

- 기존 콘솔의 시각 디자인·대화 UX를 기본으로 재사용하고 새 코어에 붙이는 얇은 adapter
- 최소 질문
- 사용자 중심 결과와 artifact
- 필요한 순간의 Preview/Commit/Undo
- 기술 오류 비노출, 부분 성공·미달의 정확한 설명

Non-goals: 콘솔 재디자인. 기존 UI 자체가 사용자 목적 달성을 막는 실제 증거가 있을 때만 해당 부분을
고친다. 기존 `server.js`·`turn.js` 실행 배선은 재사용하지 않는다.

## R5 — Persistent Personal Agent

사용자 완료 문장:

> 새 세션에서도 T5가 명시된 선호와 진행 중인 일을 정확히 이어받고, 사용자는 기억을 대화로
> 확인·수정·삭제할 수 있다.

필수 결과: append-only transcript, compaction, pre-compaction flush, 작은 user core, session search.

## R6 이후 — 증거가 열 때만

전용 파일·웹·브라우저 손, 외부 앱·MCP, 메신저 Gateway, Skills, Learning, Automation,
Multi-agent는 앞 Gate의 실제 병목과 비교 증거가 필요성을 입증할 때 하나씩 연다. 새 능력은 agent loop를
재작성하지 않고 도구 또는 상태 공급자로 붙어야 한다.

## 현재 다음 한 작업

5단계에서 현재 stdin 손으로 실패하는 실제 TTY-only fixture를 먼저 확정한다. PTY가 필요한 경우 검증된
범용 부품을 채택하고, backend는 현재 local 실행으로 불가능한 실제 위치 분리 수요가 확인될 때만 연다.

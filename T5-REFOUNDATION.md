# T5 Refoundation — Single Development Map

상태: `FIRST_COMPLETE`
현재 Gate: `R9-X5-E1 CAPABILITY OUTCOME EVIDENCE — COMPLETE` (사용·결과·비용 사실 결속)

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

상태: `COMPLETE` — 최소 loop·실제 exec·가린 prompt dump·API 키/OAuth 이중 콘솔 연결,
terminal performance·project fix·recovery·artifact 인간 여정까지 사용자 완료 문장 성립.
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
- 관리형 프로세스의 현재 경계: 레지스트리는 실행 중 T5 프로세스 메모리에만 존재해 비정상 crash/restart
  복구는 아직 없음. PTY·TTY 직접 입력은 R2에서 성립, Windows 실제 프로세스 트리 종료는 미측정
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
  독립 읽기 전용 대조와 R4 12턴 실제 자료→artifact→검증→Undo까지 원본 불변으로 성립

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

R1 완료 근거:

- 프로젝트 조사·실패 진단·소스 수정·테스트 재검증: `r1-project-qualification.json` 2/2
- 여러 파일 검색·계산·모호성 정지·실패 후 전환: `r1-terminal-performance.json` 4/4
- 방법 실패·부분 결과·safe retry·PTY·불가능 정지: `r3-recovery-live.json` 5/5
- 산출물 생성·재확인·원본 보존·recoverable Undo: `r4-human-multiturn-live.json` 파일 여정 12/12

## R2 — Truth and Authority

상태: `COMPLETE` — 1단계 Run·Step·Receipt, 2단계 명시적 `process_start` 완료 wake, 3단계
Run 기반 속도 영수증, 4단계 효과·권한 경계가 실제 OAuth·열린 콘솔까지 성립. 5단계 실제 수요 기반
PTY가 실제 OAuth까지 성립. 영속 Run 18개 backend 수요 audit 결과 0건으로 local 유지.

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
- `node-pty@1.1.0` 정확 핀, `pty_start`는 같은 processId·poll·write·resize·stop·wake·effect 계약 사용
- macOS prebuilt spawn-helper 실행 비트는 refoundation postinstall에서 해당 플랫폼 파일만 복구
- 실제 OAuth PTY: `pty_start(running, Enter value:) → write → poll(completed, exit 0, TTY output)`
- `process_control resize`가 실제 `stty size` 24×80 → 40×100으로 반영
- backend demand audit: 영속 Run 18개에서 SSH·Docker·cloud·HPC 실행 위치 요구 0, adapter 미구현

## S1 — Just-in-Time Procedural Skill v0

상태: `COMPLETE` — 사용자가 실측한 `비아이5.txt`와 `비아이5 문서` 탐색 편차가 터미널 손의 결손이
아니라 방법 선택의 편차임을 근거로, R6의 전체 Skills 축보다 먼저 검증 가능한 최소 절차 스킬 slice를 열었다.

사용자 완료 문장:

> T5가 현재 목적에 맞는 짧은 방법을 필요할 때만 읽고, 기존 터미널로 적용하며, 선택·실행·결과를
> 같은 Run에서 다시 확인할 수 있다.

현재 성립한 계약:

- 신뢰된 bundled `refoundation/skills/*/SKILL.md` 한 위치만 사용; 설치·원격·사용자 스킬은 아직 없음
- AgentSkills 핵심 frontmatter `name`·`description`을 `yaml@2.9.0`으로 읽고, 이름과 폴더를 대조
- Run 시작 때 작은 metadata snapshot을 만들고 본문은 모델이 `skill view`를 선택한 뒤에만 문맥에 공급
- snapshot digest와 본문 digest, `skill` requested/actual call, 결과 원문을 기존 ToolReceipt에 그대로 기록
- realpath가 skill root를 벗어난 링크, 잘못된 frontmatter, 64KB 초과 문서를 능력인 척하지 않고 제외
- 스킬 런타임은 실행·검색·판단을 대신하지 않음; 모델이 읽고 기존 `exec`·`process_*`·`pty_*`를 선택
- 첫 `file-discovery`: 제목·확장자 분리, Unicode 정규화, 좁은 범위부터 탐색, 수단 전환, 생성/수정일
  구분, 최종 경로 재관측, 모호성 질문과 미발견 정지를 명령 강제 없이 안내
- 격리 fixture 실제 OAuth 3/3: 확장자 포함 최신 파일, 확장자 미상 제목, 미발견 후 무반복 정지
- 실제 Run: `7b193095-389b-4bdc-862a-1f19f2b658b0`, `89d92799-16e9-4d65-a16d-22a84252aa7a`,
  `4991fdb0-df96-408f-98ea-8a0f740656ce`

측정된 경계:

- 성공 시간 24.0초·22.1초, 미발견 정지 18.1초. 셸 실행은 각 0.1초 안팎이고 대부분은 모델 왕복
- 정확 탐색 두 Run은 skill 1회 + exec 2회 + 모델 4왕복, 미발견은 skill 1회 + exec 1회 + 모델 3왕복
- S1-P1 단일 스킬 A/B 3회·실제 OAuth 18대화: 스킬 없음 9/9, 있음 9/9으로 목적 달성 차이 0
- 같은 9개 과업 합계에서 스킬 있음은 28.2초·모델 5왕복·27,173토큰·exec 3회가 더 들었고,
  절대경로 보고 이득도 1/6에서만 나타나 안정된 효과로 판정하지 않음
- 원인: tool 설명이 주제 일치만으로 `view`를 유도함. 요약과 현재 지식으로 부족할 때만 본문을 열도록
  바꾼 뒤 본문 열람은 9회 중 2회로 감소; `file-discovery` 본문 자체는 고치거나 키우지 않음
- 이 비교는 명시된 작은 작업공간에 한정됨. 사용자가 처음 관측한 `내 컴퓨터에서` 광범위 탐색 실패를
  재현한 증거가 아니므로 스킬 삭제나 전체 파일 탐색 완료로 확대 판정하지 않음
- marketplace, 여러 root 우선순위, hot reload, 요구 binary/platform gating, 스킬 작성·수정, 스크립트 실행,
  자동 학습은 수요가 증명되지 않아 구현하지 않음

## C0 — Canonical Conversation Ledger

상태: `COMPLETE` — user·assistant 최종 답만 남기던 UI transcript와, model/tool 원문을 가진 Run 원장이
분리되어 다음 턴에서 도구 관측이 사라지는 결손을 실제 소스 대조로 확정하고 완전한 세션 원장을 세웠다.

사용자 완료 문장:

> 첫 Run의 도구 결과가 최종 답에 다시 적히지 않아도, 새 턴과 콘솔 재시작 뒤 모델이 그 결과를
> 정확히 이어서 사용한다.

현재 성립한 계약:

- 세션별 0600 append-only JSONL, 단조 sequence와 안정된 messageId
- user, assistant text, assistant tool calls, tool result 원문을 모두 같은 순서로 지속
- 각 message를 `runId`·`toolCallId`와 연결; Run은 실행 증거, Conversation은 다음 Context 정본
- 실행 ToolReceipt는 Run 원장에 먼저 기록하고 Conversation 원장에 같은 관측을 모델 메시지로 기록
- 새 모델 adapter가 이전 Run의 `function_call`·`function_call_output`을 첫 provider 요청에 재생
- 기존 UI 세션은 Conversation 원장이 없을 때 user·assistant 메시지만 한 번 가져오고 이후 재주입하지 않음
- 실제 OAuth: ToolReceipt에만 `C0-OAUTH-7391`, 최종 답은 `확인했습니다.`; 콘솔 재시작 뒤 새 도구 호출
  0회로 `C0-OAUTH-7391` 정확 복원
- 실제 Session `c2e9f667-8a1f-4db1-9a9c-370bcf910c47`, 관측 Run
  `298f1391-760d-4259-a0c6-5beac7adcd5b`, 복원 Run `93f0e637-0e1f-4654-9d02-4fe2df7e9aad`

Non-goals:

- compaction, memory, session search, transcript branch/tree, vector index
- 기존 UI transcript 제거·재디자인

### C0-R1 — Incomplete Tool Call Restart Hygiene

상태: `COMPLETE` — 개발 중단 Session에서 발견된 provider 400을 실제 crash/restart 가능 결손으로 재분류하고
canonical 불변 provider projection repair가 실제 OAuth까지 성립.

- Session `41cbec96-01d4-4691-834e-7579f33d9c89`의 Run
  `91cd9c2e-35c6-427d-8edb-50ed1e91d43a`가 model function call과 `tool_started` 뒤 종료 사건 없이 끊김
- canonical Conversation에는 `call_0mWQV8JidejW2srALmXZFegD` function call만 있고 대응 tool output이 없음
- 이후 같은 Session의 Run 3개가 모두 OAuth 400 `No tool output found for function call`로 실패
- 다음 provider projection은 누락된 call_id에 `interrupted_unknown` tool result를 구조적으로 삽입
- 실행됐다고도 미실행이라고도 하지 않고 `executionKnown:false`; effect 재시도 전 현재 현실 관측을 요구
- canonical Conversation에는 synthetic message를 쓰지 않음
- 실제 OAuth 격리 Session: HTTP 200·Run completed·답 `안녕!`, terminal call 0, canonical synthetic write 0
- 증거: `refoundation/evidence/c0-incomplete-tool-restart-repaired-live.json`

## C1 — Context Projection and Compaction

상태: `COMPLETE` — Context Receipt, 과거 ToolReceipt projection, recoverable large output,
on-demand skill catalog, in-place Conversation Checkpoint v0, 반복 checkpoint와 서버 재시작 뒤 연속성이
실제 OAuth까지 성립.

사용자 완료 문장:

> 원본 Conversation은 모두 살아 있으면서, 긴 대화에서도 T5가 현재 목적·결정·정확한 경로·남은 일을
> 잃지 않고 필요한 Context만 사용해 계속 작업한다.

현재 성립한 계약:

- 두 model adapter가 실제 전송 직전 body에서 instructions·input·tool schema의 UTF-8 byte를 측정
- input은 user/assistant/function call/function output/reasoning 종류별, source는 role별 항목 수·byte 기록
- tool schema는 도구 이름별 byte 기록; prompt·사용자 문장·tool 결과·비밀값 내용은 Receipt에 기록하지 않음
- 각 model_completed 사건에 Context Receipt와 provider usage를 함께 지속하고 `/runs/:id/context`로 재조회
- provider usage가 없으면 token을 0으로 꾸미지 않고 `null`

실제 OAuth 측정:

- 빈 세션 Run `a24cd0d9-5234-4da0-b424-7d7eb1a032c4`: request 10,975 bytes, provider input
  1,879 tokens. instructions 2,713, input 100, tool schema 8,062 bytes
- tool schema 8,062 bytes: skill 4,118, exec 1,011, process_start 1,036, pty_start 996,
  process_control 895. 현재 bundled skill 16개의 metadata가 하나의 skill schema에 포함된 상태
- C0 대화 연속 Run `172736d7-657c-4e17-8d37-bb006631851b`: request 19,348 bytes, provider input
  3,926 tokens. input 8,473 bytes 중 과거 function outputs 6,145 bytes
- 빈 세션 대비 대화 연속 Run은 request +8,373 bytes, provider input +2,047 tokens

C1-P1 historical ToolReceipt projection:

- canonical Conversation과 Run의 full receipt는 그대로 두고, 다음 모델에게 보이는 과거 terminal receipt만
  `t5.historical-tool-receipt.v1`으로 결정론적 변환
- stdout·stderr·state·exit code·process 상태·승인 pending/reason·효과 kind/targets/changed 보존
- command explanation, 시각, duration, 전후 hash 같은 실행 회계 중복 제거
- skill·알 수 없는 도구·해석 불가능한 receipt는 원문 유지; 현재 Run의 tool result도 원문 유지
- 실제 OAuth A/B 2회×성공/실패 2종: full 4/4, projected 4/4, 새 tool call 모두 0,
  canonical receipt 변경 0
- projected 합계 절감: request 15,096 bytes, function output 15,096 bytes, provider input 3,584 tokens;
  호출당 3,774 bytes·896 tokens
- 실제 C0 대화 기본 경로: 메시지가 11→13개로 늘었는데도 request 19,348→14,982 bytes,
  provider input 3,926→2,693 tokens; 값·경로 정확 회상, 새 tool call 0

C1-P2 on-demand skill catalog:

- inline은 모든 skill 이름·설명을 tool schema에 넣고, on-demand는 고정된 `search/list/view` 계약만 노출
- search는 이름·설명의 Unicode 단어를 결정론적으로 순위화해 최대 8개 metadata만 반환; 본문은 view 뒤 제공
- 17개 격리 catalog 실제 OAuth 2회×전문/일반: inline 4/4, on-demand 4/4, terminal call 모두 0
- 첫 skill schema 4,077→471 bytes. 일반 요청은 호출당 request 3,606 bytes·provider input 623 tokens 절감,
  추가 왕복 0
- 전문 절차 요청은 on-demand가 `search→view`로 정확성 유지, 대신 호출당 모델 1왕복·약 646 tokens·2.8초 증가
- 현재 bundled 16개 실제 OAuth: 일반 계산은 skill call 0, schema 471 bytes, provider input 1,166 tokens;
  Apple Notes 요청은 `search apple notes→view apple-notes`, terminal/app 접근 0, 절차 원칙 정확 응답
- 기본 catalog mode를 `on-demand`로 승격; 사용자 skill 본문은 변경하지 않음

C1-Q1 long-session Context pressure qualification:

- historical ToolReceipt projection·on-demand skill 상태에서 독립 세션별 앞/중간/최근 needle 회상
- small 12,000 stdout chars: request 22,847 bytes, provider input 7,697 tokens, 3/3 회상
- medium 60,000 chars: request 70,865 bytes, provider input 28,634 tokens, 3/3 회상
- large 180,000 chars: request 190,847 bytes, provider input 85,921 tokens, 3/3 회상
- stress 540,000 chars·37 messages: request 557,381 bytes, provider input 240,790 tokens, 3/3 회상,
  새 tool call 0, 5.7초
- edge 600,000 chars·41 messages: request 618,349 bytes에서 provider가 context window exceeded,
  HTTP 500·Run failed·새 tool call 0. provider 응답 전 Context Receipt가 실패 Run에 지속됨
- ChatGPT transport HTTP 200 안의 `response.failed` status가 콘솔 HTTP 200으로 새던 결함을 함께 발견;
  400~599만 외부 status로 인정하고 나머지 실패는 500으로 통일

C1-P3 recoverable large tool output:

- canonical Conversation entry가 `messageId`·`runId`·message를 함께 제공하고 원문은 불변
- 과거 stdout/stderr가 8,000자를 넘을 때 head 1,000·tail 1,000·전체/생략 크기·message ref만 projection
- `conversation_recall`은 현재 session projection이 허용한 messageId/stream만 find/read; 원래 명령 재실행 없음
- 작은 출력·현재 Run·skill·unknown/malformed receipt는 원문 유지; 큰 출력이 없으면 recall schema도 미노출
- 실제 OAuth medium: 28,634→10,930 tokens, needle 3/3, recall 3, terminal 0
- large: 85,921→11,218 tokens, needle 3/3, recall 3, terminal 0
- stress 540KB: 240,790→24,865 tokens, needle 3/3, recall 3, terminal 0
- edge 600KB: 기존 context-window 실패→47,228 tokens 성공, needle 3/3. 한 Run에서 ref 10개를 모두
  확인한 비효율은 관측했지만 다른 tier에서 반복되지 않아 미수정
- overflow 660KB: 28,126 tokens, needle 3/3, recall 3, terminal 0
- 기본 large output mode를 `recoverable`로 승격; 단위·경계 111/111, 통합 12/12

C1-Q2 conversation-only Context pressure qualification:

- tool output 0, user·assistant pair만 누적하고 early owner fact·middle decision·recent open work 정확 회상
- small 41 messages·10KB: 4,976 tokens, 3/3, 2.5초
- medium 121 messages·60KB: 22,016 tokens, 3/3, 3.1초
- large 301 messages·180KB: 64,800 tokens, 3/3, 4.2초
- stress 901 messages·540KB: 179,356 tokens, 3/3, 6.3초
- edge 1,001 messages·600KB: 217,972 tokens, 3/3, 7.1초
- overflow 1,101 messages·660KB: 200,991 tokens, 3/3, 7.1초. 반복 패턴의 tokenization/cache 영향으로
  char 크기와 provider token은 단조 비례하지 않아 둘 다 원장에 유지
- extreme 1,301 messages·780KB: request 892,889 bytes, provider input 248,756 tokens, 3/3, 7.3초
- limit 1,501 messages·900KB: request 1,029,089 bytes에서 context window exceeded,
  HTTP 500·Run failed·tool call 0, 실패 전 Context Receipt 지속

C1-C1 In-place Conversation Checkpoint v0:

- provider usage token이 아니라 전송 전 계산 가능한 active Context UTF-8 byte가 750,000을 넘을 때만 발동
- 이 byte는 canonical 영수증 원문이 아니라 C1-P1 ToolReceipt projection·C1-P3 large-output stub을 먼저
  적용한 provider Context에서 계산해, 오래된 도구 영수증을 줄이기 전에 일반 대화를 요약하지 않음
- canonical Conversation message는 한 바이트도 다시 쓰지 않고 checkpoint를 append-only 사건으로 추가
- 오래된 prefix는 180KB 이하 chunk로 요약하고, 최근 약 60KB tail은 canonical 원문 그대로 유지
- exact ID·경로·날짜·수치·현재 목표·사실·결정·제약·약속·실패·미해결 작업 보존을 summary model에 요구
- 여러 chunk는 한 continuity checkpoint로 병합; 빈 결과·tool call·provider 오류면 checkpoint를 기록하지 않고
  기존 full Context로 계속하는 fail-closed 계약
- latest checkpoint + cover 이후 canonical tail에 C1-P1 ToolReceipt projection을 적용해 본 모델에 공급
- checkpoint model call과 Context Receipt도 같은 Run에 지속하되 사용자 답은 본 모델만 작성
- 실제 OAuth: 780KB·900KB·1.02MB 모두 early fact·middle decision·recent open work 3/3 회상,
  본 모델 request 78,252·81,497·78,874 bytes, terminal/tool call 0
- 첫 checkpoint는 6·6·7회 별도 model call을 쓰며 전체 request 합계는 837,168·965,319·1,086,554 bytes다.
  따라서 이번 승격은 속도·비용 개선이 아니라 context-window 실패를 막는 안전선이다
- 기존 900KB request 1,029,089 bytes context-window 실패를 제거했고 1.02MB까지 성공; canonical 원문 불변,
  같은 session identity 유지
- 기본 경로를 `in-place-v0`로 승격; 단위·경계 116/116, 통합 14/14
- 증거: `refoundation/evidence/c1-in-place-conversation-checkpoint-live.json`

C1-C2 repeated/restart checkpoint continuity qualification:

- 기본 `in-place-v0` 경로에서 780KB 대화의 첫 checkpoint를 만든 뒤 서버를 완전히 종료
- 같은 Session 원장에 720KB 새 대화를 누적하고 새 서버가 원장만으로 재개해 두 번째 checkpoint 생성
- 첫 owner fact·첫 decision·첫 open work와 새 decision·새 open work를 최종 답에서 5/5 정확 회수
- 두 Run 모두 terminal·skill call 0, HTTP 200·Run completed; 같은 session identity 유지
- canonical message 2,504개 불변, checkpoint 2개 append-only, coverage가 `first:seed:1205`에서
  `second:seed:1105`로 전진
- 첫/두 번째 본 모델 request 79,689·82,258 bytes; checkpoint model call은 각각 6회
- 증거: `refoundation/evidence/c1-repeated-restart-checkpoint-live.json`

C1 완료 판정: 원본 Conversation을 보존한 상태에서 도구 영수증을 먼저 줄이고, 큰 원문은 필요할 때
재조회하며, 일반 대화는 byte 안전선에서 checkpoint + 최근 tail로 전환한다. checkpoint가 반복되고 서버가
재시작되어도 같은 Session의 이전 사실·결정·미해결 작업을 이어간다.

## R3 — Recovery and Comparative Performance

상태: `COMPLETE` — legacy `흐름 0/10`·`막힘 뒤 전환 0/5` 대비 새 T5 recovery 5/5,
Codex·Claude Code·Hermes 공통 비교 3/3이 실제 격리 과업에서 성립.

사용자 완료 문장:

> 첫 수단이 막히거나 결과가 부족하면 T5가 실패 원문을 보고 다른 명령·CLI·도구로 전환해 끝낸다.

필수 결과:

- 실패 원문과 다음 현실이 모델에게 전달
- 중복 호출 방지와 안전한 retry
- 큰 결과 원본 보존·구간 재조회
- Run 중심 시간·호출·결과 trace
- legacy·Claude Code·Codex·Hermes 비교 harness

완료 Gate: 현재 legacy 실측 `흐름 0/10`, `막힘 뒤 전환 0/5`를 유효 과업에서 명확히 초과.

현재 성립한 계약:

- 일반 command/tool 실패는 원문 receipt를 모델에게 그대로 돌리고 모델이 다른 command·CLI·tool을 선택
- `command did not start`가 명시된 replay-safe transient만 모델이 같은 exact call을 한 번 재시도
- exit 0이어도 `PARTIAL_OBSERVATION`이 있으면 완료로 간주하지 않고 독립 집계 방식으로 전체 재검증
- TTY 요구는 별도 판정 층이 아니라 모델이 `pty_start → write → poll`을 선택해 전환
- 존재하지 않는 목표는 workspace 변경 0, 5회 이하 tool call, 정상 사용자 답으로 정지
- 큰 출력 원문·구간 재조회는 C1-P3, Run 시간·호출·결과 trace는 R2 영수증을 그대로 사용
- 동일 실패에 대한 일반 retry engine·명령 allowlist·정규식 recovery planner를 추가하지 않음

R3 실제 OAuth 5축:

- 방법 불가: 첫 command exit 69 → 다른 Python method → exact path·MEMO, 16.3초
- 부분 결과: partial 경고 → 독립 전체 집계 → BLUE 140·AMOUNT 1,402, 24.2초
- 안전 재시도: no-start exit 75 → exact call 1회 재시도 → 성공, 11.2초
- interaction mode: PTY → 입력 → 완료 출력, 17.8초
- 불가능 정지: 전체 0 match·변경 0·tool 4회 → 부재 답, 23.3초
- 증거: `refoundation/evidence/r3-recovery-live.json`

비교군 대조:

- Codex `0.148.0-alpha.9`, Claude Code `2.1.212`, Hermes `0.20.0`을 동일 격리 fixture와 forced failure로 실행
- 공통 3축(방법 실패·부분 결과·불가능 정지) 모두 T5 3/3, Codex 3/3, Claude Code 3/3, Hermes 3/3
- OpenClaw 최신 소스 `f95b5a006226`: tool 결과 오류를 모델에 보존하고, replay-safe provider 실패만 제한 재시도;
  tool activity 뒤 max-turn/failover 자동 replay 금지. 설치판은 격리 workspace one-shot 부재로 runtime 미측정
- 속도는 T5 16.3/24.2/23.3초, Codex 21.9/26.0/19.3초, Claude 26.2/42.6/18.8초,
  Hermes 218.4/89.3/41.7초. 목적 달성은 동률이며 T5가 비교 범위에서 성능 열세 아님
- 증거: `refoundation/evidence/r3-recovery-comparison-live.json`

Non-goals:

- 모든 실패를 자동 재시도하거나 숨기는 runtime
- 외부 API의 비멱등 효과를 tool receipt 확인 없이 replay
- 호출 횟수만 줄이기 위해 결과 검증을 생략하는 것

## R4 — Conversation Product Slice

상태: `COMPLETE` — 기존 콘솔 디자인을 유지한 채 실제 사용자 표현에서 만든 3개 장기 여정 41턴과
브라우저 UI 감사가 성립. Interaction Intelligence 공통 gap 4개만 기존 model environment에 보완.

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

R4 인간 사용자 시나리오:

- 실제 콘솔 발화와 오너 제품 서술에서 말투·후속 표현을 수집; legacy human-use 문서는 실패 유형 참고만 사용
- 사용자 prompt에 도구명·exit code·정답 식별 코드 0; 정답과 상태 판정은 fixture·Run·파일 snapshot에 숨김
- 18턴 행사 계획: 35→28 정정, 주제 전환·보류, 한 턴 표 예외, 대명사 과잉 해석 정정,
  확정/미정 분리, 급한 3줄까지 computer tool 0으로 통과
- 12턴 파일 여정: 수정 시각+내용으로 최신본 선택, 자료 충돌, 대화 preview, 저장·재확인,
  원본 hash 불변, 휴지통 Undo, 승인 0으로 통과
- 11턴 개인 여정: 전달 매체 최소 질문, macOS 알림 생성·확인·취소, Memory에서 취소 상태 제거,
  새 Session의 취향·과거 작업 회상까지 통과
- 총 41 natural-language turns; 모든 턴 정상 답, 내부 pending/tool/Run 용어 노출 0, false success 0
- 증거: `refoundation/evidence/r4-human-multiturn-live.json`

Interaction Intelligence 보완:

- 기본은 결론과 다음 행동 중심의 가장 짧은 유용한 답; 사용자가 깊이를 원하거나 과업에 필요할 때만 확장
- 계획·초안에서 사용할 사실/출처 선택은 source file 수정 허가가 아님; edit/save/create 등 행동 요청까지 대화 상태로 유지
- T5가 방금 만든 artifact의 Undo는 가능한 경우 영구 삭제보다 trash·backup·inverse operation 우선
- 반복 행동/전달에서 destination·surface·account가 도구 선택을 바꾸면 능력 설명 대신 한 문장 질문
- 비교 근거: OpenClaw `f95b5a006226` concise chat budget·human-facing decision,
  Hermes `9664e386f6` brief action/result·tool-changing ambiguity만 질문·side-effect scope 확인

기존 콘솔 UI 감사:

- 입력창·보내기·Session sidebar·대화 찾기·model ready가 첫 화면에 존재; 답에 내부 Run/tool 용어 0
- 디자인 재작업 필요 없음. 기존 답이 자주 쓰는 `~/Downloads/...`가 링크화되지 않던 gap만 확인
- `~/`·`~\\`를 현재 computer.userHome으로 기계적으로 확장해 Finder/Explorer reveal 계약에 추가
- 증거: `refoundation/evidence/r4-console-ui-audit.json`

격리 시험 사고 기록:

- 첫 알림 fixture의 로그인 shell이 fake PATH를 재설정해 실제 `com.t5.stretch-reminder` LaunchAgent를 잠시 등록
- 같은 시나리오의 취소가 bootout했고 사후 `launchctl print`는 service not found 확인; 실제 사용자 파일 작성 0
- harness를 command-token absolute fake rewrite로 수정하고 독립 probe·재실행에서 fake state만 사용 확인

## R5 — Persistent Personal Agent

상태: `COMPLETE` — canonical Conversation·compaction, P1 pre-compaction memory flush와 작은 user/work
memory, P2 선택·충돌, P3 Session Search가 실제 OAuth까지 성립. Episode·semantic/vector search는 이후 수요 항목.

사용자 완료 문장:

> 새 세션에서도 T5가 명시된 선호와 진행 중인 일을 정확히 이어받고, 사용자는 기억을 대화로
> 확인·수정·삭제할 수 있다.

필수 결과: append-only transcript, compaction, pre-compaction flush, 작은 user core, session search.

### R5-P1 — Pre-compaction Memory Flush v0

비교군에서 채택한 원리:

- OpenClaw `f95b5a006226`: compaction 직전 별도 silent agent turn, daily append-only target 한정,
  같은 compaction cycle 중복 방지, 쓰기 출처와 실패를 본 사용자 답과 분리
- Hermes `9664e386f6`: MEMORY/USER 분리, 작은 bounded store, memory-only isolated review,
  add·replace·remove 사용자 통제, 새 Session의 frozen snapshot
- T5는 daily scratch와 장기 core를 두 벌로 만들지 않고, v0에서 검증할 작은 current memory 원장 하나만 사용

현재 성립한 계약:

- 0600 append-only `memory.jsonl`; `memory_added`·`memory_replaced`·`memory_removed` 사건과 안정된 memoryId
- 현재값은 `user`(사용자 사실·선호)와 `work`(지속할 사실·결정)만 허용; Episode·Skill·transcript는 섞지 않음
- entry 2,000 bytes, 전체 current content 16,000 bytes, 100 items 상한; 정확 중복은 새 사건 없이 기존 ID 반환
- checkpoint summary 완성 뒤 별도 maintenance model이 memory 도구 하나만 사용; 터미널·스킬·외부 도구 없음
- maintenance 호출과 receipt는 같은 Run에 남지만 canonical Conversation에는 넣지 않아 다음 사용자 요청을 오염시키지 않음
- 자동 write는 source에 sessionId·runId·coversThroughMessageId·`pre_checkpoint` origin을 지속
- review 실패·빈 결과·iteration 미완료는 `memory_flush_failed`로 남기고 checkpoint와 본 사용자 답은 계속
- 각 Run 시작 때 bounded current memory를 frozen snapshot으로 공급; data이지 지시가 아니며 현재 요청·현재 현실이 우선
- 본 모델에는 같은 memory 도구의 list·add·replace·remove를 제공해 사용자가 평소 말로 확인·기억·수정·삭제
- `/memory/state`는 current projection, `/memory/ledger`는 append-only 사건을 기존 콘솔에 공급
- 실제 OAuth: 780KB pre-checkpoint 자동 저장 1회, 서버 재시작 새 Session 회상은 tool call 0,
  자연어 replace·remove는 각각 memory tool 1회, 다시 연 Session에서 제거된 기억 부재 확인
- 기본 memory flush mode를 `pre-checkpoint-v0`로 승격
- 증거: `refoundation/evidence/r5-pre-compaction-memory-flush-live.json`

Non-goals:

- Episode, vector/embedding, FTS, session search, 외부 memory provider, memory 관리 UI 재디자인
- 자동으로 Skill을 고치거나 환경 실패·일회 요청·비밀값을 기억하는 것
- memory가 현재 요청이나 새로 관측한 현실을 이기는 것

### R5-P2 — Memory Selection and Conflict

- 780KB 혼합 대화에 durable user preference·work decision과 일회 요청·해결된 오류·assistant 추측·비밀값을
  서로 다른 시점과 role로 배치
- 실제 OAuth maintenance model은 durable 2/2만 user/work로 저장하고 제외 대상 4/4를 저장하지 않음
- 규칙별 정규식이나 코드별 필터 0; 같은 memory-only review 지침과 도구 경계로 판단
- 새 Session에 과거 선호가 공급된 상태에서 현재 요청이 반대로 지시하면 tool call 0으로 현재 요청만 수행
- 증거: `refoundation/evidence/r5-memory-selection-conflict-live.json`

### R5-P3 — Session Search v0

비교군에서 채택한 원리:

- OpenClaw `f95b5a006226`: exact full-text discovery와 bounded history read 분리, user/assistant 기본 검색,
  visible Session·snippet·총 byte 제한, 현재 live context와 생성 scaffolding 제외
- Hermes `9664e386f6`: CJK 검색, Session별 dedup, stable message anchor 주변 read, archived pre-compaction 원문 포함,
  현재 직접 source가 있으면 과거 대화보다 먼저 관측

현재 성립한 계약:

- `session_search` 하나의 `search`·`read`·`browse`; 모델이 발견하고 stable sessionId/messageId로 원문을 다시 읽음
- NFKC·대소문자 정규화와 Unicode/CJK 토큰 AND, exact phrase boost, Session별 최고 hit와 match count
- 기본 discovery는 user/assistant만 검색; terminal/tool 관측이 필요할 때만 `includeTools=true`
- `session_search` 자신의 과거 receipt는 discovery에서 제외해 검색 결과가 자기 자신을 재검색하지 않음
- 현재 Session의 live tail은 제외하고 latest checkpoint가 덮은 canonical prefix만 검색 가능
- archived Session과 checkpoint 이전 원문은 포함, soft-deleted Session은 제외
- C0 이전 canonical JSONL이 없는 Session은 기존 UI user/assistant transcript를 읽기 전용 fallback으로 검색
- search 10 results·500 query chars·300 snippet chars·32KB, read ±20 messages·message 4,000 chars·32KB 상한
- 별도 index가 아닌 canonical JSONL 직접 scan으로 먼저 기능 성립; 파생 index stale/재구축 상태 없음
- 실제 OAuth 122 Session·서버 재시작: archived+checkpoint source를 search 1회 22ms, read 1회 2ms로 복원,
  terminal 0, 정확 경로·tool 값 회수
- 현재 파일과 과거 Session 값 충돌: session search 0, terminal 1회로 현재 파일 값 선택
- 현재 규모에서 scan이 10–24ms였으므로 SQLite FTS5는 병목이 관측될 때 같은 도구 계약 아래 도입
- 실제 실패 기준선: Run `fc14ec1e-6ef6-46d3-bb2d-d204bb9ae2b3`에서 다른 Session을 기억하지 못한다고 답함
- 증거: `refoundation/evidence/r5-session-search-live.json`

R5 완료 판정:

- 긴 한 Session의 원문·압축·재시작 연속성은 C0/C1, Session을 넘는 작은 사실·선호·결정은 P1/P2,
  승격하지 않은 과거 대화·tool 관측은 P3가 담당
- 사용자는 대화로 기억시키고 확인·수정·삭제하며, 과거 대화를 요청하면 exact search 뒤 canonical 근거로 답함
- Memory·Session history 모두 현재 요청과 현재 직접 source를 대신하지 않음

## R6 — Web Hand

### R6-W0 — Search & URL Reality

상태: `COMPLETE` — 읽지 않은 검색 후보와 실제 URL 본문을 분리하고, 일반 웹·네이버 공식 문서·
네이버 공개 플레이스를 실제 OAuth 콘솔에서 관통했다. Browser action과 CU는 포함하지 않았다.

사용자 완료 문장:

> 사용자가 현재 웹 자료를 찾거나 주소를 주면 T5가 후보를 고르고 정확한 페이지를 직접 읽어,
> 출처·최종주소·관측 범위와 함께 답하며 정적 읽기로 못 본 동적 범위는 과장하지 않고 멈춘다.

현재 성립한 계약:

- `web_search`는 OpenAI Responses hosted search의 ranked results를 후보로만 반환; 페이지를 자동으로 읽지 않음
- 활성 OAuth `gpt-5.5`와 별개로 저장된 OpenAI API 연결을 search provider가 사용하며 API key는 모델·오류·원장에 노출하지 않음
- provider 선택·가용성·실패·대안은 사실로 반환하고, 실패한 provider 뒤 다른 provider를 runtime이 몰래 실행하지 않음
- `web_read`는 HTTP(S) 한 주소의 IRI 정규화, private network 차단, redirect chain, 최종 URL,
  content type, canonical URL, 제목, Readability 본문, JSON/XML/text를 관측
- `@mozilla/readability@0.6.0`·`linkedom@0.18.13` 정확 핀, 응답 4MB·결과 64K·redirect 8회 상한
- 본문·검색 snippet은 `untrusted_external`이고 instruction authority 0; 웹 안의 지시를 사용자 지시로 취급하지 않음
- 큰 결과는 total/shown/omitted chars를 분리하고, 로그인벽·rate limit·동적 껍데기·부분 동적·지원하지 않는 형식을 성공과 분리
- 동적 정적관측이 소진됐고 Browser tool이 없으면 capability boundary를 반환; 같은 HTML·JS bundle을 terminal로 반복하지 않고 종료
- 읽기 좋은 주소는 resolver slot이 정함. 네이버 공개 지도·플레이스·검색·블로그는 모바일 SSR 주소를
  선택하되 요청 원주소·선택 전략·실제 redirect·최종주소를 모두 Receipt에 보존
- SPA HTML 안의 균형 JSON hydration(Apollo·Next 등)에서 사람에게 의미 있는 문자열을 bounded 추출;
  item limit·문자 limit 도달을 별도 표기하고 내부 ID·token·image URL은 제외
- 두 도구는 기존 agent loop에 일반 ToolReceipt로 붙어 같은 append-only Run·Conversation에 지속

실제 OAuth 콘솔:

- 정확한 Ncloud 공식 URL 읽기: `web_read` 1회, 5,343자 전부 관측, 2 model turns, 8.7초
- 주소 없는 네이버 이관 공지: `web_search → web_read`, 공식 공지 1순위 선택, 3 model turns, 31.9초
- 데스크톱 네이버 플레이스: mobile SSR + Apollo state, `web_read` 1회로 상호·업종·주소·리뷰·메뉴·가격 분석,
  2 model turns, 22.4초
- 사업주 동적 포털 기준선: boundary 뒤 JS bundle을 17 tool calls·412,079 tokens·153.8초 동안 추적하다 사용자 취소
- 같은 포털 교정 후: `web_read` 1회·2 model turns·5,698 tokens·13.8초, 관측 일부와 Browser 필요 범위를 밝히고 종료
- 증거: `refoundation/evidence/r6-w0-web-reality-live.json`

Non-goals:

- Browser 렌더링·click·type·upload·download, 로그인 세션, CU·화면 전체 조작
- NAVER API HUB·Maps·Commerce credential 연결 완료 주장; provider가 필요한 실제 계정 과업에서 별도 개방
- PDF·오피스 문서 내용을 HTML 본문인 척 처리; 지원하지 않는 content type은 다른 실제 손으로 전환

완료 Gate:

- 검색 후보와 읽은 본문의 기계적 분리
- redirect·canonical·content type·관측 범위·잘림의 정직한 Receipt
- 일반 정적 문서, JSON, 동적 껍데기, 로그인/차단, 네이버 mobile SSR·hydration 반대시험
- 실제 OAuth에서 direct read·search→read·네이버 플레이스 분석·불가능 정지
- 기존 terminal·memory·context·session 영역 회귀 0

### R6-W1 — Browser Observation

상태: `COMPLETE` — W0의 `partial_dynamic` 뒤 실제 격리 브라우저를 렌더링하고, 같은 대화에서
snapshot·screenshot·status·tabs를 Run/Receipt와 기존 콘솔 UI까지 관통했다. CU는 열지 않았다.

사용자 완료 문장:

> 정적 읽기로 부족한 웹페이지는 T5가 전용 격리 브라우저에서 실제 렌더링해 내용을 읽고,
> 요청하면 같은 화면의 캡처를 대화 안에 보여 주며 다음 턴에도 같은 탭을 이어서 관측한다.

현재 성립한 계약:

- 외부 실행 부품 `agent-browser@0.34.0` 정확 핀; Rust/CDP daemon과 시스템 Chrome을 사용하고 T5가 raw CDP를 재구현하지 않음
- 모델에게 보이는 도구는 `browser` 하나, action은 `status·profiles·tabs·navigate·snapshot·screenshot` 여섯 개뿐
- click·type·fill·press·evaluate·upload·download·submit schema 0; desktop/CU·접근성 권한·좌표 조작 0
- T5 전용 namespace, Session ID의 SHA-256 파생 이름, Session별 전용 profile 경로, headless, 자동 dialog 처리 금지,
  10분 idle cleanup을 CLI 인자로 강제; 사용자 Chrome profile·cookie·로그인에 붙지 않음
- passive status는 `session list`만 읽고 브라우저를 새로 띄우지 않음; 실행 중 여부와 tab list는 별도 사실
- tab은 agent-browser stable `tN`과 CDP targetId·title·URL·active를 보존
- snapshot마다 content+refs+tab을 SHA-256 observationId로 묶고 refScope에 observationId·tabId·targetId·URL 지속;
  다른 snapshot의 ref로 승격하지 않음
- compact snapshot은 렌더링된 interactive 구조, full snapshot은 접근성 본문; shown·total·omitted chars와 truncation 분리
- snapshot과 페이지 내용은 `untrusted_external`, instruction authority 0
- screenshot은 T5 관리 폴더의 실제 PNG·bytes·SHA-256만 Receipt에 남김; 픽셀을 모델이 읽었다고 주장하지 않고
  모델 사실은 accessibility snapshot에서 얻음
- screenshot preview URL은 session hash+file UUID의 관리 경로만 허용하고, 외부/data/임의 상대 이미지 금지;
  같은 origin에서 기존 Markdown UI로 렌더링되며 서버 재시작 뒤에도 같은 파일을 다시 엶
- console shutdown은 해당 런타임이 소유한 browser session을 닫고, screenshot과 전용 profile은 영속 상태로 보존

실제 OAuth 콘솔:

- W0 사업주 포털: 정적 351자만 보고 browser 필요 경계에서 종료
- W1 같은 포털 직접 probe: compact 5,355자·145 refs, full 15,642자·잘림 0
- 실제 사용자 핵심 요약: `web_read → browser.navigate`, snapshot 4,902자·138 refs,
  3 model turns·14,553 tokens·15.1초, 불필요 screenshot 0
- 실제 사용자 요약+캡처: `web_read → browser.navigate → browser.screenshot`, snapshot 4,894자·138 refs,
  PNG 919,652 bytes·SHA-256 지속, 기존 콘솔에서 image visible, 4 model turns·18.8초
- 같은 Session 후속 턴: status `running:true`, stable `t1`, 같은 스마트플레이스 URL을 재관측
- 증거: `refoundation/evidence/r6-w1-browser-observation-live.json`

Non-goals:

- click·type·submit·upload·download·결제·발송 등 브라우저 행동과 외부 효과
- 사용자 Chrome/Edge 기존 로그인 세션 연결, cookie import, 비밀번호·OTP 입력
- screenshot pixel vision, CAPTCHA, browser extension, remote/cloud browser, CU

완료 Gate:

- 실제 렌더링 snapshot과 W0 partial_dynamic의 차이 측정
- passive status, managed profile, stable tab/target, snapshot/ref scope, truncation 반대시험
- screenshot 실제 파일·hash·same-origin preview·서버 재시작 지속
- 실제 OAuth 멀티턴에서 동적 페이지 요약→화면 캡처→status/tab 재조회
- action schema 부재와 사용자 profile 미접근
- 기존 terminal·web·memory·context·session 영역 회귀 0

### R6-W2 — Browser Action and Truth

상태: `COMPLETE` — 현재 snapshot의 최신 ref에 결속된 click과 비밀이 아닌 일반 text fill을 실제
격리 브라우저·OAuth 콘솔까지 열고, 효과·권한·사후 관측을 같은 Run/Receipt에 결합했다. CU는 열지 않았다.

사용자 완료 문장:

> T5가 렌더링한 페이지에서 정확히 관측한 대상을 누르거나 일반 문자를 입력하고, 실제로 나간 요청과
> 행동 뒤의 새 화면을 확인해 목적 결과를 답하며, 오래된 대상·비밀·미개방 행동·권한 경계는 실행 전에 멈춘다.

현재 성립한 계약:

- 모델에게 보이는 `browser` 하나에 `click·fill`만 추가; 별도 submit·type·press·evaluate·upload·download action 0
- 행동은 같은 tab의 **최신** `observationId·tabId·ref` 세 값에 결속; 다시 관측한 뒤의 오래된 ref, 다른 tab,
  관측하지 않은 ref는 `actualCall:null·not_executed`
- ref의 접근성 role과 실제 element `type·autocomplete·href·download`를 실행 전에 대조
- password·OTP·결제정보 autocomplete와 `secret_input`은 모델 인자로 입력하지 않고 사용자 통제 입력 경계에서 정지
- 명시적 form submit과 download link는 효과 선언을 높여도 이번 Gate에서 열리지 않음
- 일반 fill도 input event가 요청을 보낼 수 있어 `observe`로 선언할 수 없고 `external_send·external_change`만 허용
- link 관측은 `observe`, button 등 페이지 변경은 최소 `external_change`; 백업 없는 파괴·새 상대 전송·결제는
  기존 exact-call AuthorityStore를 거쳐 승인 전 실제 driver 호출 0
- 행동 직전 network buffer를 비우고, 행동 뒤 같은 tab의 새 compact snapshot과 URL 이동 전후, HTTP(S) 요청의
  method·origin+pathname·resource type·status·MIME만 반환; header·query 값·fragment는 영수증에서 제외
- agent-browser CLI의 `@eN` 표기는 driver 경계에서만 변환하고 T5 원장 ref는 `eN` 유지
- agent-browser는 같은 active tab을 다시 선택하면 ref map을 지우므로, driver가 active tab 사실을 보존해 중복 선택을
  생략; 다른 tab으로 실제 전환했다면 새 snapshot 없이는 기존 latest-ref 계약을 통과할 수 없음
- 행동 결과를 성공 문장으로 만드는 것은 runtime이 아니라 before/after/network Receipt를 읽은 모델

실제 OAuth 콘솔:

- 일반 사용자 요청 `페이지를 열어 coffee 입력, 자동완성 요청과 현재 화면 확인, 제출 금지`:
  `navigate → fill → snapshot`, Fetch `/suggest` 2건·query 값 제거·status 200·입력값 coffee 확인,
  제출 click 0, 4 model turns·21.9초
- 같은 Session 후속 요청 `다음 페이지 링크를 눌러 이동과 새 화면 확인`:
  최신 `t1` ref로 click 1회, `/ → /next`, Document GET 200, 새 heading 관측, 2 model turns·9.9초
- 직접 loopback 실물에서 구현 중 두 결함을 발견해 교정: CLI `@ref` 변환 누락, 같은 tab 재선택의 ref 무효화
- 증거: `refoundation/evidence/r6-w2-browser-action-truth-live.json`

Non-goals:

- submit·upload·download·비밀번호·OTP·결제정보 입력, 사용자 기존 로그인 profile, cookie import
- screenshot pixel vision, CAPTCHA, browser extension, remote/cloud browser, desktop/CU
- 사전 DOM 전수 scan, 사이트별 action 규칙, runtime의 목적 달성 대신 판정

완료 Gate:

- stale/tab/ref 결속과 secret·submit·download 실행 전 정지 반대시험
- browser action의 기존 효과·exact-call 권한 배선과 결제 승인 전 `actualCall:null`
- 실제 driver fill·click, sanitized network, URL·새 snapshot 사후 관측
- 실제 OAuth 멀티턴에서 입력→네트워크·화면 확인→후속 링크 이동
- 기존 terminal·web·memory·context·session 영역 회귀 유지

### R6-W3 — Browser Submit and Confirmation

상태: `COMPLETE` — W2에서 명시적으로 막았던 form submit 한 종류만, 최신 ref·효과·권한·사후검증
계약 위에 열었다. upload·download·로그인 profile·CU는 열지 않았다.

사용자 완료 문장:

> T5가 사용자가 확인한 일반 입력값을 명시적으로 제출하고, 실제 전송과 제출 뒤 화면을 다시 관측해
> 접수 결과를 답하며, 비밀·파일·결제·파괴·새 상대 경계는 제출 전에 멈춘다.

현재 성립한 계약:

- 기존 `browser` action에 `submit` 하나만 추가; 실행 primitive는 agent-browser의 검증된 exact-ref click 재사용
- submit은 같은 tab의 최신 `observationId·tabId·ref`와 실제 `type=submit` control에만 허용
- type=submit을 일반 click으로 누르면 `submit_requires_explicit_action·actualCall:null`; 모델이 효과를 숨긴 채
  우연히 제출하는 경로를 없애고 명시적 submit으로만 실행
- 제출 전 현재 페이지의 password·OTP·신용카드 autocomplete field와 file input 개수를 좁게 관측;
  하나라도 있으면 각각 `secret_input_required`·`upload_action_not_open`으로 실제 click 0
- submit은 최소 `external_send`; observe·local/external change로 낮춰 선언할 수 없고 payment·destructive는
  실제 의미일 때만 허용
- 결제·백업 없는 파괴·새 상대 전송은 기존 exact-call AuthorityStore 승인 전 driver submit 0
- 행동 직전 network buffer를 비우고 실제 POST/GET method·origin+pathname·status·MIME, redirect/navigation,
  새 compact snapshot을 같은 Receipt에 기록; form value·body·header·query 값은 network 영수증에 싣지 않음
- action schema는 정확한 URL/origin만 effect target으로 받으며 요소 라벨을 target 문자열에 덧붙이지 않도록 명시
- 제출 결과의 성공·접수 번호 판정은 runtime이 아니라 post-submit snapshot과 network Receipt를 읽은 모델이 담당

실제 OAuth 콘솔:

- 첫 사용자 턴 `상담 신청 페이지를 열어 여름 식당 입력, 아직 제출 금지`: `navigate → fill`, 실패 호출 0,
  제출 0, 입력값·신청 버튼 재관측, 3 model turns·15.4초
- 같은 Session 후속 턴 `그 내용으로 신청하고 접수 결과·번호 확인`: submit control의 일반 click 1회는
  `not_executed`로 멈추고 모델이 즉시 `submit`으로 전환, 실제 POST `/apply` 200 한 건, `/ → /apply`,
  새 화면의 `신청 접수 완료·W3-2` 확인, 4 model turns·18.7초
- schema target 설명 보강 전에는 URL 뒤 요소 설명을 붙인 fill 1회가 막혔고, 보강 후 같은 변형에서 재발 0
- 직접 loopback tool probe: preflight allowed, POST 1건, 새 observation, 접수 완료 heading, body 원문 노출 0
- 증거: `refoundation/evidence/r6-w3-browser-submit-live.json`

Non-goals:

- password·OTP·결제정보 입력, upload·download, 사용자 기존 로그인 profile·cookie import
- 사이트별 form 규칙, 숨은 API 역추적, CAPTCHA, remote browser, desktop/CU
- submit 선택을 runtime이 대신하거나 실패 없이 한 번에 고르는 규칙 엔진

완료 Gate:

- submit-control/ref/effect와 stale ref, secret field, file input 반대시험
- 일반 click 우회 차단과 payment exact-call 승인 전 `actualCall:null`
- 실제 agent-browser POST·sanitized network·navigation·새 snapshot
- 실제 OAuth 멀티턴에서 fill-only 확인 뒤 후속 submit·접수 결과 판정
- 기존 terminal·web·memory·context·session 영역 회귀 유지

### R6-W4 — User-Controlled Login Continuity

상태: `COMPLETE` — T5 전용 격리 browser profile을 사용자에게 보이는 창으로 넘겨 직접 로그인하게 하고,
자격정보를 모델에 주지 않은 채 같은 T5 Session·profile의 로그인 상태를 browser·콘솔 재시작 뒤까지 이어갔다.

사용자 완료 문장:

> 로그인이 필요하면 T5가 전용 창을 열고 사용자가 직접 비밀번호·OTP를 입력한다. T5는 그 값을 보지 않으며,
> 사용자가 완료를 알린 뒤 실제 로그인 후 화면을 확인하고 콘솔 재시작 뒤에도 같은 상태를 이어 쓴다.

비교군에서 채택한 원리:

- OpenClaw `2026.6.11`: 기존 일상 Chrome이 아니라 전용 `openclaw` profile에서 **manual login**을 권장하고,
  모델에게 credential을 주지 않음
- Hermes `20e01f935b13`: local headed mode에서는 browser를 턴 사이에 유지하고, managed persistence는
  profile-scoped stable identity로 close/recreate 뒤 같은 상태를 사용
- agent-browser `0.34.0`: stable `--session --restore`가 cookie·localStorage를 close·idle·재시작 뒤 복원

현재 성립한 계약:

- `browser`에 `login_start·login_status·login_cancel` 세 handoff 상태만 추가; password·OTP·cookie·storage
  read/write/import action은 schema 0
- `login_start`는 현재 T5 Session의 전용 managed profile을 headed로 relaunch하고 URL·tab metadata만 반환;
  login page content·secret value 관측 0, input owner는 user
- handoff 중에는 `snapshot·screenshot·tabs·navigate·click·fill·submit`을 모두
  `user_control_in_progress·not_executed`; status·profiles·login_status·login_cancel만 허용
- `login_status`는 먼저 password·OTP·신용카드 field 존재만 count하고 값은 읽지 않음. 남아 있으면
  `user_action_required·pageObserved:false`로 사용자에게 다시 넘김
- field가 사라져도 headed 결과만 믿지 않고 profile을 flush한 뒤 headless로 relaunch하고 같은 검사를 다시 수행;
  로그인벽이 돌아오면 snapshot 없이 `continuityEstablished:false`, 통과할 때만 새 observation을 모델에 공급
- secret selector/count 형식 오류, close/relaunch 실패는 없음으로 꾸미지 않고 fail-closed
- 사용자가 취소하면 `login_cancel`이 headed browser를 닫고 handoff state를 해제; 무한 대기 없음
- restore state는 사용자 홈의 `~/.agent-browser`가 아니라 T5 Session root를 전용 HOME으로 사용하고,
  root·하위 directory 0700, state file 0600; symlink가 끼면 실패
- macOS Unix socket 길이 상한을 피하려고 비영속 IPC만 사용자별 0700 `/private/tmp/t5-ab-<uid>`에 분리
- W1–W3 daemon의 옛 autosave 설정이 새 권한을 덮지 못하도록 namespace를 `t5-refoundation-v2`로 올리고,
  periodic autosave는 0; close 시 저장 직후 T5가 권한 강제
- close 직후 daemon socket 정리 경합의 정확한 `Failed to connect: No such file`만 250ms 뒤 한 번 재연결;
  다른 오류와 두 번째 실패는 그대로 반환
- 기존 사용자 Chrome profile·cookie import·credential vault·자동 login·CAPTCHA 우회는 사용하지 않음

실제 OAuth 콘솔:

- 로그인 요청 Run `137a4a24-fb62-46bc-9004-f1f25b5cf317`: `navigate(login page) → login_start`,
  visible 전용 창, tool text null, `pageObserved:false·secretValuesObserved:false`, 3 model turns·17.9초
- 사용자 역할 인증은 T5 tool 밖에서 1회; 실제 계정·비밀번호·OTP 사용 0
- 완료 Run `49db986b-dbac-430a-80a3-997ab2057564`: login_status 1회,
  `/protected·사업자 대시보드`, `secretValuesObserved:false·continuityEstablished:true`, 2 turns·13.1초
- 콘솔 재시작 Run `3172397c-a2ca-4bd7-b58d-e522fc752d8d`: 재로그인 0,
  tabs→navigate로 같은 `/protected·사업자 대시보드`, 3 turns·11.8초
- 실제 v2 Session root 0700, restore state 0600, fixture login 1회
- 증거: `refoundation/evidence/r6-w4-user-login-continuity-live.json`

Non-goals:

- 기존 Chrome/Edge profile attach·복사, cookie/state import·export, 모델 credential 입력, password vault
- CAPTCHA 우회, 자동 2FA, 로그인 성공 규칙 엔진, account recovery
- 새 T5 대화 간 profile 공유, upload·download, remote browser, desktop/CU

완료 Gate:

- headed user handoff 중 model observation/action 0과 cancel 중단선
- secret field 전환 전후 이중 검사와 continuity 미성립 fail-closed
- 실제 managed restore의 browser·driver·콘솔 재시작 연속성
- T5 관리 상태 경로·0700/0600·symlink 반대시험과 비영속 socket 분리
- 실제 OAuth 멀티턴에서 로그인 요청→사용자 handoff→보호 페이지→콘솔 재시작 재진입
- terminal·PTY·web·memory·context·session 전체 회귀 유지

### R6-W5 — Browser File Transfer

상태: `COMPLETE` — download와 upload를 한꺼번에 열지 않고 D1 Download Truth 뒤 U1 Upload Authority를
순서대로 닫았다. 브라우저 파일은 최신 ref·실제 파일·효과·사후 현실이 모두 맞을 때만 성공이다.

사용자 완료 문장:

> T5가 웹에서 받은 파일은 실제 완성 파일과 경로·크기·해시를 확인해 알려 주고, 웹으로 보낼 파일은
> 사용자가 현재 요청에 정확히 지정한 기존 파일 하나만 전송한 뒤 실제 요청과 화면 결과를 확인한다.

비교군에서 채택한 원리:

- OpenClaw `2026.6.11`: download를 managed temp root로 제한하고, upload는 managed inbound file과 exact ref만 허용;
  file chooser upload는 arming/action 경계를 분리
- agent-browser `0.34.0`: `--download-path`와 exact-ref `upload` primitive를 재사용하되 다운로드 완료 파일,
  업로드 source hash·권한·사후 성공 판정은 T5가 담당
- Hermes `20e01f935b13`: 현재 일반 browser tool에는 독립적인 범용 file transfer 계약이 없어 T5가 복제하지 않음

#### D1 — Download Truth

- `browser.download`는 최신 `observationId·tabId·ref`, link/button role, `local_change`, 현재 page URL/origin을 요구
- download control을 일반 click으로 누르면 `download_requires_explicit_action·actualCall:null`
- 모델은 저장 경로·파일명을 정하지 않음; T5 Session별 0700 `downloads/`만 agent-browser `--download-path`로 사용
- click 전후 directory 차이에서 새 파일 하나만 허용; `.crdownload·.part·.tmp`, timeout, 다중 파일,
  64MB 초과, symlink·hardlink·하위 경로 이탈은 성공 금지하고 새 managed partial을 정리
- 파일 크기가 두 번 연속 안정되고 partial이 없을 때만 완성; file mode 0600, bytes·SHA-256·MIME·절대경로 지속
- 다운로드 파일은 `untrusted_external`; 자동 open·execute·parse 0
- agent-browser network 목록이 attachment 요청을 제공하지 않는 실제 경계를 확인. source는 click 전 실제 href를
  tab URL 기준으로 해석하고 origin+pathname만 보존하며 query 값은 제거
- 행동 뒤 같은 tab의 새 snapshot/ref scope를 함께 반환

#### U1 — Upload Authority

- `browser.upload`는 현재 **사용자 요청 문장**에 완전한 절대경로 토큰으로 등장한 파일만 허용;
  substring·상대경로·과거 대화·web content·system event에서 가져온 경로는 불허
- 최신 ref의 실제 element type이 `file`이어야 하며 일반 click은 `upload_requires_explicit_action`
- user file은 final path와 모든 parent가 exact realpath인 regular file, hardlink 1개, 64MB 이하만 허용
- `.env·.npmrc·.pypirc·SSH/GPG key·PEM/KEY/P12/PFX·AWS/Kube credential·agent-browser state` 등
  credential-like file은 사용자가 경로를 적어도 이번 Gate에서 차단
- preflight가 읽은 SHA-256을 실제 upload call에 결속; 명령 직전 불일치면 외부 실행 0,
  명령 뒤 원본 hash·bytes가 바뀌면 성공으로 답하지 않음
- upload는 `external_send`만 허용하고 새 상대(`recipientNew:true`)는 이번 Gate에서 열지 않음
- agent-browser upload 후 sanitized network와 새 snapshot을 함께 반환. network 0은 file input 선택 사실일 뿐
  서버 도착이 아니며, POST status와 사후 화면이 있을 때만 그 사실을 모델이 별도로 판정
- header·query 값·파일 content는 Receipt에 넣지 않고 path·bytes·SHA-256·MIME·trust만 기록

실제 OAuth 콘솔:

- D1 Run `914364e5-d113-4f9f-82cf-2e4322f4d8ca`: `navigate → download`, 실패 호출 0,
  `business-report-4421.pdf`, 33 bytes, PDF, SHA-256, mode 0600, query 제거 source, 3 turns·13.9초
- U1 Run `6aacc11d-0cef-44a2-8aaf-0fc06a7bd166`: `navigate → upload`, 실패 호출 0,
  사용자 지정 `/private/tmp/.../business-profile-6402.pdf`만 선택, 전후 SHA-256 동일,
  POST `/upload` 200·query 제거·fixture 수신 30 bytes·화면 filename 일치, 3 turns·15.7초
- 실제 사용자 파일·계정 사용 0; 모든 file transfer는 격리 fixture
- 증거: `refoundation/evidence/r6-w5-browser-file-transfer-live.json`

Non-goals:

- 여러 파일·폴더 upload/download, background 대용량 전송, resume, archive 자동 해제
- 다운로드 파일 자동 열기·실행·내용 해석, upload 파일 자동 검색·대체·변환
- 새 상대 upload, credential file, 기존 사용자 browser profile import, remote browser, desktop/CU
- Windows 실제 파일 chooser·Explorer 동작 완료 주장

완료 Gate:

- download partial·다중·초과·경로 이탈과 upload path substring·file ref·credential·hash race 반대시험
- 실제 agent-browser download file과 upload POST·사후 snapshot
- 실제 OAuth에서 managed file 영수증과 exact user-path 외부 전송
- terminal·PTY·web·login·memory·context·session 전체 회귀 유지

## R6-W6 — Authenticated Business Workflow Qualification

실제 사용자 자료와 사업자 계정 없이 격리된 사업 운영 fixture에서, 실제 ChatGPT OAuth 모델이 14개의
자연스러운 멀티턴 대화를 종단 수행했다. 이는 **스마트스토어·스마트플레이스 실계정 검증이 아니다.**

종단 계약:

- 비밀번호는 모델이 보거나 입력하지 않고 `login_start → 사용자 입력 → login_status`로 인계
- 오늘 예약·미처리 문의를 구분하고, 동명이인 김민서 2건은 예약번호 확인 전 변경하지 않음
- 과거 세션의 고객 응대 원칙을 반영해 초안 Preview·수정 뒤에만 기존 문의 고객에게 전송
- 페이지 안의 지시 `LEAK-DO-NOT-REPEAT`는 권한 없는 외부 콘텐츠로 취급
- 전송 뒤 같은 문의 화면에서 완료 상태 재확인
- 정산 PDF를 managed 경로로 다운로드하고, 사용자가 다시 적은 정확한 그 경로만 업로드
- 콘솔 재시작 뒤 로그인·문의 발송·업로드 상태를 다시 관측
- 마지막 답에서 실제로 한 일과 예약 변경처럼 하지 않은 일을 분리

실제 OAuth 계측:

- 20/20 논리곱 통과, 14 Runs·41 model turns·27 tool calls·failed 0
- 로그인 1회, 예약 mutation 0, 문의 reply 1회, download 1회, upload 1회
- download/upload 34 bytes·SHA-256 동일, exact path 일치
- 오래된 browser Receipt는 행동·효과·URL·network status·file hash를 남기고 압축하며,
  탭별 마지막 observation의 text·refs만 다음 턴 조작 상태로 보존
- 같은 14 Runs·41 turns·27 calls 기준 provider tokens `592,288 → 460,837`(-22.2%),
  request bytes `2,426,167 → 1,979,747`(-18.4%); canonical Conversation 원장은 변경 0
- 증거: `refoundation/evidence/r6-w6-authenticated-business-workflow-live.json`

Non-goals:

- 실제 네이버·스마트스토어·스마트플레이스 계정의 UI·정책·차단·운영 부하 검증
- 사이트별 selector·규칙 엔진, 실제 고객 전송, 실제 정산 문서 사용
- Windows 실제 브라우저·파일 chooser 지원 완료 주장

## R7-D1 — Document Data Hand

비정형 사업 문서를 서비스별 로봇팔로 만들지 않고, 모델이 터미널에서 쓰는 범용 문서 손으로 세웠다.
비교군·GitHub 조사 결과는 `refoundation/evidence/r7-d0-document-data-toolchain-comparison.json`에 있다.

채택 구조:

- PDF 현실: OpenClaw과 같은 `clawpdf@0.3.0` — PDFium WASM, 텍스트·페이지·회전·크기, 텍스트 없음 경계
- XLSX 현실: `@office-kit/xlsx@0.9.0` 정확 핀 — Node 22+, 순수 Node, OOXML read/write, 병합·숨김·수식 캐시
- 모델 표면: `$T5_DOCUMENT_CLI help|inspect|create-xlsx`; 별도 모델 도구나 의미 규칙 엔진 없음
- 상세 절차: `document-data` Skill은 필요할 때만 출처·충돌·재검산 방법을 공급
- 원본은 읽기만 하고 새 output만 생성; 기존 output은 명시적 `--replace` 없이는 거부

관측 계약:

- file path·bytes·SHA-256·mode
- XLSX sheet state, 셀 주소·typed value·number format, merge master, hidden row/column,
  formula text·cached result·error/missing result, 전체/표시/생략 셀 수
- PDF page count·page number·dimensions·rotation·text·생략량; 추출 텍스트 0이면 `requiresOcrOrVision:true`
- 스캔 문서를 읽은 척하지 않고 실제 OCR/vision이 열릴 때까지 정지

생성·검증 계약:

- 다중 sheet·typed row·source column·formula+독립 계산 result를 받는 일반 workbook 명세
- result 없는 formula는 거부; formula error·missing result를 재개방 관측
- 출력은 0600 임시 파일 뒤 원자적 rename, 생성 직후 같은 관측기로 다시 open
- 의미 정확성은 모델이 원본의 `파일·시트·셀` 또는 `파일·페이지` 출처와 건수·합계를 대조

실제 OAuth 5턴:

- 입력: 병합 제목·숨김 행·수식 XLSX 2개 + 고객 공란이 있는 text PDF 1개
- 사용자 보정: `HANBIT SHOP → 한빛상회`, 고객 없는 배송비는 `미확인`, 전부 KRW 공급가액
- 출력: `통합내역`·`고객별요약`, 5건, 68,300원, 고객별 40,300·25,000·3,000
- 원본 hash 변경 0, 출력 4,668 bytes, formula 13, formula error 0, missing result 0
- 재개방 뒤 exact source·unknown·행 수·고객별/전체 합계 논리곱 18/18 통과
- 직접 내장 CLI 노출 전 custom parser 기준보다 model turns `15→10`, tool calls `10→5`,
  request bytes `946,625→519,575`(-45.1%), provider tokens `257,744→128,851`(-50.0%)
- 증거: `refoundation/evidence/r7-d1-document-data-live.json`

Non-goals:

- `.xls`·`.xlsb`·ODS, 차트·피벗의 시각적 완성, Excel/LibreOffice formula engine 대체
- OCR 완료 주장, 한국어 스캔·손글씨·복잡한 PDF table structure 완료 주장
- 세무 판단·회계 분개·현금흐름 의미를 런타임이 대신 결정하는 규칙 엔진
- Windows 실제 Excel 렌더링·파일 연결 완료 주장

## R8-A1 — Unified Attachment Hand · First Complete

사용자가 콘솔에 파일을 직접 첨부하고 결과 파일을 다시 받는 순환을 닫았다. 내부에서는 수신과 전달을
분리하지만, 둘은 같은 immutable content identity와 append-only Attachment ledger를 쓴다.

Attachment ingress:

- 콘솔 파일 선택·다중 첨부·드래그앤드롭·보내기 전 취소
- 파일별 128MiB, Session별 512MiB, 턴별 10개 상한
- 원래 파일명은 metadata로만 보존; 저장 경로로 사용하지 않음
- magic bytes로 MIME/kind 판별, 0600 object·0700 directory, SHA-256 content-addressed dedupe
- `AttachmentId·Session·Message·Run` 연결은 append-only `t5.attachment-event.v1`
- 다른 Session ID로 조회·다운로드 불가; 현재 턴 image base64는 provider input에만 존재하고 Conversation에는 0

종류별 관측:

- image: PNG/JPEG/GIF/WebP 사실 + 현재 턴 `input_image`; 실제 OAuth gpt-5.5 vision 통과
- text: bounded UTF-8 preview·전체/표시/생략 문자 수, `untrusted_external·instructionAuthority:none`
- PDF/XLSX: R7 Document Data Hand의 page·sheet·cell·formula observation 재사용
- ZIP: 중앙 directory manifest 선관측 뒤에만 별도 managed root로 해제;
  traversal·absolute/backslash path·symlink·encrypted entry·unsupported compression·entry/total size·compression ratio 차단
- audio/video/기타 document: 안전 수신·identity는 완료, STT/video/document extractor 미연결이면
  `contentUnderstood:false` capability boundary. 수신을 이해 완료로 승격하지 않음

Artifact delivery:

- 모델이 workspace에서 요청 결과를 생성·재개방한 뒤 `attachment.register_output`
- workspace 밖·symlink·hardlink·128MiB 초과이거나 현재 요청·이번 Run의 실제 변경 target에 결속되지 않은 결과는 등록 불가
- 등록 결과는 Attachment ledger에서 Run과 연결되고, 콘솔에 파일명·크기·실제 download card로 표시
- download bytes SHA-256가 등록 Receipt와 같을 때만 전달 완료 사실

실제 OAuth 인간형 6턴:

- 빨간 PNG 직접 첨부 → 모델이 `빨간 정사각형` 관측
- 병합·숨김·수식 XLSX 2개 + PDF 1개 + 외부 셸 지시가 든 text 1개 직접 첨부
- 외부 지시 실행 0, 원본 hash 변경 0
- 사용자 의미 보정 뒤 `통합내역·고객별요약` XLSX 생성, 5건·68,300원,
  한빛상회 40,300·새봄상사 25,000·고객 미확인 3,000, exact source·formula result
- output 5,060 bytes, download SHA-256 `3c322c8175ebffa9eb9907bb0b5ae57e97c3cbce05377d0cd6e9f17e8f6851a3` 일치
- 콘솔 재시작 뒤 입력 첨부 5개·결과 artifact·내용·download link 연속
- Attachment 논리곱 15/15, Document 논리곱 18/18, 6 Runs·14 model turns·11 tool calls·failed 0
- 증거: `refoundation/evidence/r8-a1-unified-attachment-live.json`

### 1차 완성 판정

현재 측정된 macOS console lane에서 다음 사용자 순환이 모두 실제로 이어진다.

```
말한다 → 로컬·웹을 관측한다 → 파일을 직접 첨부한다 → 필요한 부분을 읽는다
→ 컴퓨터·웹에서 실행한다 → 결과 파일을 만든다 → 다시 검증한다
→ 콘솔에서 다운로드한다 → 재시작·과거 Session·기억이 이어진다
```

따라서 foundation 기능 추가 단계는 여기서 멈추고 `FIRST_COMPLETE`로 전환한다. 다음 작업은 실제 사용자
알파 사용에서 실패하거나 불편한 Run·Receipt가 공통 결손을 증명할 때만 연다.

Non-goals / honest boundaries:

- STT·음성 의미 분석, 영상 장면/자막 이해, DOCX/PPTX 내용 추출은 아직 연결되지 않음
- TAR·7z·RAR 해제, ZIP64, 암호화 archive는 완료 주장하지 않음
- OCR·손글씨·복잡한 PDF table layout과 Office의 pixel-perfect 렌더링은 별도 실제 수요
- Windows 실제 파일 chooser·drag/drop·download UX는 미측정

## R6 이후 — 증거가 열 때만

브라우저의 미개방 행동, 외부 앱·MCP, 메신저 Gateway, S1 범위를 넘는 Skills, Learning, Automation,
Multi-agent는 앞 Gate의 실제 병목과 비교 증거가 필요성을 입증할 때 하나씩 연다. 새 능력은 agent loop를
재작성하지 않고 도구 또는 상태 공급자로 붙어야 한다.

Foundation closeout 분류:

- 완료: R0·R1·R2·R3·R4·R5, S1, C0·C1 — 현재 측정된 macOS/POSIX console lane
- 플랫폼 후속: Windows 실제 기기의 exec·process tree stop·Explorer reveal·path 현실은 미측정;
  계약/adapter 시험만으로 Windows 지원 완료를 주장하지 않음
- 운영 후속: managed process의 비정상 crash/restart 복구는 없음;
  crash-resilient background work를 제품 약속하기 전 별도 실제 수요·설계 필요
- 수요 대기: remote backend, 더 큰 규모의 SQLite FTS5, existing user-profile import,
  app/MCP,
  channels, automation service,
multi-agent — 현재 foundation 완료를 이유로 자동 개방하지 않음
- 증거: `refoundation/evidence/foundation-closeout-audit.json`

## R9-X1 — Goal-Preserving Capability Handoff

상태: `COMPLETE` — 실제 사용자 Google·Notion 연결 실패에서, 연결 방법을 찾고 시작하는 기능은 섰지만
사용자 준비가 끝난 뒤 원래 부탁을 자동으로 이어가지 못하는 공통 단절을 확인했다. 비교군 대조는
`refoundation/evidence/r9-x0-capability-loop-comparison-2026-08-20.json`에 있다.

사용자 완료 문장:

> T5가 목적 수행 중 설치·로그인·계정 연결 같은 사용자 준비가 필요하면 그 대화에서 한 번만 넘겨주고,
> 사용자가 준비를 마친 사실을 실제로 확인한 뒤 원래 부탁을 다시 말하게 하지 않고 자동으로 이어서 끝낸다.

이미 선 실제 증거:

- `connection`은 모델이 자연어 목적에서 현재 연결·경로·capability·action을 직접 조회하며 표현 사전이 없음
- OAuth와 Google Drive 데스크톱 설치·로그인 화면을 비밀 입력 없이 시작하고, Session별 handoff·취소가 있음
- managed process 완료는 system event를 canonical Conversation에 넣고 같은 Session을 모델이 자동 재개함
- 같은 무진전 연결 결과가 반복되면 대화 내용을 지우지 않는 Recovery가 열림

현재 가장 큰 미달:

- OAuth 완료는 `connection_completed`를 기록하고 카드만 닫으며 원래 사용자 목적의 model wake가 없음
- 설치·로컬 앱 로그인 `user_action`은 화면을 연 뒤 handoff 자체가 끝나, 완료 상태를 이어서 확인하지 않음
- 사용자가 다른 대화로 이동하거나 T5를 재시작하면 준비 중인 로컬 연결을 이어서 관찰하는 계약이 없음

이번 Gate의 최소 변경:

- `connection start·perform`을 같은 Session-scoped capability handoff로 투영
- handoff별 append-only 상태를 `waiting → readiness_observed → completion_recorded → resume_claimed → resumed`로 분리
- 연결 inspector의 `connected·ready` 실측만 완료로 인정하고, 안정된 handoffId로 빠진 상태 전이만 이어감
- 완료 event 뒤 기존 wake와 같은 경계로 모델을 호출해 canonical 원장의 원래 목적을 재검토·재개
- 자동 재개는 과거 tool call replay가 아니며, 기존 pending·approved 권한을 철회하고 현재 현실·권한을 다시 판정
- 현재 Session이 다른 작업 중이면 끼어들지 않고 대기하며, 다른 Session은 계속 사용 가능
- 저비용 inspector만 제한 간격·최대 시간으로 호출하고, 실제 상태 변화 전 model call은 0
- 서버 재시작 뒤 handoff 원장을 읽어 미관측·미claim 단계만 복원; crash-ambiguous effect는 자동 replay하지 않고 재관측 경계에서 정지
- 같은 연결을 기다리는 여러 Session은 handoff를 각각 가지며, 한 readiness 사실 뒤 Session별 최대 한 번 재개
- 사용자는 연결 준비·대기·완료·재개 상태를 대화 카드와 Session activity에서 이해

Non-goals:

- T5 코어 자기 수정, 원격 Skill marketplace, 임의 패키지 자동 설치
- Google·Notion·Calendar 전용 intent 분기 또는 자연어 표현 사전
- 새 vendor connector, 새 Channel, Automation, Multi-agent
- 외부 정책·제품 검증·CAPTCHA 우회, 비밀값의 모델 입력
- 연결되지 않은 상태를 모델 추측이나 열린 창만으로 성공 처리

완료 Gate:

- OAuth 완료와 로컬 앱 준비 완료가 각각 원래 목적을 정확히 한 번 재개
- 연결 전 실제 실행 0, 연결 뒤 capability tool 또는 기존 손으로 사용자 목적 달성
- 다른 대화 사용·같은 대화 재진입·서버 재시작에서 준비 상태와 재개 결과 지속
- 오래된 승인 재사용 0; 재개 Run의 모든 외부 효과는 현재 권한 경계를 새로 통과
- 준비 관측은 bounded interval·timeout·cancel을 가지며 `needs_attention`을 성공으로 승격하지 않고 반복 모델 호출 0
- 같은 연결을 기다리는 두 Session은 한 준비 완료 뒤 서로의 목적·권한을 섞지 않고 각각 최대 한 번 재개
- 기존 Terminal·Web·Memory·Attachment·Messenger·권한·Recovery 전체 회귀 유지

실제 성립한 결과:

- append-only 0600 Capability Handoff 원장에 `waiting → readiness_observed → completion_recorded
  → resume_claimed → resumed`를 분리하고 안정된 handoffId·Session·connection·origin Run을 결속
- 준비 대기는 연결별 저비용 inspector 하나만 bounded poll하며 timeout·cancel 뒤 model call 0
- 같은 연결을 기다리는 두 Session은 준비 행동을 한 번만 시작하고 독립 handoff로 각각 한 번 재개
- 재개 직전 기존 pending·approved 권한을 `capability_resume`으로 철회하고 현재 효과 경계를 다시 판정
- crash 뒤 completed Run은 원장만 마감하고, interrupted·failed·cancelled Run은 자동 replay 없이
  `needs_attention`으로 정지
- fixture 종단 7/7: OAuth, 로컬 앱+서버 재시작, bounded timeout, 다중 Session, crash ambiguity, 원장 불변식
- 실제 ChatGPT OAuth `gpt-5.5`: 자연어 1회 → 준비 행동 1회 → 대기 중 model wake 0
  → readiness 뒤 resume Run 1회 → 새 capability read 1회 → 원래 목적 완료
- 실제 답: `거래처 A 견적 확인`, `오늘 17:00`; Run 2, runtime error 0
- 증거: `refoundation/evidence/r9-x1-capability-handoff-live-2026-08-20.json`

## R9-X2 — Trusted Capability Discovery

상태: `COMPLETE` — 실제 ChatGPT OAuth 모델에게 Asana 연결 목적을 세 표현으로 요청했다. 기존 T5는
등록된 연결이 없다는 사실과 URL 로그인벽을 정확히 확인하고 거짓 실행 없이 멈췄지만, 공식 Asana V2 MCP
후보와 T5 제품 등록이 먼저 필요하다는 blocker는 발견하지 못했다.

사용자 완료 문장:

> T5가 아직 장착하지 않은 능력이 필요한 목적을 받으면, 검증된 후보 정본에서 실제 방법과 현재 준비
> 가능 여부를 찾아 설명한다. 연결할 수 없는 후보는 없는 기능처럼 숨기거나 지금 연결할 수 있는 것처럼
> 꾸미지 않고, 사용자 준비·T5 제품 준비·제공자 승인 중 무엇이 부족한지 구분한다.

실패 원본:

- 실제 `gpt-5.5` 3 Session: connection list 3회, unknown inspect 실패 1회, Asana URL 로그인벽 1회
- 세 경우 모두 Asana 실제 실행·handoff 0으로 진실성은 지켰지만, 공식 연결 후보 발견 0
- 증거: `refoundation/evidence/r9-x2-capability-discovery-baseline-2026-08-20.json`

이번 Gate의 최소 변경:

- bundled·검토된 manifest 한 root만 후보 정본으로 사용; 원격 설치·사용자 manifest는 열지 않음
- 후보마다 공식 출처·연결 종류·capability·현재 blocker·사용자 시작 가능 여부를 작은 metadata로 보존
- 모델이 목적 문장으로 `search`하고 exact id로 `inspect`; runtime 자연어 keyword router는 만들지 않음
- 현재 `connection` 진실과 같은 id가 있으면 실제 connected·ready 상태가 후보 metadata를 이김
- 후보 발견은 설치·연결 성공이 아니며, `canStart:false`이면 handoff와 외부 실행 0
- 후보가 여러 개면 모델이 사용자 목적·현재 환경·blocker를 비교하고 필요한 때만 한 문장으로 상의

Non-goals:

- MCP client·OAuth·Connector 설치와 실제 외부 계정 연결
- Skill·CLI·Plugin 자동 다운로드, 임의 코드 실행, 원격 Marketplace
- 서비스별 intent 정규식, 모든 SaaS 목록, 제공자 정책 우회
- 후보를 모델 prompt에 전부 preload하거나 설정 화면을 카탈로그 관리 UI로 확장

완료 Gate:

- 표현·URL·업무 목적이 다른 Asana 요청 3개에서 같은 official candidate와 blocker 발견
- Asana의 deprecated V1 주소를 추천하지 않고 V2 제품 사전 등록 필요를 정확히 보존
- Figma처럼 T5가 아직 제공자 승인 대상이 아닌 후보를 사용자 로그인 문제로 오인하지 않음
- 현재 연결된 항목과 설치 전 후보를 동일 상태로 표시하지 않음
- 잘못된 manifest·root 이탈 symlink·중복 id·비 HTTPS 출처를 후보로 투영하지 않음
- 미장착 후보 검색 중 model이 terminal·web을 반복하지 않고, 외부 실행·handoff 0
- 기존 R9-X1·Terminal·Web·Memory·Attachment·Messenger 전체 회귀 유지

실제 성립한 결과:

- `refoundation/capabilities/*/capability.json` 한 root의 64KB 이하 HTTPS official manifest만 로드
- id·folder·schema·capability·route·preparation을 검증하고 root 이탈 symlink·비 HTTPS·잘못된 manifest 제외
- `capability_catalog search·inspect·list`는 고정 schema만 preload하고 후보 metadata는 호출 뒤에만 제공
- 현재 connection과 같은 id가 있으면 실제 `connected·ready·needs_*` 상태가 설치 전 후보보다 우선
- bundled 첫 후보 3개: Asana `product_registration_required`, Figma `provider_approval_required`,
  Airtable `generic_mcp_runtime_required`; 모두 `canStart:false`, handoff·외부 실행 0
- Asana는 폐기된 V1 `/sse`가 아니라 공식 V2 `https://mcp.asana.com/v2/mcp`와 사전 등록 필요를 보존
- 실제 `gpt-5.5` 같은 세 표현 재실행: candidate search 3, inspect 2, terminal 0, handoff 0,
  세 답 모두 official candidate와 T5 제품 준비 blocker를 정확히 설명
- URL 사례는 실제 주소 관측 1회를 추가했지만 반복 추적 없이 정지; runtime error·거짓 실행 0
- 증거: `refoundation/evidence/r9-x2-capability-discovery-live-2026-08-20.json`

## R9-X3 — Capability Coordinator Boundary

상태: `COMPLETE` — X1의 사용자 종단은 성립했지만 readiness poll·timeout·다중 Session·resume claim·
crash 판정·취소 전파·재시작 복원이 `console-server.js`에 집중됐다. X4에서 새 연결을 추가하기 전에
Capability 조율을 독립 state provider로 분리한다.

사용자 완료 문장:

> 기존 연결 준비·자동 재개·취소·재시작 경험은 그대로 유지되면서, 앞으로 새로운 연결을 추가해도
> Console Server에 서비스별 상태 조율을 덧붙이지 않는다.

최소 변경:

- `CapabilityHandoffCoordinator`가 poll·timeout·claim·resume·crash·shared cancel·restart recovery 소유
- `CapabilityHandoffLedger`는 append-only 사실 원장 역할 유지
- Console Server는 HTTP·SSE·Session surface와 `executeResume` callback 배선만 소유
- Connection Service는 provider별 inspect·start·await·cancel·tool 생성만 소유
- 상태 schema·사용자 문구·endpoint·Run metadata·기존 실제 모델 결과는 변경하지 않음

Non-goals:

- 새 Connector·MCP·Skill·CLI, 새 사용자 기능과 설정 화면
- handoff 원장 migration·schema 변경, agent loop 재작성
- X1의 권한·crash 의미 완화, 테스트 삭제로 구조 초록 만들기

완료 Gate:

- Console Server에서 watcher·timer·resume state machine 제거를 구조 시험으로 고정
- X1 원장·OAuth·로컬 준비·timeout·다중 Session·restart·crash ambiguity 전부 동일 통과
- 실제 `gpt-5.5` X1 원래 목적 자동 재개와 X2 candidate 발견 결과 유지
- 전체 회귀·legacy import 0

실제 성립한 결과:

- `console-server.js` 2,091→1,861줄; 상태 조율 285줄 제거, callback·배선 55줄만 추가
- `capability-handoff-coordinator.js` 277줄이 poll·timeout·다중 Session·claim·crash·cancel·recovery 소유
- `CapabilityHandoffLedger` schema·endpoint·Session surface·Run metadata 변경 0
- 구조 반대시험이 server 안 watcher·timer·resume state machine 재유입을 차단
- X1 집중 14/14, 실제 `gpt-5.5` 7/7 유지: Run 2, wake 1, capability read 1, 원래 목적 완료
- X2 실제 `gpt-5.5` 3표현 유지: official candidate 3/3, blocker 3/3, handoff·거짓 실행 0
- 증거: `refoundation/evidence/r9-x3-capability-coordinator-boundary-2026-08-20.json`

## R9-X4 — Generic Remote MCP

상태: `COMPLETE` — 별도 개발자 설정 없이 OAuth 2.1 Dynamic Client Registration을 지원하는 Linear를
첫 증명으로 선택해, 후보 발견부터 사용자 로그인·동적 tool 확인·원래 목적 재개까지 범용 계약으로 닫았다.

사용자 완료 문장:

> 사용자가 “Linear를 연결해서 오늘 마감 업무를 찾아줘”라고 한 번 말하면 T5가 공식 후보를 선택하고
> 로그인 화면을 열며, 사용자가 허용한 뒤 실제 도구를 확인하고 같은 대화에서 원래 업무를 자동으로 답한다.

현재 성립한 계약:

- `remote-mcp-oauth`: protected-resource·authorization metadata, HTTPS issuer 결속, DCR, PKCE S256,
  loopback callback, code exchange·refresh·invalid_grant 분리
- `remote-mcp-runtime`: Streamable HTTP, secret token callback, bounded·검증된 dynamic tools/list·call
- `remote-mcp-tool`: list 뒤 exact tool call, readOnly 자동 관측, write/open-world effect 재판정,
  destructiveHint 강화, 외부 content 무권한
- `remote-mcp-connection`: secure store, 연결 중·연결됨·취소·해제, token refresh, tools/list가 실제
  성공한 뒤에만 connected, 연결 전 모델 tool 0
- Linear manifest는 `user_authorization_available·canStart:true`; start-console service 배선 외 core vendor 분기 0
- 공식 live metadata: `https://mcp.linear.app/mcp`, DCR endpoint, PKCE S256, read·write scope 확인
- fixture 인간 여정: 자연어 1회 → OAuth handoff → tools/list → list_issues 1회 → 원래 답, 중복 0
- 실제 `gpt-5.5`: Run 2, remote call 1, error 0, handoff·connected·resumed·목적 완료 전부 통과
- 증거: `refoundation/evidence/r9-x4-remote-mcp-live-2026-08-20.json`

Non-goals / honest boundary:

- 실제 Linear 사용자 계정과 실제 업무 data 검증은 아직 없음
- Asana 사전 등록, Figma provider 승인, Airtable OAuth 앱/PAT를 우회하지 않음
- 임의 MCP URL·사용자 manifest·stdio command 설치, Marketplace, 자동 Skill 설치는 열지 않음
- Notion 고유 workspace identity·CLI file route를 generic 검증으로 낮추지 않음

완료 Gate:

- DCR·PKCE·callback·token·tools/list·read call 반대시험
- 사용자 비밀은 모델·Run·오류·공개 상태에 0
- 후보 발견→연결→X1 resume→목적 완료 fixture·실제 모델
- write·destructive 권한은 기존 R2 경계를 재사용
- 기존 X1~X3·Notion·Google·Terminal·Web·Memory·Attachment·Messenger 회귀 유지

### R9-X4-R1 — Shared Remote MCP Runtime

- Notion의 별도 dynamic tool runtime·tool wrapper를 `remote-mcp-runtime`·`remote-mcp-tool`로 교체
- Notion 고유 OAuth claims·workspace identity 검증·CLI file route·upload 불가 문구는 유지
- Linear와 Notion이 같은 schema validation·annotations·read/write/destructive authority·bounded result 사용
- 집중 12/12; 실제 Notion 계정 tool call은 자동 시험하지 않아 미확인으로 유지
- 증거: `refoundation/evidence/r9-x4-r1-shared-remote-mcp-runtime-2026-08-21.json`

## R9-X5-S1 — Managed Procedural Acquisition

상태: `COMPLETE` — 실행 코드나 임의 URL을 열지 않고, T5가 함께 배포한 검증된 text-only 작업 방법을
사용자 목적 중 필요할 때 관리 상태에 준비하고 같은 턴과 새 Session에서 재사용한다.

사용자 완료 문장:

> 사용자가 반복 업무를 부탁하면 T5가 이미 준비된 방법을 먼저 찾고, 없으면 검증된 방법을 조용히 준비해
> 바로 적용한다. 다음 대화에서는 다시 준비하지 않으며, 제거한 방법은 복원할 수 있다.

현재 성립한 계약:

- `refoundation/skill-packages/*/SKILL.md` 한 trusted root; 64KB·frontmatter·folder·realpath 검증 재사용
- package에서 실행 파일·script·추가 binary를 설치하지 않고 검증된 `SKILL.md` bytes만 0600 복사
- T5 state의 0700 `managed-skills/active·trash`, 0600 append-only lifecycle ledger
- install은 reversible local change, remove는 trash rename, restore는 최신 제거본 복원
- bundled root가 managed root보다 우선하고 같은 이름의 낮은 우선순위 방법은 제외
- install 결과가 method content를 반환해 같은 Run에서 즉시 적용; 다음 Run부터 layered skill snapshot에 포함
- 첫 package `customer-inquiry-triage`: 바로 답변 가능·직접 확인 필요 분리, 사실·추정 분리, draft-only
- 실제 `gpt-5.5`: 첫 Session `skill search → package search → install` 1회; 새 Session `skill search → view`, 재설치 0
- 단위: 0600 설치·제거·복원·layered snapshot; 실제 두 답 모두 사용자 사실과 확인 필요를 정확히 분리
- 증거: `refoundation/evidence/r9-x5-s1-managed-skill-live-2026-08-21.json`

Non-goals / honest boundary:

- 원격 Skill URL·Marketplace·사용자 archive·Git 설치, executable script와 package dependency
- CLI·Homebrew·npm·pip 설치, 시스템 PATH 변경, 관리자 권한, 자동 update
- package가 T5 core·bundled skill을 덮어쓰기

완료 Gate:

- 설치 전 installed skill 우선 검색, trusted package만 준비
- 첫 Run 즉시 적용, 새 Session·서버 재시작 뒤 재사용, 중복 설치 0
- 제거·복원과 mode·digest·lifecycle 원장
- 임의 URL·script·symlink·root 이탈 실행 0
- 기존 X1~X4·전체 기능 회귀 유지

### R9-X5-S2 — Official Skill Catalog Classification

- 2026-08-19 오너 요청으로 비교군 공통 영역을 T5 방식으로 재작성한 15개 초안을 공식 재료로 확정
- 내용 재작성·삭제 없이 SHA-256 15/15 보존; 존재 확인용 “전부 bundled” 시험을 제품 분류 시험으로 교체
- 최소 기본 4: `file-discovery·document-data·nano-pdf·diagrams`
- 환경 감지형 6: `notion·blogwatcher·xurl·apple-notes·apple-reminders·obsidian`
- 개발자 선택형 4: `github-workflow·python-debugpy·node-inspect-debugger·spike`
- 매우 제한적 선택형 3: `himalaya-email·openhue·songsee`; 기본 활성 0, 일반 install은 explicit selection에서 정지
- 기본 root에는 네 개만 남고 나머지 공식 초안은 trusted `skill-packages`에서 필요시 managed 준비
- 기존 `customer-inquiry-triage`는 `official_on_demand`로 같은 lifecycle 사용
- 실제 `gpt-5.5` 준비 1회·새 Session `skill search→view`·재설치 0 유지
- 증거: `refoundation/evidence/r9-x5-s2-official-skill-catalog-2026-08-21.json`

## R9-X5-C1 — Safe Managed CLI Acquisition

상태: `COMPLETE` — 사용자의 시스템 패키지 관리자·전역 PATH·관리자 권한을 건드리지 않고, T5가 검토한
공식 단일 실행 파일을 현재 컴퓨터에 맞춰 준비해 같은 Run과 새 Session에서 터미널 손으로 사용한다.

사용자 완료 문장:

> 필요한 컴퓨터 도구가 없거나 T5 관리본이 더 적절하면, T5가 검증된 도구를 자기 관리 영역에 준비해
> 바로 일을 끝낸다. 다음 대화에서도 다시 설치하지 않으며 제거·복원할 수 있다.

현재 성립한 계약:

- `refoundation/config/cli-catalog.json` 한 trusted manifest만 후보 정본으로 사용; 임의 URL 입력 없음
- id·command·version·official source·license·platform asset·SHA-256을 실행 전에 검증
- HTTPS official single binary만 최대 16MiB까지 streaming download; hash 불일치·과대·중단은 실행 0·활성 파일 0
- 0700 `managed-cli/bin·versions·trash`, 0600 state·append-only lifecycle ledger; symlink root 이탈 거부
- download→SHA-256→실제 `--version` probe→version 보관→managed bin 원자 활성 순서
- install·remove·restore·rollback은 reversible local change이며 sudo·Homebrew·npm/pip global·shell profile 변경 0
- T5가 띄운 exec·managed process·PTY 안에서만 managed bin을 우선하고 사용자 시스템 PATH는 불변
- 첫 후보는 MIT `jq 1.8.2`; macOS arm64/x64·Linux arm64/x64·Windows arm64/x64 공식 자산과 checksum 고정
- 공식 Apple Silicon 실물: hash `2d7534…ca07e`, 계산 `6`, 제거·복원 뒤 `jq-1.8.2`
- 실제 `gpt-5.5`: 자연어 한 번 → catalog search → install 1회 → 같은 Run 실제 합계 `20,300`
- 새 Session: install 0, managed jq 경로 우선 확인 뒤 완료 주문 `2건`·합계 `20,300`
- 전체 회귀 388/388, legacy import 0; Windows·Linux 실제 기기 실행은 미측정
- 증거: `refoundation/evidence/r9-x5-c1-managed-cli-2026-08-21.json`

Non-goals / honest boundary:

- 임의 URL·archive·설치 script·package manager·source build·관리자 권한
- 원격 marketplace, 자동 update polling, 시스템 CLI 교체·삭제, shell profile 수정
- 공식 목록에 없는 명령의 설치 성공 주장, Windows·Linux 실기기 완료 주장

완료 Gate:

- 정확한 platform asset·version·hash 검증 뒤에만 실행
- 첫 Run 즉시 사용, 새 Session·서버 재시작 뒤 재설치 0으로 managed binary 우선 재사용
- 중단·hash 불일치·과대 파일·symlink에서 active binary·외부 쓰기·실행 0
- 제거·복원·이전 검증본 rollback과 lifecycle 원장
- 기존 X1~X5-S2·Terminal·PTY·Web·Memory·Attachment·Messenger 전체 회귀 유지

## R9-X5-E1 — Capability Outcome Evidence

상태: `COMPLETE` — 능력을 준비·호출한 사실과 사용자 목적에 실제로 도움이 된 사실을 섞지 않고,
기존 Run·ToolReceipt·속도·효과 원장을 능력별로 결속해 개선·교체·정리의 근거를 만든다.

사용자 완료 문장:

> 사용자가 “전에 준비한 방법이나 도구가 실제로 쓰이고 있니?”라고 물으면 T5가 설치 개수가 아니라
> 실제 사용 횟수·완료와 실패·최근 사용·시간과 재시도 사실을 확인해 답한다. 증거가 부족하면 유용하거나
> 쓸모없다고 단정하지 않는다.

이미 선 실제 증거:

- Run 원장은 요청·모델 왕복·전체 ToolReceipt·완료·실패·취소·시간·토큰·효과를 지속
- managed Skill은 name·content digest와 install·remove·restore lifecycle을 지속
- managed CLI는 id·version·SHA-256과 install·remove·restore·rollback lifecycle을 지속
- 실제 jq 첫 Run은 prepare 1회·exec 2회·합계 20,300, 새 Session은 prepare 0·exec 2회·같은 결과

현재 가장 큰 미달:

- CLI의 bare command가 실제 managed binary로 해석됐다는 사실이 실행 영수증에 직접 결속되지 않음
- Skill view·CLI 사용·준비 lifecycle과 Run terminal 결과를 능력별로 함께 조회할 표면이 없음
- completed Run·성공 tool call만으로 사용자 목적 달성·품질 향상·폐기 가능을 추측할 위험

이번 Gate의 최소 변경:

- exec·process_start·PTY 실행 시점에 active managed CLI id·version·digest를 exact command에 결속
- 기존 skill view·capability prepare·CLI prepare receipt와 Run terminal 사실을 작은 read-only report로 투영
- capability별 사용 Run·준비 Run·완료·실패·취소·tool failure·시간·model/tool calls·최근 사용만 반환
- 모델이 자연어 목적에서 필요할 때만 list·inspect하고, 사용자에게 내부 원장 용어 없이 설명
- report는 `purposeAchieved`·quality score·improve·retire 결론을 만들지 않고 evidence boundary를 명시

Non-goals:

- 자동 점수·랭킹·A/B 실행, Skill 자동 수정, CLI 자동 update, 능력 자동 비활성·삭제
- 사용자 문장 정규식으로 만족·교정·불만 판정, Run completed를 목적 달성으로 승격
- 새 관리 화면·알림·Marketplace, Core 자기 수정, 모델 없는 lifecycle 결정

완료 Gate:

- 준비만 하고 사용하지 않은 능력을 사용됨으로 세지 않음
- tool 성공 뒤 Run 실패·취소를 완료 효과로 꾸미지 않음
- skill search와 view, CLI system binary와 managed binary를 구분
- 같은 Run 즉시 사용·새 Session 재사용이 capability id·version과 결속
- restart 뒤 같은 report, 비밀·요청 원문·사용자 경로 노출 0
- 실제 일반 사용자 질문에서 모델이 근거와 미확인 경계를 함께 답함
- 기존 X1~X5-C1·전체 기능 회귀 유지

실제 성립한 결과:

- managed CLI의 bare command와 exact managed path만 실행 시점 active id·version·SHA-256에 결속;
  `/usr/bin/jq` 같은 시스템 절대경로는 managed 사용으로 세지 않음
- `skill search`는 사용 0, exact `skill view`만 name·content digest와 사용 Run으로 결속
- read-only `capability_evidence list·inspect`가 최근 200 Run의 준비·사용·완료·실패·취소·시간·호출을 투영
- report는 요청 원문·출력·사용자 경로·비밀을 내지 않고 purpose·quality·satisfaction·retirement 미판정을 명시
- fixture 종단: prepare-only와 use 분리, 실패·취소 보존, restart 뒤 CLI 사용 2 Run·재설치 0 조회
- 실제 `gpt-5.5`: jq 1.8.2로 완료 정산 `2건·232,000원`; exec 2개에 같은 capability digest 결속
- 새 Session의 일반 사용자 질문: evidence list→inspect, 준비 1 Run·사용 1 Run/2회·완료 1·실패/취소 0
- 모델은 표본이 적다고 밝히고 즉시 제거하지 않았으며 lifecycle 변경 tool call 0
- 전체 회귀 394/394, legacy import 0
- 증거: `refoundation/evidence/r9-x5-e1-capability-outcome-evidence-2026-08-21.json`

## 현재 다음 한 작업

Web Hand W0~W6, Document Data Hand D1, Unified Attachment Hand A1까지 완료되어 1차 완성에 도달했다.
다음 한 작업은 같은 목적에서 반복 실패·사용자 교정·대체 방법이 관측될 때만 X5-E2 비교 개선 후보를
여는 것이다. 아직 한 방법의 completed Run만으로 더 낫다거나 폐기 가능하다고 판정하지 않는다. 그 밖의
능력은 기능 목록에서 자동으로 고르지 않는다. 실제 콘솔 사용에서
사용자 과업이 실패하거나 불편하면 해당 Run·Receipt를 읽고 모델·손·방법·권한·UI 중 공통 원인을 확정한 뒤
그 한 축만 연다. 실제 사업자 계정이 준비되기 전에는 Naver 실계정 자격을 완료로 주장하지 않는다.
Windows 실제 기기와 crash-resilient managed process는 각각 플랫폼·운영 트랙으로 유지한다.

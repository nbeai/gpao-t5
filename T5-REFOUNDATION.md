# T5 Refoundation — Single Development Map

상태: `ACTIVE`
현재 Gate: `C1 — Context Projection and Compaction`

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
- crash 중 미완성 tool-call group의 restart hygiene

## C1 — Context Projection and Compaction

상태: `IN_PROGRESS` — 첫 단계 Context Receipt v0가 실제 OAuth까지 성립. 아직 projection·pruning·compaction은 없음.

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

다음 한 작업은 C1-Q2 Conversation-only Pressure Qualification이다. tool output 없이 user·assistant 결정·경로·
미해결 작업을 많은 turn에 누적하고 앞·중간·최근 사실 회상과 provider pressure를 측정한다. 이 조건에서 실제
손실이나 한계가 나타날 때만 summary compaction을 연다. Memory flush는 그 뒤다.

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

전용 파일·웹·브라우저 손, 외부 앱·MCP, 메신저 Gateway, S1 범위를 넘는 Skills, Learning, Automation,
Multi-agent는 앞 Gate의 실제 병목과 비교 증거가 필요성을 입증할 때 하나씩 연다. 새 능력은 agent loop를
재작성하지 않고 도구 또는 상태 공급자로 붙어야 한다.

## 현재 다음 한 작업

C1-P3가 큰 historical tool output의 context-window 실패를 canonical 원문 손실 없이 제거했다. 다음 한 작업은
C1-Q2 Conversation-only Pressure Qualification이다. tool output을 제외한 긴 사용자·assistant 대화에서 실제
손실·비용 급증·provider 한계를 측정한다. 그 증거가 나오기 전에는 summary compaction과 Memory flush를 열지 않는다.

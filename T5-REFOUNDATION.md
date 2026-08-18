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

- 범용 POSIX shell 실행, stdout·stderr·exit code 원문 반환
- timeout·abort·출력 상한·격리 workspace·자격 환경 차단
- `tree-sitter-bash@0.25.1` + `web-tree-sitter@0.26.9` 정확 핀
- WASM 지연 로딩·캐시, 128KB 입력 상한, 500ms 파싱 제한
- command steps·nested context·operators를 같은 ToolReceipt로 모델에게 반환
- 설명기 실패는 실행 능력을 줄이지 않음
- 실제 OAuth 모델: `find` 1단계, `printf/cat` 5단계·sequence 4개 관측, 최종 답 42
- 기존 콘솔 UI → 새 session → 새 agent loop → terminal → OAuth 답 → transcript 지속 실제 관통
- 사용자 콘솔 작업 공간: `~/T5-Workspace` (초기 제한 범위)

영역 상태:

- 프로젝트 조사: 성립
- 실패 진단·소스 수정·테스트 재검증: OAuth 실제 과업 2/2 성립
- 여러 파일 검색·계산: 성립
- 기존 CLI 발견·활용: `npm`·`node`·`python3` 실측
- 실패 결과 뒤 다음 행동: 두 프로젝트에서 실패 재현 → 수정 → 재실행 성립
- 산출물 생성·재확인: 미측정

사용자 완료 문장:

> 격리된 작업 폴더에서 사용자가 자연어로 목표를 말하면 실제 모델이 `exec`를 반복 사용하고,
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

사용자가 `http://127.0.0.1:4174`의 기존 콘솔 UI에서 새 코어를 직접 사용한다. 실제 사용에서 반복되는
터미널 활용 미달을 공통 원인 단위로 개선한다. 테스트 통과 수나 단일 성공 케이스를 성능으로 보고하지
않으며, 실제 홈 전체로 범위를 넓히기 전에는 R2 권한·효과 경계를 먼저 세운다.

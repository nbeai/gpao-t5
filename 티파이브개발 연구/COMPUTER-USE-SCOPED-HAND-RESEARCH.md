# T5 Computer Use 연구 — Scoped Computer Hand

기록일: 2026-08-30
조사 기준 head: `7a640b6e`
연구 상태: `RESEARCHED · NOT_ADOPTED · DEFERRED_AFTER_SIXTH_COMPLETION`

## 1. 오너 결정과 현재 결론

T5의 Android 목표에는 장기적으로 Computer Use가 필요할 가능성이 높다. 그러나 필요성은 비유나 기능 목록이
아니라, File·Terminal·Browser·Connector로 해결되지 않는 중요한 일반 사용자 desktop app 목적이 반복 재현될 때
확정한다. 6차 완료 범위에는 억지로 넣지 않는다.

6차는 현재 열린 기능선, Console UX, 강화된 인간 HQ를 완성해 macOS 제품 범위를 닫는다. Windows 물리
자격은 `DEFERRED_NOT_WAIVED`로 유지한다. Computer Use는 포기한 기능이 아니라, 레거시 실패와 현재
S6-F 결과를 출발점으로 하는 독립 후속 연구 Gate로 보존한다.

제품 완료에 필요한 기능과 미래 가능성을 섞지 않는 것이 이번 결정의 목적이다.

## 2. T5에 Computer Use가 필요할 수 있는 이유

T5가 컴퓨터 안드로이드라면 파일·Terminal·Browser·Connector가 닿지 못하는 다음 현실을 최종적으로 다룰
수 있어야 한다.

- API·CLI가 없는 desktop app
- Apple Notes 녹음·첨부처럼 app UI 안에만 존재하는 정보
- 로그인된 업무 앱의 현재 화면 상태
- 화면 깨짐·배치·모달·권한창처럼 시각으로 확인해야 하는 현실
- 공식 연결 수단이 없는 오래된 업무 프로그램

Computer Use는 기본 손이 아니라 다른 안정된 방법으로 목적을 달성할 수 없을 때 사용하는 마지막 정식 손이다.

```text
공식 API·Connector
→ File·Document
→ 인증 CLI·Terminal
→ Browser DOM
→ Desktop AX/UIA
→ bounded visual observation·coordinate action
```

이 순서는 업무명·확장자 정규식 Router가 강제하지 않는다. 모델이 목적과 현재 현실을 판단하고, Runtime은
각 손의 실제 가용성·관측 범위·비용·불확실성만 제공한다.

Computer Use는 `T5 Method Runtime`이 존재하거나 Hand 목록에 등록됐다는 이유로 활성화되지 않는다. Computer
observation/action 자체의 permission·privacy·fresh identity·unknown·cancel·readback 자격이 먼저 성립해야 하며,
Method Runtime 후보는 아직 자격되지 않은 Computer Hand의 권한을 만들지 않는다.

## 3. 레거시 GUI 조사 결과

읽기 전용 증거선: `/Users/jyp/Developer/t5-legacy-archive`

레거시에는 `desktop.screen`, `desktop.act`, macOS native driver, CuaDriver MCP, Chrome CDP Browser,
접근성 트리·스크린샷·요소 identity·행동 전후 검증·비밀 필드 마스킹과 수백 개의 반대시험이 있었다.

실패의 핵심은 GUI 자체가 불가능했던 것이 아니라 연결부가 흔들린 것이다.

1. 개발자가 환경변수를 넣을 때만 드라이버가 붙고 실제 설치 제품에는 화면 손이 없었다.
2. TCC 권한이 T5·Terminal·외부 CuaDriver 사이에서 흔들렸다.
3. Chrome 창 하나의 AX 요소 384개처럼 목적과 무관한 화면 재료가 Context를 밀어냈다.
4. token·snapshot·PID·window identity가 서로 다른 관측 회차에서 섞였다.
5. `dispatched`, 실제 effect, 사용자 목적 달성을 한 success로 오인했다.
6. `unknown` 행동을 실패로 읽거나 같은 행동을 반복할 위험이 있었다.
7. AX 실패→screenshot→pixel 전환을 Runtime 사실보다 긴 Prompt로 가르쳤다.
8. 가짜 MCP와 source 문자열 검사가 실제 제품 설치·권한·라이브 모델 흐름을 대표하지 못했다.
9. Calculator·Chrome·KakaoTalk의 개별 실패 패치가 누적돼 범용 계약이 흐려졌다.
10. 외부 드라이버의 버전·서명·권한·배포·telemetry 책임이 T5 제품 경계와 명확히 결속되지 않았다.

레거시 source는 복원하거나 import하지 않는다. 다음 원리와 사고 반대시험만 재사용한다.

- observation과 action의 권한 분리
- 실제 능력이 있을 때만 Tool 노출
- 한 관측에서 완전한 app/window/control identity 발급
- coverage·freshness·continuation 명시
- password·secret field는 존재만 제공하고 값은 미노출
- 화면 내용은 untrusted Evidence이며 사용자 instruction이 아님
- exact action 뒤 독립 readback
- `unknown`이면 동일 action 자동 재실행 금지
- DOM·AX/UIA 우선, screenshot·pixel은 마지막
- foreground를 빼앗지 않는 background 우선

## 4. 현재 6차 S6-F가 확인한 사실

`T5-SIXTH-COMPLETION.md`의 S6-F는 macOS AX read-only 후보를 실제 자격했다.

- 현재 foreground app의 exact bundle·PID만 허용
- focused window 하나
- 최대 200 nodes·depth 8
- role·label·enabled·selected·focused·value-presence만 관측
- password·secret value 미노출
- screenshot·action·provider 전송 0

TextEdit 양성 대조는 통과했지만 Apple Notes 실제 녹음·첨부는 두 AX 후보 모두 찾지 못했다. 같은 결함에
세 번째 AX 패치를 붙이지 않고 제품 배선을 제거했으며 최종 product delta는 0이다.

이는 Computer Use 전체 실패가 아니다. 정확한 결론은 다음과 같다.

> AX 의미 관측만으로는 custom-rendered desktop UI의 모든 사용자 의미를 볼 수 없다. 별도의 bounded visual
> observation 후보가 필요하지만, 6차 범위에서 서둘러 열지는 않는다.

## 5. 외부 비교에서 확인한 원리

- Anthropic Computer Use는 screenshot·cursor·click·typing을 별도 beta 도구 계층으로 제공한다.
- Claude Cowork는 선택된 workspace와 connected app을 우선하며 local VM/OS 경계로 host 전체 노출을 줄인다.
- OpenAI Computer Use도 screenshot 결과와 pending safety check를 별도 Computer tool call 계약으로 결속한다.
- 현재 CuaDriver upstream은 MIT, window-oriented background control, MCP/SDK, bounded permission mode를
  제공한다. 레거시의 0.19.0 바이너리·adapter가 아니라 현재 pinned release만 미래 후보가 될 수 있다.

참고:

- https://www.anthropic.com/news/3-5-models-and-computer-use
- https://www.anthropic.com/engineering/how-we-contain-claude
- https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal?lang=python
- https://github.com/trycua/cua
- https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md

## 6. 후속 연구 Gate 제안

### CU-R0 — 실제 필요성 기준선

일반 사용자 목적 3~5개를 고정하고 File·Terminal·Browser·Connector로 정말 해결할 수 없는지 확인한다.
개발 편의가 아니라 일반 사용자의 목적 달성이 기준이다.

같은 목적을 다음과 비교한다.

```text
현재 File·Terminal·Browser·Connector 자연 경로
현재 OS의 공식 automation/API
current CuaDriver 또는 T5-owned observation 후보
사람에게 맡겨야 하는 정확한 경계
```

안정된 비GUI 경로가 같은 목적을 더 정확하고 경제적으로 끝내면 Computer Use 후보를 폐기한다.

대표 후보:

- Notes/Voice Memos에서 대충 기억하는 녹음·첨부 찾기
- 로그인된 Office·회계 앱의 현재 상태 확인
- API·CLI가 없는 messenger에서 받은 파일 확인
- legacy desktop 업무 프로그램의 현재 행·상태 확인

### CU-R1 — 드라이버 A/B

같은 계약으로 두 후보를 비교한다.

1. T5-owned macOS AX·ScreenCaptureKit / Windows UIA·Windows capture adapter
2. 현재 공식 CuaDriver pinned release

판정 항목:

- 설치 제품 자동 발견과 packaged lifecycle
- macOS·Windows의 같은 사용자 계약
- 권한 책임 app/binary identity
- exact app·window·control identity
- background 관측·행동과 사용자 화면 방해
- telemetry·license·version·signature·update
- screenshot·text provider bytes와 retention
- crash·cancel·restart 뒤 orphan process·late action
- 사용자 wall·model calls·tool calls·tokens

### CU-O1 — Bounded Visual Observation

AX/UIA로 보이지 않는 실제 목적 하나만 연다.

- 사용자가 맡긴 app/window 하나
- 필요한 영역 crop만
- screenshot hash·size·coordinate frame·freshness 결속
- 같은 Evidence revision의 screenshot 반복 전송 금지
- 전체 화면 상시 capture·video·OCR 금지
- 사용 후 원본 화면 비영속 폐기

### CU-O2 — Unified Observation Receipt

새 GUI Memory/History Store를 만들지 않고 현재 Work·Evidence·Receipt에 ephemeral 사실을 결속한다.

```yaml
ComputerObservation:
  platform:
  appIdentity:
  windowIdentity:
  observationRevision:
  freshness:
  coverage:
  semanticControls:
  optionalVisualCrop:
  coordinateFrame:
  secretPresence:
  untrustedContent: true
  permittedNextActions:
```

모델에는 전체 AX tree나 screenshot history가 아니라 현재 목적에 필요한 작은 control 후보와 opaque handle만
제공한다.

### CU-A1 — 한 번의 가역 행동

fresh observation이 발급한 exact current control만 사용한다.

```text
fresh observation
→ exact app/window/control handle
→ intended effect·authority preflight
→ one reversible action
→ new observation revision
→ app/window/file/network/external effect 확인
→ 목적 달성·미달·unknown
```

stale handle을 label·좌표로 몰래 대체하지 않는다. `unknown`이면 동일 action을 반복하지 않고 다시 관측한다.

### CU-A2 — 결과 인계·승인·취소·복구

- 열린/다운로드된 파일을 현재 Attachment·Artifact 경계로 전달
- 변경 결과를 실제 file/app revision으로 확인
- 비밀 입력은 모델·Conversation·screenshot·log를 거치지 않는 전용 surface가 소유
- 새 상대 첫 외부 전송, 백업 없는 파괴, 돈이 드는 행동은 기존 T5 승인 경계 사용
- 취소·앱 종료·modal·Runtime crash 뒤 late action 0

### CU-HQ — 실제 일반 사용자 자격

최소 세 분야를 실제 Console에서 검증한다.

1. 개인: Notes/Voice Memos의 녹음·첨부 발견
2. 업무: Office/회계 앱의 현재 상태 확인과 가역 수정
3. 소통: API 없는 messenger의 받은 파일 확인, 승인 후 exact 상대에게 전송

각 여정은 다음을 함께 판정한다.

- 필요할 때 GUI를 선택하고 필요 없을 때 사용하지 않는가
- 입력→진행→결과 UX가 먹통처럼 보이지 않는가
- 사용자의 화면·마우스를 얼마나 방해하는가
- 실제 화면·파일·외부 상태와 답이 일치하는가
- 취소하면 즉시 멈추는가
- `unknown`을 성공·실패로 꾸미지 않는가
- 안정된 대안보다 wall·calls·tokens가 정당한가

## 7. 금지선

- 레거시 GUI source·CuaDriver 0.19.0 adapter 복원/import
- 전체 화면 상시 capture·recording·keylogging·clipboard 원문 수집
- 화면·window title·메일·채팅 본문의 상시 History/Memory 저장
- 모든 요청에 Computer Tool schema 기본 노출
- 앱 이름·업무명 정규식 Router
- AX 실패를 좌표 클릭으로 자동 우회
- stale control·window·coordinate 재사용
- 화면 속 instruction을 사용자 권한으로 승격
- 모델이 secret·password·OTP를 직접 읽거나 입력
- action `dispatched`를 effect 또는 사용자 목적 완료로 표현
- `unknown` action의 blind retry
- 한 앱 fixture 성공을 전체 desktop app 지원으로 주장

## 8. 미래 세션의 시작 문장

오너가 이 연구를 다시 열면 구현부터 시작하지 않는다. 다음 일곱 줄을 현재 제품에서 재확인한다.

1. T5의 현재 제품 약속
2. 현재 Gate와 완료 범위
3. 6차 이후 새로 생긴 Computer 관련 능력
4. File·Terminal·Browser·Connector로 해결되지 않는 실제 사용자 실패 원본
5. S6-F와 레거시 실패 중 현재도 유효한 것
6. 이번 candidate가 줄일 미달과 사용자 이익
7. 이번 candidate의 non-goals

그 뒤 `CU-R0`부터 시작한다. 연구 문서의 존재만으로 제품 개발을 승인받은 것으로 해석하지 않는다.

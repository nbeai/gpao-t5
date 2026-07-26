# GPAO-T5 개발 계획서 v3.0

상태: `development_plan_v3`
날짜: 2026-07-26
목적: 이미 개발된 T5 고유 커널을 재작성하지 않고, OpenClaw/Hermes의 장점 중 현재 T5 실사용 경로에서 부족한 부분만 흡수해 완성도를 높인다.
주의: 이 계획은 과잉 설계, 기능 수 경쟁, 문서만 복잡해지는 개발을 금지한다.

---

## 0. 정체성

GPAO-T5는 AI 모델이 아니다.

T5는 AI 모델의 한계를 보완하고, 모델의 능력을 최대치로 활용하게 하는 운영체제다.

모델이 잘하는 것:

```text
추론
문장 생성
대화 감각
판단
요약
창작
맥락적 표현
```

T5 OS가 맡아야 하는 것:

```text
현재 요청 보존
맥락 admission
자기 상태 파악
도구/연결/권한 구분
실행 가능성 판정
외부 효과 승인
Truth Ledger
실패 복구
반복 작업 학습
세션 지속성
산출물 검증
```

T5는 모델을 억누르는 통제 장치가 아니다.

T5는 모델이 흔들리지 않고, 더 정확하고, 더 안전하고, 더 자연스럽게 일하도록 만드는 운영 조건이다.

Codex가 코드 작업에서 그 증거다. 모델 하나가 개발하는 것이 아니라, 파일, 터미널, 권한, 패치, 테스트, git, 검증 루프가 붙으면서 개발하는 AI가 된다.

T5는 그 원리를 일반 사용자의 일과 생활과 판단으로 확장한다.

## 0.1 제품 포지션

T5의 진정한 역할은 사용자가 하나의 자연스러운 대화로 여러 AI 모델, AI 서비스, 개인/업무 데이터, 앱, 웹을 쉽게 통제하게 해주는 개인 AI 운영체제다.

T5는 또 하나의 AI 서비스가 아니다.

T5는 사용자를 중심에 놓고 다음을 운영한다.

```text
AI 모델 선택과 역할 분담
AI 서비스 연결과 상태 확인
개인/업무 데이터 접근과 기억 반영
앱과 웹 실행 경로
권한과 승인
맥락과 세션 지속성
실패 복구와 다음 행동
```

사용자는 모델명, API, 계정 연결, 파일 위치, 앱 권한, 기억 반영 여부, 자동화 상태를 계속 관리하고 싶어 하지 않는다.

사용자는 이렇게 말하고 싶다.

```text
이거 해줘.
지난번 그거 이어서 해줘.
내 자료 기준으로 봐줘.
이건 보내도 돼.
이건 아직 하지 마.
필요한 앱이나 웹은 네가 알아서 준비해.
```

T5는 이 말을 받아 뒤에서 적절한 모델, 서비스, 데이터, 앱, 웹 경로를 고르고, 위험한 행동은 부드럽게 멈춰 확인하며, 확인된 결과만 사용자가 믿을 수 있게 전달해야 한다.

이 포지션은 기능 확장 명분이 아니다.

앞으로의 개발 판단 기준은 단순하다.

```text
이 변경이 사용자가 AI 모델, 서비스, 데이터, 앱, 웹을 더 쉽게 통제하게 만드는가?
사용자에게 복잡한 운영 부담을 더 떠넘기지는 않는가?
T5의 자연스러운 동반감, 편리, 속도, 안정성, 매끄러운 사용감을 해치지는 않는가?
```

위 질문에 답하지 못하는 기능은 v3.0 범위에 넣지 않는다.

## 0.2 OS 손발 실행층

T5는 AI 모델이 아니다.

따라서 v3.0은 모델이 "무엇이 필요하다"고 판단하는 수준에서 멈추면 안 된다.

T5는 그 판단을 실제 행동으로 이어 주는 손발을 가져야 한다.

여기서 손발은 다음을 뜻한다.

```text
외부 도구 검색
외부 스킬 후보 탐색
앱/웹/파일/채널 연결
도구·스킬 권한과 위험 평가
설치/등록/연결/검증
실행 가능 상태와 화면 상태 일치
실행 결과 원장 기록
실패 시 복구와 대체 경로 제안
해제/삭제/롤백
```

모델이 할 일:

```text
사용자의 의도 이해
필요한 능력 추론
후보 비교와 설명
자연스러운 대화
```

T5 OS가 할 일:

```text
현재 보유 손발 확인
없는 능력의 후보화
연결 가능성 판정
권한·위험·범위 분리
사용자 승인 경계 유지
실제 연결·검증 실행
실행 가능 여부를 SelfState와 도구함에 반영
ToolReceipt / Delivery Ledger / 기억 admission에 근거 기록
실패·해제·삭제·롤백 경로 보장
```

현재 T5에는 이 손발 실행층의 기반이 이미 있다.

```text
ToolRunner
ToolDescriptor / WebToolDescriptor
Toolbox surface
CapabilityResolution
Personal Tool 준비 게이트
ChannelRegistry / ChannelSender
SkillCandidate lifecycle
Memory Admit / Rollback
Delivery Ledger
Authority A0-A3
```

하지만 v3.0에서 보강해야 할 핵심은 더 똑똑한 설명문이 아니다.

핵심은 사용자의 요구에 따라 T5가 필요한 외부 도구와 스킬을 찾고, 후보화하고, 연결하고, 검증하고, 운용할 수 있는 자기 구성 능력이다.

불변식:

```text
추천 ≠ 설치
설치 ≠ 연결
연결 ≠ 실행 가능
실행 가능 ≠ 자동 실행
스킬 활성화 ≠ 외부 행동 승인
검색됨 ≠ 반영됨
해제 ≠ 삭제
실패 ≠ 망가짐
```

이 불변식을 깨는 개발은 편해 보여도 T5의 OS 정체성을 해친다.

---

## 1. v3.0 목표

v3.0의 목표는 T5를 다시 설계하는 것이 아니다.

이미 개발된 T5 커널을 유지한 채, OpenClaw와 Hermes가 강한 영역 중 현재 T5 실사용 경로에서 부족한 것만 흡수해 완성도를 높인다.

절대 목표:

```text
인간과의 동반감
편리함
속도
안정성
자연스럽고 매끄러운 사용감
ChatGPT/Claude급 대화 흐름
모델 능력의 최대 활용
모델 한계의 OS적 보완
```

사용자는 이렇게 느껴야 한다.

```text
말하면 알아듣는다.
대화가 자연스럽다.
필요한 것은 조용히 준비된다.
위험한 것은 부드럽게 멈춰 확인한다.
실패해도 잃은 것과 다음 행동을 안다.
설정이나 기능을 공부하지 않아도 목적에 가까워진다.
T5와 함께 일하고 있다고 느낀다.
```

---

## 2. 이미 있는 것은 다시 만들지 않는다

다음은 이미 T5에 있다. v3.0에서 새로 만들지 않는다.

```text
Work Chat
SelfStateSnapshot
Authority A0-A3
Smart Approval
ActionPlan
Truth Ledger / ToolReceipt
Streaming / EventLog
same-session queue
Completion Contract
Delivery Ledger
ChannelRegistry
ChannelSender
Toolbox 2.0-A/B
CapabilityResolution
Personal Tool 준비 게이트
Automation 후보/승인/tick/retry
Session Search
Memory Admit / Rollback
SkillCandidate lifecycle
User Model Separation
Status Overview
Model Timeout
Provider Adapter / Doctor / Model Connect 일부
Onboarding / Welcome 일부
```

v3.0의 작업은 커널 재작성 아니라 실사용 경로 완성이다.

---

## 3. 현재 출발 상태

현재 확인된 상태(2026-07-26 갱신):

```text
브랜치: main (로컬·원격 모두 main 하나로 정리)
테스트: 421개 전부 pass
산출물 게이트: npm run verify:package 통과
미커밋 변경: 없음
```

**Phase 1(Current Branch Green)은 완료됐다.** 위에 적혔던 4 fail 은 ChatGPT 계정 경로의 기본 모델
기대값 불일치였고, 오너 실계정 E2E 에서 `gpt-5.5` 가 의도된(그리고 유일하게 동작하는) 값임을
확인해 테스트·문서를 갱신했다. `gpt-5.3-codex` 는 계정 경로에서 400 으로 거절된다.

따라서 다음 출발점은 green 복구가 아니라 **v3.1 보강안 §21 Phase 0(부채 상환)** 이다.
근거: `GPAO-T5-DEVELOPMENT-PLAN-v3.1-SUPPLEMENT-2026-07-26-ko.md`

---

## 4. 개발 원칙

각 단계는 하나의 실제 사용자 경로만 닫는다.

```text
1. 사용자 경로 하나를 고른다.
2. 현재 T5가 어디까지 되는지 확인한다.
3. 이미 있는 커널을 재사용한다.
4. 꼭 필요한 작은 변경만 한다.
5. 실패/복구 테스트를 추가한다.
6. 실제 표면에서 확인한다.
7. 사용자가 더 편해졌는지 판단한다.
8. 완료/미완료를 정직하게 보고한다.
```

각 단계는 모델 문장만 보지 않는다.

```text
모델이 판단한 필요 능력이 실제 손발로 이어졌는가?
도구함/상태 표시와 실제 실행 가능 상태가 일치하는가?
연결·설치·검증·실행·기록·복구 중 어디까지 실제로 닫혔는가?
사용자가 설정을 공부하지 않아도 자기 T5를 구성할 수 있는가?
```

새 구조는 아래 조건에서만 만든다.

```text
이미 있는 구조로 사용자 경로를 닫을 수 없을 때.
```

금지:

```text
이미 만든 커널 재작성
OpenClaw/Hermes 기능 수 복제
대형 추상화 선작업
문서만 복잡해지는 개발
테스트만 늘고 사용 경로는 그대로인 개발
정형 문구 시스템
모델의 자연스러운 판단을 OS 계약으로 눌러 죽이는 개발
모델 설명만 좋아지고 실제 손발 실행층은 그대로인 개발
```

---

## 5. 대화 품질 원칙

T5의 커널은 엄격해야 한다.

하지만 T5의 대화는 ChatGPT/Claude급으로 자연스럽고 유연해야 한다.

프로그램이 할 일:

```text
상태 파악
권한 경계 판단
확인/미확인/추정 분리
실패 종류 분류
보존된 상태 기록
다음 안전 행동 후보 제공
내부 진단 비노출
모델에게 필요한 최소 조건 제공
```

모델이 할 일:

```text
현재 맥락에 맞는 첫 문장
설명 강도 조절
사과 여부 판단
질문할지 바로 이어갈지 판단
사용자가 편하게 이해할 표현
자연스러운 마무리
```

실패 조건:

```text
내부 용어가 나온다.
매번 같은 구조로 답한다.
간단한 대화도 작업 지시처럼 답한다.
복구/승인이 공문처럼 보인다.
모델 입력이 OS 계약 설명으로 가득 찬다.
```

---

# Phase 1. Current Branch Green

## 목표

테스트가 깨진 상태에서 새 개발을 하지 않는다.

## 작업

- `gpt-5.5` 변경이 의도된 결정인지 판정
- 의도된 변경이면 테스트/문서 기대값 갱신
- 의도되지 않았으면 코드 복구
- 미커밋 diff 검토
- 전체 테스트 green 복구

## 완료 기준

```text
npm test 전체 통과
미커밋 변경 목적 설명 가능
현재 브랜치 상태 설명 가능
```

---

# Phase 2. Conversational Quality Layer

## 목표

T5 응답이 ChatGPT/Claude급 대화형 AI 서비스처럼 자연스럽게 느껴지게 한다.

## 작업

- 모델 입력에서 내부 계약 냄새 줄이기
- TaskContextPacket을 모델 친화적으로 다이어트
- Conversation Charter 추가
- 응답 모드 분리

응답 모드:

```text
casual reply
direct answer
work continuation
approval ask
recovery
artifact delivery
reflective discussion
clarification
```

## 완료 기준

```text
단순 대화는 빠르고 자연스럽다.
복잡한 작업은 구조가 있지만 딱딱하지 않다.
승인/복구 안내가 정책문처럼 보이지 않는다.
모델 입력은 가볍고 정확하다.
```

---

# Phase 3. First Real Model Path

## 목표

Hermes 대비 핵심 공백인 실제 모델 연결 후 첫 대화를 닫는다.

이미 있는 것:

```text
provider adapter
model doctor
model connection
model timeout
auth/rate/billing 분류
welcome 일부
```

새로 만들지 않을 것:

```text
provider router 재설계
대형 provider marketplace
모델 선택 UI 과잉화
```

## 사용자 경로

```text
T5를 연다.
모델 미연결 상태를 본다.
모델을 연결한다.
doctor가 검증한다.
첫 Work Chat 메시지에 실제 모델이 답한다.
실패하면 auth/rate/billing/timeout을 구분해 복구한다.
```

## 완료 기준

```text
모델 미연결 상태가 정직하게 보임
연결 후 첫 실제 답변 성공
stub처럼 꾸미지 않음
키/토큰/authSignal 노출 없음
대화 품질 기준 통과
```

---

# Phase 4. First-Run Experience

## 목표

OpenClaw/Hermes의 온보딩 장점을 T5답게 최소 흡수한다.

새로 만들지 않을 것:

```text
대형 setup wizard
모든 채널 연결 마법사
제품 투어
```

## 사용자 경로

```text
처음 실행한다.
T5가 가능한 것과 필요한 것을 짧게 알려준다.
모델 연결 또는 건너뛰기를 선택한다.
연결하면 첫 대화로 간다.
건너뛰면 계속 조르지 않는다.
```

## 완료 기준

```text
첫 사용자가 설정판에서 헤매지 않음
미연결인데 연결된 척하지 않음
건너뛰기 가능
연결 후 바로 대화 가능
첫 안내가 자연스럽고 부담스럽지 않음
```

---

# Phase 5. One Real Channel Path

## 목표

OpenClaw 대비 채널 공백을 채널 수가 아니라 실제 경로 하나로 닫는다.

이미 있는 것:

```text
ChannelRegistry
ChannelSender
Channel status
outbound approval
Delivery Ledger
inbound gate
```

새로 만들지 않을 것:

```text
채널 20개 복제
channel marketplace
완전한 multi-agent routing
```

## 1차 선택

Telegram 또는 Slack 중 하나.

## 사용자 경로

```text
채널을 연결한다.
허용되지 않은 발신자는 처리하지 않는다.
허용된 발신자 메시지만 turn으로 들어온다.
T5가 답변 후보를 만든다.
외부 전송은 승인 전 멈춘다.
승인하면 전송한다.
성공/실패가 ledger에 남는다.
```

## 완료 기준

```text
unknown sender 차단
allowed sender만 처리
전송 전 승인
보낸 척하지 않음
delivery ledger 기록
최소 1개 채널 실경로 검증
```

---

# Phase 6. Install / Local Runtime

## 목표

개발 트리가 아니라 사용자가 실행 가능한 T5로 만든다.

이미 있는 것:

```text
server
health
doctor 일부
package bin/files 일부
zero-build 구조
```

새로 만들지 않을 것:

```text
복잡한 daemon 관리자
OS별 full installer
GUI companion app
```

## 사용자 경로

```text
T5를 설치하거나 실행한다.
명령 하나로 서버가 뜬다.
상태 확인이 된다.
문제가 있으면 doctor가 알려준다.
재시작 후 연결/세션이 복원된다.
```

## 완료 기준

```text
사용자 실행 경로 존재
health/status 확인 가능
doctor가 실제 문제를 구분
재시작 후 핵심 상태 복원
산출물 실행 검증
```

---

# Phase 7. Learning Polish

## 목표

Hermes의 학습 장점을 이미 있는 T5 구조로 체감되게 만든다.

이미 있는 것:

```text
Session Search
Memory Admit/Rollback
SkillCandidate lifecycle
User Model Separation
Automation candidate
TaskTrace / DefaultTarget
```

새로 만들지 않을 것:

```text
대형 벡터 DB
자동 스킬 생성 시스템
사용자를 모르게 바뀌는 memory engine
```

## 사용자 경로

```text
같은 일을 반복한다.
T5가 반복 패턴을 후보로 제안한다.
사용자가 승인한다.
다음 같은 요청에서 질문이 줄어든다.
언제든 되돌릴 수 있다.
외부 효과는 여전히 승인받는다.
```

## 완료 기준

```text
실제 반복 작업 1개에서 "배웠다"는 체감
승인 전 영향 없음
승인 후 편해짐
되돌리기 가능
A2/A3 우회 없음
제안 문장이 부담스럽지 않음
```

---

# Phase 8. Automation Polish

## 목표

이미 있는 자동화 구조를 실제 사용 경로로 닫는다.

이미 있는 것:

```text
automation candidate
approve
tick
trusted runtime token
retry/backoff
expiry/cancel
ledger
```

새로 만들지 않을 것:

```text
대형 automation center
복잡한 workflow builder
무인 외부 전송 기본값
```

## 사용자 경로

```text
반복 작업을 요청한다.
T5가 자동화 후보로 제안한다.
사용자가 승인한다.
정해진 tick에서 실행된다.
실패하면 재시도/중지 기준을 따른다.
사용자가 취소할 수 있다.
```

## 완료 기준

```text
후보 -> 승인 -> 실행 -> 실패/재시도 -> 취소 확인
외부 전송 자동화는 더 강한 승인 유지
무한 반복 없음
상태가 overview/doctor/ledger에 보임
```

---

# Phase 9. Output Canvas Minimal

## 목표

HTML-native Output Canvas를 대형 제작툴이 아니라 최소 산출물 경로로 검증한다.

이 Phase는 앞 단계가 안정된 뒤에만 한다.

새로 만들지 않을 것:

```text
full design tool
video editor
marketplace
복잡한 DSL
```

## 사용자 경로

```text
안내문/리포트/랜딩 중 하나를 요청한다.
T5가 HTML/CSS/JS draft를 만든다.
브라우저에서 preview한다.
수정한다.
export 또는 저장한다.
외부 게시/전송은 승인받는다.
```

## 완료 기준

```text
1종 산출물 end-to-end
브라우저 렌더 확인
출처/asset receipt
외부 게시 무승인 없음
완료 주장 전 preview 확인
```

---

# Phase 10. Release Readiness

## 목표

실제 산출물 기준으로 v3.0을 닫는다.

## 검증

```text
전체 테스트
산출물 실행
첫 실행
첫 실제 모델 대화
대화 품질 시나리오
최소 채널 경로
최소 학습 경로
최소 자동화 경로
실패 복구
secret 미노출
rollback 안내
```

## 완료 기준

```text
소스 테스트 통과
산출물 실행 검증
새 환경 첫 대화 검증
실패/복구 검증
대화 품질 검증
검증/미검증 범위 정직 보고
```

---

## 11. v3.0에서 하지 않는 것

```text
OpenClaw식 전체 채널 수 복제
Hermes식 full TUI 복제
대형 plugin marketplace
대형 Project OS
대형 Canvas 제작툴
새 memory engine
새 provider router 전면 재작성
권한/원장/자동화 커널 재작성
T-cell 이론 확장
대화 품질을 빌미로 템플릿 문구 시스템 만들기
```

---

## 12. 최종 수용 테스트

v3.0은 아래 시나리오로 판정한다.

```text
1. Current Branch Green
2. 잡담/상담/실무 요청의 자연스러운 대화 품질
3. 모델 미연결 -> 연결 -> 첫 실제 답변
4. 첫 실행 -> 안내 -> 건너뛰기 또는 연결
5. 채널 연결 -> inbound -> approval -> outbound -> ledger
6. 반복 작업 -> 후보 -> 승인 -> 질문 감소 -> rollback
7. 자동화 후보 -> 승인 -> 실행 -> 실패/재시도 -> 취소
8. 산출물 요청 -> preview -> 수정 -> export
9. timeout/auth/rate limit/disconnected/expired approval 복구
10. 산출물 기준 release 검증
```

---

## 13. 최종 판정

v3.0이 끝났을 때 이렇게 말할 수 있어야 한다.

```text
T5는 이미 만든 고유 커널을 유지한 채,
실제 모델 연결, 자연스러운 대화 품질, 첫 사용 경험, 최소 채널, 설치/실행,
학습 체감, 자동화 체감, 최소 산출물 경로를 닫았다.

OpenClaw와 Hermes의 장점은 기능 수 복제가 아니라
T5의 자연스러운 사용자 경로 안으로 흡수되었다.

T5는 AI 모델이 아니라,
AI 모델의 한계를 보완하고 능력을 최대치로 활용하게 하는 운영체제로 작동한다.

사용자는 더 덜 헤매고,
더 빨리 목적에 도달하며,
실패해도 안심하고 이어갈 수 있고,
무엇보다 T5와 자연스럽게 대화하며 함께 일한다고 느낀다.
```

이 문장을 실제 검증 근거로 말할 수 없으면 v3.0은 끝난 것이 아니다.

---

## 14. 과잉 개발 방지 주의 사항

v3.0은 고난도 연구개발이 아니라, 이미 만들어진 T5의 실사용 완성도를 높이는 고정밀 제품 마감이다.

개발 난이도보다 중요한 것은 절제력이다.

난이도 판정:

```text
개발 난이도: 중간 이하
판단 난이도: 높음
검증 난이도: 중간 이상
과잉설계 방지 난이도: 높음
```

가장 큰 위험:

```text
이미 있는 걸 또 만들기
흥분해서 구조 키우기
OpenClaw/Hermes 기능 수 따라가기
대화 품질을 템플릿으로 해결하려 하기
테스트만 보고 실제 사용 경로를 안 보기
```

작업 중 아래 신호가 나오면 즉시 멈추고 줄인다.

```text
새 객체가 늘었는데 사용자 경로가 나아지지 않았다.
문서 이름은 늘었는데 화면은 더 복잡해졌다.
테스트는 늘었는데 실제 사용은 느려졌다.
자연스러움을 위해 템플릿 문구가 늘었다.
도구함, 게이트웨이, 캔버스, 자동화를 한 번에 만들려 한다.
OpenClaw/Hermes 기능 수를 맞추려 한다.
모델 입력이 내부 계약 설명으로 가득 차 대화가 딱딱해졌다.
```

v3.0의 성공은 구조의 완성도가 아니라, 사용자가 덜 헤매고 더 빨리 목적에 도달하며, 실패해도 안심하고 이어갈 수 있고, T5와 자연스럽게 함께 일한다고 느끼는가로 판정한다.

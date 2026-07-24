# GPAO-T5 UI/UX Reference Seal Audit

- Status: `conditional_pass`
- Date: 2026-07-24
- Auditor: Codex
- Audited commit: `43da314`
- Target:
  - `GPAO-T5-UIUX-REFERENCE-SEAL-2026-07-24-ko.md`
  - Phase 5 Work Chat T3-DNA UI implementation
  - `design/WORK-CHAT-DESIGN-EVIDENCE-2026-07-24-ko.md`

## 0. 판정

`조건부 통과`.

UI/UX Reference Seal 자체는 방향이 맞다. 사용자 지시였던 **T3/OpenClaw/ChatGPT/Claude/Codex/Claude Code
참조 표면을 UI/UX 관점으로 해부하고, 복제가 아니라 T5 기관으로 재구성한다**는 요구를 문서가 받아냈다.

Work Chat 구현도 첫 슬라이스 대비 크게 좋아졌다. 데스크톱 첫 화면은 T3의 구조적 DNA인 조용한 사이드바,
넓은 채팅, 하단 입력, 작은 상태칩을 실제로 보여준다.

다만 **디자인 봉인**으로 닫기에는 아직 두 가지가 남았다.

1. 375px 모바일 캡처에서 하단 입력 영역 오른쪽이 잘려 보이고 `보내기` 버튼이 보이지 않는다.
2. 디자인 evidence 문서가 “스크린샷을 저장소에 커밋할 수 없다”고 적었지만, Codex 감사에서 실제 PNG 캡처가 가능했다.

따라서 Reference Seal 문서 방향은 통과시키되, Work Chat 표면 봉인은 모바일 입력 영역 수정과 실제 시각 증거 보강 후
다시 닫는다.

## 1. 직접 확인한 것

Codex가 직접 확인한 항목:

- `npm test`: 40개 테스트 모두 통과.
- 로컬 서버 실행: `PORT=4329 npm start`.
- HTTP 경로:
  - `GET /`: Work Chat HTML 반환.
  - `POST /turn` 슬랙 게시 요청: A2 승인 카드 상태 반환.
  - `POST /turn` approve: 보관된 계획을 이어받아 `슬랙에 게시했어요` 반환.
  - 메일 발송 불가: 확인으로 둔갑하지 않고 `unconfirmed` 처리.
  - 차단된 페이지: blocked/unconfirmed + 다음 행동 처리.
- 상태칩 ready 값: `웹 자료 수집`, `로컬 파일`, `슬랙 게시` 라벨로 반환. raw id 비노출.
- 데스크톱 초기 화면 PNG 캡처:
  - `design/evidence/2026-07-24-codex-audit/workchat-desktop-initial.png`
- 모바일 초기 화면 PNG 캡처:
  - `design/evidence/2026-07-24-codex-audit/workchat-mobile-initial.png`

## 2. 통과 근거

### 2.1 Reference Seal 방향

문서는 다음을 올바르게 고정했다.

- T3 실제 화면은 복제 대상이 아니라 기준 샘플.
- OpenClaw는 런타임 정체성/스키마가 아니라 구조적 DNA만 흡수.
- ChatGPT/Claude의 자연 웹챗 껍질 위에 Codex/Claude Code급 기능을 얹는다.
- 상태칩, 승인카드, 근거토글을 Kernel Contract 필드의 화면 번역으로 묶었다.
- raw id/path/schema/provider error 기본 화면 노출 금지.

### 2.2 Work Chat 데스크톱 화면

데스크톱 초기 화면은 방향이 좋다.

- 좌측 사이드바가 조용하다.
- 중앙은 비어 있는 넓은 채팅면이다.
- 하단 입력창이 안정적으로 보인다.
- 상태칩은 작고 우측에 접혀 있다.
- 개발자 대시보드 느낌이 아니라 생활형 AI 채팅 도구에 가깝다.

## 3. 조건부 보완 지시

### 3.1 모바일 입력 영역 잘림

감사 캡처:

- `design/evidence/2026-07-24-codex-audit/workchat-mobile-initial.png`

375px 폭에서 하단 입력 영역 오른쪽이 잘려 보인다. `보내기` 버튼이 보이지 않고, 하단 상태 문구도 오른쪽에서
잘리는 형태다.

이건 작은 미감 문제가 아니라 사용자 경로 문제다. 모바일에서 전송 버튼이 보이지 않으면 Work Chat first 원칙이 깨진다.

보완 지시:

- 모바일에서 입력창, `보내기` 버튼, 상태행이 모두 화면 안에 들어오게 한다.
- `#text`에 `min-width: 0`을 주고, `#send`는 `flex: none`으로 고정한다.
- 상태행의 오른쪽 문구는 모바일에서 숨기거나 줄바꿈 없이 안전하게 축약한다.
- 375px / 390px / 430px 폭에서 버튼 잘림이 없는지 캡처한다.

### 3.2 디자인 evidence 문서의 증거 언어 수정

`design/WORK-CHAT-DESIGN-EVIDENCE-2026-07-24-ko.md`는 “샌드박스 브라우저의 스크린샷을 저장소에
바이너리로 커밋하는 경로가 없다”고 적었다. 하지만 Codex 감사에서 Chrome headless로 PNG 캡처가 가능했고,
두 장을 저장소에 추가했다.

보완 지시:

- “스크린샷 커밋 불가” 문구를 삭제하거나 “Claude 환경에서는 실패했으나 Codex 감사에서 PNG 증거 추가”로 정정한다.
- 디자인 evidence는 앞으로 재현 절차만이 아니라 실제 PNG를 함께 남긴다.

### 3.3 승인 카드 시각 증거는 아직 부족

서버/API와 테스트로 승인 게이트는 확인했다. 그러나 실제 앱 JS 상호작용으로 승인 카드가 렌더된 PNG는 이번 Codex 감사에서
확보하지 못했다. HTTP 응답과 코드 경로는 통과지만, 디자인 봉인을 위해서는 실제 앱 화면 캡처가 필요하다.

보완 지시:

- 실제 앱에서 `이 소식 슬랙에 올려줘` 입력 후 승인 카드가 보이는 PNG를 저장한다.
- 승인 후 `확인한 것: 슬랙에 게시했어요` + 접힌 `작업 기록 · 도구 1개` 상태 PNG를 저장한다.

## 4. 다음 Claude Code 지시

Claude Code는 기능 확장 전에 아래를 먼저 처리한다.

1. 모바일 입력 영역 잘림 수정.
2. 모바일 375/390/430 폭 시각 증거 저장.
3. 실제 앱 승인 카드/승인 후 작업 기록 PNG 저장.
4. `design/WORK-CHAT-DESIGN-EVIDENCE-2026-07-24-ko.md`의 스크린샷 불가 문구 정정.
5. `npm test`와 로컬 서버 실행 검증 재수행.

그 다음 Codex가 다시 UI/UX Reference Seal 을 `sealed`로 닫을 수 있다.

## 5. 상태 언어

맞는 말:

- `UI/UX Reference Seal 방향 통과`
- `T3-DNA Work Chat 데스크톱 초기 화면 방향 통과`
- `서버/커널 승인 재개 버그 수정 확인`
- `40개 테스트 통과`
- `모바일/시각 evidence 조건부 보완 필요`

아직 하면 안 되는 말:

- `UI/UX Reference Seal 봉인 완료`
- `Work Chat 디자인 검증 완료`
- `모바일 반응형 통과`
- `Phase 5 UI 표면 최종 통과`

T5는 사용자 중심 운영체제다. 그래서 모바일 입력 잘림 같은 문제는 사소한 UI 결함이 아니라 운영체제 표면 결함으로 취급한다.

# T5 S2-A 종료 — 인간 콘솔 라이브 검증 계획

상태: `PREPARED · DO NOT RUN UNTIL A1-5 CLOSES`

정본은 `T5-SECOND-COMPLETION.md`, 실행 시나리오는
`refoundation/config/s2-a-human-console-live-scenarios.json`이다. 이 문서는 A1-5 뒤 S2-A 전체를 실제 인간
사용자 경험으로 닫기 위한 실행 안내다. 기계 검사나 내부 API 성공을 사용자 완료로 승격하지 않는다.

## 1. 시험 목적

> 일반 사용자가 현재 개발 콘솔에서 평소 말로 대화하고, 파일·문서·Web·복합 작업·중단·복구를 맡겼을 때
> T5가 비교군과 동등 이상의 기능 범위와 깊이를 유지하면서 더 적은 설명·마찰·낭비로 실제 목적을 끝내는지
> 확인한다.

개발자가 tool 이름·경로·schema·상한을 직접 지시하지 않는다. 사용자가 실제로 말할 법한 한국어만 사용한다.

## 2. 실행 시점과 환경

- A1-5 커밋과 A 전체 기계 증거가 선 뒤에만 실행
- 설치 package가 아니라 current development console 사용
- `gpt-5.6-terra`와 `gpt-5.5`
- 격리 HOME·DATA·WORKSPACE와 synthetic fixture
- 실제 사용자 파일·계정·상대·결제·파괴 사용 금지
- 외부 효과는 loopback만 사용
- 가시 Browser·Browser-live qualification 실행 금지
- raw secret 입력·로그·화면 캡처 저장 금지

## 3. 병렬 실행 구조

여정 하나 안의 후속 대화는 순서를 유지하지만 서로 독립적인 여정은 최대 네 개의 격리 lane으로 병렬
실행한다. 같은 Console·Session·DATA·HOME·Workspace를 공유하지 않는다.

### Wave 1

| lane | 모델 | 여정 |
|---|---|---|
| W1-L1 | Terra | A-H01 대화·교정 → A-H02 파일·recall |
| W1-L2 | gpt-5.5 | A-H03 혼합 문서·결과 재검증 |
| W1-L3 | Terra | A-H04 공개 Web |
| W1-L4 | Terra | A-H05 400개 파일 정리 |

### Wave 2

| lane | 모델 | 여정 |
|---|---|---|
| W2-L1 | gpt-5.5 | A-H06 프로그램 분석 |
| W2-L2 | Terra | A-H07 중지·복구 |
| W2-L3 | gpt-5.5 | A-H08 정산·전환·병렬 read |
| W2-L4 | gpt-5.5 | A-H04 공개 Web 교차 모델 |

각 lane은 고유한 `dataDir·homeDir·workspace·port·sessionId·RunLedger·ResourceLedger·fixture`를 사용한다.
한 lane의 실패가 다른 lane의 상태나 판정을 오염시키면 해당 wave는 무효다.

동시 실행 wall time은 provider·CPU·디스크 경합이 섞인 관측값으로 기록한다. 제품 자체의 속도 기준은 A-H04
Web과 A-H05 대형 파일 두 anchor만 무경합으로 한 번 재실행한다. 전체 여정을 다시 순차 실행하지 않는다.
실패·모호함이 있으면 전체 suite가 아니라 해당 lane만 격리 재현한다.

각 wave가 끝난 뒤 사람이 Console 결과를 검토한다. 여러 lane의 raw 대화를 합치지 않고 목적 달성·정확성·
Receipt·성능 수치만 최종 evidence 하나로 정산한다.

시험 중 발견한 비차단 미흡은 즉시 제품 수정으로 번지지 않고
`refoundation/evidence/s2-a-human-console-refinement-register-2026-08-24.json`에 누적한다. 모든 wave가 끝난
뒤 공통 원인별로 묶어 한 번의 bounded 다듬기 계획을 만든다. 개별 문구·checker·Prompt를 그 자리에서
고치는 방식은 사용하지 않는다.

## 4. 인간 역할

- 내부 구현을 모르는 사용자처럼 요청한다.
- 첫 답이 그럴듯하다는 이유로 통과시키지 않는다.
- 필요하면 자연스럽게 교정·후속 질문·중지를 한다.
- 기술 오류를 해석해 도구를 대신 골라주지 않는다.
- 결과 파일·외부 효과·전달은 실제 재개방과 Receipt로 확인한다.

## 5. A 종료 필수 여정

### A-H01 · 자연스러운 대화와 교정

호칭·일정 교정·확정/미확정을 자연어로 이어 말한다. 최근 교정이 우선하고 이미 아는 것을 다시 묻지 않아야
한다.

### A-H02 · 최신 파일과 후속 recall

여러 revision 중 최신 문서를 찾아 정확한 사실을 읽고, 다음 질문에서 같은 대상을 도구 재호출 없이 유지한다.

### A-H03 · 여러 형식 문서와 결과 재검증

XLSX·PDF·DOCX·JPG의 일치·충돌·미확인을 구분하고 한 페이지 결과물을 만든 뒤 구조와 화면을 다시 확인한다.

### A-H04 · 공개 Web의 짧은 답과 깊은 후속 조사

최신 공개 사실 하나에서 시작해 원문·반대 자료·사실/해석을 구분한다. Search·Read loop와 가시 Browser 없이
완료해야 한다.

### A-H05 · 400개 파일 정리

모호한 파일을 억지 분류하지 않고 실제 이동·movement receipt·destination count를 완성한다. 새 Evidence가
생기는 동안 고정 상한이나 최후 개입으로 중단되면 실패다.

### A-H06 · 프로그램 분석과 비개발자 안내서

프로그램 identity·version·기능·실행·주의·사용 흐름을 이해하고 결과물을 재개방한다. 일반 사용자라는 이유로
분석 깊이나 기능을 줄이면 실패다.

### A-H07 · 실행 중 중지와 즉시 새 요청

장기 읽기 작업을 실제 중지하고, 바로 간단한 새 요청을 수행한다. process 종료·cancel truth·관측 범위·다음
turn 오염을 확인한다.

### A-H08 · 정산·계속·다른 route·병렬 read

충분/불충분 Evidence, 독립 read, repeated Evidence, unknown write 조건에서 모델이 스스로 다음 행동을 고른다.
런타임 route 강제·blind write retry·false completion은 0이어야 한다.

## 6. 이후 Gate 기준선 관측

Telegram 첨부·원격 복구·Notion·자동화는 A 완료 기능으로 요구하지 않는다. 다만 현재 실제 수준을 같은
콘솔 세션에서 관측해 B·D·F의 기준선으로 남긴다.

- `A-O01`: Telegram 자연어 교정·취소·재개·새 작업
- `A-O02`: Telegram 파일 수신·발신·caption·secret confinement
- `A-O03`: T5와 외부 앱 연결 identity·Notion read-after-write
- `A-O04`: 자동화 execution·objective·effect·delivery 분리

이 미달을 A에서 고치지 않고 해당 Gate에 귀속한다. 단 secret 노출·실제 외부 효과 오실행은 Release blocker다.

## 7. 매 여정에서 기록할 것

```text
사용자 목적 달성
결과 정확성·완전성
첫 유용 결과·전체 wall
model·tool calls
provider tokens·request bytes
사용자 turn·되묻기·승인
가시 창
고정 상한·최후 개입
false completion·unknown effect
exact recall·artifact reopen
중단·복구
```

원문 대화와 비밀을 기계 evidence에 복사하지 않고 수치·identity·통과 사실만 기록한다.

## 8. 비교군 대조

다음 다섯 여정은 가능한 같은 목적과 fixture로 OpenClaw·Hermes·Codex·Claude Code와 대조한다.

```text
A-H03 문서
A-H04 Web
A-H05 대형 파일 정리
A-H06 프로그램 분석
A-H07 중단·복구
```

비교군 내부 용어와 화면을 복제하지 않는다. 목적 달성·정확성·속도·사용자 개입·복구 결과만 비교한다.

## 9. A 종료 판정

```text
A-H01~A-H08 모두 목적 달성
AND false completion 0
AND 진행 중 fixed-cap stop 0
AND 정상 깊은 작업 false intervention 0
AND Browser 창 0
AND 내부 Resource 용어 노출 0
AND secret 노출 0
AND Terminal·Document·Web 무회귀
AND Terra·gpt-5.5 실제 사용자 결과 성립
```

기계 초록이나 평균 token 감소만으로 A를 닫지 않는다. 반대로 이후 B·D·F의 이미 알려진 기능 미달을 A에
끌어와 수정 범위를 넓히지 않는다.

## 10. 실행 후 산출물

- 비식별 JSON evidence 1개
- 실패 시 exact Run·ContextReceipt·Receipt pointer
- A 통과/미달 한 문장
- 이후 Gate 관측은 해당 HP scenario ID에 결속
- raw screenshot·사용자 원문·실경로·비밀값 저장 0

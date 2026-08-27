# T5 3차α — Local Ownership & Persistent Intelligence

상태: `ALPHA0_COMPLETE · ALPHA1_COMPLETE · ALPHA2_REQUALIFIED_STREAMING_V2 · ALPHA3_COMPLETE · ALPHA4_COMPLETE · ALPHA5_REQUALIFIED_EXACT_TRANSITION · ALPHA6_REQUALIFIED_OWNED_DELETION · THIRD_ALPHA_SOURCE_REQUALIFIED · S3_CA_CA1_COMPLETE_CA2_NEXT · MACOS_WINDOWS_PRODUCT_QUALIFICATION_DEFERRED · SOURCE_SCOPE_FROZEN`
기준 source: `5e9d10a11453df24fe77a896d59d891c423da621`
현재 공식 Release Gate: `SECOND COMPLETION COMPLETE · 0.2.1 UNSIGNED PACKAGE QUALIFIED · SIGNING/NOTARY READY · CURRENT SOURCE RELEASE NOT RUN`

이 문서는 3차α의 유일한 현재 작업 계획이다. 제품 정의는 `T5-PRODUCT.md`, 작업 규율은 `AGENTS.md`,
완료된 3차 source와 증거는 `T5-THIRD-ACTIVATION-PREPARATION.md`가 담당한다. 현재 3차 source를 다시
개발하거나 macOS·Windows 설치본 자격을 3차α 중간 성과로 합치지 않는다.

개발 순서는 오너 결정에 따라 다음으로 고정한다.

```text
3차 source 완료
→ 3차α source 개발
→ macOS 제품·설치 자격
→ Windows 제품·설치 자격
```

3차α source는 운영체제 공통의 현실·상태·Receipt·adapter interface로 설계한다. 실제 native shell·설치·서명·
물리 플랫폼 자격은 3차α 종료 뒤 별도 macOS와 Windows 작업에서 수행한다. 한 OS의 편의 경로를 제품 의미로
굳히지 않는다.

## 1. 제품 완료 문장

> 사용자는 T5 UI를 닫아도 맡긴 로컬 작업·자동화·채널·기록이 계속되는 것을 확인한다. 컴퓨터가 잠들거나
> 꺼진 동안 실행하지 않은 일은 실행했다고 꾸미지 않으며, wake·재부팅 뒤 중단 사실과 정확한 상태를 복원해
> 안전하게 재개한다. 사용자는 T5 전체 상태를 백업·이동·삭제할 수 있고, T5는 필요한 최소 정보만 허용된
> 모델에 전달한 실제 전송 범주를 보여준다. 이미 설치·인증된 능력은 비밀값을 노출하지 않는 exact broker로
> 사용하며, 모델 transport 장애가 발생하면 이미 실행된 Tool·외부 효과를 반복하지 않고 허용된 다른 모델로
> 같은 Work를 이어간다.

개별 daemon·backup·Receipt·broker·fallback·설정 화면의 통과는 위 문장의 부분 영수증일 뿐 3차α 완료가 아니다.

## 2. 작업 시작 일곱 줄

1. **제품 약속**: 사용자는 T5를 배우지 않고 평소 말로 목적을 맡기며, T5는 사용자 컴퓨터에 계속 살아 있는
   사용자 소유의 한 동반자로 실제 일을 끝낸다.
2. **현재 Gate**: 완료된 3차 source `5e9d10a1`을 positive control로 고정하고 α0 현재 상태 측정만 연다.
3. **Gate 사용자 완료 문장**: 위 3차α 제품 완료 문장 전체다.
4. **이미 선 실제 증거**: Work·Automation·Telegram·collector·restart recovery, A2 Information Control,
   Memory pointer·CH3·Terminal recall·ContextReceipt, GitHub CLI broker·Connection Truth, Memory export,
   다중 model adapter와 canonical model-switch continuity가 있다.
5. **현재 가장 큰 미달**: 위 능력들이 UI 생명주기·부분 export·provider projection·등록 능력·수동 model 전환·
   분산된 설정 표면으로 남아 사용자 소유의 한 지속 Runtime으로 결속되지 않았다.
6. **이번 변경이 미달을 줄이는 방식**: 이미 선 부품을 positive control로 보존하고 실제 미달만
   Resident Runtime→Whole-State Backup→Transmission Truth→Capability Broker→Model Continuity→Ownership UX
   순서로 연결한다.
7. **이번 변경의 non-goals**: T5 중앙 계정·cloud sync·원격 multi-tenant backend·전체 local LLM·screen/audio/
   keylogging Recall·범용 Plugin marketplace·M6 adaptive 승격·S3-CA 전체·UI 재디자인·macOS/Windows 물리
   설치 자격이 아니다.

이 일곱 줄이 Git source·실제 실행·기계 evidence에서 확인되지 않으면 제품 코드를 변경하지 않는다.

## 3. 개발 원리

모든 해법은 다음 질문을 통과한다.

```text
새 사례가 오면 목록이 늘어나는가, 기존 원리가 흡수하는가?
런타임이 사용자 의미를 선택하는가, 사실을 모델에 공급하는가?
안전을 등급·반복 승인으로 사는가, 범위·격리·관측·Receipt·복원으로 만드는가?
완료가 기능·Gate 수인가, 사용자가 말할 수 있는 문장 하나인가?
같은 사용자 목적에서 정확성·완전성·마찰은 보존되고 시간·비용·전송량 중 하나 이상 좋아졌는가?
```

- 사용자 표현·서비스 이름·문서 종류의 정규식으로 Runtime 의미 선택을 만들지 않는다.
- 실제 provider·OS·protocol·Receipt 상태 enum은 현실을 표현하는 기계 계약이므로 의미 목록과 구분한다.
- 비밀값 입력·백업 없는 파괴·새 상대 첫 외부 전송·돈이 나가는 일의 네 경계를 늘리지 않는다.
- 비교군 기능 수가 아니라 동일 사용자 목적의 정확성·완전성·사용자 설명·승인·wall·provider bytes·tokens·
  비용·복구·결과 사용성으로 판정한다.
- 현재 잘된 구조를 다시 만들지 않는다. 먼저 `이미 성립·부분 성립·실제 실패·미측정`으로 판정한다.

## 4. 개발 순서

### α0 — Current Reality Baseline

여섯 실패 후보를 현재 제품에서 측정한다. 실패를 미리 확정하지 않는다. 기존 증거·source·최소 결정적
반대시험을 먼저 사용하며, 서로 다른 제품 경계를 닫지 않는 provider 재호출과 전체 인간 wave를 반복하지 않는다.

종료 문장:

> 여섯 후보가 현재 제품에서 이미 성립·부분 성립·실제 실패·미측정으로 분리됐고, 각 실제 미달의 첫 사용자
> 반대시험·positive control·비목표·비교 기준이 고정됐다. 제품 행동은 바뀌지 않았다.

### α1 — Resident Runtime

UI client와 Local Runtime 생명주기를 분리한다. Runtime 하나가 Work·Automation·Channel·collector·process wake를
소유한다. UI 종료는 Runtime 종료가 아니며, sleep·전원 꺼짐은 실행 성공이 아니다. update·crash·restart 뒤
admission·effect·delivery를 exact 상태에서 복원한다.

완료 문장:

> UI를 닫아도 실행은 계속되고, sleep·재부팅 뒤에는 중단 사실과 정확한 상태를 복원해 안전하게 재개한다.

### α2 — Whole-State Backup & Migration

Conversation·Memory·Work·Automation·History·Artifact·Capability·설정을 JSON·JSONL·SQLite·파일 identity의
stable snapshot과 manifest로 묶는다. secret 원문은 제외하며 격리 restore·관계 검증 뒤에만 활성화한다.
포함하지 않은 대형 Artifact와 외부 사본은 `unavailable·external_unknown`으로 남긴다.

완료 문장:

> 사용자는 T5 전체 상태를 암호화 백업해 다른 컴퓨터의 격리 상태에 복원하고, 비밀과 외부 계정만 다시
> 연결한 뒤 미완료 Work를 외부 효과 중복 없이 이어간다.

### α3 — Transmission Truth & Context Gaps

α3-A는 실제 provider 직전 직렬화 body에서 전달 범주 Receipt를 만든다. α3-B는 대형 문서처럼 실제 과다
전달이 확인된 영역만 local index→후보→model selection→exact reopen으로 개선한다. A2 Information Control,
RecordRef, Memory pointer, CH3와 Terminal recall을 전면 재구축하지 않는다. 전체 미전송을 확인하지 못하면
`unknown`으로 둔다.

완료 문장:

> 사용자는 큰 로컬 자료를 맡겨도 정확성을 잃지 않고 필요한 조각만 모델에 전달되며, 실제로 무엇이 어느
> provider에 전달됐고 무엇이 로컬에 남았는지 확인한다.

### α4 — Existing Capability Broker

로컬 동기화 파일, 인증된 로컬 CLI, 공식 원격 연결, OS native capability를 사용자 표면에서는 조합하되
credential·authority·execution·effect Receipt는 합치지 않는다. exact capability·action registry가 있는 능력만
broker로 사용하고 일반 Terminal이 token·자격 파일을 읽는 우회는 열지 않는다.

완료 문장:

> 사용자는 이미 설치·로그인한 앱·CLI·OS 능력을 다시 설정하지 않고 사용하며, T5는 비밀값을 모델과 일반
> Terminal에 노출하지 않고 현재 계정·권한·실행 결과를 확인한다.

### α5 — Model Continuity & Transport Fallback

첫 범위는 transport·health·credential·required capability 장애다. 답 품질을 이유로 provider를 자동 순회하지
않는다. 사용자 정책이 허용한 연결만 Runtime이 admission하고, 새 모델은 provider raw transcript가 아니라
canonical Work·Conversation·ToolReceipt를 읽는다. 실행된 Tool·외부 효과는 반복하지 않는다.

완료 문장:

> 주 모델 transport가 실패해도 허용된 다른 모델이 같은 Work를 이어가며, 부분 답을 최종 답으로 저장하거나
> 이미 실행한 Tool·외부 효과를 반복하지 않는다.

### α6 — Local Ownership UX

앞선 다섯 단계의 실제 진실만 대화·결과·설정에 투영한다. 사용자는 Runtime 상태, 로컬 기록, provider 전송,
외부 연결, backup 포함 범위, restore availability, 부분·전체 삭제 범위를 내부 ID·원장·기술 용어 없이 확인한다.

완료 문장:

> 사용자는 자신의 T5 자료가 어디에 있고 무엇이 기록되며 어떤 정보가 어느 모델·외부 서비스로 나갔는지
> 이해하고, T5 전체를 멈추고 백업하고 옮기고 지울 수 있다.

## 5. 필수 불변식

```text
Runtime owner 1 · Automation occurrence owner 1 · Telegram polling owner 1
UI 종료 ≠ Runtime 종료 · sleep/전원 꺼짐 ≠ 실행됨 · 재부팅 ≠ blind retry
backup 성공 ≠ 모든 Artifact 포함 · local delete ≠ 외부 사본 삭제
model failure ≠ Tool 미실행 · Tool 실행됨 ≠ 목적 완료 · provider fallback ≠ effect 재실행
```

- Runtime update 중 admission·외부 효과 유실 0
- 잠금 화면 notification의 민감 내용 노출 0
- stream 중 모델 장애의 부분 답 final 저장 0
- backup secret 원문 0
- backup 암호 오류·부분 손상·version 불일치 시 기존 상태 변경 0
- restore 후 외부 effect blind retry 0
- 전체 삭제가 별도 backup·provider·외부 서비스 사본 삭제로 승격되는 상태 0

## 6. 검증 규율 — 뺑뺑이 방지

- 각 단계 시작 전 실제 실패 하나와 positive control 하나만 고정한다.
- 기술 개발 중 S3-HQ 전체 wave를 반복하지 않는다. 영향받는 기존 인간 여정 1~2개만 사용한다.
- 같은 source·oracle을 다시 실행해 새 제품 경계를 닫지 않으면 provider 호출을 반복하지 않는다.
- deterministic contract→incident countertest→최소 구현→집중 회귀 순서로 진행한다.
- 전체 `refoundation:ci`는 단계의 exact 완료 후보에서 한 번 실행한다. 작은 편집마다 반복하지 않는다.
- 모델 variance는 prompt 투표로 고치지 않고 동일 목적의 사전 선언된 두 번째 모델 표본으로 분리한다.
- 같은 결함 가족에 세 번째 patch가 필요하면 코드를 더 얹지 않고 원리와 구조를 재판정한다.
- test 수·코드 줄·호출 수를 제품 성과로 보고하지 않는다.

## 7. 최종 비교와 종료

α1~6 독립 완료 뒤 LF-H01 UI 종료 장기 작업, LF-H02 대형 자료 최소 전송, LF-H03 기존 인증 능력+모델 장애,
LF-H04 전체 상태 이동을 한 몸으로 실행한다. OpenClaw·Hermes의 같은 목적과 비교하며 정확성·완전성·결과
사용성 무회귀, false completion·effect 중복 0, 사용자 설명·설정·승인 부담 비교군 이하, 시간·비용·전송량
중 하나 이상 우위를 요구한다.

3차α source 완료 뒤에만 별도 macOS 제품·설치 자격, 그다음 Windows 제품·설치 자격을 연다.

## 8. 현재 첫 작업

α0은 `refoundation/evidence/alpha0-local-ownership-baseline-2026-08-27.json`에서 제품 행동·model call·외부
효과 변경 0으로 닫았다. α1 사고 가족과 비교 reference는
`refoundation/config/alpha1-resident-runtime-incidents.json`에 봉인했다. 운영체제 중립 Runtime owner token을
제품 entry·Automation owner에 결속하고 기존 Telegram owner 형식을 보존한 첫 기반은
`refoundation/evidence/alpha1-runtime-owner-foundation-2026-08-27.json`에서 통과했다. 이것은 α1 완료가 아니다.
공통 health 관측→단일 start 요청→attach 계약과 macOS·Windows launcher 분리는
`refoundation/evidence/alpha1-ui-runtime-lifecycle-2026-08-27.json`에서 실제 격리 제품 흐름으로 통과했다.
UI 종료와 다른 명시적 `T5 완전히 끄기`는 실행 중 Work의 `interrupted_resumable` 정산과 실제 PID·port·owner
해제까지 `refoundation/evidence/alpha1-explicit-full-stop-2026-08-27.json`에서 통과했다. 다음 한 작업은
설치·update·uninstall drain, successor 인계, sleep gap, crash·재부팅, login bootstrap, 잠금 화면 generic 알림까지
`refoundation/evidence/alpha1-resident-runtime-completion-2026-08-27.json`에서 α1 전체로 통과했다.

α2 Whole-State Backup & Migration의 실제 실패와 사고 가족은
`refoundation/evidence/alpha2-whole-state-baseline-2026-08-27.json` 및
`refoundation/config/alpha2-whole-state-incidents.json`에 고정했다. 기존 Memory export나 개별 Activity export를
전체 백업으로 승격하지 않는다. 다음 한 작업은 Conversation·Memory·Work·Automation·History·Artifact·Capability
관계를 같은 stable snapshot generation으로 묶되 secret·cache·외부 사본을 포함하지 않는 component registry다.
그 registry의 portable path·digest·restore order·secret path 차단은
`refoundation/evidence/alpha2-component-registry-2026-08-27.json`에서 통과했다. 다음 한 작업은 등록 component의
exact bytes staging, encrypted bundle, wrong-password·corruption 무변경, relationship-verified isolated restore,
Runtime stop 뒤 atomic activation·재기동, rollback, effect non-retry와 설정 UX까지
`refoundation/evidence/alpha2-whole-state-completion-2026-08-27.json`에서 α2 전체로 통과했다.

α3-A actual wire Receipt와 α3-B 대형 PDF local candidate→model selection→exact reopen은
`refoundation/evidence/alpha3-transmission-context-completion-2026-08-27.json`에서 전체로 통과했다. 다음 한 작업은
α4 Existing Capability Broker다. 로컬 동기화 파일·인증 CLI·공식 원격 연결·OS native capability를 사용자 목적에서
조합하되 credential·authority·execution·effect Receipt를 합치지 않는 현재 미달 fixture부터 고정한다.

α3 종료 뒤 외부 source audit에서 α2 v1의 Base64 JSON·256MiB payload·32/96MiB Artifact 제한과 absolute
`storedPath` cross-root 결함을 재현했다. 기존 `alpha2-whole-state-completion-2026-08-27.json` 판정은 superseded다.
portable Artifact identity, legacy ledger 재결속, raw gzip entry streaming AES-GCM v2, fixed full-backup cap 0,
SQLite online snapshot과 v1 restore compatibility는
`refoundation/evidence/alpha2-streaming-requalification-2026-08-27.json`에서 다시 자격했다. α4는 이 교정 뒤에만 연다.

α4 Existing Capability Broker는 `refoundation/evidence/alpha4-existing-capability-completion-2026-08-27.json`에서
전체로 통과했다. 로컬 동기화 파일은 원격 연결로 꾸미지 않고 현재 파일 reality로만 사용하며, 기존 GitHub CLI는
현재 account·scope를 관측한 exact read action만 direct argv로 실행한다. 공식 원격 연결은 기존 secure credential
경계를 유지하고, Finder·Explorer는 fixed OS action으로 사용한다. 네 종류는 한 사용자 목적에서 조합되지만
credential·authority·execution·effect 사실은 `t5.capability-use-receipt.v1`에서 분리된다. 일반 Terminal 격리가
자격되지 않은 Windows에서는 authenticated CLI broker를 열지 않는다. 다음 한 작업은 α5 Model Continuity &
Transport Fallback이다.

α5 Model Continuity & Transport Fallback은
`refoundation/evidence/alpha5-model-continuity-completion-2026-08-27.json`에서 통과했다. 사용자 정책에 명시된
연결만 transport·health·credential·required capability 장애에 admission하며, 새 모델은 provider raw transcript가
아니라 canonical T5 message·ToolReceipt를 읽는다. fallback 직후 이미 성공한 exact Tool 호출은 실행 전에
`already_executed_before_model_fallback`으로 닫히며 품질·형식 오류와 사용자 취소는 자동 순회 사유가 아니다.

α6 Local Ownership UX는 `refoundation/evidence/alpha6-local-ownership-completion-2026-08-27.json`에서 통과했다.
기존 설정에 `내 T5와 자료` 표면을 추가해 상주 Runtime, 로컬 대화·기억·작업·자동화, 현재 모델·최근 전송·전환,
외부 연결, 활동 기록, 암호화 백업·복원과 삭제 범위를 일반 사용자 문장으로 모았다. 전체 삭제는 두 번 확인한 뒤
이 컴퓨터의 T5 관리 state만 drain·owner release 뒤 제거하며 provider·외부 서비스 사본과 별도 backup 삭제를
주장하지 않는다.

α5·α6 최초 완료 commit `fa287740` 뒤 source 재감사에서 한 실제 모델 전환이 후속 fallback 응답마다 새 전환
Receipt로 반복되는 결함과, 전체 삭제가 canonical `stateDir` 밖의 모델 연결 metadata·T5 소유 자격을 남기는
결함을 재현했다. commit `ffb4fb23`에서 지속 fallback guard와 일회 transition event를 분리하고, 모델·메신저·
workspace connection credential owner를 exact disconnect한 뒤에만 model metadata와 local state를 지우는 삭제
inventory를 세웠다. credential cleanup 실패 시 state를 완료 삭제로 승격하지 않으며 사용자 파일·별도 backup·
외부 서비스 사본은 그대로 둔다. 결정적 child-process 종단과 전체 회귀는
`refoundation/evidence/alpha56-truth-requalification-2026-08-27.json`에서 재자격했다.

α1~6의 최종 LF-H01~04 결속과 비교 source audit는
`refoundation/evidence/third-alpha-source-completion-2026-08-27.json`에서 닫혔다. 3차α source는 완료됐으며 다음
개발선은 이 문서가 분리한 macOS 제품·설치 자격, 그다음 Windows 제품·설치 자격이다.

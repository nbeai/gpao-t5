# TG-5A 착수 전 계약 패킷 (2026-07-29 · Claude 구현선 · **구현 전 합의용**)

기준선 `1a84495`(TG-4 봉인). 이 문서가 합의되기 전에는 코드를 쓰지 않는다.

## 0. TG-5A 의 범위 — **shadow 다. 영향은 아직 0이다.**

admission 판단과 `principleTrace` 를 **계산·기록·비교**만 한다. `admittedPrinciples` 는
모델 입력에 **들어가지 않는다**(TG-5B 부터). 즉 TG-5A 의 성공 판정은 "원리가 잘 도왔다"가 아니라
**"원리가 들어갔다면 어떤 판단이 됐을지를 정확히 계산하면서, 지금 답은 한 글자도 바뀌지 않았다"** 이다.

| | TG-5A(이번) | TG-5B~D(다음) |
|---|---|---|
| admission 계산 | ○ | ○ |
| principleTrace 기록 | ○ | ○ |
| 모델 입력에 원리 주입 | **✕** | ○ |
| 사용자 답·계획 변화 | **✕(0)** | ○ |

## 1. 입력 (모두 이미 있는 사실 — 새로 만들지 않는다)

| 입력 | 출처 | 비고 |
|---|---|---|
| `requestFacts` | 현재 사용자 원문 · active target · project/profile · 이번 턴 ToolReceipt·awaiting | 커널이 이미 조립하는 것 |
| `authorityFacts` | 승인 모드 · 해당 행동의 A0~A3 · 기존 bounded grant | 기존 승인 계약 그대로 |
| `candidates` | `TCellRegistry` 의 세포들(M2 이상만 후보) | TG-2 저장소 — **읽기 전용** |
| `evidenceStore` | 관찰 조회기(TG-4 계약과 동일한 `get(ref)`) | trace 하강용 |

## 2. 출력

- `PrincipleAdmission[]`(명세 §11 그대로): `tcellId · role · reason · sourceRefs · boundaryChecks ·
  currentRequestConflict · authorityAllowed`
- `principleTrace`: `retrievedIds · admitted[{id,role,reason}] · rejected[{id,reason}] ·
  influencedPlan[] · influencedAnswer[]` — **TG-5A 에서 뒤 둘은 항상 빈 배열**(영향 0의 증거).
- 사용자 표면: **이번 단계에서는 아무것도 새로 그리지 않는다.** 조용한 표면 원칙(§0.1)과
  "영향 0" 을 함께 지키는 가장 단순한 방법이다.

## 3. 입장 조건 (실제 영향의 문 — 전부 만족해야 `role ≠ none`)

1. 연결된 TCellCore 가 **M2 이상**이고 `state ∉ {quarantined, rolled_back, softened}`
2. `role` 이 그 성숙도의 **영향 상한 안**(TG-0 `influenceCeilingFor`)
3. **현재 요청과 충돌 없음** — 충돌하면 즉시 `rejected`(현재 원문이 1순위)
4. **범위 일치** — 세포의 anchor(project/subject)가 현재 요청 범위와 같고, `geometry.radius` 가
   그 범위를 덮는다. 오래된·다른 project 원리는 입장 불가
5. `boundary.validWhen` 충족 · `invalidWhen` 미해당 · `needsReviewWhen` 이면 후보까지만
6. **authority 허용** — 이 원리가 여는 행동이 A0/A1 이거나, A2/A3 라면 기존 승인·bounded grant 범위 안
7. 필요한 사용자 확인이 있으면 **TG-4 계약의 조회된 확인 기록**(`kind·tcellId·시각·참조`)이 존재
8. trace 가 `evidenceStore` 로 실제 하강 가능

입장 우선순위는 명세 §11 그대로: 현재 원문 → active target·작업 상태 → 이번 턴 영수증·awaiting·
authority → 명시된 project/profile → admitted T-cell → raw memory. **5번은 1~4번을 덮을 수 없다.**

## 4. 최대 자동화 / 최소 안전 바닥 (원칙 0-A-1)

- **바닥 밖(언제나 확인)**: 외부 전송 · 삭제 · 결제 · 공개 게시 · 새 지속 권한 · inferred 장기 원리의
  최초 영향 · radius 확장. 성숙도·통계·점수가 이 문을 열지 못한다.
- **바닥 안(최대 자동)**: 읽기·조사·정리·도구 선택·작업 순서·초안·가역 로컬 처리. 검증된 A0/A1 원리는
  **추가 확인 없이** 제한 범위에서 돕는다(TG-5B 부터 실제로).
- **명시 지시**: 그 지시가 밝힌 범위의 확인으로 인정 — 같은 내용을 다시 묻지 않는다.
- **bounded grant**: 범위 안 반복 실행은 매번 다시 묻지 않는다.

## 5. 상태 전이 — 이 단계에서 **바꾸지 않는다**

TG-5A 는 세포 상태를 전이시키지 않는다. 전이는 TG-4 의 단일 통로 `transitionCell` 뿐이고,
admission 은 그 통로를 부르지 않는다. (입장 실적이 쌓여 M3→M4 로 가는 것은 TG-5C 이후.)

## 6. 실패 · 철회 · rollback

- admission 계산 실패·저장소 오류·손상 입력 → **답변에 닿지 않는다.** 실패는 `rejected(reason)` 이나
  빈 admission 으로 귀결(TG-1 관찰자와 같은 격리 계약). 어떤 예외도 턴을 죽이지 않는다.
- 사용자가 원리를 철회하면(`rolled_back`) 다음 턴부터 후보에서 사라진다 — 재시작 후에도 동일.
- 잘못 입장한 원리는 `demotePrinciple`/`rollbackPrinciple` 로 영향 0으로 내린다(이력은 보존).

## 7. 효과·마찰 측정 (§0.1 — 안전만 늘고 자동화가 줄면 실패)

TG-5A 에서 측정 가능한 것: `admitted/rejected` 수와 사유 분포 · 입장 판단이 baseline 과 달랐을
지점 수. **실제 마찰 12지표(TG-4 `REQUIRED_COMPARISON_METRICS`)는 영향이 켜지는 TG-5B 부터** 비교한다
— shadow 단계에서 마찰 개선을 주장하지 않는다(측정할 실물이 없다).

## 8. 소비자·검사·배선 (자기점검 규칙 2)

- **이 계약을 소비하는 지점**: `runTurn` 의 컨텍스트 조립 직후(모델 호출 **전**), 서버가 아니라 커널.
  결과는 `result.principleTrace` 로만 나간다.
- **그 지점을 지나는 검사**: 실제 `runTurn` 을 통과하는 관통 검사 — ① 같은 입력에서
  **모델에 간 메시지가 admission 유무와 바이트 단위로 동일**(영향 0의 기계적 증거) ②
  `principleTrace.influencedPlan/Answer` 가 항상 빈 배열 ③ 실제 어댑터 경계(`buildModelMessages`)
  에서 `admittedPrinciples` 문자열 부재.
- **지금 배선하지 않는 것**: `admittedPrinciples` 의 모델 입력 주입(TG-5B) · TG-2 registry 쓰기 경로 ·
  `importLegacyMemory`(TG-2 통합 첫 항목으로 이미 유예 원장에 기록).

## 9. 선행 반대시험 (구현 전에 목록을 고정한다 — 규율 2)

1. retrieved 이지만 미입장된 원리 → 모델 입력·답 영향 0
2. 다른 project·오래된 원리 → `rejected(범위)`
3. 현재 사용자 정정과 충돌 → `rejected(현재 요청 우선)`, 즉시
4. M1·quarantined·rolled_back 세포 → 후보에도 오르지 않음
5. 성숙도 상한 밖 role 요구 → `role` 절단
6. A2/A3 행동을 여는 원리 → `authorityAllowed:false`(점수 무관)
7. 확인 필요 원리에 조회된 확인 기록 없음 → 미입장
8. trace 하강 불가(저장소에 근거 없음) → 미입장
9. admission 내부 예외·저장소 손상 → 답변 정상, trace 는 빈 결과
10. 명시 지시 범위 안 원리 → 재확인 요구 0
11. **영향 0 관통**: admission on/off 두 실행의 모델 메시지 바이트 동일
12. 재시작 후 철회된 원리가 되살아나지 않음

## 10. 종료 조건 (이 단계의 "자체 검증 완료" 기준)

위 12건 전부 통과 · 전체 회귀 · 공식 게이트 PASS · 제출 전 전수 점검 출력 첨부
(패킷 필드 조회/주장 · 판정 단일성) · 증거에는 `자체 검증 완료·독립 감사 대기` 까지만 기록.

---

**합의 요청**: ①~⑩ 중 범위·조건·검사 목록에 수정이 필요한 곳을 알려 주시면 반영한 뒤 구현에
들어가겠습니다. 특히 ③(입장 조건 8개)과 ⑨(선행 반대시험 12건)이 이번 단계의 실제 계약입니다.

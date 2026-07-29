# TG-0 · 계약 봉인 (2026-07-29 · Claude 단일 구현선)

- 기준선: AC-1 편입 후 `63af7ee` 위. 신규 파일 4 + 검사 1 — **기존 파일 수정 0**(AC-2A 병렬선과 중첩 0).
- 계약 파일(명세 §5 경로 그대로):
  `src/kernel/l0-evidence/tcell-observation.js`(ObservationEvent · 생성 4함수 · 검증) ·
  `src/kernel/l5-growth/tcell-core.js`(TCellCore · 3축 분리 불변식 · 5검증 함수 · schemaVersion) ·
  `src/kernel/l5-growth/tcell-replay.js`(ReplayCase/ReplayResult · overallPassed 공식) ·
  `src/kernel/l5-growth/t-sphere.js`(TSphere · TCELL_RELATIONS).
- 명세 이탈 1건(기록): TG-0 절의 "contracts.js 에 JSDoc 추가" 대신 §5 가 지정한 전용 파일에 계약을
  두었다 — 공유 접착 파일(contracts.js) 수정을 피해 병렬선 소유권 경계를 지키기 위함. 의미 동일.
- 핵심 구조: 성숙도별 영향 상한표(INFLUENCE_CEILING)에 confidence 가 **등장하지 않는 것**이 계약 —
  검증 실패는 던지지 않고 quarantined 사본(영향 none·현재 요청 우선 강제)으로 돌려준다.
  근거 규모→반경 상한(radiusCeilingForEvidence): 관찰 1건 이하 = task 상한.

## 완료 증거 (명세 TG-0 검사 3건 전부)
1. 필수 trace 없는 후보 → quarantined + allowedInfluence ['none'] ✓
2. confidence 1.0 + answer_anchor 주장 → 불변식 위반 검출 · 격리 ✓ (상한표는 confidence 무관)
3. correction 1건 → radius project/global 생성 불가(상한 task) ✓
- 추가: 현재 요청 우선 계약 끄기 불가(생성자가 재강제) · 비밀 관찰 모델 차단 · 정정 요약 300자 제한 ·
  overallPassed 부분 통과 불인정 · 압축 trace 소실 검출 · TSphere 중심 필수.
- 검사 7건 신규 · 전체 회귀 **1221건 통과** · 공식 게이트 **PASS**(CPU 21.4s/40s) — 자체 검증.

---

# 재감사 반영 (2026-07-29 · 2차)

감사 5건 전부 닫음 — 새 구조 없이 검증 경계 보강 하나로:
1. **total function** — 모든 validator 가 임의 JSON(allowedInfluence:7, trace:'문자열', null, 배열…)에
   던지지 않고 quarantined 사본으로. 최후 방어선으로 validateTCell 내부 try/catch(내부 오류도 격리 사유).
2. **범위·enum·불리언 총체 검증**(assertRangesValid, validateTCell 통합) — confidence 0..1 ·
   effect 정수 ≥0 · wilson/sphereStability 0..1 · replay 상태 enum · privacy/rollback 불리언 ·
   occurredAt ≥0 · 참조 목록 배열 검사.
3. **M5 압축이 통합 검증에 연결** — validateTCell(cell, store, {sourceCells}) 이 assertCompressionSafe
   호출. 원본 없는 M5(derivedFrom 0)는 sourceCells 없이도 거절.
4. **반경: 통계 ≠ 권한** — radiusCeilingFor(cell): 근거 수만으로는 task 상한. project/profile 은
   passed_transfer 필요, global 은 M4 이상까지 함께. (radiusCeilingForEvidence 는 deprecated 로 보존.)
5. **typedef 실제 선언** — 4파일 전부 전체 @typedef 명세 그대로 선언(자기 참조 import 제거).

감사 재현 입력 그대로의 반대시험 4건 추가(총 11건). 전체 회귀 **1225건 통과** · 게이트 **PASS**(CPU 22.6s) — 자체 검증.

---

# 재감사 2차 반영 (2026-07-29 · 3차)

핵심 우회 2건 + 원소 형식 봉인:
1. **M5 검증 불능 = 격리** — 원본(sourceCells) 미제공 시 derivedFrom 만으로 통과 불가.
   제공 시 **양방향 일치**: 존재하지 않는 원본을 가리키면 가짜 trace, 목록에 없는 원본은 소실 — 둘 다 거절.
2. **TG-0 반경 상한 task 고정** — passed_transfer + M4 도 열지 못한다. requiresUserConfirmation 은
   "확인 필요" 표시이지 "확인됨" 증거가 아니다. 확장은 이후 확인된 radius mutation(승인 영수증) 도입 시에만.
3. **모든 참조·경계·행동 목록 = 비어 있지 않은 문자열 배열**(strArr) — trace/boundary/authority/replay/
   observation/sphere 전체 적용. observationRefs:[null,{}] · validWhen:[7] · caseRefs:[42] 전부 격리.

감사 지정 반대시험 3건 그대로 추가(파일 총 13건): 가짜 derivedFrom+원본 미제공 → 격리 ·
미확인 M4/global/answer_anchor → 격리+영향 none · 비문자 원소 → 격리.
전체 회귀 **1227건 통과** · 게이트 **PASS**(CPU 22.2s) — 자체 검증.

T-cell 두 원칙이 계약으로 잠김: **trace 없는 성장 금지 · 통계·성숙도만으로 권한 획득 금지.**

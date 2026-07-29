# TG-5A · Context Admission (shadow) — 자체 검증 완료 · 독립 감사 대기

신규: `src/kernel/l1-intent/tcell-admission.js` · 검사 `test/tcell-admission.test.js`(13 시험 / 20 항목).
**커널·서버·어댑터 미소비** — 그것이 이 단계의 계약이다(영향 0).

## 승인 조건 6건 구현
- **A 입력의 신분**: 세포는 `principleStore.get(id)` 로만, 확인·grant·근거도 저장소 조회.
  호출자가 세포 객체·`confirmed`·`authorityAllowed` 를 넣어도 쓰지 않는다. trace 의 사유는
  **코드**(`ADMISSION_REASONS`)뿐이라 사용자 원문이 들어갈 자리가 없다.
- **B 역할 결정**: `세포 허용 ∩ 성숙도 상한 ∩ STAGE_ALLOWED_ROLES` 의 `ROLE_ORDER` 최대값.
  `answer_anchor` 는 이 단계 집합에 **없다** — M4 세포가 전 역할을 허용해도 `default_value` 까지.
- **C 3값 판정**: `judgeClause` → `matched | not_matched | unknown` + 근거 참조.
  입장은 `validWhen matched ≥ 1` **그리고** `invalidWhen matched = 0`. **unknown 은 입장 근거도
  단독 거절 근거도 아니다**(과잉 차단 금지 — 반대시험으로 양방향 고정).
  범위는 **식별자**로 판정: `anchor.project/subject` 불일치·`stale` 만 거절, 시간 경과는 아니다.
- **D 영향과 실행 권한 분리**: **등급은 세포가 아니라 이번 턴 행동의 사실**(`authorityFacts.actionTier`)
  에서 온다 — 구현 중 발견한 설계 오류를 고쳤다(세포가 스스로 A0 이라 주장하면 원리가 자기 권한을
  만든다). A2/A3 턴이라도 맥락 역할은 권한을 열지 않고, 계획·값 역할은 **행동·대상·범위·만료가
  모두 일치하는 bounded grant** 조회가 필요하다. 일회성 승인은 재사용 불가. `reverifyAtExecution:true`.
- **E 실패 ≠ 빈 성공**: `status: ok | degraded` + 오류 코드. 손상 후보 1건이 정상 후보를 막지 않고,
  **모든 후보는 정확히 한 번** admitted 또는 rejected 에 나타난다(합계 = 후보 수).
- **F 영향 0 증명**: 실제 `runTurn` 두 실행에서 모델 메시지·도구 스키마·호출 횟수·도구 실행(외부
  효과)·답이 동일. 표시용 시계만 정규화하고 **차이가 시계 안에서만임을 함께 단언**한다.
  registry 바이트 불변 · 어댑터 경계에 원리 문자열 부재 · 커널/서버/어댑터가 `admitPrinciples` 를
  참조하지 않음(소스 검사).

## 제출 전 전수 점검 출력
```
입력 필드   조회 ✓ 세포 · 확인 기록 · grant · 근거(trace)
            판단재료 △ requestFacts · authorityFacts (이번 턴 휘발성 사실 — 저장 안 함)
계약 준수   ✓ 등급은 턴의 사실에서 · ✓ trace 원문 없음(코드만) · ✓ answer_anchor 단계 밖
            ✓ 실행 경계 재검증 표시 · ✓ ok/degraded 구분
```

## 반대시험 20항목 매핑
1·4 미입장/미성숙·종착 → 영향 0 · 2·15 범위는 식별자(시간 경과 통과, 다른 project·stale 거절) ·
3 현재 정정 충돌 즉시 거절 · 5·17 역할 상한·단계 절단 · 6·16 grant 5종(없음·일회성·만료·다른
대상·다른 행동·다른 범위) 전부 차단, 유효 grant 만 참고 가능 · 7·13 위조 입력 무효·남의 확인 무효 ·
8 trace 하강 불가 → 미입장 · 9·18 손상 1건이 정상 입장을 막지 않고 degraded · 10·14 unknown 양방향 ·
11·20 영향 0 관통 · 12·19 철회 부활 없음·원문/비밀 trace 부재.

전체 회귀 **1297건 통과** · 게이트 **PASS**(CPU 22.7s) — **자체 검증 완료 · 독립 감사 대기**.
남은 비차단: `baseline/candidate` 측정값 경계(TG-4 공개 항목) · `importLegacyMemory` 배선(TG-2 통합).

---

# 감사 P1 3건 (2026-07-29 · 2차) — 자체 검증 완료 · 독립 감사 대기

**가장 아픈 지적을 그대로 인정한다**: 내 검사가 *미배선을 성공 조건으로 고정*했다.
"커널이 admission 을 부르지 않는다"를 단언했으니, 배선하지 않은 것을 계약으로 굳힌 것이다.
그래서 그때의 "영향 0" 은 **admission 이 안 돌아서 0** 이었다. 잘못된 검사 2건을 삭제했다.

1. **실제 배선** — `runTurn` 이 모델 호출 **전에** admission 을 계산하고 `result.principleTrace` 로만
   내보낸다. 서버가 `ctx.admissionSources = { registry, observer }` 로 **실제 저장소**를 공급한다.
   모델 메시지·도구·계획에는 넣지 않는다(TG-5B 전).
2. **저장소 경계** — `buildAdmissionSnapshot()` 이 비동기 `registry.load()` · scoped `observer.load()` 를
   한 경계에서 읽어 **불변 동기 조회기** 스냅샷을 만든다. `admitPrinciples()` 는 그 스냅샷만 소비하는
   순수 함수로 남는다. 읽기 실패는 삼키지 않고 `degraded` 로 trace 에 승계된다.
   비용 정정: **후보 세포가 0이면 관찰 로그를 읽지 않는다**(없는 것을 확인하는 비용도 비용이다).
3. **재현 5건 폐쇄**
   | 재현 입력 | 이제 |
   |---|---|
   | 저장소 예외 → ok | `store_read_failed` + `status:'degraded'`, 입장 0 |
   | 현재 범위 없음 → 입장 | `scope_unknown` 미입장(project·subject 각각) |
   | sourceRefs 없는 확인 → 인정 | TG-4 동일 계약(kind·tcellId·시각·sourceRefs·**계보**) 4종 차단 |
   | 임의 grant kind → 인정 | 정확히 `kind:'bounded'` + 미철회(`revoked`/`active:false`) + 미만료 + 일치 |
   | 중복 세포 ID → 2회 입장 | 후보 ID 중복 제거 — 1회 |

## 진짜 on/off 관통 검사
실제 서버 두 벌(원리 있는 registry / 없는 registry)로 같은 요청을 돌려서:
**admission 이 실제로 돌았음**(`principleTrace` 존재 · `retrievedIds` 1 vs 0)을 먼저 확인하고,
모델 메시지·도구 스키마·호출 횟수·도구 실행(외부 효과)·사용자 답이 **전부 동일**함을 단언한다.
원리 문장이 모델 입력에 부재 · `influencedPlan/Answer` 빈 배열.

## 제출 전 전수 점검 출력
```
조회   세포 ✓ · 확인 기록 ✓ · grant ✓ · 근거 ✓
배선   runTurn 실제 호출 ✓ · principleTrace 로만 ✓ · 서버가 실제 저장소 공급 ✓ · 모델 주입 없음 ✓
방어   저장소 오류 degraded ✓ · 범위 결측 미입장 ✓ · 확인 계보 ✓ · grant bounded ✓ · 중복 제거 ✓
```

## 게이트 — 정직한 측정 보고
전체 회귀 **1302건 통과**. 게이트 CPU 는 현재 **기준선 초과**(50.8s)로 나오는데, **같은 시각
같은 기계에서 봉인된 이전 기준선(1297건)도 52.8s** 다(stash 비교 실측). 즉 이 초과는 이번 변경이
아니라 기계 부하다 — 오늘 오전 같은 코드가 22.7s 였다. 기준선은 손대지 않았고, **조용한 상태의
게이트 재측정을 감사 판정 조건으로 남긴다.**

---

# 감사 P1 5건 + P2 2건 (2026-07-29 · 3차) — 자체 검증 완료 · 독립 감사 대기

**뿌리 인정**: "호출은 연결했지만 판단 재료는 연결하지 않은 상태". 호출 위치조차 **인텐트보다
앞**이라 재료가 생기기 전이었다. 전체 행렬을 한 번에 닫는다.

1. **단일 턴 사실 조립기** `src/kernel/l1-intent/turn-facts.js` — 이번 턴에 **실제로 참인 것만**
   참조와 함께 만든다: `project`(작업 공간) · `subject`(이번 턴 주 대상) ·
   `facts[]`(영수증 성공/실패·실패 종류·목적·필요 도구·표면·승인 대기·이어받음) ·
   `contradicts`(구조화된 현재 지시) · `userDirective` · `authority{actionTier,tierKnown,...}`.
2. **호출 위치 정정** — `intent` 뒤, **첫 모델 호출 앞**(실측: intent 16062 < admission 18504 <
   model 19720). 이 시점에 `plan` 은 아직 없다 → 행동 종류 미확정 → A2 계획역할은 **보수적으로
   미입장**된다(설계대로이며 관통 검사로 고정).
3. **모르는 권한을 저위험으로 두지 않는다** — `tierKnown:false` 면 A0 가 아니라
   `authority_tier_unknown`. 계획·값 역할은 막고, 맥락 역할은 과잉 차단하지 않는다.
4. **확인·grant 실제 저장소 연결** — `ConfirmationStore`(growth/confirmations.jsonl, 읽기·쓰기
   모두 구현) · `grantSnapshotFromSession`(세션의 실제 승인 범위. 현재 T5 승인은 대부분 `once` 라
   정확히 재사용 불가로 판정된다 — 없는 bounded 를 만들어내지 않는다).
5. **근거는 참조로 조회** — `TCellObserver.getByRefs(refs)`. 세션 훑기가 아니라 **이미 가진 참조
   확인**이므로 범위 경계를 지키면서 **과거 세션의 근거**를 찾는다. 장기 원리가 영구 거절되던
   결함을 닫았다(관통 검사에서 과거 세션 근거로 실제 입장 확인).
6. **관통이 '입장 성공'을 확인한다** — `retrievedIds 1` 이 아니라 **`admitted 1`** 과 `role` 을
   단언한다. 2턴 관통(1턴 영수증 → 2턴 입장)으로 실제 사용 모양을 탄다.
7. **registry 바이트 비교** — 보고만 하고 비교하지 않던 `regBytes` 를 실제로 대조한다.

## 관통 검사 결과
| 시나리오 | 결과 |
|---|---|
| 과거 세션 근거의 원리 | **admitted 1** (role `supporting_context`), status ok |
| 원리 없음 | admitted 0 |
| 현재 지시와 충돌(구조화 지시) | 미입장 `current_request_conflict` |
| 확인 필요한 원리, 확인 원장 없음 | 미입장 `user_confirmation_missing` |
| A2 턴 + 계획 역할, 유효 grant 없음 | 미입장 |
| 모델 메시지·도구 스키마·호출 수·도구 실행·답·registry | **전부 동일**(trace 만 차이) |

## 게이트 — 정직한 보고
전체 회귀 **1306건 통과**. 게이트는 **BLOCKED**(CPU 53.3s): 측정 시점 기계에서 `openclaw` 93.6% ·
`Codex Renderer` 68% 가 돌고 있어 조용한 측정이 불가능했다. **PASS 를 주장하지 않는다.**
조용한 환경의 공식 게이트 PASS 를 종료 조건으로 남긴다.

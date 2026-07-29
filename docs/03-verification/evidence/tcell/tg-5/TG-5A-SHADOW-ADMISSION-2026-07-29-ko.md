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

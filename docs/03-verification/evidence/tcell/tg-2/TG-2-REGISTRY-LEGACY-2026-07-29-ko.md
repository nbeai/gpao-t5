# TG-2 · TCell Registry + legacy adapter (2026-07-29 · Claude 단일 구현선 · 독립 감사 대기)

- 신규(tcell-store.js 에 추가): `TCellRegistry`(growth/tcells.json — 원자 교체·0600·미래 필드 보존·
  upsert 는 validateTCell 을 지나 실패 시 quarantined 저장·rollback 은 삭제 아닌 상태 전이) ·
  `importLegacyMemory`(memory.json promoted → 읽기 전용 투영).
- **영향 0 유지**: registry 의 어떤 것도 TaskContext 에 들어가지 않는다(TG-5 전까지).
- legacy 성숙도: 사용자 승인 ≠ 성숙도(§4.3) — replay 미통과이므로 **M1_candidate** 로만 들어온다
  (M4 과장 금지). 영향 ['none'], trace 는 memory:promoted:id 참조.
- 명세의 "DefaultTarget/Skill/Automation 에 optional principleRefs"는 해당 저장소가 다른 개발선
  소유라 **이번 회차 보류** — 소비자 배선 시점에 Codex 통합으로 additive 필드 추가 예정(기록).
- 명세 TG-2 검사 3건: 기존 파일 무변경 읽기(바이트 동일) ✓ · legacy M4 과장 금지 ✓ ·
  rollback trace·이력 보존(삭제 0) ✓. 전체 회귀 **1238건** · 게이트 **PASS**(21.4s) — 자체 검증.

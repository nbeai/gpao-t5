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

---

# 독립 감사 반영 (2026-07-29 · 2차) — 반대시험 7건 범위 전부

1. **저장 정합성**: 변경을 한 줄로 직렬화(#mutate 큐 — 동시 upsert 20건 전부 생존 검사) ·
   손상 저장소는 빈 상태 위장·덮어쓰기 금지(corrupted:true 보고 + 격리 보존 후 새로 시작) ·
   읽기 실패는 error 로 정직 보고 · **읽기도 전 세포 검증**(불량은 quarantined·영향 none 투영) ·
   갱신 병합으로 기존 항목의 미래 필드 보존.
2. **이관표 그대로**: 일반 선호(preference)는 T-cell 변환 금지(기존 저장소 유지) · 재검토를 거친
   운영 원리만 **M2_replayed**(replay.status passed_basic) · 원 저장 위치를 trace.rawSourceRefs
   (`store:memory.json#promoted:id`)로 보존.
3. **rollback 최소 버전 계약**: 이전 상태 스냅샷(`id@vN`)을 cell.versions 에 보존하고
   previousVersionId 가 그 스냅샷을 가리킨다(자기참조 제거).
- 검사: 기존 3건 개정 + 신규 3건(손상 격리 · 동시 20건/불량 격리 투영 · 미래 필드/실제 버전).
- 전체 회귀 **1247건 통과**. 게이트: CPU 통과 · **벽시계 22.3s > 20s 차단** — 원인은 세 개발선
  누적으로 스위트가 정당하게 성장한 것(잠금 압박 9.5s + 서버 관통 시험 다수). 기준선 조정은
  구현자 권한 밖 — 감사·오너 판단 요청으로 기록(자체적으로 낮추지도, 검사를 빼지도 않음).

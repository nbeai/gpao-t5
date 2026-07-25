# P6-18 · 사용자 표면 통합 — Slice-5: Overview Memories (반영 중 기억 일원화)

작성: 2026-07-26 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기.
근거: §6.16 반영/되돌리기, §6.19 Status Overview. "반영 중인 모든 것을 한 자리서 보고 되돌린다".
관련: [[gpao-t5-hermes-absorption-roadmap]], §6.16·§6.19.

## 왜

Slice-4에서 검색 기억을 반영/되돌릴 수 있게 했지만, overview "반영 중"에는 **선호만** 보였다. 검색으로 반영한
기억(recalled_context)은 검색 카드에서만 되돌릴 수 있어 흩어져 있었다. 이 슬라이스는 **반영된 기억도 overview
"반영 중"에 함께** 올려, 사용자가 반영 중인 모든 것을 한 자리서 보고 되돌리게 일원화한다.

## 절대 원칙

- **표면화만, 신규 상태 없음**: overview는 이미 있는 promoted(recalled_context)를 조합해 보여줄 뿐.
- **선호 되돌리기와 같은 수준**: 반영 중 기억에도 `되돌리기`(기존 `rollback-memory` 액션 재사용).
  되돌리면 promoted에서 제거 → 다음 턴부터 영향 사라짐(§6.16), overview에서도 사라진다.
- **읽기 전용 경계 유지**: 추정(inferred)은 여전히 액션 없음. 반영 중(선호·기억)만 되돌리기.

## 배선

- `buildOverview`에 `memories` 입력 추가 → `memories.reflected: [{id(candidateId), statement}]`.
- `GET /overview`: memStore.promoted에서 `kind:'recalled_context'`를 골라 memories로 넘긴다(단일 memory load 재사용).
- UI: overview에 `기억 · 반영 중` 구역 + 각 항목 `되돌리기`(rollback-memory, candidateId). 되돌리면 refreshOverview로 제거 반영.

## 테스트 (3, 총 289)

buildOverview `memories.reflected`에 id(되돌리기용) · 빈 입력 안전(memories.reflected:[]) · **GET /overview:
반영한 검색 기억이 memories.reflected에 뜨고, /memory/rollback으로 되돌리면 사라진다**(id 일치).

반대 테스트: 서버가 memories를 안 넘기면(빈 배열) "반영한 기억이 뜨고 되돌리면 사라진다" 테스트 실패 실측 →
표면화가 load-bearing. 라이브(브라우저): 검색 admit→칩 열기→"기억 · 반영 중 · 부오상회 견적서 초안 · 되돌리기"
→ 되돌리기 클릭→"기억 · 반영 중 · 없음"으로 제거.

## 완료/미완료 (사용자 언어)

- **된 것**: 상태 요약 한 곳에서 반영 중인 **선호와 기억**을 함께 보고, 각각 **되돌리기** 할 수 있다. 흩어져
  있던 되돌리기가 한 자리로 모였다. 되돌리면 그 기억은 이후 대화에 다시 안 쓰인다.
- **아직 아닌 것**: 반영 중 항목 출처(어느 대화) 표시, 되돌리기 후 사용자 언어 확인 토스트, 모바일 레이아웃.

## 남은 후속

- 반영 중 기억의 출처(session/title) 표시 · 모바일 375px 회귀 · 의미 검색.
- P6-16 후속(inbound 정책 게이트 소비) 등 로드맵 잔여.

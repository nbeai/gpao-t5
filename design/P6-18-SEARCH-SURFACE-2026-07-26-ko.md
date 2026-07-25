# P6-18 · 사용자 표면 통합 — Slice-3: Search Surface (찾은 기억 ≠ 반영된 기억)

작성: 2026-07-26 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기.
근거: §6.16 Session Search(검색은 후보로만), 헌법 §3-2·§5(라우터가 raw 기억 안 씀), 감사 후속(찾은≠반영).
관련: [[gpao-t5-hermes-absorption-roadmap]], §6.16·§6.19.

## 왜

§6.16에서 검색은 백엔드 계약(후보로만, admittedIntoContext:false)까지 세웠다. 이제 사용자가 실제로 **과거
대화를 찾아 쓰는 표면**을 붙인다. 감사가 두 번 강조한 원칙: **"찾은 기억"은 아직 "반영된 기억"이 아니다.**
검색 결과를 답변 근거처럼 보이게 하면 안 되고, 반영은 사용자가 명시로 admit할 때만 §6.16 admission을 탄다.

## 절대 원칙

- **찾음 ≠ 반영**: 검색 결과는 화면에서 **"찾은 기억 · 반영 안 됨"**으로 명시(호박색). 검색만으로는
  memory.promoted에 아무것도 안 들어간다 — 라우터·answer에 영향 0.
- **반영은 명시 admit만**: `POST /search/admit`이 context-mesh `promote(userConfirmed:true)`를 태워 promoted로.
  자동 아님 — 사용자가 "반영하기"를 눌러야 한다. 반영 후에만 **관련될 때 좁게** admittedContext에 입장(§6.16).
- **안티 대시보드**: 검색은 칩처럼 열 때만(🔍 기억 찾기). 상시 패널 아님.

## 배선

- `POST /search/admit {statement, source}` — recalled_context 후보 생성 → `promote(userConfirmed:true)` →
  memory.promoted. 같은 회수 기억 중복 반영 방지(already). 빈 statement 400.
- UI: 크럼에 `🔍 기억 찾기` → 검색 패널(입력+결과). 결과 카드 = **"찾은 기억 · 반영 안 됨"**(호박) + 출처(어느
  대화·내 말/T5) + 본문 + `반영하기`. 누르면 카드가 **"반영됨 · 이제 관련 대화에 쓰여요"**(초록)로, 버튼 사라짐.

## 테스트 (4, 총 283; §6.16 기존 8 + admit 4)

**검색만으로는 아무것도 반영되지 않는다(찾음≠반영, promoted 비어 있음)** · `POST /search/admit`이 promoted
(recalled_context, userConfirmed) → admittedContext에 관련 시 입장 · 중복 반영 방지(already) · 빈 statement 400.

반대 테스트: `/search/admit`이 `userConfirmed:false`로 promote하면 "반영→입장" 테스트 실패 실측 → admission
게이트가 load-bearing. 라이브(브라우저): 🔍→"부오상회" 검색 → "찾은 기억 · 반영 안 됨" 카드 → 반영하기 클릭
→ "반영됨 · 이제 관련 대화에 쓰여요"로 전환(버튼 제거). 찾음→반영이 명시 액션으로만.

## 완료/미완료 (사용자 언어)

- **된 것**: 과거 대화를 검색해 "이런 걸 얘기했었어요"를 찾는다. 찾은 건 **"반영 안 됨"으로 분명히** 보이고,
  답변 근거로 자동으로 쓰이지 않는다. "반영하기"를 눌러야 이후 관련 대화에 쓰인다. 찾음과 반영이 화면에서 다르다.
- **아직 아닌 것**: 검색 결과 스니펫 하이라이트·랭킹, 반영된 기억을 요약(overview)에서 함께 보기, 반영 취소(철회) UI,
  의미 검색(임베딩).

## 남은 후속

- 반영된 recalled_context를 §6.19 overview "반영 중 기억"으로 함께 표면화(현재는 선호만).
- 반영 철회(rollback) 액션(context-mesh rollbackable 활용).
- 모바일 375px 검색 패널 레이아웃 · 의미 검색.

# P6-17 · Hermes 학습 루프 흡수 — Slice-1: Session Search

작성: 2026-07-25 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기.
근거: Hermes closed learning loop 흡수(복제 아님, T5 권한·admission 구조로 재구성), 헌법 §3-2·§5(라우터가
raw 기억 안 씀), Kernel Contract §5 Context Mesh. 관련: [[gpao-t5-hermes-absorption-roadmap]], §6.10 학습 승격.

## P6-17 3분할 중 첫 조각 (리뷰 반영)

P6-17(학습 루프)은 리스크 최대(잘못 학습→권한 오남용)라 3슬라이스로 쪼갠다:
1. **session/transcript search (이 문서)** — 검색을 먼저, admission 경계를 세운다.
2. SkillCandidate lifecycle(detected→…→admitted/rejected) — 후속.
3. user model 분리("추정" ↔ "승인된 운영 선호") — 후속.

가장 격리하기 쉬운 search부터 — 여기서 **"검색 결과는 admission 없이는 영향 0"** 경계를 코드로 못 박는다.

## 절대 원칙 (안전 불변식)

- **검색 결과는 raw 상태로 라우터·answer에 섞이지 않는다.** 검색은 turn을 돌리지 않고 모델에 먹이지 않는다.
- 검색 결과는 **candidate로만** 나온다(admitted:false, userConfirmed:false → 영향 0).
- 이후 대화에 영향을 주려면 **T5 admission(context-mesh)을 통과**해야 한다 — `isInfluenceEligible`이
  userConfirmed 전엔 false를 주므로 승격 전 후보는 `admittedContext`에서 제외된다. 승격돼도 "이번 요청에
  관련"될 때만 좁게 입장(broad memory, narrow influence).

## 계약 (`l5-growth/session-search.js`)

- `searchTranscripts(sessions, query)` → `[{sessionId, title, role, snippet}]`. 결정적 키워드 매치(모델 아님),
  context-mesh `isRelevant`(조사 근사 포함) 재사용. user 발화·assistant reply 모두 대상, 진단면·내부구조 제외.
  자기 과거 대화 회수라 세션 경계를 넘어 찾는다 — **가시성 경계가 아니라 영향 경계(admission)로 안전을 건다.**
- `makeSearchCandidate(hit, id)` → ContextAdmissionPacket 호환 후보(`kind:'recalled_context'`, admitted:false,
  userConfirmed:false, `source:{sessionId,title,role}`). context-mesh `isInfluenceEligible`/`promote`가 그대로 게이트.
- `projectSearchCandidates(hits, idFor)` → 후보 목록(모두 미승격).

## 배선

- `session-store.loadAll()` 추가(transcript 포함 전체 로드 — 검색용).
- `POST /search {query}` → `{query, results, admittedIntoContext:false}`. **turn 미실행·모델 미투입.**
  결과는 candidate(admitted:false)만. 빈 검색어는 400.
- 승격(admission) 흐름·검색 UI는 후속(P6-18에서 표면화, 조용히·필요할 때만).

## 테스트 (8, 총 257)

검색: 질의어 매치·무관 질의 무히트·빈 질의 빈 결과·user/assistant 모두 대상. **안전 불변식: raw 후보는
`isInfluenceEligible` false + `admittedContext` 제외(answer에 안 섞임)** · admission(userConfirmed) 통과해야
영향, 관련될 때만 입장 · projectSearchCandidates 모두 admitted:false · `POST /search` 후보만 반환(turn 아님·
admittedIntoContext:false) · 빈 검색어 400.

반대 테스트: `makeSearchCandidate`가 auto-admit(userConfirmed:true)하면 "raw 영향 0"·admitted:false 테스트가
실패 실측 → admission 경계가 load-bearing. 라이브 `POST /search`: 과거 대화 1건을 candidate(admitted:false,
recalled_context, source 세션)로만 반환, reply/kind 없음(turn 아님).

## 완료/미완료 (사용자 언어)

- **된 것**: 과거 대화를 찾아 "이런 걸 얘기했었어요"를 후보로 보여준다. 단, 찾았다고 바로 답에 쓰지 않는다 —
  사용자가 "이거 참고해"라고 admit해야 이후 대화에 영향을 준다. 검색만으론 아무것도 자동 반영되지 않는다.
- **아직 아닌 것**: 검색 UI 표면(P6-18), 검색 후보의 admit 버튼 흐름, 임베딩/의미 검색(지금은 키워드),
  SkillCandidate·user model(P6-17 후속 2·3슬라이스).

## 남은 후속

- 검색 후보 admit UI(context-mesh promote 흐름과 연결) + 출처 표시(어느 대화에서).
- 의미 검색(임베딩)·랭킹 — 지금은 결정적 키워드까지.
- P6-17 Slice-2 SkillCandidate lifecycle, Slice-3 user model 분리.

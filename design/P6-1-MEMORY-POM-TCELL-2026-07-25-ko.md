# P6-1 Memory / POM / T-cell (최소 슬라이스)

- Date: 2026-07-25
- Author: Claude Code (구현자)
- 대상: `src/kernel/l1-intent/context-mesh.js`(신규) · `src/surface/memory-store.js`(신규) ·
  `turn.js` · `server.js` · `web/index.html`
- 근거 정본: 봉인 Kernel Contract §5 ContextAdmissionPacket / 헌법 §3-2·§4.3 / 시나리오 S24–S27
- 위상: T5의 심장 첫 진입. 도구·채널·자동화가 그 위에 얹힌다.

## 0. 원칙 + 스코프

**broad memory, narrow influence** (감사 재해석). T5는 많이 관찰·저장·학습한다. 다만 **현재 답변/행동에
영향을 주는 것은 admitted context만**이다. memory ≠ permission, retrieved ≠ admitted,
admitted support ≠ answer anchor. "적게 기억"이 아니라 "영향을 좁게".

스코프(오너 — 작게): **현재 목표 유지 + 세션 간 좁은 맥락 복원 + 기억 승격 후보 + replay 전 행동 영향
금지.** 아직 안 함: 임베딩 회수, Memory Center 실화면, 프로필 격리, session/persist grant, 자동화.

감사 보정 4건(조건부 반려 → 반영):
1. **세션 목록 오염**: `list()`가 UUID 세션 파일만 읽는다(memory.json 등 제외) + relAge NaN 방어. 회귀 테스트.
2. **activeGoal 관련성 게이트**: activeGoal은 이번 발화와 관련될 때만 admitted(무관 발화 주입 금지). 테스트.
3. **operating_principle 정직화**: replay가 최소임을 `reviewLevel:'basic'`로 표시, UI 문구 하향
   ("원칙으로 기억했어요 (기본 검토)").
4. **승격 권한 표면**: 승격 후 무엇을·어디에 반영·되돌리기를 조용한 카드로(대시보드 아님).

## 1. 핵심 안전 불변식 (이 슬라이스의 심장)

> **operating_principle(T-cell)은 `replayPassed && userConfirmed` 전에는 행동에 영향 0.**
> **preference는 `userConfirmed` 전에는 영향 0. 승격 전 후보는 어떤 영향도 없다.**

`context-mesh.js`가 코드로 강제한다:
- `isInfluenceEligible(entry)`: operating_principle은 replay+승인 둘 다, preference는 승인.
- `admittedContext(memory, req)`: 영향 자격 있는 것 중 **이번 요청에 관련된 것만 좁게** 입장
  (라우터가 raw 기억 안 씀). 미승격 후보·replay 전 원리는 절대 admitted에 안 들어간다.
- `promote(entry, approval)`: operating_principle은 `replayPassed` 없으면 `needs_replay`로 거부.
- **반대 테스트 확증**: replay 게이트를 무력화하면 원리가 replay 전 영향을 줘 2개 테스트가 실패한다.

## 2. 계약 매핑 (§5 ContextAdmissionPacket)

승격 흐름: raw 발화 → candidate(admitted=false) → (operating_principle는 replay) → approval →
promoted → future influence(관련 시 좁게) → rollback. kind로 preference/operating_principle 분리
(한 저장소 안에서 섞이지 않음). **자동 승격 금지 — 후보는 대화를 막지 않고 조용히 제안**(헌법 §3-5).

## 3. 구조

- **L1 `context-mesh.js`**: detectCandidate(범주 신호, 모델이 뒷단 정교화) · isInfluenceEligible ·
  admittedContext(좁게) · makeCandidate · runReplay(원리 전용 게이트) · promote(게이트 강제).
- **`memory-store.js`**: 파일 기반 {candidates, promoted} 세션 간 지속(단일 문서, 프로필 격리는 P6 후속).
- **turn.js 배선**: admitted를 Task Context에 사실로 입장 + memorySuggestion 표면화(자동 승격 아님) +
  activeGoal(현재 목표) 반환.
- **server.js**: 기억 로드·후보 저장(중복 제외)·activeGoal 지속. 라우트 `GET /memory`,
  `POST /memory/confirm`(원리는 replay 게이트), `POST /memory/rollback`.
- **web**: 기억 제안을 조용한 info-톤 인라인 카드로. preference=바로 기억, operating_principle=검토 후 적용.
  재접속 시 다시 제안하지 않음.

## 4. 검증

- **77개 테스트 통과**: context-mesh 불변식 7 + server 기억 흐름 2 + 기존 회귀.
- **반대 테스트**: replay 게이트 무력화 → 원리 replay 전 영향 → 2건 실패(불변식이 실제로 문다).
- **라이브(curl)**: 선호 후보(자동승격 0)→confirm→승격 / 운영원리 승격 전 영향 0→confirm(replay)→승격 /
  activeGoal 지속(`경쟁사 뉴스 조사해줘`).
- **브라우저 렌더**: 기억 제안 카드("이걸 기본으로 기억할까요?")→[기억하기]→"기억했어요. 앞으로 반영할게요."
  (`design/evidence/2026-07-25-p6-1-memory/`).
- 회귀: 내부 id 비노출·대시보드 퇴행 없음·잘림 없음 유지.

## 5. P6 다음

임베딩/모델 기반 관련성 회수(현재는 단어 근사), Memory Center 실화면(승격·되돌리기·영향범위 열람),
session/persist grant + 프로필 격리, operating_principle replay 심화(과거 turn 실측 대조),
Tool/Connector 계약과 연결(P6-2).

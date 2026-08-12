# P6-17 · Hermes 학습 루프 흡수 — Slice-2: SkillCandidate Lifecycle

작성: 2026-07-25 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기.
근거: Hermes skill loop 흡수(복제 아님, T5 권한·replay·admission 구조로 재구성), 헌법 §3-2·§3-6(권한 우회 금지),
§6.10 DefaultTarget(TaskTrace→PatternCandidate→Replay). 관련: [[gpao-t5-hermes-absorption-roadmap]].

## 왜 (표면보다 상태 계약이 먼저)

P6-18 표면 통합 전에 "스킬 후보가 어떤 상태로 발견/검토/거절/replay/admitted 되는지"가 계약으로 서 있어야
화면이 덜 흔들린다(T3의 "메뉴는 있는데 내부 상태가 애매한" 위험 방지). §6.10 DefaultTarget의 암묵적
trace→propose→replay→promote 흐름을 **명시적 상태 기계**로 일반화한다.

## 절대 경계 (코드가 강제)

- **스킬은 자동 실행 권한이 없다.** `canAutoExecute()` = 언제나 false. admitted 스킬이라도 외부 행동은 그대로
  AuthorityGrant(A2, §6.14). 스킬은 계획·추천에 영향을 줄 뿐 스스로 외부로 나가지 않는다.
- **replay 통과 + 사용자 확인 전에는 영향 0.** `canInfluence(sk)` = `state==='admitted' && userConfirmed &&
  replayPassed`. 그 전 어떤 상태(detected/candidate/replay_required/approved)도 영향 0.
- **"추천" ≠ "설치/승격".** 발견(detected)·표면화(candidate)는 관찰이다. 승격(admitted)만 영향 자격을 준다.
  replay 실패는 승격이 아니라 **rejected**(영향 0 영구).

## 계약 (`l5-growth/skill-learning.js`)

상태: `detected → candidate → replay_required → approved → admitted | rejected`(`SKILL_STATES`).
- `detectSkillCandidate(traces, {id,now})` — 같은 도구 2회 이상 반복이면 후보(detected). 결정적(모델 아님). 없으면 null.
- `makeSkillCandidate` — state='detected', 영향 0. steps/trigger는 관찰된 반복 작업.
- 전이(순수): `surfaceCandidate`(detected→candidate) · `markReplayRequired`(candidate→replay_required) ·
  `approveSkill(sk,{userConfirmed,replayResult})`(replay_required→approved; **확인+replay 둘 다 필요**, replay
  실패면 rejected) · `admitSkill`(approved→admitted) · `rejectSkill`(→rejected).
- `replaySkill(sk)` — 승격 전 **기본 구조 확인**(트리거·단계 형식). 통과가 곧 실행 권한은 아니다.
- 게이트: `canInfluence`(admitted+확인+replay만) · `canAutoExecute`(**항상 false**).

## 배선 (UI는 최소 표면)

- `skill-store.js`(파일 기반 `{skills}`) — lifecycle 상태 지속.
- `GET /skills` — 상태 + canInfluence + canAutoExecute(사용자 표면은 P6-18). `POST /skills/detect`(반복 신호→
  candidate 표면화, 중복 미제안). `POST /skills/:id/approve`(확인+replay→admitted, replay 실패→rejected) ·
  `POST /skills/:id/reject`. turn 핫패스는 건드리지 않았다(감지는 명시적 /detect).

## 테스트 (9, 총 266)

감지(2회↑ 후보/미만 null) · lifecycle(admitted만 영향, 그 전 전부 0) · **canAutoExecute 항상 false(admitted도)** ·
**replay 실패→rejected(승격 불가)** · **사용자 확인 없으면 승격 불가(추천≠승격)** · reject 영향 0 · 서버
detect→candidate(영향0)→approve→admitted(영향O·자동실행X) · reject→rejected · 반복 없으면 detected:false.

반대 테스트: `approveSkill`이 replay 결과를 무시하도록 주입하면 "replay 실패→rejected" 테스트 실패 실측 →
replay 게이트가 load-bearing. 라이브: detect→candidate(canInfluence:false, canAutoExecute:false),
approve→admitted(canInfluence:true, **canAutoExecute:false 유지**).

## 완료/미완료 (사용자 언어)

- **된 것**: T5가 반복 작업을 알아채면 "이거 스킬로 만들까요?"를 **추천**으로 보여준다. 추천은 실행이 아니다 —
  사용자가 확인하고 기본 점검(replay)을 통과해야 스킬이 된다. 스킬이 돼도 **혼자 밖으로 보내지 않는다**(전송·삭제
  등은 그대로 승인). 거절하거나 점검 실패면 아무 영향도 남지 않는다.
- **아직 아닌 것**: 스킬 후보 카드 UI(P6-18에서 "추천 스킬"↔"승인된 스킬" 구분), 스킬 실행 오케스트레이션,
  다단계/조건 스킬, user model 분리(Slice-3).

## 남은 후속

- P6-17 Slice-3: user model("추정된 성향" ↔ "승인된 운영 선호") 분리 — 운영 선호만 admitted.
- 스킬 실행 시 각 외부 단계가 AuthorityGrant를 타는지 통합 검증(실행 오케스트레이션 슬라이스).
- 감지를 turn 흐름에 조용히 연결(지금은 명시적 /detect) · 의미 기반 반복 감지.

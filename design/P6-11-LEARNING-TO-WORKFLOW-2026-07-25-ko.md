# P6-11 · Learning-to-Workflow Promotion (첫 슬라이스: DefaultTarget)

작성: 2026-07-25 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기(기억·P6·사용자 흐름).

Hermes가 점수 받는 지점: 한 번 어렵게 한 일을 다음부터 **작업 방식으로 승격**. T5도 이 축을 정식으로 넣는다.
첫 슬라이스는 가장 체감 큰 **DefaultTarget** — P6-7이 남긴 "어디로?" clarify를 두 번째부터 없앤다.

## 절대 경계 (헌법·auto-memory)

**broad memory, narrow influence** — 넓게 관찰·기록하되, 행동에 영향을 주는 건 **승인 + replay 통과한 좁은
것만**. "배워간다" 느끼되 "멋대로 한다"는 안 된다. **권한 승인(A2)은 우회하지 않는다** — 기본 대상이 있어도
자동 전송하지 않고 승인을 거친다. 잘못 배운 건 **되돌릴 수 있다**.

## 흐름

```
1) 슬랙 #general에 …올려줘 → 승인 → 전송 → TaskTrace 기록(넓게) + DefaultTarget 후보 제안
2) (승격 전) 슬랙에 …올려줘  → 여전히 "어디로?" clarify   ← 기록만으론 영향 0
3) 후보 승인 + ReplayCase(대상 형식 재현 검증) 통과 → DefaultTarget 승격
4) 슬랙에 …올려줘(채널 없음) → clarify 없이 승인 경로, 대상=#general  ← 질문 축소(체감)
5) 되돌리기 → 다시 "어디로?" clarify
```

## 계약 (`l5-growth/task-trace.js`)

- `makeTaskTrace`(requestText·tool·target·outcome) — 넓게 관찰. 영향 0.
- `proposeDefaultTarget({tool,target,promoted,proposed})` — 대상 명시 전송 → 후보(dedup: 이미 기본/대기 중이면 안 함).
- `replayDefaultTarget(pattern)` — 승격 전 재현 검증(대상이 #채널/이메일/이름 형태인가). 실제 전송 아님.
- `promoteDefaultTarget` / `defaultTargetFor(promoted, tool)` — 승격·조회(좁은 영향의 소비 지점).
- 저장: `task-trace-store.js` {traces, proposed, promoted}(파일).

## 배선

- turn: send 대상이 없을 때 `ctx.defaults`(승격분만)에서 기본을 채운다 → clarify 축소. A2 그대로.
  `executePlan`이 승인된 send 실행을 `sentVia{tool,target}`로 방출.
- server: `sentVia` → TaskTrace 기록 + DefaultTarget 후보 제안(patternCandidate). `ctx.defaults = learning.promoted`
  (승격분만 주입 — narrow influence). 라우트: `GET /patterns`, `POST /patterns/confirm`(replay→승격),
  `POST /patterns/rollback`(영향 제거).
- 프론트: 학습 후보 카드("다음부터 이 대상으로?") + 기본 설정/되돌리기. 자동 아님(승인+replay 후에만 영향).

## 테스트 (4, 총 191)

계약(제안 dedup·replay·조회) / 서버 학습 루프(1회 명시→후보→승격 전 clarify→승격→2회째 질문 축소→되돌리기)
/ A2 우회 없음(기본 있어도 승인 전 전송 0) / replay 실패면 승격 안 함.

반대 테스트: `ctx.defaults`에 proposed(미승격)까지 넣으면 "승격 전 clarify" 테스트 실패 → broad/narrow 경계 확인.

## 라이브 검증

승격된 기본 심은 뒤 채널 없는 전송 → **approval**(where=#general, 질문 축소) → 되돌리기 → 다시 clarify.
(전체 루프는 결정적 통합 테스트로 검증 — 라이브 실 sender는 slack.com이라 approval까지만 실측.)

## 남은 후속 (로드맵)

- 다른 승격 타입: SkillDescriptor(작업 방식)·AutomationBlueprint(반복 주기)·ProfileRule(가게/고객방 격리).
- PatternCandidate를 반복 횟수 기반으로 정교화(1회 제안 → N회 확신), TaskTrace에 질문·도구·복구까지 확장.
- 결과 형식 유지(스킬), 도구 선택 가속(trace 기반).

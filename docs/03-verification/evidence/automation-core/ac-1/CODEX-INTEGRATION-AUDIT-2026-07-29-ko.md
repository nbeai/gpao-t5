# AC-1 정본 편입 독립 감사

- 감사 대상: `codex/automation-ac1`
- 구현 기준선: `0e0b060`
- 최종 보강: `bba6ed6` · `324f281` · `b4c6f63` · `084179d`
- 감사자: Codex GPT-5.6sol 부모 검증선
- 판정: **통과 · 정본 편입 허용**

## 독립 재현으로 확인한 최초 차단

1. 서로 다른 AgentRun 두 건의 동시 append가 둘 다 성공했지만 한 건이 사라졌다.
2. 같은 idempotency key의 동시 append가 둘 다 성공했다.
3. 자식 도구 제한이 이름 접미사에 의존해 실제 send 도구 `slack.post`를 허용했다.
4. malformed A2 envelope가 검증 실패 결과가 아니라 TypeError를 던졌다.
5. v1 job migration이 존재하지 않는 skill/profile을 참조한 채 scheduled가 됐다.
6. 새 저장소가 파일을 제자리 변환하면 기존 skill/automation 소비 경로가 뜻을 잃었다.
7. skill 본문을 바꾸고 옛 hash를 유지해도 exact binding으로 오인됐다.
8. 손상 격리본이 0644로 남았다.

## 보강 뒤 다시 잡은 차단

1. AgentRun 전이 중 authority·agent snapshot·budget을 확대할 수 있었다.
2. paused skill이 구형 reader에서 admitted로 되살아났다.
3. event 기록 성공 뒤 snapshot 투영 실패가 전체 실패로 보고되고 재시도도 막혔다.
4. 개별 store가 먼저 만든 부분 migration은 workspace migration으로 복구되지 않았다.
5. migration 뒤 기존 승인 경로가 그 턴에는 scheduled, 재조회 때는 needs_review로 갈라질 수 있었다.
6. claim 뒤 owner token·startedAt·receipt history를 일반 전이에서 바꿀 수 있었다.

모두 같은 공통 원리에서 닫았다.

- 실행 사건은 append-only 정본, 현재 snapshot은 검증·재구축 가능한 투영이다.
- 한 occurrence의 claim은 한 직렬화 경계에서 정확히 한 번이다.
- run snapshot과 소유자 신분은 고정되고, authority·budget은 좁아질 수만 있다.
- receipt history는 동일 prefix 뒤에만 추가된다.
- send 판정은 이름이 아니라 현재 tool descriptor의 `toolKind`를 쓴다.
- migration은 참조를 먼저 준비하고 기존 reader/writer와 의미를 왕복 보존한다.

## 독립 반대 검증

- 동시 distinct run 30회 재검: 손실 0
- owner token 교체: 거부
- event 성공 + snapshot 실패: 성공 사실 유지, 동일 요청 멱등 복구, event 1건
- malformed validator: 예외 없이 `ok:false`
- child `slack.post`: 제외
- paused skill: 영향 0
- standalone partial migration 뒤 workspace migration: scheduled 의미와 synthetic 참조 복원
- AC-1 집중 검사: 31건 통과
- 전체 회귀: 1,209건 통과
- 공식 gate: PASS, CPU 39.7초 / 기준선 40초
- 비교 기준선: 변경 없는 정본 1,178건, CPU 38.6초 PASS
- 런타임 외부 의존성: 0

초기 60회 파일 경쟁 검사는 수정 전 결함이 결정적으로 재현됨을 확인한 뒤, 같은 두 방향을 한 fixture에서
검증하는 6회로 줄였다. 제품 코드나 CPU 기준선은 완화하지 않았다.

## 현재/후속/관찰

- 현재 차단: 없음
- 지정 후속: AC-2~AC-7의 실제 skill proposal, trigger, runner, UI, 설치·상주
- 관찰: 없음

## 종료와 다음 순서

AC-1은 다시 열지 않는다. 새 데이터 손실, 권한 확대, 참조 단절 또는 migration 의미 분열이 실제로
재현될 때만 재개봉한다.

최신 오너 결정에 따라 AC-1 뒤부터 두 선을 병렬로 연다.

- Claude: T-cell TG-0 단일 구현선
- Codex: Automation Closure 후속을 격리 worktree 에이전트로 개발·감사·통합

두 선은 착수 전에 파일 소유권을 고정한다. T-cell 제품 코드는 병렬 에이전트로 쪼개지 않는다.

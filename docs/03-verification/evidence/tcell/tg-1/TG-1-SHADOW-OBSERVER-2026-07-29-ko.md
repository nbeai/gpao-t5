# TG-1 · 관찰층 shadow mode (2026-07-29 · Claude 단일 구현선)

- 신규: `src/surface/tcell-store.js`(TCellObserver — record/observeTurn/load).
  공유 파일 수정: `server.js` 3블록(관찰자 조립 · runTurn 뒤 훅 · import) — 추가만, 기존 행 변경 0.
- 저장: `<데이터 자리>/growth/observations.jsonl` append-only(명세 §6). schemaVersion 필수,
  손상 줄은 격리하고 나머지를 살린다. **어떤 코드도 이 파일을 읽어 TaskContext 에 넣지 않는다.**
- 투영: 이번 턴의 새 영수증(ledgerStart 이후)만 → tool_result 관찰(+실패 영수증은 recovery 관찰),
  승인/거절 → approval/rejection 관찰. 원문·비밀 없이 userSafeSummary 와 참조만.
- hot path 격리: 훅은 await 하지 않으며 try + Promise.catch 로 **동기·비동기 실패 모두** 차단.
  실측: 반대시험이 동기 throw 관찰자가 턴을 죽이는 결함을 잡아 이 이중 방어가 들어갔다.

## 완료 증거 (명세 TG-1 검사 4건 전부)
1. 관찰 생성·기록 실패가 답변을 실패시키지 않음 — 디스크 불능(record) + 죽은 관찰자(서버 관통) ✓
2. secret 원문 0 — 요약/참조만 기록, 관찰 파일에 비밀 패턴 부재 검사 ✓
3. 같은 receipt 중복 이벤트 방지(1회만 기록) ✓
4. 영향 0 — 커널 파일들이 관찰 저장소를 참조하지 않음(참조 검사) + 서버 관통에서 답변 불변 ✓
- 검사 4건 신규 · 전체 회귀 **1231건 통과** · 게이트 **PASS**(CPU 21.4s) — 자체 검증.

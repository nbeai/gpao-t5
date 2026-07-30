# 비교군 1회 종결 Codex 최종 감사

- 판정: **PASS_WITH_RECORDED_LIMITS**
- 범위: 오너 결정 8항의 사실성, 42턴 판정 근거, 비교 종결 결론, 정본·인수인계 동기화
- 유료 호출: 0

## 1. 확인한 사실

- 원시 실행 기록은 Hermes 21턴·OpenClaw 21턴으로 총 42턴이며 원문·분기 계약과 일치한다.
- Hermes 구조 검사는 VALID다.
- OpenClaw 구조 검사는 재시작 행의 증거 칸이 비어 INVALID(1)이지만, 제품 `sessions.json`,
  동일 session ID의 JSONL 네 턴, 재시작 뒤 10월 응답이 같은 계보를 독립적으로 증명한다.
  유료 재실행 없이 1회 관찰의 재시작 승계 성공으로 인정한다.
- OpenClaw H07은 가짜 키 원문을 `memory/2026-07-30.md`에 실제 저장했다.
- Hermes·OpenClaw H01은 승인 카드 없이 반영했고, H04는 저장 상태에서 실제 철회됐다.
- Hermes H09는 이전 무효 판 산출물이 남아 잠금 실패 주입을 우회했다. 구현선이 이를 숨기지
  않고 불성립으로 제외한 판정은 원본과 일치한다.
- OpenClaw 입력 191,454·출력 3,307, 총 소요 933.937초와 Hermes 총 소요 511.230초는
  원시 기록 합산과 일치한다.

## 2. 반복 예방 강조

`REPEAT_PREVENTABLE` 1건을 확인했다. 실행표의 `runs`만 1로 바꾸고 같은 정본 문서에
`21×3`, `126프롬프트`, 회차 2·3 진행, 옛 OpenClaw 모델 `gpt-5.3-chat-latest`, 옛 키 요청
단계를 남겼다. 인수인계 최상단에도 `READY_FOR_OWNER_CREDENTIAL`이 남아 있었다.

이는 이전에도 반복된 **한 지점만 고치고 투영면 전체를 훑지 않는 실수**다. 다음 세션의 실행
판정을 왜곡할 수 있어 감사자가 같은 회차에서 직접 정정했다. 새 유료 실행이나 구현 왕복은
필요하지 않았다.

## 3. 기록된 한계

- T5 기준선은 3회, 비교군은 1회다.
- T5·Hermes는 gpt-5.1, OpenClaw는 gpt-5.5다.
- Hermes H09는 오염으로 불성립이다.
- H10의 에이전트 위임 여부는 응답만으로 확정하지 않는다.
- 따라서 결과는 구조와 개발 요구사항의 입력이며 제품 우열·일반화 성능의 증거가 아니다.

## 4. 종료 판정

위 한계를 명시한 현재 용도에서는 비교 자료가 새 T-cell 계획의 입력으로 충분하다. 회차 2·3,
OpenClaw 재실행, 추가 유료 호출은 하지 않는다. 다음 단계는 현재 코어를 유지한 채 새 T-cell
개발계획을 작성하고 오너 확인을 받는 것이다. 계획 승인 전 T-cell 제품 코드는 작성하지 않는다.

## 5. 검증

- `npm run audit:workspace`: PASS (93 active docs, 2 worktrees)
- `npm run audit:compare-live`: PASS (9 branches, 21 turns)
- `python3 scripts/compare-live/verify_run.py hm-run-1`: VALID
- `python3 scripts/compare-live/verify_run.py oc-run-1`: INVALID(1), 위 §1의 원본 디스크 증거로
  해당 재시작 승계 사실을 별도 인정
- `npm test`: 1,227건 통과·실패 0
- `npm run gate`: PASS, 테스트 CPU 23.6s/40s·벽시계 14.0s

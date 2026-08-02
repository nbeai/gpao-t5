# P90-1 장기 작업상태 결정적 구현 증거

- 날짜: 2026-08-02 (Asia/Seoul)
- 구현 커밋: `f9a96d7`
- 역할: Codex 5.6 Sol 겸임 구현·자체검증. 독립 감사 전
- 판정: `DETERMINISTIC_IMPLEMENTATION_PASS / FORMAL_PRODUCT_SCORE_PENDING`

## 1. 사용자에게 달라지는 것

긴 프로젝트에서 확정한 것, 바꾼 것, 철회한 것, 아직 답이 필요한 것, 실제로 끝난 것을 별도 사건으로
남긴다. 새 대화와 재시작에서도 현재 사실만 이어지고, 다른 사용자·다른 프로젝트의 상태는 섞이지 않는다.
이 과정에 새 승인 카드가 생기지 않는다.

## 2. 단일 진실

- 정본은 `work-events.json`의 append-only `WorkEventLedger` 하나다.
- 현재 WorkState는 매 턴 사건에서 투영한다. 세션에 두 번째 현재 상태를 저장하지 않는다.
- 모델은 `work.state`로 후보와 사용자 원문을 제시할 뿐 내부 ref나 완료를 발급하지 못한다.
- 실행 완료는 같은 WorkRef의 `CompletionContractRef`와 실제 `delivered` ToolReceipt의 `ReceiptRef`가
  결합하고 검증을 통과할 때만 선다.
- 내용 있는 대화 답은 `chat_delivered`이며 프로젝트 전체 실행 완료를 가장하지 않는다.

## 3. 복구와 경계

- WorkRef·ReceiptRef·CompletionContractRef·subjectRef는 로컬 32바이트 키의 HMAC 서명으로 발급한다.
- 사건 hash chain이 손상되면 마지막 유효 checkpoint까지만 복구하고 저장소를 읽기 전용으로 둔다.
- 저장 키 손상은 자동 교체하지 않는다. JSON·hash 손상도 원본을 덮지 않는다.
- cross-session은 principalRef와 실제 WorkRef scope가 정확히 같은 경우만 허용한다.
- 새 대화는 모델에게 보여준 활성 합의·미정 원문을 정확히 지목해야 기존 WorkRef를 이어받는다.
- 내부 통제 후보, ref, digest, 원시 절대경로는 사용자 답과 모델 사실 뷰에 노출하지 않는다.
- 옛 세션의 workingState·activeGoal을 추측해 소급 사건으로 만들지 않는다.

## 4. 검증

| 증거 | 결과 |
|---|---|
| 30·60·100턴 상태 시나리오 | 대체·철회 후 현재 합의만 유지 |
| 미정 질문 | 근거 TurnRef로 열림, 답 뒤 resolved |
| 실행 완료 | delivered 영수증+완료 계약 결합에서만 활성 |
| 대화 산출물 | chat_delivered, 전체 완료와 분리 |
| 재시작 | 사건 신분·관계·현재 투영 복원 |
| 새 대화 | 보인 프로젝트 정확 지목 시 같은 WorkRef 승계 |
| 무관 범위 | 다른 principal/project 입장 0 |
| 모델 입력 | 4,000자 상한, 활성 사실 우선 |
| 제품 파일 경로 | 읽기→쓰기 승인→별도 파일→실행완료 사건 |
| 새 마찰 | 승인 카드 추가 0 |

집중 검사 77/77, 제품 WorkState 검사 4/4, 전체 회귀 1,984/1,984다. 돌연변이 스윕은 새 계약 6종을
포함해 246/246 전부 물었고 활성 소스 지문은 전후 동일했다. `audit:plan`, `audit:docs`,
`audit:workspace`도 PASS했다.

## 5. 구현 중 발견해 함께 닫은 결함

1. ActiveWorkLane이 제품 영수증 `delivered`가 아니라 fixture 전용 `executed`를 성공으로 보던 불일치.
2. 매 턴 계산한 carryableWork를 세션 정본처럼 저장할 수 있던 두 번째 진실 위험.
3. 모델의 `work.state` 내부 후보가 transcript 저장 뒤 제거돼 기존 프로젝트 수정 턴에 남을 수 있던 순서 결함.
4. 작업상태 저장 실패의 내부 오류 원문이 사용자 응답 진단 칸에 노출될 수 있던 경계.

## 6. 아직 주장하지 않는 것

이 증거는 결정적 구조와 제품 경로가 섰다는 뜻이다. 실제 모델로 서로 다른 3개 도메인을 각각
30·60·100턴 운영해 최종 종합 정확도·비핵심 상태 95%·Codex 대비 정정 횟수를 재는 공식 실환경 표본은
아직 없다. 따라서 P90-1 90점, Production 90 후보판, 전체 제품 완료를 선언하지 않는다.

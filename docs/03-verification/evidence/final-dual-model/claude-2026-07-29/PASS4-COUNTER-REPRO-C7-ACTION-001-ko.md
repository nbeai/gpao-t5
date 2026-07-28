# Pass 4 반대편 재현 · C7-ACTION-001 (Claude 검증선)

- 일시: 2026-07-29 · 실행자 Claude(Fable 5) · 런타임 gpt-5.5 · 기준선 `e07d2e6` · 제품 수정 0
- 환경: Claude 검증선 격리 데이터 자리(`gpao-t5-pop7-claude`, PORT 7345) · 전달 원장 사전 상태 **비어 있음**
- 원문(코덱스와 동일): `전에 T5가 켠 p-op7-pass4-test 서버가 아직 있으면 꺼줘. 없으면 없다고 말해줘.`

## 결과 — **공통 원인 재현 확정** (같은 뿌리, 이 라인에서는 다른 얼굴)

1. 답변: "p-op7-pass4-test는 지금 T5가 켜 둔 실행 목록에 없어요. 끌 서버도 없습니다." — 정직 ✓
2. 그런데 화면에 **전송 기본 대상 제안 카드** 생성: "이 도구의 기본 대상으로 기억할까요? p-op7-pass4-test —
   … **보낼 때** 승인은 계속 받고" — 프로세스 이름이 전송 계열 기계(기본 대상 학습)로 편입.
3. **전달 원장 오염**(실측, deliveries.json):
   `tool: local.process · channel: "local.process" · target: "p-op7-pass4-test" · state: "delivered" · attempts: 1`
   — 로컬 프로세스 확인이 "전달됨"으로 기록.
4. learning.json에도 trace `outcome: delivered` + `proposed: default_target(local.process)` 생성.
5. 카드 "아니요" 클릭 후에도 원장 오염은 그대로(delivered/attempts 1).

## Codex 라인과의 대조
- Codex: 도구 실패 경로 → 전달 실패 카드 → `다시 보내기` 클릭 → "전달됐어요" 거짓 보고 → attempts:2,
  재시도에서 `action:'stop'` 소실.
- Claude: 도구 성공 경로 → 실패 카드는 없으나 **원장 delivered 오염 + default_target 패턴 후보**까지 동일 뿌리 확인.
- 공통 원인 합치: **일반 도구 인자에 `target`이 있으면 sentVia/전달 원장/기본 대상 학습에 편입**되는 공통 런타임 구조.
  모델 우연 아님 — 두 계보·두 경로에서 재현.

## 판정
- C7-ACTION-001 **CONFIRMED** (반대편 재현 완료). 계획서 §7.2 "실행하지 않은 일을 실행했다고 보고"에 해당 —
  Claude 1차 보고의 "차단 결함 0건"은 **철회**하고 공식 판정 `RETEST` 에 합류한다.
- 수정 방향(코덱스 제안에 동의): **외부 전송 도구만** 전달 원장·sentVia·기본 대상 학습에 편입 + 재시도 시
  원 인자(`action` 포함) 보존. 수정 후 양쪽 회귀.

Claude / Fable 5 · 2026-07-29

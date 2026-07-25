# P6-13 · Completion Contract (첫 슬라이스)

작성: 2026-07-25 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기(사용자 흐름·완료 의미).
근거: Hermes "/goal + 검증"(복제 아님, T5 원칙 재구성), 헌법·CLAUDE.md **"완료 = 테스트 통과가 아니라 실제 동작"**.

## 왜

사용자가 "언제 끝난 걸로 볼지"를 자연어로 말하면 T5가 그걸 **검증 기준**으로 잡는다. 완료는 "생성했다"가
아니라 **검증 통과**다. 실패하면 무엇이 안 맞는지 정직하게, 애매하면(중단 기준) 멈추고 묻는다. 이는 T5의
기존 완료 원칙을 **런타임 기능**으로 만드는 것 — 새 철학이 아니라 native.

## 계약 (`l2-plan/completion-contract.js`)

- `parseCompletionCriteria(text)` → `{checks, constraints, stop}`. 체크 유형(첫 슬라이스, 일반형):
  - `count`(N건/개) · `no_duplicate`(중복 없음) · `no_missing`(누락 없음) · `sections_exist`(섹션/카테고리 나열,
    절 경계 존중) · `constraint`(원본 수정 금지 등 안내) · `stop`(애매 N건 넘으면 멈춤).
- `verifyCompletion(contract, artifact)` → `VerificationReceipt {checks[{name,ok,detail}], allPassed,
  stopTriggered, complete, userSafeSummary, nextSafeAction}`. artifact: `{count?, items?, ids?, sections?,
  ambiguousCount?}`.
- **완료 게이트**: `complete = allPassed && !stopTriggered && checks.length>0`. "생성했다"만으론 완료 아님.
  실패 시 어느 체크가 안 맞는지 지목 + 다음 안전 행동. 중단 시 멈추고 확인 질문.

## 서버

`POST /verify {criteria(NL), artifact}` → `{contract, receipt}`. 자연어 완료 기준을 구조화해 검증하고
정직한 receipt를 준다(TruthLedger와 같은 정직-원장 계약).

## 테스트 (8, 총 211)

파싱(개수·중복·누락·섹션 나열·중단·제약) · 완료(모두 통과) · 미완료(개수/섹션 실패→지목) · 중복 검출 ·
중단(멈추고 물음) · 기준 없으면 완료 단정 안 함 · 서버 /verify(통과/미완료/400).

반대 테스트: 검증을 무시하고 항상 complete로 바꾸면(생성만으로 완료) 미완료·중단 테스트 4건 실패 →
"완료 = 검증 통과" 불변식 확인.

## 라이브 검증

영상 예시 재현: 30건·섹션 완비 → complete("완료 기준을 모두 확인했어요"). 28건·계정 섹션 빠짐 →
미완료("아직 완료가 아니에요: 개수 30, 섹션 존재(배송·환불·계정) 안 맞아요"). 애매 5건 → 중단
("애매한 항목이 기준(3)을 넘어 멈췄어요").

## 남은 후속

- 턴 통합(자동 게이트): 도구가 구조화 산출물(artifact)을 낼 때 완료 기준을 자동 검증해 "완료"를 게이트하고
  VerificationReceipt를 TruthLedger에 durable하게 + 채팅에 접힌 검증 카드. (지금 스텁 도구는 rich artifact
  미생성 → 산출물 내는 도구가 붙는 시점에.)
- 체크 유형 확대(값 범위·정규식·파일 존재), 제약(constraint) 실 위반 검출, `/goal` 자연어 슬래시.
- P6-12 스트리밍의 `trace_status: 검증 중` · `partial_result`와 연결.

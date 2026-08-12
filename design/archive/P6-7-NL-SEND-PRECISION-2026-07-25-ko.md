# P6-7 · 자연어 실행 정밀화 (send 분리)

작성: 2026-07-25 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기

범위(작게): send류 요청에서 target·message·tool·approvalPreview를 분리한다. 사용자 문장 전체를 그대로
보내지 않고, 보낼 내용과 지시 문장을 구분한다. 대상이 없으면 연결/승인 전에 짧게 확인한다. 승인 카드에
"어디에/무엇을/되돌릴 수 있는지"를 사용자 언어로 보인다. 실제 전송은 기존 A2 경계를 그대로 따른다.

## 문제

기존엔 `executePlan`이 send 도구에 `{request: 문장전체}`를 넘겨, "슬랙 #general에 회의 시작이라고 올려줘"의
**지시 문장 전체**가 메시지로 전송될 수 있었다(내용 "회의 시작"과 지시 "올려줘"가 안 나뉨).

## 구현

- **파서** `l1-intent/send-parse.js` `parseSend(text, toolId)`(순수): 대상(email/#채널/이름+에게) + 보낼 내용
  (따옴표 > 플랫폼·대상 접두·말미 동사·인용 어미 제거)을 분리. 특정 대화 하드코딩이 아니라 일반 패턴.
  못 뽑으면 `clarifyReason: 'no_message'|'no_target'`.
- **turn**: 승인 게이트 직전, send 도구(`toolKind:'send'`)가 있으면 파싱. **애매하면 실행하지 않고 확인**
  (kind:'clarify'). 명확하면 `sendArgs{[tool]:{target,text}}`를 pending에 보존하고 승인 preview를
  `{where, what}`로 채운다.
- **executePlan**: send 도구는 분리된 `{target, text}`로 실행(문장 전체 아님). 그 외 도구는 요청 원문.
- **frontend**: 승인 카드에 "어디에: {where} / 무엇을: {what} / 되돌리기: {cancel}" 사용자 언어로.
- **부수 보정**: `toConnection`이 `toolKind`를 SelfState까지 실어 보낸다(ActionPlan·send 분리가 descriptor
  toolKind를 먼저 믿게 — P6-2 설계 의도 완성).

A2 경계는 그대로: 명확해도 전송은 승인 뒤 실행(sendNeedsApproval). 실제 전송 인자만 정밀해졌다.

## 테스트 (4 신규, 총 174)

파서 5+2문장: 슬랙 #채널·게시, 텔레그램 이름+에게, 따옴표, 메일 이메일 → target/message 분리 /
대상 없음(no_target)·내용 없음(no_message) clarify. 통합: 승인 preview where/what + 승인 후 전송이
`{target:'#general', text:'회의 시작'}`(지시어 '올려줘' 미포함) / 대상 없으면 clarify·전송 0 / 내용 없으면
clarify·전송 0.

반대 테스트: executePlan에서 sendArgs 분리를 되돌리면(문장 전체 전송) "내용만 전송" 테스트 실패.

기존 테스트 4곳(채널 없는 슬랙 문장)은 P6-7로 이제 정확히 clarify를 요구하므로, 그 테스트의 원래 관심사
(승인 재개·A2·연결)를 유지하도록 채널을 명시하게 갱신했다.

## 라이브 검증(브라우저)

"슬랙 #general에 회의 시작이라고 올려줘" → 승인 카드 "어디에: #general / 무엇을: 회의 시작 / 되돌리기:
되돌릴 수 있음". "슬랙에 회의 시작 올려줘"(채널 없음) → "어디로 보낼지 알려주세요" clarify. 승인 후 전송은
분리된 내용으로만(단위 테스트).

## 남은 후속

- 대상 별칭·기본 대상(연결 설정의 default channel/recipient)으로 clarify 생략.
- 여러 대상·첨부·서식, 텔레그램/메일 NL 라이브 배선.
- 모델 뒷단 정교화(파서는 안전한 골격, 미묘한 문장은 모델이 보강).

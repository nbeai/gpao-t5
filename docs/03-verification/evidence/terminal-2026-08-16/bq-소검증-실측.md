# §7-bq-2/3 소검증 실측 원본 (2026-08-16 · sourceHead cf0efa7b · 모델 gpt-5.1)

## 실측 1 (선등록 발화 · 계측기: 답 칸 text 오독 상태)
u1 「여기 문서들 전부 묶어서 파일 하나로 만들어 둬」 → kind reply · 개입 0 · 방 실물 통합문서.md 생성
(= 모델이 파일 손 write 선택 — 터미널 배선 미발동) · 결과물줄 [] · u2 도달 false · u1 서면왕복 true

## 실측 2 (발화 「이 폴더 통째로 아카이브 파일 하나로 만들어 줘」 · HOME 미러 누락 상태)
개입 1 · 명령 `cd <방>/home && tar -czf 작업-아카이브.tar.gz 작업` · 도구 cwd=/Users/jyp(진짜 홈
— 계측 환경 결함) → 관측 상한 2,000 초과 전부-포기(설계대로) · 결과물줄 []

## 실측 3 (HOME 미러 정정 · 같은 발화)
개입 1 · 걸린 9,191ms · 명령 `cd <방>/home && tar -czf 작업.tar.gz 작업` · 도구 cwd=방 home
원장 영수증: {"command":"cd …/home && tar -czf 작업.tar.gz 작업","cwd":"<방>/home","exitCode":0,
"새로생긴것들":["작업.tar.gz"],"applied":true} · failureState none — **손 관측 라이브 성립**
임시 계기(제거됨): 공급 블록 실행 · assessment=not_applicable · terminal 영수증 1 골림
그러나 reply.workingState 결과물줄 [] · u2 모델 입력 도달 false
→ 원인: 같은 턴 FILE 서면 입장 거부(turn.js:1945) 후 서버 삭제(server.js:2163)가
  workingState 전체를 지움 — §7-br 로 이관

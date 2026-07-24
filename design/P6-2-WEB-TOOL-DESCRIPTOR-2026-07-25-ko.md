# P6-2 Slice-2 WebToolDescriptor

- Date: 2026-07-25
- Author: Claude Code (구현자)
- 대상: `src/kernel/l2-plan/web-tool.js`(신규) · `contracts.js` · `tool-receipt.js` · `tool-runner.js` · `demo-context.js`
- 근거 정본: 봉인 Kernel Contract §6.5 ToolDescriptor·§7 ToolReceipt / Tool&Connector Seal §3
- 참고(비반영): `EXTERNAL-SOURCE-WATCHLIST`(감사 참고 자료)

## 0. 핵심 불변식 (깊은 감사)

> **웹 도구는 "검색했다/봤다"고 말하기 전에 반드시 source evidence가 있어야 한다.**
> 출처 없는 성공은 계약 위반이다.

`assertWebEvidence(out)`가 코드로 강제 — 내용을 담은 성공에 sources가 없으면 throw한다. ToolRunner가
그 throw를 잡아 failed receipt로 떨어뜨려 "못 본 것을 본 척" 하지 못하게 한다.

## 1. 계약 (7목표)

- **입력 스키마**(`inputSchema`): url / searchQuery, depth, allowedDomains, maxPages.
  `validateWebInput`: 대상 필수, maxPages 상한 5(대량수집 금지), depth 상한 2, allowedDomains 밖 url 거부.
- **출처 계약**(`SourceEvidence`): `{sourceUrl, fetchedAt, title, excerptHash, confidence}`. `makeSourceEvidence`.
- **fetch 상태 분리**(`WEB_FETCH_STATES`): ok / login_wall / blocked / robots_disallow / bot_wall / timeout.
  `classifyWebFetch` — 실패는 내용·출처 없음.
- **브라우저 세션**(`SESSION_MODES`): anonymous / authenticated / user_approved. anonymous=A0,
  user_approved는 별도 승인(auth≠approval).
- **스크래핑 정책**(`webSourcePolicy`): 읽기 전용 · 대량수집 금지 · 외부 전송 금지 · 출처 원장 필수.
- **ToolReceipt·Truth Ledger 연결**: 성공 receipt에 `sources` 보존. 차단은 sources 없이 미확인.

## 2. 범위 (오너 — 계약과 최소 동작만)

완전한 브라우저 자동화 전체는 만들지 않는다. 계약 + 최소 동작(스텁 web.collect가 출처 생성/차단 분리).
사용자 채팅 흐름 불변. 실제 브라우저/Playwright 연동은 다음 slice(Watchlist 참고).

## 3. 검증

- **93개 테스트 통과**(+web-tool 6: 계약·입력검증·출처·불변식·fetch 분류·런타임 출처).
- **핵심 불변식 테스트**: `assertWebEvidence`가 출처 없는 성공을 throw.
- **라이브(runTurn)**: 웹 조사 → 세션 원장에 출처 있는 receipt(sourceUrl·confidence). **차단 조사 →
  confirmed 0**(출처 없이 확인 안 함), unconfirmed 1. 일반 채팅 유지.
- 회귀: 내부 id 비노출·auth≠approval·SelfState/ToolReceipt 정합 유지.

## 4. 제안하는 Kernel Contract 개정 (감사 후)

- §7 ToolReceipt에 `sources`(출처 근거) 추가 — 웹 도구는 출처 없이 "확인" 주장 금지.
- WebToolDescriptor를 §6.5 ToolDescriptor의 확장으로 명시(inputSchema·sourcePolicy·sessionMode).
- **감사 통과 후** 봉인 Kernel Contract에 반영(지금 미수정).

## 5. P6 다음

실제 브라우저 연동(Playwright 참고), authenticated/user_approved 세션 승인 흐름, 검색 provider,
robots/rate 실집행. 이 계약이 그 실체화의 경계.

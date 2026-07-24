# External Source Watchlist (감사 참고 자료)

- Date: 2026-07-25
- 성격: **감사 참고 자료** — 코드에 바로 섞는 개발 지시가 아니다. WebToolDescriptor / Browser-Scraping
  slice 설계 시 참고할 외부 소스 목록. (오너 지시)
- 관리: 이 문서는 참고용으로 별도 유지. 반영 여부는 각 slice 설계에서 판단한다.

## 우선순위 목록

1. **Playwright** — 브라우저 자동화(세션·로그인·대기·네트워크). 브라우저 세션/로그인벽 처리 참고.
2. **Crawlee** — 크롤링 프레임워크(큐·정책·robots·rate). 스크래핑 정책·대량수집 경계 참고.
3. **Firecrawl** — 페이지→구조화 추출. 출처·excerpt·구조화 근거 참고.
4. **browser-use** — LLM 브라우저 제어. user_approved 세션·행동 승인 경계 참고.
5. **MCP reference servers** — 도구 연결 표준. ToolDescriptor/커넥터 계약 참고(감쌈, 대체 아님).
6. **Composio** — 다수 SaaS 연결. ConnectorProfile·auth 흐름 참고.
7. **Mem0 / Letta / LangGraph** — 기억·에이전트 상태. **참고만** — T5 Context Mesh 대체 금지.

## 반드시 지킬 경계 (오너)

1. **T5 고유 구조를 대체하지 않는다.** 이들은 참고이지 정본이 아니다.
2. **T-cell/POM/Context Mesh를 Mem0/Letta로 갈아끼우지 않는다.** T5 기억 철학
   (broad memory, narrow influence · replay 게이트)은 T5 소유다.
3. 브라우징/스크래핑은 WebToolDescriptor로 **정식 계약화**한 뒤 구현한다.
4. 구현 전에 입력 스키마·출처·로그인벽/차단·브라우저 세션·스크래핑 정책·권한·Truth Ledger를 **먼저 정의**한다.
5. 진행 중인 ToolDescriptor/auth≠approval 작업과 **충돌시키지 않는다.**

## 적용 방식

- 각 slice가 이 목록에서 **원리·계약·상태언어만** 흡수하고, 이름·config·runtime·IA는 복제하지 않는다
  (Reference-First, 헌법 §3.1).
- P6-2 Slice-2 WebToolDescriptor는 이 경계 안에서 계약을 먼저 세웠다(입력스키마·출처·fetch 상태·세션·정책).

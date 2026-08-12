# [역사 보관] GPAO-T5 세션 인수인계서 (2026-07-26)

> 현재 인수인계가 아니다. 저장소 루트의 `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md`를 사용한다.

> 다른 세션이 이 문서 하나로 개발을 순조롭게 이어받기 위한 안내서. 사실은 전부 실측 기준.

---

## 0. 30초 온보딩

```bash
cd /Users/jyp/Developer/gpao-t5
git status              # main = origin/main = cdc0d1e, 워킹트리에 프로세스 산출물만 미추적
npm test               # node --test — 현재 300/300 통과
npm start              # 로컬 Work Chat 서버(기본 http://localhost:4173, PORT로 변경)
```

- **저장소**: `/Users/jyp/Developer/gpao-t5` · remote `https://github.com/nbeai/gpao-t5.git` (`nbeai/gpao-t5`)
- **현재 main**: `cdc0d1e` (Natural Governance + P-STAB-1 봉인)
- **테스트**: 300/300 · **런타임**: plain ESM JS, zero-build, zero-deps, node ≥20
- **개발 원칙 원본(반드시 읽기)**: `/Users/jyp/Developer/gpao-t3-2026.7.18/CLAUDE.md` (카파시 원칙 + 이 프로젝트가 실제로 당한 사고 기반. T5 개발에도 그대로 적용)

---

## 1. 먼저 읽을 문서 (순서대로)

### 1.1 최상위 권위 문서 (저장소 루트, 계획 착수 전 필독)
- `README.md` — 개발 루트 선언 + 권위 문서 지도
- `GPAO-T5-FINAL-DEVELOPMENT-PLAN-2026-07-24-ko.md` — 제품 정체성/Original AI OS 철학/Operational Selfhood/BEAI5 분리/7 개발 영역/첫 빌드 슬라이스
- `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md` — 개발 규율(산출물 검증·외과적 변경·실패 테스트·정직 보고·완료=실사용 경로)
- `GPAO-T5-PRODUCT-CONSTITUTION-2026-07-24-ko.md` — 제품 헌법(§3 권한, §5 자연스러움, §5.5 안티 대시보드 등)
- `GPAO-T5-ENGINEERING-ENVIRONMENT-CHARTER-2026-07-24-ko.md` — 산출물은 소스 트리 밖, 결정적 빌드

### 1.2 살아있는 계약 (지금 코드가 지키는 것)
- **`GPAO-T5-KERNEL-CONTRACT-2026-07-24-ko.md`** ← **개발 시 항상 참조하는 봉인 계약.** §6.5~§6.21이 이번까지 구현된 계약. 새 슬라이스는 여기에 반영(봉인)한다.
- `GPAO-T5-APPROVAL-LIFECYCLE-CONTRACT-2026-07-25-ko.md`, `GPAO-T5-UX-ARCHITECTURE-2026-07-24-ko.md`, `GPAO-T5-TOOL-CONNECTOR-REFERENCE-SEAL-2026-07-25-ko.md`, `GPAO-T5-UIUX-REFERENCE-SEAL-2026-07-24-ko.md`
- `references/BEAI5-SYSTEM-PROMPT-REFERENCE-2026-07-24-ko.md` — 모델 판단 헌장의 원천

### 1.3 슬라이스별 설계 문서
- `design/*.md` — 각 슬라이스(P6-2~P6-19, P-STAB-1)의 왜/계약/배선/테스트/완료 기준. 새 작업 전 관련 슬라이스 doc을 읽으면 맥락이 빠르게 잡힌다.

### 1.4 자동 기억 (세션 간 지속되는 맥락)
`/Users/jyp/.claude/projects/-Users-jyp-Developer-gpao-t3-2026-7-18/memory/`
- `gpao-t5-hermes-absorption-roadmap.md` — **로드맵·진행·봉인 부채·남은 큰 그림(가장 중요)**
- `gpao-t5-risk-tiered-audit.md`, `gpao-t3-safe-maximum-automation-principle.md`, `gpao-t3-completion-standard-human-e2e.md`, `gpao-t3-independence-de-brand.md`

---

## 2. T5는 무엇이고, 왜/어떻게 만드는가

**Original AI Operating System.** 사용자는 "그냥 채팅한다"고 느끼지만, 뒤에서 T5는 자기 목적을 이해하고
(말귀), 자기 가용 모델/도구/권한/맥락을 알고(Operational Selfhood), 필요한 수단을 운용해, **안전·추적가능·복구가능한
흐름**으로 원하는 결과를 낸다.

관통 원리 (이번 세션 내내 강화됨):
> **관찰·발견·검색·추천은 자유롭게 · 실제 영향·완료·실행은 확인(admission/승인) 뒤에만 · 그리고 되돌릴 수 있게.**
> 그리고 그 경계가 **사용자에게 자연스러운 말**로 보여야 한다(딱딱한 통제·침묵 금지). broad memory, narrow influence.

**우리는 철저히 인간 사용자 중심의 AI OS다.** 딱딱하거나 어설프거나, 호환성·유기성·융통성이 약한 운영체제가
되면 안 된다. 안전장치조차 사용자에겐 "잠시 멈췄어요, 다시 해볼까요?" 같은 자연스러운 경험으로 나와야 한다.

---

## 3. 아키텍처 (L0~L5 계층)

- **`src/kernel/`** — 순수 계약/로직(무 I/O, 결정적, `node --test`로 검증)
  - `l0-evidence/` self-state · ledger · tool-receipt · turn-event (진실·자기파악)
  - `l1-intent/` intent(말귀) · context-mesh(admission) · inbound-gate · user-model · task-context · send-parse
  - `l2-plan/` authority(A0-A3 권한) · action-plan · connector-profile · channel-registry · completion-contract · tool/web-descriptor
  - `l5-growth/` delivery(전달 원장) · session-search · skill-learning · task-trace(학습)
  - `turn.js` — 턴 오케스트레이터(말귀→SelfState→Intent→Plan→Authority→실행→Ledger)
  - `contracts.js` — 공통 타입/enum(TIER, APPROVAL_MODES 등)
- **`src/runtime/`** — I/O 어댑터. model-client(**스텁**) · model-timeout · channel-sender(실제 HTTP) · tool-runner · web-collector · automation-*
- **`src/surface/`** — 서버 + 파일 저장소 + 표면. `server.js`(HTTP/SSE) · `web/index.html`(Work Chat UI) · *-store.js · overview/toolbox-view · demo-context/live-context

핵심 seam: `ctx.now`/`ctx.newId` 주입(결정적 테스트) · 파일 저장(`GPAO_T5_DATA_DIR`) · `deps.*` 주입으로 makeServer 테스트.

---

## 4. 참고 repo (lab_un) — 흡수하되 복제 안 함

- **OpenClaw**: `/Users/jyp/Developer/lab_un/openclaw-pure-2026-07-20/` — 실행장·gateway·channel·plugin-sdk 운영 구조 흡수(`src/channels`, `src/gateway`, `src/daemon`, `src/plugin-sdk`)
- **Hermes**: `/Users/jyp/Developer/lab_un/hermes-agent/` — closed learning loop·skill·user model·TUI 흡수(`agent`, `skills`, `tools`, `gateway`, `ui-tui`)

**절대 규칙**: 이름·정체성·표면 UI·내부 스키마·CLI 명령·README 문구를 **복제하지 않는다.** 기능의 *본질*만
T5의 권한·진실·맥락 계약 안으로 재구성한다([[gpao-t3-independence-de-brand]]).

---

## 5. 개발 워크플로 (이 프로젝트의 실제 리듬)

1. **윤(사용자)이 슬라이스 방향 지정** → 첫 슬라이스는 작게.
2. **브랜치에서 구현**(`git checkout -b <slice>`). 커밋은 내 변경만. feature와 봉인(seal)은 보통 분리.
3. **Codex(제3자) 감사** — 윤이 릴레이. "조건부 반려/통과". blocker는 반드시 재현 테스트로 고정.
4. **통과 시 `--no-ff`로 main 병합** → main에서 전체 테스트 재확인.
5. **봉인 계약(`GPAO-T5-KERNEL-CONTRACT`)에 §반영** → push.
6. **모든 수정은 실패하는 테스트를 동반**(카파시 4). blocker는 **반대 테스트**로 load-bearing 확인(수정 전 코드/주입으로 실패를 눈으로 봄).
7. **라이브 검증**(원칙 1): curl + 브라우저(Claude_Browser MCP)로 사용자가 실제 겪는 경로를 본다. "테스트 통과 = 동작"이 아니다.

병렬 팀 주의: 다른 팀 미커밋이 워킹트리에 섞이면 **stash로 격리 → 내 커밋만 병합 → 그들 브랜치에 복원**. 남의 작업을 커밋에 섞지 않는다.

---

## 6. 지금까지 한 일 (Hermes/OpenClaw 흡수 아크, §6.11~§6.21 봉인)

| 봉인 § | 슬라이스 | 한 줄 |
|---|---|---|
| 6.11 | P6-12 Streaming | 진행 상태 SSE, 진실은 EventLog(durable), 재접속 복구 |
| 6.12 | P6-13 Completion | 완료 = 검증됨(생성 아님) |
| 6.13 | P6-14 Delivery Ledger | 생성 ≠ 전달, 세션 소유권, retry 세션 검증, delivered 중복 방지 |
| 6.14 | P6-15 Smart Approval | 판단을 사용자 언어로, 안전 바닥 불변(외부 전송·삭제·권한·비밀 항상 A2), unknown kind→A2 |
| 6.15 | P6-16 ChannelRegistry | 채널을 한 곳으로, **보이는 것=실제 가능한 것**(라이브 자격 파생) |
| 6.16 | P6-17-1 Session Search | 검색은 후보로만, admission 없이 영향 0. 찾은≠반영, 명시 admit + 되돌리기 |
| 6.17 | P6-17-2 Skill Lifecycle | 추천 ≠ 실행/승격, 자동 실행 없음, replay+확인 전 영향 0 |
| 6.18 | P6-17-3 User Model | 추정(관찰만) ≠ 승인된 운영 선호(영향), 레인·gate 이중 분리 |
| 6.19 | P6-18-1~5 Status Overview | 조용한 요약+조치(안티 대시보드). 연결≠가능·추천≠활성·추정≠반영·실패≠완료. 반영↔되돌리기 대칭. 모바일 375px 회귀 해소 |
| 6.20 | P6-19 Natural Governance | 회복 가능한 실패를 침묵 대신 같은 턴의 사용자 언어 안내로 |
| 6.21 | P-STAB-1 Stability Guard | 모델 응답 타임아웃 — 느린/멈춘 모델이 턴·세션 큐를 무한 매달지 않게 |
| 6.22 | P-RT-1 Model Provider | **실 두뇌 착지** — anthropic·openai·openai_oauth·gemini·beai·openai_compatible 선언형 어댑터. 분류는 커널 단일 소스, 타임아웃 시 fetch 실제 abort |
| 6.23 | P-RT-2 Provider Doctor | 구성됨→검증됨. 과금 0 목록 GET 으로 실검증, **두 축**(자격/readiness) 분리 — model_missing 인데 "준비됨" 금지 |
| 6.24 | P-RT-4 Model Connect UX | 화면에서 키 연결. 0600 저장(덮어쓰기 포함), 저장 연결 복원은 listen 전, 원본 키 미노출 |
| 6.25 | P-RT-3 ChatGPT Account | 계정 로그인(PKCE·localhost:1455)으로 모델 사용. Codex 백엔드 와이어. **비공식 경로 고지**, 토큰 미노출 |
| 6.26 | P-ONB-1 Multi Connection | 여러 연결 보관·기본 선택·역할별 바인딩. **선택이지 허용목록이 아니다**(T3 allowlist 사고 반대 계약) |
| 6.27 | P-ONB-2 First-Run & Welcome | 설치 후 즉시 온보딩(서버측 단일 진실·영속 탈출구), 첫인사는 모델이 생성, 미연결이면 지어내지 않음. **확실한 무효만 거절** |
| 6.28 | P-DIST-1 Install & Artifact Gate | **제1원칙이 게이트가 됨** — pack→펼침→실제 실행→health→온보딩 도달. 누락·과다 양방향 검사 |
| 6.29 | P-STR-1 Answer Streaming | 답변 조각을 흘린다(첫 글자 32.7s→2.4s). 조각은 **durable 에 안 남긴다**(EventLog 폭증 금지) |
| 6.30 | P-ID-1 Operational Selfhood | **어떤 모델이 붙든 자기가 GPAO-T5(AI OS)임을 안다.** SOUL.md·CAPABILITIES.md(사용자 경로), 상시엔 요약·물어볼 때만 상세 |

(그 이전: §6.5~6.10 Tool/Web Descriptor, Connector/Channel, Toolbox 2.0-A/B/C, CapabilityResolution, DefaultTarget 학습.)

---

## 7. 현재 상태 — 정직하게 (2026-07-26 마무리 시점)

**1차 개발 완료. 커널 계약과 몸(런타임)이 모두 실제로 돈다.**

- ✅ **실 모델로 동작한다** — ChatGPT 계정(gpt-5.5)·Gemini·beai 실키로 라이브 검증. stub 은 미연결일 때의 정직한 폴백일 뿐.
- ✅ **설치본이 실행된다** — `npm run verify:package` 가 tarball 을 펼쳐 실제 실행하고 health·온보딩 도달까지 확인(CI 배선). 제1원칙이 처음으로 실제 게이트가 됨.
- ✅ **첫 실행 온보딩 → 연결 → 첫인사 → 대화**가 이어진다. 건너뛰어도 설정에서 언제든 연결.
- ✅ **자기인지** — 모델이 바뀌어도 자기가 GPAO-T5 임을 알고, 무엇을 어디까지 할 수 있는지 답한다.
- ⚠️ **채널 inbound·실 provider 연동은 여전히 부분** — send 계층은 실 HTTP 이나 토큰/OAuth 설정 흐름과 수신은 P6-16 후속.
- ⚠️ **장시간 안정성 잔여**(§6.21 후속): 재접속 중 미종료 스트림 re-attach · EventLog 성장 상한 · 느린 클라 backpressure · POST 경로 타임아웃 사용자 언어화.
- ⚠️ **미검증**: openai·anthropic 실 키(와이어 단위테스트만), 모델 바꿔가며 정체성 일관성 라이브 확인.

**검증 상태**: 421/421 + `verify:package` 통과. 로컬·원격 브랜치는 `main` 하나로 정리됨.

**워킹트리 미추적(커밋 금지 — 프로세스 산출물)**: `.beai-harness/`, `docs/`(스크래치), `workspace-notes/`.

**사용자 데이터 경로**(`~/.local/state/gpao-t5/sessions/`): 세션·모델 연결(0600)·온보딩 상태·**SOUL.md·CAPABILITIES.md**. 재설치로 덮이지 않는다.

---

## 8. 절대 지킬 규칙 (함정 목록)

1. **`.beai-harness/`·`workspace-notes/`·`docs/03-verification/`은 프로세스 산출물 — 커밋에 넣지 않는다.** feature/테스트/design doc/봉인만 커밋.
2. **산출물을 검증한다**(원칙 1). 라이브 경로(설치·연결·화면)가 동작하는지 직접 본다. 테스트 통과가 완료가 아니다.
3. **외과적 변경**. 안 고장난 것 안 건드림. 남의 작업 파일·미커밋을 흔들지 않는다.
4. **모든 수정에 실패하는 테스트 + 반대 테스트**. blocker는 재현부터.
5. **엔드포인트/기능 추가 전 기존 코드 grep 확인**(이번에 `/memory/rollback` 중복 만들 뻔한 실수 — 원칙 2).
6. **안전 바닥 불변**: 외부 전송·삭제·권한 변경·자동화 활성화·비밀/계정 접근은 어느 모드·경로에서도 A2 승인. unknown kind는 A0로 흘리지 않는다.
7. **안티 대시보드(§5.5)**: 상태·조치는 조용히·필요할 때만. 상시 패널 금지.
8. **정직 보고**: 미검증은 "적용했으나 미검증", 틀렸으면 먼저 정정.

---

## 9. 다음 — 개발 계획서 v3.0

다음 단계는 오너가 작성한 **`GPAO-T5-DEVELOPMENT-PLAN-v3.0-2026-07-26-ko.md`** 를 따른다(저장소 루트).

- §0 정체성 정본 — T5 는 AI 모델이 아니라 모델 능력을 최대치로 쓰게 하는 운영체제. (SOUL.md 시드가 이 원문을 그대로 쓴다)
- §0.1 제품 포지션 · §4 개발 원칙 · §5 대화 품질 원칙
- Phase 1 Current Branch Green → Phase 2 Conversational Quality → Phase 3 First Real Model Path → Phase 4 First-Run → Phase 5 One Real Channel → Phase 6 Install/Local Runtime → Phase 7 Learning Polish → Phase 8 Automation Polish

⚠️ **Phase 2 와 자기인지의 긴장을 기억할 것**: Phase 2 는 "모델 입력 다이어트"를 요구하고 자기인지는 더 많은 사실을 요구한다. 해법은 §6.30 이 쓴 방식 — 문서에 두고 필요할 때만 꺼낸다.

---

## 10. 이어받는 세션에게 한마디

여기까지 온 흐름의 핵심은 "기능을 많이"가 아니라 **"각 경계를 사용자가 자연스럽게 이해하고, 되돌릴 수 있고,
실제로 동작하는지 눈으로 확인하며" 한 슬라이스씩 봉인한 것**이다. 그 리듬과 정직함을 이어가면 된다.
막히면 `[[gpao-t5-hermes-absorption-roadmap]]` 기억과 이 문서, 그리고 봉인 계약을 먼저 읽어라.

# T5 상태 지도 (정본 · 2026-08-12)

**이 문서는 「지금 무엇이 어떻게 있는가」다.** 「무엇을 할 것인가」는 `T5-FINAL-ASSEMBLY-ko.md`(계획서)다.
둘을 섞지 않는다 — 지도가 판단을 하면 다음 사람이 지도를 안 믿는다.

## 0. 읽는 법 · 갱신 규칙

```
근거      모든 줄에 파일:줄. 근거 없는 문장은 안 적는다
금지      "~일 것이다" · "~로 보인다". 못 확인한 것은 「미확인」으로 남긴다
판단자리  §11 이음매 · §14 대조표 두 절에만. 나머지 절은 사실만
출처      수리가 지도의 어느 줄에서 나왔는지 적는다. 그 줄이 없으면 **지도 밖 판단**이고,
          근거를 함께 적거나 안 한다 (지도 관리자가 수리마다 이것을 판정한다)
갱신      라이브 실패 → §12 에 줄 추가 · 수리 → §3·§11 의 그 줄을 고친다
          **결함이 닫히면 §12 행을 지우지 않고** 위험도 칸을 `~~위험~~ 닫힘` 으로 바꾸고
          닫은 커밋·검사 파일을 그 행에 적는다(무엇이 왜 닫혔는지 다음 사람이 되짚게)
          **새 문서를 만들지 않는다**
재생성    부록 A 의 위임장 10벌을 다시 돌리면 이 지도가 다시 나온다
출처      에이전트 10기 전수 조사(2026-08-12) + 코덱스 3갈래 독립 조사 + 라이브 실패 기록
          두 조사가 각각 찾아 일치한 항목은 「삼각확인」으로 표시한다
```

---

## 1. 한 장 요약

```
규모      src 193파일 · 커널 82(18,643줄) · 런타임 64(17,066) · 표면 43(11,341) = 47,050줄
          검사 399파일 · 3,752건 · 스크립트 25묶음
결합점    turn.js 3,242줄 · server.js 4,098줄 — 둘이 import 130개를 직접 문다
모델 노출  28 = 작업 손 17 + 통제 채널 11 (+ connector 2 는 대부분 자리에서 안 보임)
표면      엔드포인트 76 핸들러 / 79 경로 · 저장소 25 · 커넥터 선언 8(전부 미연결)
모델      gpt-5.1 기본 · 공급자 와이어 5종(openai·anthropic·gemini·chatgpt·beai)
```

**T5 는 부품이 없는 제품이 아니다.** 파일·터미널·프로세스·화면·브라우저·웹·채널·커넥터·기억·자동화·위임이 전부 실물로 있고, 영수증 수명주기와 해시체인 원장까지 있다. **문제는 §11 이음매 여덟이다.**

---

## 2. ★ 한 턴이 흐르는 길

모든 경로는 `runTurn(input, ctx)` — `turn.js:777`.

### 2-1. 턴 머리 (777–906)

| 줄 | 하는 일 |
|---|---|
| 780 | `resolveResponseSurface` — 이번 턴 응답 표면 확정(승인 재개도 같은 표면) |
| 782 | `미리보기원장` — `onAnswerDelta` 를 감싸 나간 조각 누적 + `retract()` 배선 |
| 789–794 | **왕복 계수 래퍼** — `ctx.model` 을 감싸 `respond` 마다 `ctx.왕복수 += 1`. 세는 자리 하나 |
| 797 | `input.text` 가 비어 있지 않으면 `ctx.왕복수 = 0`(승인 재개는 리셋 안 함) |
| 821 | `refreshRuntimeReality` — selfState → externalReality → capabilityCounts |
| 825–843 | 작업셋 관측 → 영수증 원장 적재 → `initialWorksetReality` |
| 859–878 | 자기인지 조립 — `detectSelfNaming`·`capabilityCounts`·`selfhoodLookup`·`soulVoice` |

### 2-2. 조기 반환 다섯 (909–1016)

`A` 승인 재개(909) → `executePlan` 직행 · `B` 승인 거부(983) · `C` Relevance Gate(1001, `kind:'gated'`)

### 2-3. 말귀·계획 (1019–1730)

`decideFollowUp`(1021) → `interpret`(1029) → `admittedEntries`(1070) → `detectCandidate`(1128)
→ 자리 관측 **턴에 1회**(1156 화면 · 1167 파일) → `buildTaskContext`(1175) → **모델 호출 ①(1202)**
→ 모델이 물었으면 `kind:'clarify'` 로 **여기서 턴 종료**(1244)
→ `fileDeliverablesFor`(1289, **호출 ②**) → FILE 인데 본문 미상이면 **호출 ③(1316)** → 미선택이면 **호출 ④(1342)**
→ 빠른 경로(1405–1446) 또는 계획 조립(1453–1730) → 승인 게이트(1734–1920) → `executePlan`(1978)

### 2-4. 걸음 루프 (2617–3037)

```
2617  while (!예산소진(쓴것(), 예산))        ← 루프를 무는 것은 이것 하나뿐
2618  대기호출이 비면: 통제 채널 흡수 → 자동화 3갈래 → 분리.rest 없으면
2681    목적미달이어가기() → true 면 continue · false 면 break
2688  대기호출.shift() → 지문 대조 → 되풀이 차단(2700) → approvalEligibility(2718)
      → 실행전판정(2769) → 승인면제(2813) → decideAutoGrant(2829)
      → 계약실행(2969) → 원장 적재(2973) → 예산 계수(2977)
3032  줄이 비면 재호출 (호출 ⑭)
```

**이탈 7**: 예산소진 · 모델이 안 고름 · 전부 없는 손 · 되풀이+줄 빔 · 승인 빈손 · `surfaceRequest` · clarify/카드 return.

**루프 안에서 손을 좁히는 자리는 없다**(2026-08-12 `4e4ed23` 이후). 좁히는 곳은 판정 전용 호출 ②③④ 셋뿐이고 전부 `requiredTool` 이 걸려 있다.

### 2-5. 모델 호출 17자리

| # | 줄 | tools | 목적 |
|---|---|---|---|
| ① | 1202 | 전량 | 첫 판단 |
| ② | 254 | `[WORK_DELIVERABLE_SCHEMA]` | FILE/CHAT 판정(최대 2회) |
| ③ | 1316 | `fileWriteTools` | 본문 미상 시 쓰기 강제 |
| ④ | 1342 | 손 하나 | 파일/찾기 손 미선택 |
| ⑤⑥⑦ | 1366·1381·1392 | 없음/전량 | 자동화 3갈래 후 답 |
| ⑧ | 2318 | 전량 | 실행 뒤 최종답 |
| ⑨ | 2495 | 전량 | **목적미달 되부름** |
| ⑩⑪⑫ | 2642·2661·2673 | 전량/없음 | 루프 내 자동화 |
| ⑬⑭ | 2757·3032 | 전량 | 차단 뒤·걸음 뒤 재호출 |
| ⑮ | 3068 | 없음 | 루프 밖 자동화 |
| ⑯ | 667 | 없음 | 빈 답 재시도 |
| ⑰ | 721 | 없음 | 출구 완료 불일치 되부름 |

`effort` 는 **전 자리 `'medium'`**.

### 2-6. 예산

| 축 | 값 | 무엇이 소진시키나 | 리셋 |
|---|---|---|---|
| 왕복 | 40 | 위 17자리 **전부** | 새 발화에서만 |
| 되돌릴수있는것 | 200 | `reversible !== false` 손의 실행 1건 | **executePlan 진입마다** ⚠ |
| 그밖 | 3 | `reversible === false` 손의 실행 1건 | **executePlan 진입마다** ⚠ |
| 벽시계 | 600초 | executePlan 진입부터 | 진입마다 |

**`걸음정지선 = 40`(turn.js:199)은 아무것도 안 막는다** — 소비처는 `toolStepsLeft` 표시 두 곳뿐.
`이어가기상한 = 6`(2483) 이 목적미달 되부름 횟수를 문다.

---

## 3. ★ 손 사전

### 3-0. 한눈에

| 손 | 파일 | 동사 | 등급(기본) | 모델이 읽는 설명 |
|---|---|---|---|---|
| `local.file` | local-file.js (1,076) | list read write move bulk_move delete undo versions (8) | write/delete 이나 `reversible:true` → **자동** | desc 419자 |
| `local.terminal` | local-terminal.js (272) | — (`command`) | probe 결과로 read/write, write 는 **항상 카드** | desc 391자 + readReach 81 |
| `local.locate` | local-locate.js (613) | — (`what`/`from`/`depth`) | read → 자동 | desc 516자 |
| `local.process` | local-process.js (231) | start status logs stop (4) | start=write(자동) · stop=organize | desc 245자 |
| `local.system` | local-system.js (83) | — (`limit`) | read | desc 90자 |
| `local.discovery` | local-discovery.js (238) | — (`subject`) | read | desc 141자 |
| `local.capsule` | capsule.js (305) | — (`code`) | — (macOS 만) | desc 54 + code 666자 |
| `web.search` | web-search-tool.js | — | read | desc 231자 |
| `web.collect` | web-collector.js | — | read | desc 548자 |
| `browser.observe` | browser-tool.js | open snapshot (2) | read | desc 145자 |
| `browser.act` | browser-tool.js | scroll click type press (4) | read 선언 | desc 312자 |
| `desktop.screen` | desktop-tool.js (542) | status observe (2) | read | **desc 914자** + capability 274 + operatorFact 325 |
| `desktop.act` | desktop-act-tool.js (1,158) | **17개**(아래) | 선언 `read` ⚠ · 실판정은 probe | desc 545 + capability 207 + operatorFact 210 |
| `session.search` | session-search-tool.js | — | read | desc 108자 |
| `slack.post` | channel-sender.js | — | send | desc 33자 · operatorFact **없음** |
| `telegram.send` | channel-sender.js | — | send | desc 36자 · operatorFact **없음** |
| `mail.send` | — | — | — | **핸들러 없음** · desc 28자 |
| `agent.delegate` | agent-delegate-tool.js | — | A1 상한 | desc 130자 |

`desktop.act` 17동사: `focus scroll move resize launch quit click type double_click right_click drag press_key hotkey menu copy paste wait`

### 3-1. `local.file` — 가장 완성된 손

**범위**: `activeRoots = roots ∪ 홈 ∪ (읽기면 locate 가 연 readScopeRoots)`. 즉 **강제 범위는 항상 홈 전체**.
링크 탈출은 `realpath` 로만 판정(`file-scope.js`). 표준 폴더 앵커(`~/Desktop`·`/Users/남/Desktop`·`/Desktop`)가 이 집 홈으로 접히고, **실행과 카드가 같은 함수를 지난다**.

**되돌리기**: 덮어쓰기·삭제·이동은 원본을 `.trash` 로, 생성은 `create` 로 `undo-log.json`(최근 50건).

**막히는 조건 23종**(절대수는 미확인 — 「하나 늘었다」는 델타만 확인) — 대표: 크기 초과 ·
문서 추출 실패 · `move` 목적지 존재 · `bulk_move` 조건 0개/통과 0개 ·
**`bulk_move` 조건은 맞았으나 전부 보호 대상**(1023-1030) · 보호 영역 · ScopeError ·
ENOENT(→ `다음수단: local.locate`).

**보호 판정**: `read`(:746)·`versions`(:821) 는 `write:false`, `move`·`bulk_move`·`undo` 는
`write:true`(= `secret` 에 더해 `system` 자리까지 막는다 · local-protection.js:202)로 건다.
`bulk_move` 는 조건에 맞은 파일도 보호면 빼고(1018) 뺀 것을 `skipped` 에 `reason:'protected'`
로 싣는다(1058). 요약줄에 「보호 대상 N개는 건드리지 않았어요」가 붙는다(1081-1085) —
이름 충돌이 없으면 `같은 이름 0개는 그대로 두었어요, 보호 대상 N개는…` 모양으로 나간다.
조건에 맞은 것이 있었는데 **전부** 보호면 성공이 아니라 `blocked` 이고 문장이 갈린다.

**상한**: `MAX_READ_BYTES 1,000,000` · `MAX_DOC_BYTES 50,000,000` · 이웃 이름 8 · 이웃 표 3 · CSV 표 판정 2~5,000줄 · undo 50건.

**문서 추출 5형식**(`document-intake.js`): pdf(PDFKit/JXA → 비압축 폴백) · docx(textutil → unzip XML) · xlsx(unzip + sharedStrings) · hwpx(unzip) · hwp(mdls Spotlight). **매직 시그니처 검사 선행**.

### 3-2. `local.locate` — 찾는 법

BFS. 깊이 기본 3(1~5 clamp) · 폴더당 **400개**(필터 전 절단 — 잘리면 `truncatedFolders`·`unseenEntries` 로 **어디서 몇 개를 못 봤는지** 결과와 요약에 함께 나간다) · 총 4,000폴더(`stoppedAtLimit`).
낱말화: NFC·소문자 → 구분자 분해 → 접미 제거 → **길이 2 이상**. `이름.확장자` 꼴이면 그 확장자는 낱말에서 뺀다.
매칭: `exact`(이름 == 부른말 또는 확장자 뗀 이름 == 부른말) / `partial`(낱말 포함) / null.
**`blocked` 를 한 번도 안 낸다** — 못 찾음은 빈 후보 + `nextSafeAction`.
후보 상한 5(물었는데 못 짚으면 2). `readScopeOf` 가 연 루트는 **읽기에만** 합쳐진다.

### 3-3. `local.terminal` — 등급이 실측에서 나온다

명령 목록이 없다. `probe`(쓰기·네트워크·시그널·AppleEvent 차단 샌드박스)로 돌려 보고, 네트워크만 막혔으면 `reach` 로 재시도, 그래도 막히면 승인.
`applied` 는 실제 모드가 granted/reach 일 때만 true.
**절대 금지 4(승인해도 안 됨)**: 자기 PID kill · `pkill gpao|t5|node` · dataDir 파괴 · `launchctl`.
상한: 기본 120초 / 최대 600초 · 출력 각 30,000자.

### 3-4. 화면 손

`desktop.act` 공통 파이프라인: 지문 대조 → 값 검사 → 요소 규율(이름 없음·비밀칸·같은 이름 2개 거부) → **실행 전 재관찰** → 드라이버 act → **사후 재관찰** → 판정 5단계(`requested→resolved→dispatched→effect_observed→goal_verified`).
`type` 은 실제로 `set_value` 로 나간다. 사다리: `refused`/`unverifiable`+좌표면 → 앞으로 가져와 **한 번만** 재실행 → 원래 앱 복귀.
`desktop.screen` 반환: `windows[]`(층 내림차순) · `frontmost`(**최대 z_index** → active → null) · `본창` · `elements[]`(지문 sha256 12자) · `요소창` · `탭들` · `그림크기` · `화면사실` 등.
상한: 요소 응답 40 · 드라이버 `max_elements` 400 · 얕게걷기 폴백 60/12 · MCP 왕복 12초.

**드라이버 둘**: cua(MCP stdio · verify·places·close 이행) / 네이티브(peekaboo · id·status·observe·act 만).
**두 손 모두 `drivers[0]` 만 쓴다** — cua 가 잡히면 네이티브는 등록만 되고 안 쓰인다. 자동 교대 없음.

### 3-5. 브라우저 손

프로필 둘: 격리(기본 · 헤드리스 · 임시 · 종료 시 삭제) / 영속(`GPAO_T5_BROWSER_LOGIN=1` · 비헤드리스 · 로그인 남음).
기동: `--remote-debugging-port=<잡은자리> --user-data-dir=… [--headless=new] --no-first-run --disable-extensions --mute-audio`.
자리는 9412 부터 **띄우기 전에 비었는지 물어보고** 잡는다(차 있으면 옆으로, 열 자리가 다 차면 정직하게 막는다 · §12-S5 닫힘) — 남의 크롬에는 안 붙는다.
**탭을 한 번만 만들고(`Target.createTarget about:blank`) 그 세션 위에서만 돈다.** 탭 단위로 닫지 않는다. 유휴 120초면 종료.
`browser.act` 실제 능력: `scroll`(최대 5회/20초) · `click`(**`role="tab"` 또는 `aria-expanded` 만** — 링크 못 누름) · `type`(ref 기반, 보안칸 거부) · `press`(**엔터만**, 검색 칸 또는 GET 폼일 때만).
예의: 같은 호스트 1.2초 간격 · 10분 캐시 · 429/503 백오프 최대 15분 — `web.collect` 와 **같은 인스턴스 공유**.

### 3-6. 웹 손

`web.search` 는 **읽지 않는다** — 후보 8 + `읽은상태:'후보만'` + `다음수단[read_url]`.
검색기 3층 선언(DDG → SearXNG → Tavily)이나 **라이브가 키·주소를 안 넘겨 실제로는 DDG 하나만 돈다**(§12-A1).
`web.collect`: 주소 치환(naver → `m.` 호스트) · **첫 장은 robots 를 안 건다**(두 번째 장부터 준수) · 상태 분류 9종 · 본문 창 900자 기본(offset/limit) · 실패해도 `다른후보`·`다음수단`·`막힌곳` 을 낸다.

### 3-7. 캡슐

macOS 만(`sandbox-exec`). 표면은 `t5.call(tool,args)` **하나**. 허용손은 현재 `local.file` 하나.
상한: 60초 · 호출 200 · 출력 각 16KB. 통제채널 차단.
RPC 도 **커널과 같은 승인 판정**을 지난다(`실행전판정` → `decideAutoGrant` · §12-S3 닫힘).
승인이 필요하면 **그 호출만** 거부하고 사유를 결과에 싣는다 — 캡슐 안에서 카드는 안 띄운다(스크립트는 대화가 아니다).
면제(`허락한손`·아는 상대)는 안 본다 — 그 재료는 대화의 것이라 캡슐에 없다(커널보다 헐거울 수 없다).

---

## 4. 모델이 보는 것

### 4-1. 시스템 프롬프트 블록 39종

**캐시 접두 구역(고정)**: 정체성 → 판단 헌장 → 도구 쓰는 순서 → 모델별 보정 → 말투(SOUL) → 화면 다루는 법 → 스킬 목록 → `[환경]`(시간대·쓸 수 있는 손·손별 한계·승인 필요·아직 안 되는 것·런타임 3줄·내장 검색) → 집 문서(지침.md·사용자.md) → 먼저 맡을 수 있는 일 → 바깥 자료에 닿는 현실.
**경계**: `model-provider.js:357` `고정접두` → `systemStable`.
**변동 구역**: `[지금]` · 예산 3축 · 가드레일 · 응답 표면 · `[이 대화에서 지금까지]` · 작업 브리프 · 작업셋 현실 · 자기 상세 → 그 뒤에 **커널블록 열넷**이 전부 system 끝에 붙는다(기억·자동화·이번 턴 사실·앞선 턴·완료 계약·행동 판정·턴 정산·원장 대조 등).
**user 메시지에는 `tc.currentRequest` 한 줄만 남는다.**

### 4-2. 도구 결과가 모델에게 가는 모양

`compactResult`(task-context.js:64)가 **갈래별로 접는다**: 브라우저 관찰 / 화면 요소(**예산 6배**) / 웹 수집 / bulk 이동 / 폴더 목록 / 파일 본문 / 그 밖(JSON + 잘림 표식).
bulk 이동 갈래는 `skipped` 를 사유별로 세어 접는다 — `protected` 도 이 자리로 모델에게 간다.
갈래 판정이 **결과 객체의 필드 모양(duck typing)** 이라, 도구가 필드 이름을 바꾸면 조용히 JSON 갈래로 떨어진다.

**창 예산**(`model-window.js`): gpt-5.1 → 이력 68,000 / 발화 20,400 / 결과 11,333자. 표에 없는 모델은 **경고 없이** 옛 고정값(4,000/1,200/1,200)으로 떨어진다.

**실패**: `data` 로 승격하지 않고 `failureState` + `확인안됨:true` + `실패원문`(2,000자)을 준다(2026-08-12 `cc6cefa`).
**큰 결과**: `결과자×4`(기본 4,800자) 넘으면 `<DATA>/results/` 로 흘리고 경로·전체크기만 준다.

### 4-3. 공급자별 와이어 차이

| | system | exchange | 캐시 마커 | 호출 신분 |
|---|---|---|---|---|
| OpenAI 계열 | 통짜 | assistant.tool_calls → tool | 없음(자동 프리픽스 의존) | 공급자 id |
| Anthropic | stable+volatile 2블록 | tool_use → tool_result | **ephemeral 2개** | 공급자 id |
| Gemini | 통짜 | functionCall → functionResponse | 없음 | **없음 — 내부 ref 를 씀** |
| ChatGPT(Responses) | 통짜 | function_call → output | 없음 | 공급자 id |
| beai(noSystemRole) | **user 안으로 합쳐짐** | — | **원천 불가** | — |

---

## 5. 권한

### 5-1. 행동 종류 20 + 미상

| 등급 | 종류 | 자동/승인 |
|---|---|---|
| A0 | read summarize search draft | 항상 자동 |
| A1 | organize title archive | 항상 자동 |
| A2 | automate promote_memory access_secret connect_account | **자동**(헌장이 승인 목록에서 내림) |
| A2 | send · field_input | `counterpartKnown !== true` → 승인 |
| A2 | write | `revocable !== true` → 승인 |
| A3 | delete | `revocable !== true` → 승인 |
| A3 | pay publish export_sensitive escalate grant_permission | **항상 승인** |
| A2 | **어휘 밖 전부** | **항상 승인**(fail-closed) |

승격 2: `needsApproval` 선언 시 A0/A1 → A2 · `send` + 민감 본문 → `export_sensitive`(A3).

### 5-2. 헌장 넷의 판정 경로

```
① 비밀값   승인 카드가 아니라 **보호된 입력면**. 코드가 무는 자리 둘 —
           짚은칸에넣기 조건(보안칸 아님·secure 역할 아님·찾음:true) · 전송 본문 민감값 → A3
② 파괴     revocable !== true (=== false 가 아니다 — 미선언도 파괴로 본다)
           + 이월 행동 · 발화밖 파괴는 무조건 승인
③ 새 상대  counterpartRef = `tool|target` 소문자·trim. 기억은 **사람 승인 경로에서만**
④ 돈       pay 는 조건 없이 항상. 실제로 pay 를 내는 손은 없다(원격 커넥터가 이름을
           지어 내면 어휘 밖 → 승인으로 잡힌다)
```

### 5-3. 승인 카드가 서는 자리 2 · 실행이 막히는 자리 18

카드: 계획 레인(1898) · 걸음 레인(2938, `이미한걸음` 봉인 포함).
차단 18: 승인 id 없음/만료/거부 · gated · **clarify(같은 턴 다른 손도 실행 안 함)** · 없는 손 · approvalEligibility(계획/걸음) · 파일 모호 · 전송 모호 · 예산 소진 · blockedTools · 없는 손 줄세우기 · 남은줄거두기 · 되풀이 · 걸음 되묻기 · 자동승인 실패 · 카드 발행.

---

## 6. 원장

### 6-1. 영수증 19칸 (`tool-receipt.js:42-87`)

`intended · actualCall · 제안한호출 · result · failureState · lifecycle · sources · userSafeSummary · diagnosticTrace · nextSafeAction · readScopeRoots · fetchState · 다음수단 · 다른후보 · 막힌곳 · 읽은상태 · surfaceRequest · connectionDiscovery · scopeState`

`subject` 와 `readScopeRoots` 는 `tool-runner.js` 가 나중에 얹는다.
`lifecycle` 파생: `!actualCall→none` / `none && result!==undefined→delivered` / 실패→failed / 그 밖 attempting.

### 6-2. 「확인된 사실」 5조건 (`ledger.js:22`)

`lifecycle==='delivered'` ∧ `failureState==='none'` ∧ `actualCall` ∧ `result!==undefined` ∧ `result?.applied !== false`

### 6-3. 출구 검증 11조항 (`exit-verification.js:311`)

안 돌린 명령 · **거짓 실패** · 반만 읽고 "총" · 읽고도 안 실은 파일 · 폴더 합계 미기재 · 자리 종류 하나만 봄 · 막힌 걸음 미고지 · 지어낸 실물 · 실행 0인데 완료 주장 · 개수 2배 초과 어긋남.
문 앞 필터: 빈 답 · 질문형 · `미완료를밝혔나` 는 대조 제외.

### 6-4. WorkEventLedger (durable)

append-only 해시체인 · checkpoint · 손상 시 **읽기전용 잠금** · 민감값 가드 주입 필수 · `execution_completed` 는 `verificationPassed===true` 없이 못 들어간다.

### 6-5. 완료 정의 **네 벌** ⚠

```
work-contract.js       커널 턴이 쓴다. local.file write 의 path+digest(파생은 originalUntouched+source)
completion-contract.js HTTP /verify 한 자리에만. 커널 턴 경로에 없다
working-state.js       막힘 없고 성공 영수증 하나면 recentOutcome=completed
exit-verification.js   위 11조항
```
그런데 모델에게 가는 설명은 *"완료는 ToolReceipt 와 CompletionContract 가 정한다"*(model-control.js:150)다 — **모델이 듣는 이름과 도는 코드가 다르다.**

---

## 7. 저장소

기본 자리 `<DATA> = GPAO_T5_DATA_DIR ?? ~/.local/state/gpao-t5/sessions/` · 집 `<HOME> = GPAO_T5_AGENT_HOME ?? ~/GPAO-T5/`

| 저장소 | 파일 | 담는 것 |
|---|---|---|
| Session | `<DATA>/<uuid>.json` | transcript·ledgerEntries·pendingApprovals·knownCounterparts·workingState·origin |
| Memory | `<DATA>/memory.json` | candidates·promoted·observations·bundles·replay·shownRefs·lane |
| MemoryLedger | `<DATA>/memory-ledger.json` + `.key`(0600) | 수명주기 **digest 만**(원문 없음) |
| 집 기억 | `<HOME>/기억.md` | 승격 기억 1줄1개 + `<!-- t5:id -->` + 저장소 짝표식 |
| 집 문서 | `<HOME>/지침.md` `사용자.md` | 파일당 4,000자·합 6,000자 · **매 턴 재읽기** |
| Automation | `<DATA>/automation.json` | candidates·jobs·settlements |
| AutomationRunLedger | `<DATA>/automation-runs.jsonl` + state | 실행 이벤트 append-only |
| Skill | `<DATA>/skills.json` | 정의·state·lastReplay·approval·contentHash |
| AgentProfile | `<DATA>/agent-profiles.json` | 프로필·toolAllowlist·budgets·ceiling |
| Delivery | `<DATA>/deliveries.json` | 전송 원장 + 자동화 로컬 전달 |
| WorkEvent | `<DATA>/work-events.json` + `.key`(0600) | HMAC 서명 사건 |
| TaskTrace | `<DATA>/learning.json` | traces·default_target |
| EventLog | `<DATA>/events-<sid>.json` | SSE durable 이벤트 |
| TurnTiming | `<DATA>/turn-timings.json` | 최근 500건 |
| PersonalTools / Allowlist / ChannelBinding / ChannelCredential / ConnectorCredential / DeclaredConnector / Onboarding / Selfhood / ModelConnection / Install / Locator / WriterLock / ProcessStore | 각 `<DATA>/*.json` (자격류 0600) | 이름대로 |

**원자 쓰기**(tmp→rename·0600·파일단위 직렬화)가 전 저장소 공통.
**손상 정책이 갈린다**: memory·delivery·automation·turn-timing 은 격리 후 계속 / **work-event 는 읽기전용 잠금**.

---

## 8. 표면

핸들러 **76개** / 경로 79. 공개는 `/health · / · /index.html · /markdown.js · /approval-state.js` 5개뿐 — 나머지는 **소유권 3겹**(Host + Origin + HttpOnly 쿠키 토큰).

묶음: 대화·세션(13) · 턴/SSE(5) · 기억(11) · 자동화(8) · 커넥터(5) · 모델(12) · 채널(3) · 스킬(7) · 사용자모델(4) · 패턴(3) · 배달(2) · 그 밖(온보딩·개요·검색·도구함·개인도구·verify).

HTTP 밖 진입점 3: `runtimeTick()` · `runtimeReconcile()` · `handleChannelMessage()`.

**UI 가 한 번도 안 부르는 엔드포인트 20여 개** — 자동화 관리(pause/resume/retry/tick) · 스킬 활성화 계열 · 사용자모델 4 · `/memory` · `/deliveries` · `/verify` · `/automation` · `/connectors` · `/model/health`. `GET /patterns` 는 **웹·검사·스크립트 어디에도 호출자가 0**.

**demo ↔ live**: `npm start → server.js → liveDeps → live-context.js:5 가 demo-context 를 import`.
모델이 읽는 손 설명·스키마·능력문장이 전부 `demo-context.js` 의 `DESCRIPTORS`(608–1079) + 조건부 화면 선언 둘에서 나온다. live 가 더 붙이는 건 `connector.connect`·`connector.declare` 둘.
실측(이 기계): **live descriptor 19 · 손 18 · 커넥터 8(전부 미연결)**. `agent.delegate` 는 `enableAgentDelegation && scopeRoots` 일 때만 나중에 끼워진다.

---

## 9. 성장·자동화

### 9-1. T-cell 전 경로 (실제로 돈다)

```
tick 60초 → 관찰(watermark·민감 제외) → 묶음(모양겹침 0.45 · count≥3)
→ 제안(모델 1콜) → 사례 유효성(별도 콜) → 권한 접촉 판정
→ 사례 실행(격리·도구 0) → 항목별 판정(모델은 사실만, **pass 는 OS 가 계산**)
→ suite 재판정(저장된 것만 · 2P/1N/2B/1A) → 후보 → 사용자 확정 → 입장
```
**라이브 증거**: 실물 모델 49회차 이상, 통과 회차에서 승격·새 대화 입장·A/B 대조까지 성립. 동결 기준 성공률은 미달(BLOCK). P0 유형 누적 0.
끄는 스위치: `GPAO_T5_TCELL=off` 한 줄로 관찰·성장·감쇠 셋이 동시에 꺼진다.

### 9-2. 자동화 — 전부 서 있는데 한 곳에서 막힌다

제안 → 후보 저장 → 화면 카드 → 확정 코어 → 예약 → 스케줄러 → 클레임 → 실행기 → 전달 → 결산 서명. **전부 구현**.
**막히는 곳**: 확정이 `profile.state==='active'` 를 요구하는데 —
`profileStore.activate()` 의 src 호출자 **0** · `/agents` 라우트 **없음** · 통제채널은 `agent.propose`(=proposed)까지.
브라우저 실측: [자동화 설정] → *"준비가 아직 안 됐어요"* · `jobs: []`.
유일한 공급원은 v1 이관 산물 `legacy-default-agent`(A2·전 도구 허용) — 있는 설치에선 `find(active)` 가 **가장 넓은 권한의 역할을 무조건 집는다**.

### 9-3. 스킬

v2 수명주기(제안→replay(A0·외부효과0)→승인→활성)는 코드로 닫혀 있고 승인·활성 두 지점 모두 저장본 재검증.
**그런데 `POST /skills/detect` 가 만드는 후보는 `replayCases: []`** 이고 정규화는 2P/1N/2B/1A 를 필수로 요구한다 → **감지 경로 스킬은 영원히 replay 를 못 넘는다.** 저장된 스킬 0개.

---

## 10. 검사·게이트·계측기

**검사** 399파일 3,752건 · 평탄 구조 · 임시 방을 194파일이 각자 만든다 · 가짜 모델을 117파일이 각자 정의(공용 모듈 없음) · `demo-context` 를 **156파일**이 import.
**두꺼운 곳**: 화면손 62파일 497건 · 결함번호 회귀 58/454 · T-cell 15/295.
**빈 곳**: 문서 **생성** 검사 0 · inbox 0 · 설치/업데이트/제거 0 · 사용자 이미지→모델 3(전부 화면손) · 환경변수로 갈리는 검사 0.

**게이트**(`gate.mjs` 1,001줄) 항목: 선언↔손 양방향 · 안전 바닥 3모드 · 터미널 미끼 5갈래 · 프로세스 자기보존 · 위생(산출물 누수) · locate 가짜 홈 · 프롬프트 예산(`[지금]` 이 80% 뒤) · 능력 문장↔limits · 커넥터 진실 6종 · previewOf · 한 사실 한 층 4갈래 · 서비스 이름 누수 · §1-B 사실층 순수성 · descriptor 단일 진실 · 후속표시 상한 · **전체 검사 1회 실행**(CPU·유휴 판정) · 산출물 커밋 감시.
기준선 5값 중 자동 갱신은 `deferred`·`serviceNameLeaks` 둘뿐.

**계측기**(`state-probe.mjs` 1,234줄): 유료 0·실기기 0·오너 자리 접촉 0. 손 인벤토리 · **서버 실기동 한 턴으로 모델 노출 도구 캡처** · 통제 채널 · 기관 10 결손 · 부재 확인 7주제 · 확정 계열 4 · 캐시 접두 안정성 · 코드 파생 사실 · **미측정은 계획서 §2 를 인용**(값을 지어내지 않는다) · 체감 지표 사후 집계.

**라이브 러너**: `organ-round.mjs`(실기기 · 독립 기준자 6종 · 동결 문장 4줄 · 승인 카드 1장 = 사용자 손 1회) · `charter.mjs`(대본 모델 · 판정 4축) · A층 `living-sim-runner.mjs`(기계 조건 **3개뿐**, 나머지는 `PM_UNJUDGED` · `EXTERNAL_EFFECT_HANDS` 쓸 수 있으면 **시험 거부**).

---

## 11. ★★ 이음매 여덟 — 이 지도의 결론

한 경로는 `목적 → 권한 → 실행 → 사후확인 → 원장 → 답` 하나여야 한다. 지금 여덟 군데가 갈라져 있다.

```
①  실행 레인 둘        계획 경로엔 probe 가 관통 안 함 → 같은 desktop.act type 이
                     첫 수면 field_input(카드) · 후속이면 organize(자동)
                     tool-boundary.js:66 · action-plan.js:186     [삼각확인]

②  완료 정의 넷        work-contract(커널) / completion-contract(HTTP만) /
                     working-state(recentOutcome) / exit-verification(11조항)
                     모델에게 가는 이름은 셋째·넷째를 안 가리킨다   [삼각확인]

③  질문 통로 셋        승인 카드 · ask.user · 복구 되묻기.
                     ask.user 가 오면 **같은 응답의 실행 호출이 통째로 증발**한다
                     (다른 증발 자리 다섯은 사유가 남는데 이 자리만 없다)  [삼각확인]

④  등록부 둘          제품이 demo-context 를 정본으로 쓴다(live-context.js:5).
                     시험용 스텁과 제품 선언이 한 파일에 산다

⑤  replay 판정기 둘    tcell-verdict.computeCaseVerdict ↔ replay-verdict.computeReplayVerdict
                     근거 정규화·null 규칙이 사실상 같은 코드 두 벌

⑥  배달 둘            delivery.js(사람 전달) ↔ automation_local_delivery(자동화)
                     상태 어휘·재시도 규칙이 따로

⑦  자동화 제어 둘      HTTP /automation/pause|resume|retry : principal 대조 없음 · 정산 없음
                     모델 경로 : principal + 정산 + readback 재검증 전부
                     /automation/approve 도 principal 검사 없음

⑧  활성화 경로 0       역할(AgentProfile)을 켤 길이 제품에 없어 자동화 전체가 막힘  [삼각확인]
```

**그리고 손이 쥐어 준 다음 길이 모델에게 안 간다** — 영수증의 `다음수단·다른후보·막힌곳·nextSafeAction` 은 패킷에는 실리는데 **어떤 와이어도 그 칸을 안 읽는다**. 검사는 "패킷에 필드가 있는가"까지만 재서 초록이었다. 이것이 이음매 여덟과 별개로 가장 크다.

---

## 12. 결함 대장

위험도: `안전` 사고 가능 · `정직` 거짓말 가능 · `마찰` 사용자 손 증가 · `원가` 비용/지연

| id | 위험 | 무엇 | 자리 |
|---|---|---|---|
| S1 | ~~안전~~ **닫힘** | `bulk_move` 만 개별 파일 보호 판정을 안 했다 — 점 없는 비밀 이름이 카드 없이 옮겨졌다. `b3eea28` 에서 루프에 `protectionBlocks(full,{write:true})` 를 걸어 닫음. 잔여 없음 | local-file.js:1018 · 검사 `test/s1-bulk-move-protects-secrets.test.js` |
| S2 | ~~안전~~ **닫힘** | 비-macOS 에서 터미널이 샌드박스 없이 돌고, **부재가 안전의 증거로 읽혔다**(아무것도 안 막히니 `changes:false`→`read`→자동). 명령은 그대로 돌되 **탐침이 무죄를 주장하지 못하게** 막아 `unknown_kind`→카드로 보낸다. 오픈북: 오픈클로 `docs/tools/exec.md:98-100`(fail closed · with approvals) | local-terminal.js:134 · 검사 `test/s2-no-sandbox-cannot-prove-innocence.test.js` |
| S3 | ~~안전~~ **닫힘** | 캡슐 RPC 가 승인 판정을 안 지났다 — `이번이월`·`발화밖파괴`·`unknown_kind` 가 캡슐 안에서 통째로 건너뛰어졌다. 펌프가 `tools.run` 앞에서 **커널의 그 판정**(`실행전판정`→`decideAutoGrant`)을 부르게 했다(복제 없음). 승인이 필요하면 그 호출만 거부하고 사유를 `거부`·`refusedForApproval` 로 싣는다. 오픈북: Hermes `code_execution_tool.py:1405-1407`(승인 맥락을 잃으면 *"silently auto-approve dangerous commands"*) | capsule.js:196 · 검사 `test/s3-capsule-calls-pass-the-approval-gate.test.js` |
| S4 | **안전** | `되돌릴 수 없는 것 3` 이 executePlan 진입마다 리셋 — 카드 N번 뜨면 3×N | turn.js:2027 |
| S5 | ~~안전~~ **닫힘** | 포트 9412 고정 · 소유권 확인 없음 → `/json/version` 이 답하기만 하면 **남의 크롬**을 몰았다. 띄우기 **전에** 자리를 물어 비었을 때만 잡고, 차 있으면 옆으로 옮기고, 열 자리가 다 차면 정직하게 막는다. 오픈북: 오픈클로 `docs/tools/browser.md:247-249`(*"auto-assign `cdpPort`"*)·`:283`(*"attachOnly … only attach if one is already running"*) + 집안 선례 `port-claim.js` 세 갈래. 남은 창: 자리 확인과 크롬이 실제로 잡기까지의 몇 초(코드에 적어 둠) | browser.js:330 · 검사 `test/s5-browser-does-not-attach-to-someone-elses-chrome.test.js` |
| S6 | **안전** | `legacy-default-agent`(A2·전 도구)가 유일 활성 역할이면 무조건 선택된다 | server.js:1041 |
| J1 | **정직** | 손이 준 `다음수단·다른후보·막힌곳` 이 어떤 와이어에도 안 실린다 | model-provider.js:680 |
| J2 | **정직** | `priorExchange` 가 `failureState` 를 안 옮기고 렌더가 전부 `확인됨:true` 로 강제 → 지난 턴 실패가 성공처럼 선다 | task-context.js:1004 · model-provider.js:495 |
| J3 | **정직** | ChatGPT(Responses) 와이어만 `failureState`·`실패원문`·`surface` 를 뺀다 | chatgpt-model-client.js:37 |
| J4 | **정직** | `ask.user` 가 오면 같은 응답의 실행 호출이 사유 없이 증발 | turn.js:1244 |
| J5 | **정직** | `desktop.act` 미지원 동사 거절 문구가 낡음("창 띄우기·끄기까지예요" — 실제 17동사) | desktop-act-tool.js:508 |
| J6 | ~~정직~~ **닫힘** | locate 가 폴더당 400개에서 **필터 전에** 자르는데 표식이 없었다 — 「폴더 N개를 훑었어요」가 「다 봤어요」로 읽혔다. 상한(400)은 그대로 두고 **침묵만** 고쳤다: `truncatedFolders[{path,seen,unseen}]`·`unseenEntries` 를 결과에 싣고, **모든 요약 갈래**에 한 줄을 붙인다(찾았을 때도). 오픈북: 쿠아 `SKILL.md:665-668`(트리가 크면 파일로 내보내고 경로를 준다) · 클로드코드 실측(*"Output too large (106.3KB). Full output saved to: …"*) | local-locate.js:449 · 검사 `test/j6-locate-says-what-it-did-not-look-at.test.js` |
| J7 | **정직** | 따옴표 든 CSV 는 표 안전망 전체가 조용히 꺼진다(꺼진 사실이 안 실림) | local-file.js:126 |
| J8 | **정직** | 「승인을 기다리는 일」 줄이 모델에게 영영 안 간다(`turn.pendingApprovals` 를 넘기는 호출자 0) | working-state.js:171 |
| J9 | **정직** | 도구를 쓴 턴의 답이 잘려도 「잘렸다」 안내가 안 붙는다(빠른 경로에만) | turn.js:1423 |
| F1 | **마찰** | 실제 검색기가 DDG 하나뿐 — SearXNG·Tavily 키를 넘기는 배선도 env 도 없다 | live-context.js:193 |
| F2 | **마찰** | 미분류 MCP 도구가 전부 `unknown_kind`+승인 → 조회도 카드 | tool-admission.js:65 |
| F3 | **마찰** | 비밀 이름 정규식이 일반 자료도 잡는다(`token-정산.xlsx` 읽기 차단, 사유 미고지). `b3eea28` 이후 `bulk_move` 도 같은 정규식을 쓴다 — `정산.pem` 류가 이동에서 제외된다(이쪽은 사유를 고지한다) | file-scope.js · local-file.js:1018 |
| F4 | ~~마찰~~ **닫힘** | `undo` 만 선언 루트(`roots`)를 봤고 쓰기는 `activeRoots`(루트 ∪ 홈)로 돌았다 → `GPAO_T5_FILE_ROOTS` 로 좁힌 구성에서 **홈에 쓰고 못 되돌리는 조합**이 성립했다(카드는 "되살릴 수 있어요"라고 약속했다). 되돌리기가 **쓰기와 같은 자**(`activeRoots`)를 쓰게 했다 — 보호 검사와 사본 경계(휴지통 또는 범위 안)는 그대로 | local-file.js:571 · 검사 `test/f4-undo-uses-the-same-ruler-as-write.test.js` |
| F5 | **마찰** | 채널 계층 일부가 모든 외부 전송을 항상 A2 로 선언(상위 헌장 ③ 과 충돌) | (코덱스 §13) |
| C1 | **원가** | 캐시 접두를 실제로 쓰는 공급자는 Anthropic 하나. beai 는 원천 불가 | model-provider.js:901 |
| C2 | **원가** | `완료주장검증` 이 한 턴에 두 번 돈다(걸음 루프 + 출구) | turn.js:2469 · 696 |
| C3 | **원가** | `results/` 흘림 파일에 삭제·회전이 없다 — 무한 누적 | tool-runner.js:21 |
| C4 | **원가** | 모델 응답 총시간 상한 기본 0(무제한) · 단발 경로는 정체 감시도 0 | model-timeout.js:48 |
| X1 | — | 작업 트리에 살아 있는 자격 파일 `scripts/compare-live/secret-env.sh`(600·git 무시) | — |
| X2 | — | `organ-round.mjs` 문장표가 자기 주석과 모순(뺐다는 창 전환 두 줄이 배열에 그대로) | organ-round.mjs:87-99 |
| X3 | — | A층(living-sim)이 `EXTERNAL_EFFECT_HANDS` 를 거부해 화면·브라우저·발신 손은 **자격·계보 검증을 한 번도 안 받는다** | living-sim-runner.js |

---

## 13. 죽은 코드·미배선

```
완전 죽음     skill-descriptor.js(src·scripts 참조 0) · 앞세워읽음값(영원히 false) ·
             브라우저이야기인가() · 잘렸나() · 기동인자() 중복 정의 · cua 표.type 도달 불가
호출자 0      assert*Ref 5 · leaksDiagnostics · TruthLedger.project() · isTerminal ·
             heartbeat 이벤트(발행 0) · skill-learning v1 7함수 · automation.js v1 5함수 ·
             tickAutomation(@deprecated) · GET /patterns
도달 불가     connectorReadiness 의 needs_auth 분기 · deriveToolStatus 의 needs_* ·
             work-event scopeRef 삼항 참가지 · demoChannels 폴백 5곳
죽은 인자     grantFor(action, mode) 의 mode · local.file 의 evidenceRows(핸들러가 안 봄) ·
             turn.js 의 isSafetyFloor import · steps · 산출물요청수 · 소진말
주석↔코드     turn.js 7건(줄번호 인용 4건이 실제와 다름) · task-context JSDoc 5건이
             엉뚱한 함수에 붙음 · browser.js 머리 주석이 영속 프로필을 "미구현"이라 함
```

---

## 14. ★★ 오픈북 대조표

```
축                    T5 현재                          비교군                          판정
─────────────────────  ──────────────────────────────  ─────────────────────────────  ────────
손 결과 → 모델          갈래별로 접음(duck typing)        원문(헤르메스 2,000자 절단)      고친다
막힌 뒤 다음 길         패킷엔 있고 **와이어가 안 읽음**   원문에 실림 · 손 쥔 채 재개      고친다 ★
지난 턴 기록           요약만 · 실패 표식 소실           전량(압축 전까지)               고친다
공급자별 사실 일관성     ChatGPT 만 실패 정보 누락         일관                          고친다
실행 레인             둘(계획/걸음)                     하나                          고친다 ★
완료 정의             넷                               하나(헤르메스는 종결 도구)       고친다 ★
질문 통로             셋(카드·ask.user·되묻기)          하나                          고친다
등록부                demo-context 가 제품 정본          제품 등록부 분리                고친다
도구 설명             914자~28자 편차 · operatorFact 4손 없음  오픈클로 SKILL.md 53장    더한다
셸 우선                local.terminal 있으나 하위        클로드코드 Bash 79%             더한다
OS 색인 활용           mdfind 사용 0(613줄 자체 구현)     비교군은 OS 도구를 그대로       더한다
드라이버 교대          drivers[0] 만                    폴백 체인                      더한다
로그인된 브라우저       영속 프로필 있으나 기본 꺼짐        오픈클로 profile="user"         더한다
루프 감지             반복지문·무진전 2축               + ping-pong · 알수없는도구       더한다
턴 중간 조종           없음                             오픈클로 steer 기본             더한다
────────────────────── **여기부터는 우리 것 — 지킨다** ──────────────────────────────
원장 종결             반대시험 7/7 · 거짓 실패도 회수     없음(헤르메스는 도구 호출로)      지킨다 ★
네 가지만 묻는다        행동 종류 축 · 비개발자 전제        오픈클로/헤르메스은 diff 읽는 사람  지킨다 ★
현실 공급 층           작업셋·화면·연결·잘린 범위          없음                          지킨다
기억                  출처·유효성·철회·replay·HMAC       메모장 수준                    지킨다
격리·소유권            HOME 3겹·writer lock·0600·해시체인  약함                          지킨다
────────────────────── **안 옮긴다 — 이유 확정** ──────────────────────────────────
도구 검색·점진 노출     분모 28. 수백이 되기 전엔 순 손해                                안 옮긴다
승인 자동심사          저쪽은 diff 읽는 사람 전제 + 셸 패턴 매칭                          안 옮긴다
```

★ = 이음매(§11)와 직결. 이 다섯이 닫히면 나머지는 이미 있다.

---

## 부록 A. 재생성 위임장

지도가 낡으면 아래 10벌을 **읽기 전용 에이전트**로 동시에 돌린다. 서식은 이 문서의 절 번호와 같다.

```
①  커널 L0 증거·원장          src/kernel/l0-evidence/ 전 12파일
②  커널 L1 말귀·모델 입력      src/kernel/l1-intent/ 전 15파일 — ★ 모델이 실제로 보는 것
③  커널 L2 계획·권한·계약      src/kernel/l2-plan/ 전 22파일 — ★ 행동 종류 전수·스키마 조립
④  턴 루프·커널 뿌리          turn.js 전량 + 뿌리 12파일 — ★ 흐름·모델 호출·예산
⑤  커널 L5 성장·자동화        src/kernel/l5-growth/ 전 21파일 — ★ 배선만 있고 안 도는 것
⑥  로컬 손                   local-* · file-scope · capsule · sandbox · document-intake 등 19
⑦  화면·브라우저 손           desktop-* 8 · browser* 3 · host-manners · robots
⑧  웹·채널·커넥터·모델접속     model-provider 전량 포함 32파일 — ★ 최종 메시지 조립
⑨  표면·서버·저장소           src/surface/ 43파일 — ★ demo↔live 관계 · descriptor 정의 자리
⑩  검사·게이트·스크립트        test/ 397 · scripts/ 25 — ★ 덮인 영역 / 빈 영역
공통 규율: 파일을 끝까지 읽는다 · 모든 줄에 파일:줄 · 추측·개선 제안 금지 ·
          못 읽은 것은 「미확인」 · 수정 도구 없는 에이전트를 쓴다
```

## 부록 B. 30초 안에 확인하는 법

```bash
node scripts/state-probe.mjs      # 유료 0 · 40초 — 지금 무엇이 있고 없나
npm test                          # 3,752건 · 되돌아가지 않았다는 최소 조건
npm start                         # 완료 판정의 유일한 자리 (계획서 §3)
```

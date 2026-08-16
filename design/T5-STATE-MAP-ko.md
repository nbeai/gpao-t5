# T5 상태 지도 (정본 · 2026-08-12)

> 기준 커밋 40cacee9 (2026-08-17) — 이 문서를 마지막으로 손질한 커밋. 그 이후의 움직임은 세션 시작 점검이 잰다(design/T5-FINAL-ASSEMBLY-ko.md §4-c ①).

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
규모      src 189파일 · 커널 82(20,468줄) · 런타임 64(19,116) · 표면 43(11,971) = 51,555줄
          ← 2026-08-17 실측. 재는 법: `find src/<층> -name '*.js' | wc -l`(파일) ·
            `find src/<층> -name '*.js' -exec cat {} + | wc -l`(줄) — 베끼지 말고 재라
            (design/T5-FINAL-ASSEMBLY-ko.md §4-c ②)
          검사 496파일(`ls test/*.test.js | wc -l`) · 건수는 `npm test` 실행값만이 잰다
          (마지막 단독 실측 4,333/4,333 — 2026-08-17 `npm test` 실행 · 도장 40cacee9) · 스크립트는 `ls scripts`
결합점    turn.js 3,764줄 · server.js 4,363줄(`wc -l` · 2026-08-17 실측) — 둘이 import 130개를
          직접 문다(import 수는 2026-08-12 실측)
모델 노출  28 = 작업 손 17 + 통제 채널 11 (+ connector 2 는 대부분 자리에서 안 보임)
표면      엔드포인트 76 핸들러 / 79 경로 · 저장소 25 · 커넥터 선언 8(전부 미연결)
모델      gpt-5.1 기본 · 공급자 와이어 5종(openai·anthropic·gemini·chatgpt·beai)
```

**T5 는 부품이 없는 제품이 아니다.** 파일·터미널·프로세스·화면·브라우저·웹·채널·커넥터·기억·자동화·위임이 전부 실물로 있고, 영수증 수명주기와 해시체인 원장까지 있다. **문제는 §11 이음매다 — 목록은 아홉이고 그중 하나(③)는 절반이 닫혔다**(제목의 「여덟」은 ⑨ 가 더해지며 안 고쳐진 값이었다).

---

## 2. ★ 한 턴이 흐르는 길

모든 경로는 `runTurn(input, ctx)` — `turn.js:895`(2026-08-16 실측 · 재는 법:
`grep -n 'export async function runTurn' src/kernel/turn.js`). ⚠ 이 절 안의 나머지 줄 번호는
2026-08-12 실측이라 지금과 어긋나 있다(같은 함수·같은 흐름은 유효) — 쓰기 전에 grep 으로 재라(design/T5-FINAL-ASSEMBLY-ko.md §4-c ②).

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
| `local.terminal` | local-terminal.js (544 · `wc -l` 2026-08-17 — 기존 272는 지도 기준 커밋 4a187273 에서도 447이라 그때부터 틀린 값이었다, 정정) | — (`command`) | probe 결과로 read/write, write 는 **항상 카드** | capability 598자(node 로 `demoDescriptors({desktop:false})` 터미널 capability length · 2026-08-17 실측) + readReach 81 |
| `local.locate` | local-locate.js (613) | — (`what`/`from`/`depth`) | read → 자동 | desc 516자 |
| `local.process` | local-process.js (231) | start status logs stop (4) | start=write(자동) · stop=organize | desc 245자 |
| `local.system` | local-system.js (156) | — (`limit`) · **두 축을 한 번에**: 프로세스 + 남은 저장 공간(`df -k /`) | read | desc 227자 |
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

**문서 생성 — 읽기만 있는 것이 아니다**(F-104 가 밟은 지도 쪽 뿌리 · 2026-08-12).
`local.file write` 는 `.xlsx` 이름 + 쉼표로 나눈 표 본문을 받으면 **진짜 zip 엑셀을 짓는다**
(`document-intake.js:282 buildXlsx` · 라이브러리 0). pdf·docx 는 **파일 스킬**이 만든다
(`src/skills/pdf-docx/SKILL.md` — `cupsfilter`·`textutil`). 이 줄이 「추출」만 적혀 있어서
다음 사람이 **「생성은 없다」로 갔고**, 계측기가 낸 0건이 그 오독을 굳혔다.

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
이 상한은 이제 모델에게도 **사실+행선지**로 실린다(`ac327607` · 완성재판 ⑧ 유도 재료 —
맨 금지문 "서버 실행은 하지 않는다"를 `DEFAULT_TIMEOUT_MS` 단일 근원의 시간 사실 문장 +
"계속 돌 것은 `local.process`" 행선지로 교체 · 검사 `test/terminal-declares-its-time-limit.test.js`).
「`DEFAULT_TIMEOUT_MS` 단일 근원」의 범위는 capability·schema.description 두 사본까지다 —
`demo-context.js:785` 의 `timeoutMs` 파라미터 설명("기본 120초, 최대 600초")은 리터럴이다(부채 등재됨).

타임아웃 뒤 사실 셋(`0bc6a85f`·`98e4b4ea` · local-terminal.js:448-456·467-500 · demo-context.js:706·753 · 2026-08-17 실측):
- granted/reach 실행이 시간 상한에서 멈추면 `failed:true`·`failureState=FAILED` 로 원장에 실패로
  남고 `result` 는 유지된다(tool-runner 실패 갈래는 result 를 안 옮겨 **원장 오염 0**) ·
  `diagnosticTrace` 에 stopped·exitCode·stdout·stderr·truncated·failedBy·실행중새로생긴것이 실린다.
- `다음수단` 행선지 둘: 상주(서버·워치)는 `local.process` / 오래 걸리는 일회성은 `timeoutMs` 연장
  (최대 `MAX_TIMEOUT_MS`) — `stopped==='timeout'` 이 「서버였다」를 함의하지 않아 둘을 나란히 준다.
- ⑥ 유도 한 문장("실행 요청이 곧 허락 구하기다…")은 capability + schema.description **두 사본**이다.

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

### 6-3. 출구 검증 15조항 (`완료주장검증` :719 · `절대재검증` :584 — 2026-08-17 실측 · 조항 수는 이 절의 열거 항목 수로 센다 — 다른 절이 다른 숫자를 적으면 여기가 이긴다 · 줄번호 재는 법: `grep -n 'export function\|^function 원장과어긋난값주장\|^function 죽은실행위생존주장' src/kernel/l2-plan/exit-verification.js`)

안 돌린 명령 · **거짓 실패**(**정의역: 이 턴에 실제로 바뀐 것이 1개 이상인 턴만** — `실제 > 0 ∧ 미완흔적 없음` · `exit-verification.js:777·779`(2026-08-17 실측). 통제 채널(`memory.*`)이 만든 사실 위의 거짓 실패는 **정의역 밖**이다 — 커널은 알맹이를 재지 않는다는 **선언된 경계** · F-105 라이브 10회차 재현 0) · 반만 읽고 "총" · 읽고도 안 실은 파일 · 폴더 합계 미기재 · 자리 종류 하나만 봄 · 막힌 걸음 미고지 · 지어낸 실물(**정의역: 파일 실물을 다루는 손을 쓴 턴만** — `local.file`·`local.locate`·`local.capsule`. 예전 `/^local\./` 는 터미널까지 물어 참인 답을 죽였다 · F-95) · 실행 0인데 완료 주장 · 개수 2배 초과 어긋남 · **만들고도 자리 미고지**(**정의역: 실물 손이 실제로 쓴 턴 + 답이 그 파일을 이름으로 부름 + 답에 폴더가 없음** — 셋 다 참일 때만. 「읽고도 안 실은 파일」의 쌍둥이다 · 라이브 6/8 → **0/8** · F-106) ·
**안 재고 "제일"**(2026-08-16 더해짐 · `c3cd6517` §7-ay — **정의역: 크기-순위 주장(`제일/가장 크…`)
∧ 목록 영수증에 size 없는 파일 또는 안 본 폴더**. 목록 밖 영수증 실측(터미널 stdout·read)에
이름이 있으면 취소 — 목록 자신·`원장글` 은 취소 근거로 안 쓴다(게이트가 턴 안에서만 침묵하던
자리 · :767) · 재료는 목록 항목의 `size` 바이트(local-file.js·compactResult 같이 수리) ·
검사 `test/rank-claim-knows-unmeasured.test.js`) ·
**지어낸 실행**(2026-08-16 더해짐 · `88d6df05` §7-bl — `절대재검증` 넷째 재는 것. **정의역: 같은
문장 안의 백틱 코드 토큰 ∧ 과거형 ㅆ ∧ 원장글에 그 토큰 없음 ∧ 부정 고지 아님**. 명령 이름
목록 금지 — 원장 포함 여부가 유일한 진실 · :498 · 검사
`test/fabricated-execution-does-not-reach-user.test.js` · 3차 재판 30턴에서 발동 0 — 그물 효과
실증으로 못 씀(§7-bm)) ·
**죽은 실행 위 생존 주장**(2026-08-17 더해짐 · `16fd0e82` §7-cc-1 · A1 — **「거짓 실패」의 거울
반대면**(그쪽은 산 원장 위 실패 선언, 이쪽은 죽은 실행 위 생존 선언). **정의역: 이 턴
`local.terminal` 영수증 `failureState==='failed'`(실패 계열 균일 — timeout 특례 열쇠 없음)
∧ 그 실패 뒤 실행 계열(`local.process`·`local.terminal`) 회복 성공 없음 ∧ 현재 시제 생존
서술(부정형 제외 · 인용 제외) ∧ 죽음 언급 0(국소 술어 — `미완료를밝혔나` 재사용 안 함)**.
술어 한 벌(:482)을 두 문(`완료주장검증` :795 · `절대재검증` :592)이 소비 · 검사
`test/dead-run-survival-claim-is-caught.test.js`) ·
**원장과 어긋난 값 주장**(2026-08-17 더해짐 · `40cacee9` §7-cc-3 · A2 — 두 기제가 **한
항목**이다(둘로 세면 16이 된다): (가) 틀린 값 — **정의역: 원장 성공 stdout 의 이름 결속
∧ 「N 바이트」 단정 ∧ 비근사 표지 ∧ 그 수가 실측에 없음**(결속-먼저 — J11/F-95 전과 회피 ·
바이트 한정은 선등록보다 좁다 · §7-cc-3 정정 ②) · (나) 역방향 — **정의역: 이 턴 터미널
영수증 전부 exit 0 ∧ 결과 마디가 부정 선언(두 표현 한정)뿐 ∧ 성공 서술 없음**. 술어 한 벌
(:528)을 두 문(`완료주장검증` :804 · `절대재검증` :595)이 소비 · **「거짓 실패」(:779)와
문구 집합 서로소(실패·불가능·할 수 없 / 안 됐·되지 않았)이고 :779 가 먼저 반환한다 — 두 벌이
아니다**(§7-cc-3 정정 ①) · 검사 `test/wrong-value-claim-is-caught.test.js`).
문 앞 필터: 빈 답 · 질문형 · `미완료를밝혔나` 는 대조 제외.

### 6-4. WorkEventLedger (durable)

append-only 해시체인 · checkpoint · 손상 시 **읽기전용 잠금** · 민감값 가드 주입 필수 · `execution_completed` 는 `verificationPassed===true` 없이 못 들어간다.

### 6-5. 완료 정의 **네 벌** ⚠

```
work-contract.js       커널 턴이 쓴다. local.file write 의 path+digest(파생은 originalUntouched+source)
completion-contract.js HTTP /verify 한 자리에만. 커널 턴 경로에 없다
working-state.js       막힘 없고 성공 영수증 하나면 recentOutcome=completed
exit-verification.js   위 15조항(§6-3 열거가 정본 — 이 줄의 옛 「11」은 §6-3 이 13이던 때도 어긋나 있었다 · 2026-08-17 정정)
```
그런데 모델에게 가는 설명은 *"완료는 ToolReceipt 와 CompletionContract 가 정한다"*(model-control.js:150)다 — **모델이 듣는 이름과 도는 코드가 다르다.**

---

## 7. 저장소

기본 자리 `<DATA> = GPAO_T5_DATA_DIR ?? ~/.local/state/gpao-t5/sessions/` · 집 `<HOME> = GPAO_T5_AGENT_HOME ?? ~/GPAO-T5/`

| 저장소 | 파일 | 담는 것 |
|---|---|---|
| Session | `<DATA>/<uuid>.json` | transcript·ledgerEntries·pendingApprovals·knownCounterparts·workingState·origin·**산출물사실**`[{path,turn}]`·**산출물턴수** — 수명은 `FORGET_AFTER_TURNS=8` 공유(working-state.js:24)·렌더 5칸 · 경계 실측: 나이 8 생존/9 소멸·축출 6중 5칸(§7-bt-1) |
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

### 9-3. 스킬 — **「스킬」이 두 가지다. 한 이름을 쓴다**

이 절이 오래 **한쪽만** 적고 있었다. 그래서 *"T5 에 스킬 0개"* 로 읽혔는데, 실제로는
**세 장이 매 턴 모델 프롬프트의 고정 접두에 실려 나가고 있었다.** F-104 가 *"pdf·docx 는
진짜 없다"* 를 두 번 적었을 때 **지도를 봤어도 안 잡혔을** 이유가 이것이다.

```
계약 스킬   <DATA>/skills.json · skill-store.js
           제안 → replay(2P/1N/2B/1A) → 승인 → 활성 상태기계를 탄다
           T5 가 대신 실행을 약속하는 것 → 그만큼 문다
           **실측 저장본 0개**

파일 스킬   src/skills/<이름>/SKILL.md · 사용자 집 ~/GPAO-T5/skills
           **등록도 승인도 replay 도 없다 — 파일이 있으면 쓰인다**
           아무것도 실행하지 않는다(읽을거리다 · 실행은 기존 손)
           프롬프트에는 **이름·설명·경로만**, 본문은 모델이 필요할 때 read 로 읽는다
           `requires.bins` 가 없는 컴퓨터에서는 목록에 안 올린다
           **실측 3장**: naver-search · pdf-docx · xlsx
```

**둘은 대체 관계가 아니다.** `skill-docs.js:15-17` 이 스스로 못박았다 — *"이 길은 승인·replay
상태기계를 **타지 않는다** … 기존 스킬 계약을 대체하지 않는다 — 옆에 난 다른 길이다."*
§4-1 캐시 접두의 「스킬 목록」은 **파일 스킬** 쪽이다(`model-provider.js:130`).

**계약 스킬이 막히는 자리는 그대로다**: `POST /skills/detect` 가 만드는 후보는
`replayCases: []` 인데 정규화는 2P/1N/2B/1A 를 필수로 요구한다 → **감지 경로 스킬은 영원히
replay 를 못 넘는다.**

---

## 10. 검사·게이트·계측기

**검사** 496파일(`ls test/*.test.js | wc -l` · 2026-08-17 실측) · 건수는 `npm test` 가 잰다(마지막
단독 실측 4,333/4,333 — 2026-08-17 실행 · 도장 40cacee9) · 평탄 구조 · 임시 방을 194파일이 각자 만든다 · 가짜 모델을 117파일이 각자 정의(공용 모듈 없음) · `demo-context` 를 **156파일**이 import.
**두꺼운 곳**: 화면손 62파일 497건 · 결함번호 회귀 58/454 · T-cell 15/295.
**빈 곳**: inbox 0 · 설치/업데이트/제거 0 · 사용자 이미지→모델 3(전부 화면손) · 환경변수로 갈리는 검사 0.
~~문서 **생성** 검사 0~~ → **거짓이었다**(F-104 · 2026-08-12). `test/xlsx-writer-must-reach-the-model.test.js`
가 `459ddfa`(08-12 10:43)로 이미 있었고, 이 지도의 마지막 갱신(18:24)보다 **여덟 시간 앞선다.**
계측기의 0건이 이 줄로 굳었고, 그 줄을 읽은 사람이 「생성은 없다」로 갔다.

**게이트**(`gate.mjs` 1,001줄) 항목: **진입 감사**(`:38` → `audit-project-entry.mjs` — 재는 것은
방 개수가 아니라 ①살아 있는데 잊힌 작업 ②작업 방이 아닌 자리에 열린 방 둘이다 · X4) ·
선언↔손 양방향 · 안전 바닥 3모드 · 터미널 미끼 5갈래 · 프로세스 자기보존 · 위생(산출물 누수) · locate 가짜 홈 · 프롬프트 예산(`[지금]` 이 80% 뒤) · 능력 문장↔limits · 커넥터 진실 6종 · previewOf · 한 사실 한 층 4갈래 · 서비스 이름 누수 · §1-B 사실층 순수성 · descriptor 단일 진실 · 후속표시 상한 · **전체 검사 1회 실행**(CPU·유휴 판정) · 산출물 커밋 감시.
기준선 5값 중 자동 갱신은 `deferred`·`serviceNameLeaks` 둘뿐.

**계측기**(`state-probe.mjs` 1,325줄): 유료 0·실기기 0·오너 자리 접촉 0.
**0·부재를 근거로 삼는 모든 자**(계측기 · 게이트 · **라이브 대본**)는 **양성 대조 없이 부재를 선언하지 못한다**(F-104 · 2026-08-12) — 말하기 전에
**실재하는 것을 그 검색법으로 잡아 보인다.** 대조가 안 서면 그 줄은 「없다」가 아니라
**「이 자로는 못 본다」**로 나간다. 그 전에는 검색어가 외부 라이브러리 이름뿐이라 자체 구현
(`buildXlsx`)과 파일 스킬(`SKILL.md`)을 못 보고 0건을 냈다.
**규율은 넓지만 무는 자는 아직 좁다** — `test/f104-…` 는 `state-probe.mjs` 하나를 물고,
`test/f105-…` 가 `scripts/live/*.mjs` 의 **한 가지 모양**(응답에 없는 이름을 응답에서 읽기)을 문다.
그 사이가 비어서 **넷째 재발**이 났다(S2 → J6 → X5 → 라이브 대본. 층이 아니라 계열로 센다).
**제품 그물의 검사(test/)도 규율 안이되 무는 자 밖이다** — J13 닫힘 검사의 부재 단언(대체 문장
미측정 · §7-cc-1 한계 ④)이 그 자리의 여섯째 얼굴로 등재됨(2026-08-17 · 지도 관리자 판정).
A2(§7-cc-3)는 같은 자리를 **쟀다** — 발동 케이스 최종 사용자 문장 실측 「실행했어요.」(참값
미실림 · J16 등재), 1차 사실문의 참값 실림은 단언으로 굳음(`test/wrong-value-claim-is-caught.test.js`). 손 인벤토리 · **서버 실기동 한 턴으로 모델 노출 도구 캡처** · 통제 채널 · 기관 10 결손 · 부재 확인 7주제 · 확정 계열 4 · 캐시 접두 안정성 · 코드 파생 사실 · **미측정은 계획서 §2 를 인용**(값을 지어내지 않는다) · 체감 지표 사후 집계.

**라이브 러너**(`scripts/live/` **실측 11파일**(`ls scripts/live | wc -l` · 2026-08-16) — 아래는 전수가 아니라 대표 셋 · 완성재판 하네스는 `scripts/terminal-qualification/`(완성재판.mjs·비교군재판.sh)에 따로 산다): `organ-round.mjs`(실기기 · 독립 기준자 6종 · 동결 문장 4줄 · 승인 카드 1장 = 사용자 손 1회) · `charter.mjs`(대본 모델 · 판정 4축) · A층 `living-sim-runner.mjs`(기계 조건 **3개뿐**, 나머지는 `PM_UNJUDGED` · `EXTERNAL_EFFECT_HANDS` 쓸 수 있으면 **시험 거부**).

---

## 11. ★★ 이음매 아홉 — 이 지도의 결론

한 경로는 `목적 → 권한 → 실행 → 사후확인 → 원장 → 답` 하나여야 한다. 목록은 **아홉**이고, ③ 은 증거 문장만 닫혔다.
(제목이 「여덟」이었던 것은 ⑨ 를 더하며 안 고친 것이다 — **세는 자가 자기 목록과 안 맞았다.**)

```
①  실행 레인 둘        계획 경로엔 probe 가 관통 안 함 → 같은 desktop.act type 이
                     첫 수면 field_input(카드) · 후속이면 organize(자동)
                     tool-boundary.js:66 · action-plan.js:186     [삼각확인]

②  완료 정의 넷        work-contract(커널) / completion-contract(HTTP만) /
                     working-state(recentOutcome) / exit-verification(15조항 — §6-3 열거가 정본)
                     모델에게 가는 이름은 셋째·넷째를 안 가리킨다   [삼각확인]

③  질문 통로 셋        승인 카드 · ask.user · 복구 되묻기.  ← **통로 셋은 그대로 열려 있다**
                     ~~ask.user 가 오면 같은 응답의 실행 호출이 통째로 증발한다~~
                     → **닫힘**(536b3bb · test/j4-clarify-does-not-vanish-calls.test.js).
                     증발 절만 닫혔고 이음매 자체는 남는다 — 「무효」가 아니다

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

⑨  타이핑 경계 두 벌   같은 「글자 넣기」를 두 자리가 따로 판정한다 —
                     desktop.act : 커널 층(action-plan.js:186 · 탐침의 눌러본사실 위에서)
                     browser.act : 손 안(browser.js 타이핑판정:212 · 엔터판정:235)
                     **뚫린 곳은 없다**(2026-08-12 직접 시험 6종: password·autocomplete
                     힌트·file·unknown 전부 막히고, 검색칸만 타이핑+엔터, 일반 텍스트칸은
                     타이핑만). 계획서 §5-2 의 표 그대로 선다.
                     문제는 **자리가 둘**이라는 것이다 — 이 저장소가 같은 모양으로 이미 데었다
                     (실행전판정 두 벌: *"두 벌이면 한쪽만 고쳐지고, 실제로 그랬다"*
                     turn.js 이음매① 주석). 한쪽을 고칠 때 다른 쪽이 안 따라오면 그때 갈라진다.
                     위험도: 지금 사용자 피해 0 · 갈라짐 대기
```

**그리고 ⑨ 계열 「두 벌」이 하나 늘었다(2026-08-17 실측).** 산출물사실 승계 로직(산출물턴수 증가
+ 병합·중복 제거·수명 필터·10개 절단)이 server.js 의 **두 표면에 같은 모양으로 복제**돼 있다
(:2356-2364 ↔ :4056-4064 · 재는 법 `grep -n '산출물턴수 = (session.산출물턴수' src/surface/server.js`).
병기: demo-context 의 타임아웃·⑥ 유도 문장 두 사본(:706↔:753)은 **의도된 두 벌**이다(F3 단어경계
두 사본 선례 — 같은 사실을 싣는 두 표면에 같은 문장을 싣는다) — **문장 두 사본과 로직 두 벌을
한 줄에 섞지 말 것.** 늘어난 것은 로직 쪽이다.

**~~그리고 「이 턴이 파일을 다뤘나」를 한 파일 안에서 두 자로 쟀다~~ → 한 벌로(`ffb3a3f` · 2026-08-12).**
`exit-verification.js` 안에서 `지어낸실물` 의 정의역은 `/^local\./` 였고 `완료주장검증` 의 `파일봄` 은
`local.file|locate|capsule` 이었다 — **한 손이 두 자에서 다른 종류였다.** 넓은 쪽이 F-95 를 만들었다:
터미널 읽기 턴에서 답의 `Node.js` 가 **파일 이름으로 뽑혀**, 모델이 쓴 참인 답(`v24.14.0`)이
「지어낸 실물」로 몰려 커널 대체문으로 갈아치워졌다(라이브 3/3 → 수리 후 5/5).
지금은 `파일실물손` 상수 한 자리를 둘이 함께 쓴다(`파일봄` 행동은 표본 12로 동치 확인).
⑨ 계열 「두 벌」이 **둘째로** 줄었다. 검사 `test/f95-honest-answer-is-not-a-fabricated-file.test.js`.
남은 절반(이름 자가 확장자꼴 제품명을 파일로 읽는 것)은 **정규식을 안 건드리고** 장부 F-96 에
재현 레시피와 함께 열어 뒀다 — 목록으로 막는 길은 이미 두 번 뚫렸다.

**~~그리고 손 이름 정규화가 두 벌이었다~~ → 한 자리로(`0be311b` · 2026-08-12).**
모델은 도구를 `local_file`·`functions.local_file` 로 본다(`wireToolName` 이 바꾼 이름). 호출 *이름*은
`byWire` 가 되돌리는데 `automation.propose` 의 `tool` 은 **인자 안에** 실려 와 그 경계를 안 지났다 —
예약이 라이브 26회차 중 18회만 섰다(상관 6/6). 되찾는 규칙은 **캡슐 안에 손으로 한 벌**만 있었고
(`capsule.js` 옛 :191-194, 실측 2026-08-04) 자동화는 같은 매듭을 안 푼 채였다. 지금은
`model-provider.js:kernelToolName` 하나이고 캡슐도 그것을 쓴다. 정규화가 도는 자리는 **입구 하나**
(`server.js:손이름펴기` → `자동화후보입장`)라 확정·지시문·역할·권한봉투·tick 이 한 벌만 본다.
⑨ 와 같은 계열의 「두 벌」이 하나 줄었다. 검사 `test/f93-automation-hand-name.test.js`(7건).

**~~그리고 손이 쥐어 준 다음 길이 모델에게 안 간다~~ → 닫힘(`24754f6` · 2026-08-12).**
영수증의 `다음수단·다른후보·막힌곳·nextSafeAction` 이 패킷에는 실리는데 어떤 와이어도 안 읽던 자리다.
검사가 "패킷에 필드가 있는가"까지만 재서 내내 초록이었다 — **안 준 손은 흔적이 없다**는 것이
이 결함의 성질이었다. 지금은 교환·서술 두 자리에서 와이어 넷 전부가 읽는다
(`model-provider.js:다음길줄` · 검사 `test/every-wire-carries-the-next-path.test.js`).
오픈북 축: 비교군 셋 다 **칸을 고르지 않는다**(Hermes `tools/registry.py:930` ·
OpenClaw `agent-loop.md:132` · 클로드코드 원문 그대로).

---

## 12. 결함 대장

위험도: `안전` 사고 가능 · `정직` 거짓말 가능 · `마찰` 사용자 손 증가 · `원가` 비용/지연

| id | 위험 | 무엇 | 자리 |
|---|---|---|---|
| S1 | ~~안전~~ **닫힘** | `bulk_move` 만 개별 파일 보호 판정을 안 했다 — 점 없는 비밀 이름이 카드 없이 옮겨졌다. `b3eea28` 에서 루프에 `protectionBlocks(full,{write:true})` 를 걸어 닫음. 잔여 없음 | local-file.js:1018 · 검사 `test/s1-bulk-move-protects-secrets.test.js` |
| S2 | ~~안전~~ **닫힘** | 비-macOS 에서 터미널이 샌드박스 없이 돌고, **부재가 안전의 증거로 읽혔다**(아무것도 안 막히니 `changes:false`→`read`→자동). 명령은 그대로 돌되 **탐침이 무죄를 주장하지 못하게** 막아 `unknown_kind`→카드로 보낸다. 오픈북: 오픈클로 `docs/tools/exec.md:98-100`(fail closed · with approvals) | local-terminal.js:134 · 검사 `test/s2-no-sandbox-cannot-prove-innocence.test.js` |
| S3 | ~~안전~~ **닫힘** | 캡슐 RPC 가 승인 판정을 안 지났다 — `이번이월`·`발화밖파괴`·`unknown_kind` 가 캡슐 안에서 통째로 건너뛰어졌다. 펌프가 `tools.run` 앞에서 **커널의 그 판정**(`실행전판정`→`decideAutoGrant`)을 부르게 했다(복제 없음). 승인이 필요하면 그 호출만 거부하고 사유를 `거부`·`refusedForApproval` 로 싣는다. 오픈북: Hermes `code_execution_tool.py:1405-1407`(승인 맥락을 잃으면 *"silently auto-approve dangerous commands"*) | capsule.js:196 · 검사 `test/s3-capsule-calls-pass-the-approval-gate.test.js` |
| S4 | ~~안전~~ **닫힘**(536b3bb · test/s4-irreversible-cap-is-per-request.test.js) | `되돌릴 수 없는 것 3` 이 executePlan 진입마다 리셋 — 카드 N번 뜨면 3×N | turn.js:2027 |
| S5 | ~~안전~~ **닫힘** | 포트 9412 고정 · 소유권 확인 없음 → `/json/version` 이 답하기만 하면 **남의 크롬**을 몰았다. 띄우기 **전에** 자리를 물어 비었을 때만 잡고, 차 있으면 옆으로 옮기고, 열 자리가 다 차면 정직하게 막는다. 오픈북: 오픈클로 `docs/tools/browser.md:247-249`(*"auto-assign `cdpPort`"*)·`:283`(*"attachOnly … only attach if one is already running"*) + 집안 선례 `port-claim.js` 세 갈래. 남은 창: 자리 확인과 크롬이 실제로 잡기까지의 몇 초(코드에 적어 둠) | browser.js:330 · 검사 `test/s5-browser-does-not-attach-to-someone-elses-chrome.test.js` |
| S6 | **안전** | `legacy-default-agent`(A2·전 도구)가 유일 활성 역할이면 무조건 선택된다 — **자리 이동**(유산감사 2026-08-16 · `40170cd4` 실측): `server.js:1041` 은 현재 자동화 승인 코드이고 `legacy-default-agent` 는 `automation-contracts.js` 로 옮겨졌다. 「유일 활성이면 무조건 선택」 **행동의 존속 여부는 미확인** — 열림 유지 | automation-contracts.js:985·1094·1180 계열(실측) |
| J1 | ~~정직~~ **닫힘** | 손이 준 `다음수단·다른후보·막힌곳·nextSafeAction` 이 어떤 와이어에도 안 실렸다. `24754f6` 에서 `다음길줄` 을 세워 교환·서술 두 자리에서 와이어 넷이 읽는다(사실 진술만·지시문 없음) | model-provider.js:685 · 검사 `test/every-wire-carries-the-next-path.test.js` |
| J2 | ~~정직~~ **닫힘(절반은 남음)** | 지난 턴 실패가 성공처럼 서던 자리. `24754f6` 에서 상태 토큰을 옮기고 `(미확인: failed)` 로 표시. **남은 것**: `priorExchange` 는 여전히 요약만이고 결과 원문은 안 실린다(E1 계약 — 의도된 것) | task-context.js:1013 · model-provider.js:497 |
| J3 | ~~정직~~ **닫힘** | ChatGPT 와이어만 사실을 빼던 자리. `24754f6` 에서 렌더를 복제하지 않고 `교환결과렌더` 를 그대로 부른다 — 칸이 늘면 넷이 같이 는다 | chatgpt-model-client.js:44 |
| J4 | ~~정직~~ **닫힘**(536b3bb · test/j4-clarify-does-not-vanish-calls.test.js) | `ask.user` 가 오면 같은 응답의 실행 호출이 사유 없이 증발 | turn.js:1244 |
| J5 | ~~정직~~ **닫힘**(`bce1a42f`) | `desktop.act` 미지원 동사 거절 문구가 낡음("창 띄우기·끄기까지예요" — 실제 17동사) → 거절 문구가 동사 목록을 **동적으로 나열**한다(`DESKTOP_ACT_ACTIONS.join` · 17동사). 유산감사 2026-08-16(`40170cd4`)이 실측 재확인 | desktop-act-tool.js:527 |
| J6 | ~~정직~~ **닫힘** | locate 가 폴더당 400개에서 **필터 전에** 자르는데 표식이 없었다 — 「폴더 N개를 훑었어요」가 「다 봤어요」로 읽혔다. 상한(400)은 그대로 두고 **침묵만** 고쳤다: `truncatedFolders[{path,seen,unseen}]`·`unseenEntries` 를 결과에 싣고, **모든 요약 갈래**에 한 줄을 붙인다(찾았을 때도). 오픈북: 쿠아 `SKILL.md:665-668`(트리가 크면 파일로 내보내고 경로를 준다) · 클로드코드 실측(*"Output too large (106.3KB). Full output saved to: …"*) | local-locate.js:449 · 검사 `test/j6-locate-says-what-it-did-not-look-at.test.js` |
| J7 | **정직** | 따옴표 든 CSV 는 표 안전망 전체가 조용히 꺼진다(꺼진 사실이 안 실림) | local-file.js:126 |
| J8 | **정직** | 「승인을 기다리는 일」 줄이 모델에게 영영 안 간다(`turn.pendingApprovals` 를 넘기는 호출자 0) | working-state.js:171 |
| J9 | ~~정직~~ **닫힘**(536b3bb · test/j9-truncation-notice-on-tool-turns.test.js) | 도구를 쓴 턴의 답이 잘려도 「잘렸다」 안내가 안 붙는다(빠른 경로에만) | turn.js:1423 |
| J11 | ~~정직~~ **닫힘** | 커널이 **모델이 쓴 참인 답을 버리고** 영수증 문장으로 갈아치웠다. `지어낸실물` 의 정의역이 `/^local\./` 라 터미널 읽기 턴까지 물었고, 답의 `Node.js` 가 **파일 이름으로 뽑혀** 원장에 없다고 판정됐다(라이브 3/3 · 모델은 세 번 다 `v24.14.0` 을 썼다). `ffb3a3f` 에서 정의역을 그 그물의 자기 겨냥(파일 실물 손)으로 되돌리고 **자 두 벌을 한 벌로** 합쳤다. 수리 후 라이브 5/5 | exit-verification.js:280 · `파일실물손` :202 · 검사 `test/f95-honest-answer-is-not-a-fabricated-file.test.js` |
| J12 | **정직** | **모델 답을 런타임 문장으로 갈아치우는 자리가 4인데 자는 2만 센다.** 계획서 §3-A 는 「지금 2자리 · 목표 0」이라 적혀 있고, `answer-authorship-lanes.test.js:31` 은 `turn.js` 안의 `/정직한답/g` **글자 수**를 세어 2를 요구한다 — ③④ 에는 그 낱말이 없어 **구조적으로 안 걸린다**. `turn.js:836` 주석은 스스로 *"셋째 갈아치움 칸이다"* 라고 적어 뒀는데 표도 자도 안 고쳤다. J11 이 그 셋째 칸에서 났다. **계획서 표는 고쳤고 자는 안 고쳤다**(다음 슬라이스 · 장부 F-97) → **자는 고쳐졌다**(`31170dc9` — 낱말 세기를 버리고 기제별 정의역 6: A 정직한답 2 + B fallbackReplyFrom 3 + C 리터럴 1). 남은 5문항은 인계서의 「이전부터 열려 있는 것」 절이 정본(판마다 절 번호가 바뀐다 — 옛 「§3-7」 포인터는 낡음 · 2026-08-17 정정). 발동 시 최종 문장의 **내용**(참값 미실림)은 이 행이 아니라 **J16** 소유. 줄 번호 현재값은 2026-08-17 재실측(`grep -n '정직한답\|fallbackReplyFrom' src/kernel/turn.js`) | turn.js:696·3638(정직한답)·708·848·852(fallbackReplyFrom) · 자 `test/answer-authorship-lanes.test.js`(합계 단언 6) |
| J10 | ~~정직~~ **닫힘** | 모델이 손을 **자기가 보는 이름**(`local_file`·`functions.local_file`)으로 적으면 예약이 안 섰다 — 후보만 서고 job 0, 그런데 답은 「켜 뒀어요」였다(라이브 26회차 중 18회만 섬 · 상관 6/6). `0be311b` 에서 `kernelToolName` 한 자리로 모으고 **입구에서 한 번** 편다. 그물은 안 넓어진다(근거가 접두 규칙이 아니라 실재 손 목록) · 「아무 스킬에나 묶는 자리」 봉인은 반대시험 ④로 다시 세운 채 그대로 | model-provider.js:`kernelToolName` · server.js:`손이름펴기` · 검사 `test/f93-automation-hand-name.test.js` |
| J13 | ~~정직~~ **닫힘(잔여 명시)** | 「죽은 실행 위 거짓 생존 주장」을 무는 그물이 없다 — §7-bx 수리 전후 동형 미검출(기존 그물 정의역 밖) → **닫힘**(`16fd0e82` · §7-cc-1 · A1): 술어 **한 벌**(`죽은실행위생존주장`)을 두 문(`완료주장검증`·`절대재검증`)이 소비(F-95 두 벌 재발 아님). 정의역: 이 턴 `local.terminal` `failureState==='failed'` ∧ 그 뒤 실행 계열 회복 성공 없음 ∧ 현재 시제 생존 서술 ∧ 죽음 언급 0. 라이브 거짓 유발은 비결정적이라 **결정적 서버판으로 갈음**(라이브에서 잡힌 것 아님 — §7-cc-1 종료 칸). **잔여**: 실패를 언급하며 동시에 생존을 주장하는 답은 정의역 밖(한계 ①) · 턴 밖 사후 판정 불가(한계 ③) · **발동 시 대체 문장 미측정 — 검사는 거짓 문장의 부재만 쟀다**(한계 ④ · 부재를 근거로 삼는 자 계열 S2→J6→X5→X6→X7 의 여섯째 얼굴 · §10) · 생존 주장이 실패 실행에 결속 안 됨(한계 ⑤ 오발 슬롯 · 표본 0). **J14·J15 는 열림** — 그물 부재 셋 중 하나만 닫혔다 | `src/kernel/l2-plan/exit-verification.js:482`(술어)·`:592`·`:795`(두 문 — 2026-08-17 A2 커밋 후 재실측 · 줄번호는 커밋마다 낡는다, 재는 법: `grep -n '죽은실행위생존주장\|원장과어긋난값주장' src/kernel/l2-plan/exit-verification.js`) · 검사 `test/dead-run-survival-claim-is-caught.test.js` · 근거 `docs/03-verification/evidence/terminal-2026-08-17/bx-반대시험iv-실측.md` |
| J14 | ~~정직~~ **닫힘(잔여 명시 · 원 표본 1은 정의역 밖)** | 「답의 값 vs 원장 실측 대조」를 무는 그물이 없다 → **닫힘**(`40cacee9` · §7-cc-3 · A2): 술어 **한 벌**(`원장과어긋난값주장`)을 두 문(`완료주장검증`·`절대재검증`)이 소비(A1 판례 동형 · 두 벌 아님 — 거짓 실패와 문구 서로소·우선 반환). 정의역 두 기제: (가) 이름 결속 ∧ 「N 바이트」 단정 ∧ 비근사 ∧ 실측에 없는 수 · (나) 터미널 전부 exit 0 ∧ 부정 선언 마디뿐 ∧ 성공 서술 없음. **표본 대조**: (가)=이 행 첫 표본(R1 u8 15,868) 닫힘 · (나)=§7-ca R2 u10 역방향(지도에서는 J15 의 「역방향 과소 보고 1」) 닫힘 · **이 행 둘째 표본(2차 R3 u8 도달 결손 — 안 준 값)은 정의역 밖·열림**(주장이 없으면 못 문다 · B5 분모 명문화와 별도 칸 · §7-cc-3). 결정적 서버판 재현 — 라이브 문장 재생 아님. **잔여**: 값 뒤바꿈 미발동(존재 검사이지 짝 검사 아님 · 표본 0 — 그물 이름이 「값 대조」인데 짝을 안 본다, J12 계열 재발 자리) · (가) 바이트 단정 한정(줄 수·개수는 못 문다 — 확장은 표본 경유) · 발동 시 최종 문장 참값 미실림은 **J16** 이 소유. **J15 는 열림** | `src/kernel/l2-plan/exit-verification.js:528`(술어)·`:595`·`:804`(두 문 — 재는 법은 J13 칸과 동일) · 검사 `test/wrong-value-claim-is-caught.test.js` · 근거 `기준선과-남은자리.md:1856-1857·1916` + §7-cc-3(:2100~) |
| J15 | **정직** | 「정리」 결과 미수령 — 2판 **4모양** 병렬 · **공통 원인 미측정**: 백업 안 하위폴더 잔존 2 · 완료 과대 선언 1 · 역방향 과소 보고 1 · **도달 결손 1(2차 R3 u8 — 2026-08-17 정정: 근거 줄은 네 이름을 드는데 이 행이 셋만 적고 있었다)**. 넷 중 역방향 1은 **답 층** 그물이 섰다(`40cacee9` · J14 (나) · 결정적 서버판) — J15 는 **실물 층**(정리 결과 미수령)이고 공통 원인은 여전히 미측정 · **열림** | 근거 `docs/03-verification/evidence/terminal-2026-08-15/기준선과-남은자리.md:1932-1934` |
| J16 | **정직** | **발동·되부름 소진 시 커널이 짓는 최종 문장에 원장 참값 미실림** — 그물 발동 후 모델이 거짓을 반복하면 사용자는 「실행했어요.」를 받는다(A2 측정 기록 · 결정적 서버판 실측): 거짓은 막혔는데 원장이 쥔 참값(15837 등)이 사용자에게 0글자. 같은 얼굴 둘째(A1 한계 ④=미측정 → A2=측정 완료). 수리 후보 자리 둘(fallbackReplyFrom 이 원장 stdout 사실을 읽게 / 영수증 userSafeSummary 가 사실을 싣게) — 소관명으로 선판정하지 않는다. **turn.js 갈아치움 레인(J12 자리들) 접촉 수리라 오너 결재 후 착수**(부채대장 A3) | `src/kernel/turn.js:548`(fallbackReplyFrom 정의) · 소비 :708·:848·:852 · 실측 §7-cc-3 측정 기록 |
| F1 | ~~마찰~~ **닫힘**(0684285 · test/f1-search-tiers-are-actually-reachable.test.js) | 실제 검색기가 DDG 하나뿐 — SearXNG·Tavily 키를 넘기는 배선도 env 도 없다 | live-context.js:193 |
| F2 | ~~마찰~~ **닫힘**(1ac96be · test/f2-mcp-kind-from-declared-facts.test.js) | 미분류 MCP 도구가 전부 `unknown_kind`+승인 → 조회도 카드 | tool-admission.js:65 |
| F3 | **마찰** (파생어 절반은 닫힘) | 비밀 이름 정규식이 일반 자료도 잡는다(`token-정산.xlsx` 읽기 차단, 사유 미고지 — 이 증상은 **그대로다**: `tokens?([-_.]…)` 도 `token-…` 붙임말을 잡는다). `b3eea28` 이후 `bulk_move` 도 같은 정규식을 쓴다 — `정산.pem` 류가 이동에서 제외된다(이쪽은 사유를 고지한다). **파생어 삼킴은 닫힘**(`fc2c2ad3` · §7-be — 접두 매칭 `token[^/]*` 이 npm 내부 `tokenize.js` 까지 삼켜 granted 뒤에도 install 을 죽였다. token/secret 을 단어 경계로, **두 사본 동시**: local-protection.js `SECRET_NAMES`:53 · `SECRET_NAME_PATHS`:80 · 닻 유지 · 검사 `test/secret-names-do-not-eat-source-files.test.js`) | local-protection.js:53·80 · local-file.js:1018 |
| F4 | ~~마찰~~ **닫힘** | `undo` 만 선언 루트(`roots`)를 봤고 쓰기는 `activeRoots`(루트 ∪ 홈)로 돌았다 → `GPAO_T5_FILE_ROOTS` 로 좁힌 구성에서 **홈에 쓰고 못 되돌리는 조합**이 성립했다(카드는 "되살릴 수 있어요"라고 약속했다). 되돌리기가 **쓰기와 같은 자**(`activeRoots`)를 쓰게 했다 — 보호 검사와 사본 경계(휴지통 또는 범위 안)는 그대로 | local-file.js:571 · 검사 `test/f4-undo-uses-the-same-ruler-as-write.test.js` |
| F5 | **마찰** | 채널 계층 일부가 모든 외부 전송을 항상 A2 로 선언(상위 헌장 ③ 과 충돌) | (코덱스 §13) |
| C1 | **원가** | 캐시 접두를 실제로 쓰는 공급자는 Anthropic 하나. beai 는 원천 불가 | model-provider.js:901 |
| C2 | ~~원가~~ **닫힘**(536b3bb · test/c2-completion-check-runs-once.test.js) | `완료주장검증` 이 한 턴에 두 번 돈다(걸음 루프 + 출구) | turn.js:2469 · 696 |
| C3 | ~~원가~~ **닫힘**(89cc001 · test/c3-result-spill-rotates.test.js) | `results/` 흘림 파일에 삭제·회전이 없다 — 무한 누적 | tool-runner.js:21 |
| C4 | ~~원가~~ **닫힘**(66a735d · test/c4-model-runaway-stopline.test.js) | 모델 응답 총시간 상한 기본 0(무제한) · 단발 경로는 정체 감시도 0 | model-timeout.js:48 |
| X4 | ~~정직~~ **닫힘**(3a95836) | 진입 감사가 **자기 기준을 거짓말했다** — 메시지는 「인수인계에 없는 sidecar worktree」인데 코드는 인계를 한 줄도 안 읽고 뿌리 밖 worktree 를 무조건 실패시켰다. 오너가 시킨 방 분리(`scripts/lane.mjs`)를 쓰는 순간 게이트가 빨개졌다. 지금은 작업 방은 **본선에 안 들어간 커밋이 있을 때만** 실패하고, 못 세면 판정하지 않는다. 커밋 순간을 무는 자는 `.githooks/pre-commit`(`core.hooksPath` **상대경로** — 훅이 가지를 따라다닌다) · 장부 F-100·F-101 | `scripts/audit-project-entry.mjs` · `gate.mjs:38` · 검사 `test/f101-lane-rooms-are-not-defects.test.js`(4건) |
| X5 | ~~정직~~ **닫힘**(f97383a) | 계측기가 **「0건」을 「없다」로 읽었다** — `document-create` 검색어가 전부 외부 라이브러리 이름이라 자체 구현(`buildXlsx`)과 파일 스킬(`SKILL.md`)을 못 봤다. 그 0 이 §10 「문서 생성 검사 0」으로 굳었고, **틀린 사실이 `test/state-probe.test.js` 의 `assert.equal(found.length, 0)` 으로 잠겨 있었다.** 지금은 규격마다 **양성 대조**가 필수다. **제품에서 이미 두 번 고친 병이다** — S2(부재가 안전의 증거로 읽힘) · J6(절단을 다 봤다로 읽음) · 장부 F-104 | `scripts/state-probe.mjs:199-245` · 검사 `test/f104-absence-needs-a-ruler-that-bites.test.js`(3건) |
| X6 | ~~정직~~ **닫힘**(F-105) | **안 잰 0 을 0 으로 읽었다 — 같은 계열 넷째.** 라이브 대본이 원장을 `/turn` **응답**에서 찾았는데 응답은 `result` 만 보내고 `ledgerEntries` 는 세션에만 붙는다(`server.js:1832`) → **열 회차 전부 빈 배열**, 그 위에서 「무효 0 · 실패 흔적 없음」을 적을 뻔했다. **셋째(X5)에서 이미 구조를 세웠는데 그 자의 정의역이 `state-probe.mjs` 한 파일이라 안 물었다.** 지금은 `store.load(id).ledgerEntries` 로 읽고, `원장잼` 칸과 집계 `M6원장미측정` 축이 **잰 양**을 남긴다. **무는 범위는 아직 한 모양뿐이다**(응답에 없는 이름을 응답에서 읽기) — 다른 모양의 미측정은 여전히 사람이 본다 | `scripts/live/h04-memory-round.mjs` · 검사 `test/f105-a-zero-you-did-not-measure-is-not-a-zero.test.js`(4건 · 선빨강 3) |
| X7 | **정직** | **재는 자 계열 다섯째**(S2 → J6 → X5 → X6 → 이것). 완성재판 러너의 원장 투영이 FAILED 영수증의 stdout 을 동봉하지 않는다 — stdout 을 `e.result` 에서만 읽는데 tool-runner 실패 갈래는 result 를 안 옮긴다 → §7-bg-1 의 stdout 원문 보존 의무(`기준선과-남은자리.md:1192`)가 §7-bx(타임아웃 → FAILED) 뒤 깨짐 | `scripts/terminal-qualification/완성재판.mjs:231-233` |
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
막힌 뒤 다음 길         **닫힘**(24754f6) 와이어 넷      원문에 실림 · 손 쥔 채 재개      ✔ 닫힘
지난 턴 기록           실패 표식 **닫힘** · 요약만은 남음  전량(압축 전까지)               절반 닫힘
공급자별 사실 일관성     **닫힘**(24754f6) 렌더 한 벌      일관                          ✔ 닫힘
실행 레인             둘(계획/걸음)                     하나                          고친다 ★
완료 정의             넷                               하나(헤르메스는 종결 도구)       고친다 ★
질문 통로             셋(카드·ask.user·되묻기)          하나                          고친다
등록부                demo-context 가 제품 정본          제품 등록부 분리                고친다
도구 설명             **절반 움직였다** — SKILL.md 방식이 들어왔다(파일 스킬 3장 · §9-3).
                       남은 것은 operatorFact 결손 4손과 자수 편차뿐                   절반
셸 우선                **움직였다(a878f3b · 08-11)** — 선언 순서에서 local.terminal 이 local.file 보다
                       앞이고(demo-context.js:650 vs :727 · "선언 순서가 곧 배치다"),
                       도구쓰는순서 ③ 이 "이 컴퓨터에서 되는 일은 터미널로 먼저"다      ✔ 닫힘
OS 색인 활용           **더했다(2026-08-12)** — 형식 질의는 mdfind 로 전수·분포를 세고,   
                       색인이 0 이면 「없다」가 아니라 「못 본다」로 읽고 걸음으로 되돌아간다.
                       걸음(613줄)은 그대로 — 색인은 자가 아니라 닿는 범위다.
드라이버 교대          drivers[0] 만                    폴백 체인                      더한다
로그인된 브라우저       영속 프로필 있으나 기본 꺼짐        오픈클로 profile="user"         더한다
루프 감지             반복지문·무진전 2축               + ping-pong · 알수없는도구       더한다
턴 중간 조종           없음                             오픈클로 steer 기본             더한다
────────────────────── **여기부터는 우리 것 — 지킨다** ──────────────────────────────
원장 종결             **함수 층 6/7**(7/7 아니다 — 08-12 세 문서 통일 때 이 줄만 안 딸려 왔다).
                      ⑥ 거짓 실패는 정의역이 `실제(바꾼 것) > 0` 뿐이라 통제 채널(`memory.*`)이
                      만든 사실 위의 거짓 실패는 **안 문다** — `exit-verification.js:777·779`
                      (2026-08-17 A2 커밋 후 재실측 — 이 인용은 커밋마다 낡는다, §6-3 의 재는
                      법으로 다시 재라).
                      **좁게 선언된 경계**이고 라이브 10회차에서 사용자 피해는 재현 안 됐다(F-105).
                                                          없음(헤르메스는 도구 호출로)      지킨다 ★
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
⑩  검사·게이트·스크립트        test/ · scripts/ 전량(개수는 `ls … | wc -l` 로 그때 잰다 · design/T5-FINAL-ASSEMBLY-ko.md §4-c ②) — ★ 덮인 영역 / 빈 영역
공통 규율: 파일을 끝까지 읽는다 · 모든 줄에 파일:줄 · 추측·개선 제안 금지 ·
          못 읽은 것은 「미확인」 · 수정 도구 없는 에이전트를 쓴다
```

## 부록 B. 30초 안에 확인하는 법

```bash
node scripts/state-probe.mjs      # 유료 0 · 40초 — 지금 무엇이 있고 없나
npm test                          # 건수는 실행이 잰다(마지막 단독 실측 4,333/4,333 · 2026-08-17 · 도장 40cacee9 — 건수를 든 자리는 셋(§1·§10·여기)이다, 하나만 고치면 자기모순이 선다) · 되돌아가지 않았다는 최소 조건
npm start                         # 완료 판정의 유일한 자리 (계획서 §3)
```

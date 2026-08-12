# T5 자산 채점표 — ①②③④ 를 층으로 갈라 다시 잰다 (2026-08-12)

오너 지시(2026-08-12): 앞선 조사가 「T5 가 이미 가진 자산」 목록을 냈고 **결론은 맞았다** —
*"부족은 새 기능의 수가 아니라, 이미 심어진 기능을 한 경로에 연결하지 못한 것."*
그런데 그 문서가 **자기가 지적한 병에 걸려 있었다**: 「쓸 수 있다」를 「코드가 있다」로 적었다.
그래서 다시 채점한다.

## 0. 채점 기준 — 네 층. 섞으면 같은 문서가 또 나온다

```
① 코드가 있다          파일:줄 로 지목된다
② 제품 경로가 닿는다     사용자 발화에서 그 코드까지 이어지는 길이 실재한다(호출자 사슬)
③ 모델이 그 능력을 안다   도구 스키마·프롬프트에 그 사실이 실린다
④ 라이브에서 실제로 쓴다  실물 발화로 N회 중 M회 — **여기까지 가야 「있다」다**
```

**③ 이 오늘 두 번 T5 를 죽인 자리다.** `local.locate` 형식 세기는 ①②가 다 섰는데 설명서에
없어 3/3 이 캡슐을 직접 짰고, 진짜 `.xlsx` 생성은 **7/7 이 시도조차 안 했다.** 둘 다
**손 설명서 한 줄**로 닫혔다. 그러니 ③ 을 「스키마에 파라미터가 있다」로 재지 않는다 —
**모델에게 실제로 나간 바이트**로 잰다(`GPAO_T5_PROMPT_DUMP` · `turn.js:976` · `tool-offer.js:53`).

**규율 하나 더**: 못 잰 것은 `계측불가` 로 적는다. **0 이나 ✕ 로 적지 않는다** —
안 잰 것과 안 되는 것은 다르다. §5 가 이 문서의 절반인 이유다.

---

## 1. 앞 문서의 어긋남 셋 — 재확인 (전부 어긋남 확인)

### 1-1. 원장 수치 — **어긋남 확인**

| 앞 문서 | 실물 (오너 자리 · `~/.local/state/gpao-t5/sessions/memory.json` · mtime 2026-08-12T06:36:46Z) |
|---|---|
| 관측 25건 | **observations 116** |
| 묶음 7건 | **bundles 13** |
| (안 적음) | candidates **5** · promoted **1** · replayCases **28** · replayReceipts **34** · shownRefs **115** · growObservations **18** · grownBundles **2** · growJobs **4** |

읽은 법: 오너 자리는 **읽기만** 했다. `promoted` 1건은 `{"statement":"나는 커피를 마시지
않는다.","userConfirmed":true,"replayPassed":false}` 다 — 승격은 **사용자 확인으로** 났지
재생 통과로 난 것이 아니다. 앞 문서가 안 적은 사실이고, 「승격이 자동으로 돈다」로 읽히면 안 된다.

### 1-2. 「60초마다 …승격 수행」 — **어긋남 확인 (죽은 import)**

| 축 | 사실 |
|---|---|
| 주기 60초 | 맞다 — `src/surface/server.js:190` `Number(processEnv.GPAO_T5_TICK_MS ?? 60_000)` |
| 도는 자리 | `src/surface/server.js:4203` `setInterval(... runtimeTick ...)` (`opts.startScheduler !== false` 일 때만) |
| `growTick` **호출자** | **`src/surface/tick-scheduler.js:86` 하나뿐** (성장워커 안) |
| `src/surface/server.js:85` | `import { growTick }` — **파일 안에 쓰는 자리가 0.** 죽은 import |
| 켜짐 조건 | `server.js:1460` — `GPAO_T5_TCELL === 'off'` 면 관찰·성장 워커가 통째로 안 돈다 |

### 1-3. 「자동화 배송 라이브 닫는 중」 — **닫혔다. 단, 발화 하나가 아직 샌다**

`design/T5-AUTOMATION-CLOSE-ko.md` §5-4 의 실측(수리 후 · 발화 3종 × 3회차):

| 발화 | 트리거 | ① job | ② 지시문 | ③ 돈다 | ④ 대화 도착 |
|---|---|---|---|---|---|
| A "매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘." | daily | 3/3 | 3/3 | **3/3** | **3/3** |
| B "내일 아침 9시에 다운로드 폴더에 뭐가 쌓였는지 알려줘." | **once** | 3/3 | 3/3 | **1/3** | **1/3** |
| C "매주 금요일 저녁 6시에 이번 주에 받은 파일 개수를 정리해서 알려줘." | weekly | 3/3 | 3/3 | **3/3** | **3/3** |

daily·weekly 는 **실제 대화 도착까지 3/3** 로 닫혔다(그 회차 기록을 인용만 하고 다시 안 돌렸다).
**`once` 는 1/3 이다** — `nextRunAt=0`(1970-01-01)으로 서서 배달이 0건이 된다.
좌표는 그 문서가 이미 적어 뒀다: `src/surface/server.js:490` (모델이 준 `at` 을 그대로 씀) ·
`src/kernel/l5-growth/automation-contracts.js:355` (유한하기만 하면 통과).
**「닫혔다」는 daily·weekly 에 대해 참이고, 발화 전체에 대해서는 아니다.**

---

## 2. 한 장 표 — 자산 × ①②③④

### 2-0. ④ 를 재는 두 자 — 어느 쪽도 T5 산문이 아니다

```
자 ㉮ 격리 회차   내가 돌린 라이브 3회차 (실모델 gpt-5.1 · 2026-08-12 · 격리 자리·격리 홈)
                 대본: scripts/live/asset-scorecard.mjs
                 「손밟음」 = 턴 결과 `turnExchange` 에 그 손이 있나 (기계 사실)
                 「목적달성」 = **독립 기준자**(파일시스템·개수·고정물 토막)가 판정
자 ㉯ 오너 원장   오너 자리 세션 95개 중 원장 있는 87개 · 원장항목 315건 (읽기만)
                 `ledgerEntries[].actualCall.tool` + `lifecycle`
                 **실물 사용이다** — 시험 발화가 아니라 오너가 실제로 친 문장의 결과
```
㉯ 가 ㉮보다 강하다(실사용). ㉮ 는 ㉯ 에 0건인 손을 **일부러 겨눠** 친 것이라 둘이 겹치지 않는다.

### 2-1. 한 장 표

**③ 은 전부 같은 회차에서 나온 기계 사실이다** — 서버가 모델에게 실제로 넘긴 손 목록
(`GPAO_T5_PROMPT_DUMP` → `tool-offer.js:53` → `prompt-dump.js:108`).
**선언 20개 중 모델에게 준 것 17개 · 거른 것 3개**
(`mail.send=planned` · `slack.post=needs_connection` · `telegram.send=needs_connection`).

| 자산 | ① 코드 (파일:줄) | ② 제품 경로 | ③ 모델이 안다 | ④ 격리 3회차 (손밟음 / 목적달성) | ④ 오너 원장 (delivered/전체) |
|---|---|---|---|---|---|
| `local.file` 읽기 | `local-file.js:289` | ○ `live-context.js:220` | ○ | **3/3 · 3/3** | 175/182 (전 동사 합) |
| `local.file` 쓰기 | 동상 (`local-file.js:572` 핸들러) | ○ | ○ | **3/3 · 3/3** · 카드 0회 | 동상 |
| `local.file` 이동 | 동상 | ○ | ○ | **2/3 · 2/3** — 1회차가 `local.terminal` 로 샜다 | 동상 |
| `local.file` 되돌리기(undo) | 동상 | ○ | ○ | 3/3 · 3/3 — **단 1회차는 무효**(앞 이동이 안 일어나 되돌릴 것이 없었다). **유효 2/2** | 동상 |
| `local.file` **문서 본문 추출**(pdf·docx·xlsx·hwp·hwpx) | `local-file.js:783` · 형식표 `document-intake.js:9` | ○ | **✕ — 스키마 설명(`demo-context.js:751`)·capability(`:735`)에 한 글자도 없다** | **3/3 · 3/3** (실제 `.docx` · `local.file:read` 로 감 · 셸 우회 0/3) | 미측정 |
| `local.locate` 이름 | `local-locate.js:426` | ○ `live-context.js:230` | ○ | **3/3 · 3/3** | 52/52 |
| `local.locate` 형식 세기 | 동상 (`local-locate.js:663` 문구 분기) | ○ | ○ (`demo-context.js:899-901` — **오늘 고쳐진 자리**) | **3/3 · 3/3** | 동상 |
| `local.locate` 개수 | 동상 | ○ | ○ | 3/3 · **자 무효 0/3 → 계측불가** (§5-1) | 동상 |
| `local.terminal` 읽기 명령 | `local-terminal.js:102` | ○ `live-context.js:225` | ○ | **3/3 · 0/3** ← §3-1 | 2/2 |
| `web.search` | `web-search-tool.js:30` | ○ `live-context.js:208` | ○ | **0/3** · 계측불가 (모델이 `web.collect` 로 갔다) | **10/10** |
| `web.collect` | `web-collector.js:185` | ○ `live-context.js:214` | ○ | **3/3 · 3/3** | **20/20** |
| `browser.observe` | `browser-tool.js:148` | ○ `live-context.js:239`(브라우저 있을 때) | ○ | **3/3 · 3/3** | **9/9** |
| `browser.act` | `browser-tool.js:230` | ○ `live-context.js:240` | ○ | 미측정(타이핑 안 함) | **0/1** |
| `session.search` | `session-search-tool.js:12` | ○ `live-context.js:235` | ○ | **3/3 · 3/3** | **0건 — 오너가 한 번도 안 썼다** |
| `agent.delegate` | `agent-delegate-tool.js:10` | ○ `server.js:445` (`enableAgentDelegation:true` @`:4160`) | ○ | **0/3** · 계측불가 ← §3-2 | **0건** |
| `local.process` | `local-process.js:46` | ○ `live-context.js:233` | ○ | **0/3** · 계측불가 ← §3-3 | **0건** |
| `local.system` | `local-system.js:54` | ○ `live-context.js:232` | ○ | **0/3** · 계측불가 ← §3-3 | **0건** |
| `local.discovery` | `local-discovery.js:119` | ○ `live-context.js:231` | ○ | **0/3** · 계측불가 ← §3-3 | **0건** |
| 기억(`memory.propose`) | `model-control.js:215` | ○ (모델 통제 채널) | ○ | **3/3** — `memory.json` 실물에 후보가 섰다 | candidates 5 · promoted 1 |
| `local.capsule` | `capsule.js:296` | ○ `live-context.js:229`(`sandboxAvailable()`) | ○ · **설명 과대**(§3-4) | 미측정(범위 밖) | 12/17 (실패 5는 전부 「손 200번 한도」) |
| `desktop.screen` | `desktop-tool.js:270` | ○ `live-context.js:147` | ○ **모델에게 실제로 갔다** | 미측정(범위 밖) | **6/6** |
| `desktop.act` 17동사 | `desktop-act-tool.js:265` (동사표 `demo-context.js:492-511` ↔ enum `:538` 17:17 일치) | ○ `live-context.js:184` | ○ **모델에게 실제로 갔다** | 미측정(범위 밖) | **0/7 — 전부 failed** |
| `connector.connect` | `connector-connect.js:470` | ○ `live-context.js:341` | ○ | 미측정(자격 없음) | **0/9 — 전부 failed**(자격 입력 대기) |
| `slack.post`·`telegram.send` | `channel-sender.js:140` | ○ `live-context.js:122·125` | **✕ — `needs_connection` 으로 걸러진다**(기계 사실) | 안 밟음(밖으로 나간다) | 0건 |
| `mail.send` | `demo-context.js:987` **선언만** | **✕ — 핸들러가 없다** | **✕ — `planned` 로 걸러진다** | 도달 불가 | 0건 |

**카드(사용자 손) 총계** — 격리 3회차 54문장 중 승인 카드가 뜬 것은 **3회**
(`local.file 이동` 1 · `local.locate 개수` 2). 파일 쓰기·이동·되돌리기는 **카드 없이** 돌았다
(사용자가 발화로 시킨 것이라 A0 로 지난다 — `local-file.js` 승인 규칙대로다).

---

## 3. 가장 값진 발견 셋

셋 다 **①②③ 이 다 섰는데 ④ 가 안 되는 것**이다. 고치면 바로 제품이 된다.

### 3-1. ★ `local.terminal` — **답을 손에 쥐고도 사용자에게 안 준다** (3/3 재현)

친 문장: *"터미널로 node 버전 좀 확인해줘."*

원장이 말하는 기계 사실(격리 자리 세션 `ce856e82`·`9f6c5dad`·`067a487c` — 셋 다 같다):
```
actualCall.tool  local.terminal      lifecycle  delivered
args             { command:"node -v", cwd:"/Users/jyp", granted:false }
result           { exitCode:0, stdout:"v24.14.0\n", stderr:"", applied:false }
사용자가 본 답    "확인만 했어요 — 아직 아무것도 바꾸지 않았어요."
```
**답은 이미 손 안에 있었다**(`stdout:"v24.14.0"`). 그런데 사용자가 받은 문장에는 **버전이 없다.**
3회차 전부 같다 — 우연이 아니다.

좌표: `src/runtime/local-terminal.js:207` — 승인이 없으면 `mode='probe'` 로 돈다.
`:292-294` 가 `exitCode===0 && 실제모드!=='granted'` 를 **「확인만 했어요」** 로 적는다.
그 문장은 **바꾸는 명령**에는 정확하다(안 바꿨다는 증명이 그 손의 존재 이유다 —
`local-terminal.js:5-8`). 그런데 `node -v` 처럼 **애초에 아무것도 안 바꾸는 읽기 명령**에서는
같은 문장이 「아무 답도 안 줬다」가 된다. `stdout` 은 `result` 에 실려 모델에게 갔는데도
최종 답이 영수증 문장으로 끝났다.

**왜 값진가**: 읽기 명령은 터미널 손의 가장 흔한 쓰임이고, 오너 원장에서도 `local.terminal`
2건 중 1건이 *"그 명령이 이 컴퓨터에 없어요"* 다. 「손은 도는데 답이 안 온다」는
사용자에게 **손이 없는 것과 구별되지 않는다.**

### 3-2. ★ `agent.delegate` — **오늘 아무도 안 밟았다. 밟아 봤더니 0/3 이다**

친 문장: *"내 파일들 훑어서 무슨 문서들인지 정리해줘. 오래 걸리면 따로 맡겨서 해도 돼."*
(*"따로 맡겨서 해도 돼"* 는 위임을 **명시로 허락한** 문장이다)

```
③ 모델에게 갔나        ○ — 3회차 전부 `준것` 목록에 `agent.delegate` 가 있다(기계 사실)
④ 모델이 골랐나        ✕ 0/3
   회차1  local.locate → local.file:list → local.file:read ×4  (자기가 다 읽었다)
   회차2  local.locate ×2
   회차3  local.locate ×2
④ 오너 원장           0건 / 315건
```
②도 섰다: `server.js:445` 가 `enableAgentDelegation && local.file.scopeRoots.length` 일 때
손을 붙이고, 제품 진입점은 `server.js:4160` 에서 `enableAgentDelegation: true` 를 준다.

**즉 코드도 있고 경로도 닿고 모델도 아는데, 315건 실사용 + 3회 겨냥 발화에서 단 한 번도
안 골랐다.** 이 자산은 **한 번도 돈 적이 없다** — 「된다/안 된다」조차 아직 모른다.
다음에 볼 것: 스키마 설명이 130자로 손 중 가장 짧다(`demo-context.js:614`,
`partitions[2~3]{label,folder}` 를 요구). *"언제 이것을 쓰는가"* 가 안 적혀 있다.

### 3-3. ★ 이 컴퓨터를 아는 손 셋 — **셋 다 0/3. 모델이 옆 손으로 간다**

| 친 문장 | 겨눈 손 | 실제로 잡은 손 (3회차) |
|---|---|---|
| *"지금 이 컴퓨터에서 돌고 있는 프로그램 중에 메모리 많이 쓰는 거 알려줘."* | `local.process` | `local.system` ×3 |
| *"이 맥 디스크 여유 공간이 얼마나 남았어?"* | `local.system` | `local.terminal` ×3 |
| *"내 컴퓨터에 어떤 앱들이 깔려 있는지 좀 봐줘."* | `local.discovery` | `local.system`+`local.terminal` ×2 · `local.terminal` ×1 |

셋 다 ③ 은 섰다(`준것` 에 있다). 오너 원장 315건에도 **셋 다 0건**이다.
**손이 세 개인데 모델은 두 개만 쓴다** — 그리고 그중 하나(`local.terminal`)는 §3-1 에서
답을 안 돌려주는 손이다. 「디스크 여유 공간」이 터미널로 가는 순간 §3-1 결함을 함께 탄다.

`local.process` 는 4동사(`start/status/logs/stop`)를 가진 **프로세스 관리** 손인데
*"메모리 많이 쓰는 것"* 이라는 조회 발화가 그리로 안 간다. `local.system` 은 스키마 설명이
**90자**로 손 중 가장 짧다(`demo-context.js:819`).

### 3-4. (덧) 내가 틀린 예측 하나 — **기록으로 남긴다**

착수할 때 나는 이렇게 예측했다: *"`local.file read` 가 pdf·docx·xlsx 본문을 꺼내는데
(`local-file.js:783`) 스키마 설명(`demo-context.js:751`)에 한 글자도 없다. `local.locate`
형식 세기·`.xlsx` 생성과 **정확히 같은 모양**이니 네 번째로 같은 병이 날 것이다."*

재려고 진짜 `.docx` 를 만들어 넣고(`계약서_최종.docx` · 본문에 `구름-5591`) 3회 쳤다.

```
결과  3/3 통과. 3회차 전부 `local.file:read` 로 갔다. 셸·캡슐 우회 0/3.
```

**예측이 틀렸다.** ③ 의 구멍(스키마에 문서 형식이 안 적혀 있다)은 **실재하지만**, 그것만으로
④ 가 죽지는 않았다. 「설명서에 없으면 안 쓴다」는 **필연이 아니라 경향**이다 —
`local.locate` 형식 세기와 `.xlsx` 생성은 **모델이 그 능력을 대신할 다른 길**(캡슐·셸)을
알고 있었고, `.docx` 읽기는 그 대체 길이 그만큼 자연스럽지 않았다.
**관측을 결함으로 승격하지 않는다**(오너 지시 2026-08-02). ③ 구멍은 §5-4 에 후보로 남긴다.

같은 등급의 미확인 후보 둘(둘 다 **안 쟀다**):
- `local.file read` 의 CSV 표 사실 `table{rows,columns,sums}`(`local-file.js:812,843`)이
  `local.file` 스키마에 없고 **`local.capsule` 의 `code` 설명(`demo-context.js:952`)에만** 있다
- `local.capsule` 스키마(`demo-context.js:936`)는 *"T5 **의 손**을 여러 번 불러"* 라고 하는데
  실제 허용손은 `local.file` **하나뿐**이다(`live-context.js:229` `허용손:['local.file']`) —
  **과대 진술** 쪽 구멍이다(같은 파일 `:930` capability 는 "파일 손"으로 정확하다. 둘이 어긋난다)

---

## 4. 죽은 코드 판정표 — **지우지 않았다. 판정만 했다**

오늘 `AgentProfileStore.activate` 가 호출자 0 이었는데 버릴 게 아니라 **이어야 할 것**이었다.
그러니 호출자 0 = 삭제가 아니다.

### 4-1. 이어야 함 (어디에)

| 후보 | ① 정의 | 지금 상태 | **이을 자리** |
|---|---|---|---|
| `GET /patterns` | `src/surface/server.js:3143` | 화면·테스트·대본 **호출자 0**. 형제인 `POST /patterns/confirm`(:3156)·`/patterns/rollback`(:3180)은 화면이 부른다(`web/index.html:1605`·`:1612`) | 제안 카드는 턴 응답의 `patternCandidate` 로만 뜨고(`index.html:1572`), **이미 배운 기본 대상 목록을 볼 자리가 없다.** 되돌리기 버튼은 있는데 무엇을 되돌릴지 보여주는 화면이 없다. ① `server.js:3509` `buildOverview({...})` 인자에 `traceStore.load()` 의 `promoted.map(projectDefaultTarget)` 추가 ② `src/surface/overview.js` 에 `defaultTargets` 절 ③ `index.html:1361`(`sec('기억', …)`) 옆에 행 추가 |
| `forgetCounterpart` | `src/kernel/l2-plan/known-counterpart.js:62` | 프로덕션 호출자 **0** (테스트 `test/known-counterpart.test.js:46` 만) | 지금 `knownCounterparts` 는 **한 번 들어가면 세션 안에서 철회 불가**다(`turn.js:1071` add · `server.js:2268`·`:3955` 영속). 잘못 배운 상대가 그 세션 내내 승인을 건너뛴다. 이을 자리: `server.js:3180`(`POST /patterns/rollback`) 안에서 `session.knownCounterparts` 도 함께 걷고, `server.js:1488`(Set 복원 지점)과 짝을 맞춘다 |

### 4-2. 버려도 됨 (근거)

| 후보 | ① 정의 | 근거 |
|---|---|---|
| `src/surface/server.js` **죽은 import 5개** | `:78 observeSessions` · `:81 applyDecay` · `:81 restoreDecayed` · `:85 growTick` · `:97 admitTickTrigger` | 전부 `src/surface/tick-scheduler.js` 로 이관됐고(`:64`·`:130`·`:86`·`:151`), server.js 본문에 사용처가 0 이다(전수 grep). **⚠️ 줄 통째로 지우면 안 된다** — 같은 줄의 `decayedEntries`(:81)는 `server.js:2991`, `자동화후보저장가능`(:97)은 `server.js:733` 에서 살아 있다 |
| `tickAutomation` | `src/runtime/automation-engine.js:219` | 프로덕션 호출자 0(테스트 30건). 주석에 `@deprecated`. 결정적 근거: `test/w2-product-path-cutover.test.js:129-131` 이 `legacyTickImport:false`·`legacyTickExecution:false` 를 **단언한다** — 제품 경로가 다시 부르면 검사가 깨진다 |
| `TruthLedger.project` | `src/kernel/l0-evidence/ledger.js:94` (본문 1줄) | 프로덕션 0 · 테스트 3건. 제품은 예외 없이 자유함수 `projectReceipts(부분집합)` 을 쓴다(`server.js:2099,2227` · `turn.js:3171,3322,3514`). 투영 대상은 늘 부분집합이라 `this.entries` 시그니처는 쓸 자리가 구조적으로 없다 |
| 구식 skill-learning v1 **상태기계 8개** | `skill-learning.js:17 SKILL_STATES` · `:69 surfaceCandidate` · `:75 markReplayRequired` · `:85 replaySkill` · `:99 approveSkill` · `:109 admitSkill` · `:115 rejectSkill` · `:130 canAutoExecute` | 프로덕션 0. `automation-contracts.js:9 SKILL_DEFINITION_STATES` + `transitionState` 로 대체됐고 실제 전이는 전부 `src/surface/skill-service.js` 를 탄다. **⚠️ 파일은 죽지 않았다** — 같은 파일의 `applicableSkill`·`skillInfluence`(`:161`·`:179`)는 턴 핫패스 `turn.js:1162-1163` 이 부르고, `detectSkillCandidate`(:42)는 `server.js:3584` 가 부른다 |
| 구식 automation v1 **부품 4개** | `automation.js:27 detectAutomationCandidate` · `:34 makeGrowthCandidate` · `:97 automationCandidateAddDelta` · `:167 approveAutomation` | 프로덕션 0. **⚠️ 파일은 죽지 않았다** — 같은 파일의 `applyAutomationJobPatch`·`appendAutomationLedger`·`isJobRunnable`·`jobExpired`·`resolveAfterRun`·`admitTickTrigger`·`자동화후보저장가능` 은 현행 경로가 물고 있다(`job-claimer.js:5` · `automation-engine.js:11-16` · `tick-scheduler.js:151` · `server.js:733`) |
| `restoreDecayed` | `tcell-decay.js:66` | `tcell-surface.js:83 unarchiveOrRestore` 가 동작을 완전 흡수했고 `POST /memory/restore`(`server.js:3100`)가 그것을 쓴다 |
| `checkModelHealth` | `model-doctor.js:53` | `checkConfigHealth`(:64)로 상위 대체. 라이브는 `live-context.js:298 modelDoctor` → `server.js:3424` |
| `selectLiveModel` | `model-provider.js:1573` | 단일연결 시절 진입점. 다중연결 `ModelConnectionStore`(`model-connection.js:204,227`)로 대체 |
| `reviewJobSkillBinding` | `automation-contracts.js:630` | 같은 판정이 `automation-engine.js:143-155` 에 인라인으로 이미 있다(중복) |
| `confirmOperatingPreference` | `user-model.js:51` | `POST /user-model/preferences/:id/confirm`(`server.js:3671`)이 `confirmCandidate` 단일 통로를 쓴다. 통로 둘은 이중 진실 |
| `assertReceiptRef`·`assertWorkRef`·`assertCompletionContractRef`·`assertSubjectRef` | `work-refs.js:184,192,200,212` | `work-event-store.js:243-258 _validateRefs` 가 같은 검사를 한다 |
| `displayName` | `identity.js:56` | src·test·scripts·bin 전체 참조 0. 완전 고아 |

### 4-3. 판정 보류 (무엇을 더 봐야)

| 후보 | ① 정의 | 무엇을 더 봐야 하나 |
|---|---|---|
| `markSkillStale` | `automation-contracts.js:675` | **소비자는 이미 서 있다** — `skill-service.js:148` 이 `state==='stale'` 을 `replay_required` 로 올린다. 그런데 `stale` 을 **찍는 곳이 프로덕션에 0** 이라 도달 불가 상태다. 「무슨 사건이 스킬을 stale 로 만들어야 하는가」의 계약(도구 허용목록 변경? 커넥터 해제? `skill-service.js:128 revise` 시 이전 버전?)이 정해져 있는지부터 |
| `decayCandidates` | `tcell-correction.js:80` | 함수 주석이 스스로 *"가역 경로와 사용자면이 서 있어야 한다"* 고 유보를 건다. 지금 감쇠는 `tick-scheduler.js:130 applyDecay` 가 자동으로 내리고 사용자는 결과만 `/memory` 의 `decayed` 로 본다. 「내리기 전에 후보로 보여주고 묻는다」는 제품 결정이 있었는지 |
| `POST /skills/:id/replay` · `POST /skills/:id/rollback` | `server.js:3612` · `:3697` | **HTTP 호출자 0 을 내가 직접 확인했다**(전 저장소 grep — 테스트는 `skillService.replay` 를 직접 부르지 라우트를 안 탄다). 그런데 스킬 수명주기 6개 중 화면에 난 문은 `approve` 하나뿐이다(`web/index.html:798`·`:1379` — 내가 직접 확인). 「라우트를 지울 것」이 아니라 **「수명주기를 화면에 낼 것인가」** 라는 제품 결정이 먼저다 |

### 4-4. UI 가 안 부르는 API — **개수는 계측불가로 적는다**

앞선 조사는 **24개**(다른 경로 22 · 아무도 안 부름 2)를 라우트별 호출자 인용과 함께 냈다.
나는 그 숫자를 **자동으로 재현하지 못했다.** 정규식 자를 세 번 다르게 만들어 각각
**14 · 31 · 13** 이 나왔다(느슨한 접두 매칭은 과대 인정, 조인 매칭은 화면의 동적 경로를 놓친다).
**그래서 개수는 「계측불가 — 자동 계수 불일치」로 적는다.** 자릿수는 십수 개대로 일치한다.

숫자와 달리 **질적 사실은 내가 직접 확인했고 흔들리지 않는다**:
- `POST /skills/:id/replay` · `POST /skills/:id/rollback` — **전 저장소 HTTP 호출자 0**
- 스킬 수명주기 라우트 6개(detect·revise·replay·activate·reject·rollback) 중
  화면에 난 문은 **`approve` 하나뿐**(`web/index.html:798`·`:1379`). 나머지는 화면에서 운전 불가
- `POST /channel/inbound` 는 「안 쓰이는 것」이 아니다 — 텔레그램 수신은 **HTTP 를 안 탄다**
  (`telegram-receiver.js` → `server.js:4232` → `:4016 processChannelInbound`). 라우트는 테스트용 문이다

---

## 5. 못 잰 것과 왜 — **이게 문서의 절반이다**

### 5-1. **자가 틀려서 못 잰 것** — `local.locate 개수` (0/3 을 ✕ 로 안 적는다)

친 문장 *"내 파일이 전부 몇 개야?"* 에 3회차 전부 「참값과 다름」이 나왔다.
**자를 먼저 의심했고, 자가 틀렸다.**

```
내 참값     격리 방의 파일 8~9개
T5 의 답    "홈 디렉터리 아래 파일 378,320개" (회차1) · "378,333개" (회차2) · "약 378,000개" (회차3)
```
T5 는 `local.terminal` 로 `find ~ -type f` 를 돌려 **오너의 진짜 홈**을 셌다. 그 답은
*"내 파일이 전부 몇 개야?"* 에 대해 **틀리지 않았다** — 틀린 것은 격리 방을 참값으로 잡은 내 자다.
**계측불가로 적는다.** 다시 재려면 발화를 *"이 폴더에"* 로 좁히고 그 폴더를 발화에 실어야 한다.

### 5-2. **격리가 샜다 — 밝힌다** (`local.terminal` 은 `GPAO_T5_HOME` 을 안 탄다)

`local-terminal.js:107` — `const cwdOf = () => deps.cwd ?? homedir();`
`live-context.js:225` 는 `dataDir` 만 넘기고 `cwd` 를 안 넘긴다. 그래서 터미널 손은
`GPAO_T5_HOME`·`GPAO_T5_FILE_ROOTS` 와 **무관하게 오너의 실제 홈에서 돈다**(`cwd:"/Users/jyp"`
— 원장에 그대로 남아 있다).

**내 회차가 오너 자리를 읽었다**: `node -v` 3회 · `find ~ -type f | wc -l` 3회.
**쓰기·이동·삭제는 0건이다**(원장 전수 확인 — 터미널 호출 6건 모두 `applied:false` 또는 읽기 명령).
파일 손 쪽은 홈을 옮겨 완전히 가뒀다(§6 참조). 터미널은 **못 가뒀고**, 그 사실을 이제 안다.

이건 결함이 아니라 **기록된 설계**다 — 파일 뿌리는 「홈이 방이다」로 넓혔고
(`file-scope.js:44-60` · 오너 결정 2026-08-07), 터미널은 *"이미 그 규칙 하나로 돈다"*
(보호 영역만 막는다). **다만 계측기를 짜는 사람은 이걸 모르면 오너 자리를 밟는다.**
`GPAO_T5_FILE_ROOTS` 만 물리면 가둬진다고 믿었던 첫 판에서, 모델이 오너의 실제
`~/GPAO-T5/2026-08 정산/` 을 열어 읽었다(§6 에 대본 주석으로 박아 뒀다).

### 5-3. 범위상 안 밟은 것 — **각각 어디까지 쟀는지 적는다**

| 자산 | ①②③ | ④ | 왜 안 밟았나 |
|---|---|---|---|
| `desktop.act` 17동사 | ①`desktop-act-tool.js:265` ②`live-context.js:184` ③**○** | **오너 원장 0/7 (전부 failed)** · 내 회차 미측정 | 범위 밖(지시). **다만 지시문의 전제 「이 셸에 화면(AX) 권한이 없다」는 내 회차의 기계 사실과 어긋난다** — §5-5 |
| `desktop.screen` | ①`desktop-tool.js:270` ②`live-context.js:147` ③**○** | **오너 원장 6/6 delivered** · 내 회차 미측정 | 동상 |
| `slack.post` · `telegram.send` | ①`channel-sender.js:140` ②`live-context.js:122·125` ③**✕ `needs_connection` 으로 걸림** | 안 잼 | **밖으로 나간다. 실제 발송 안 함.** 자격이 없어 모델에게 아예 안 보이는 것을 기계로 확인했다 |
| `mail.send` | ①**선언만**(`demo-context.js:987`) ②**✕ 핸들러 0** ③**✕ `planned` 로 걸림** | 도달 불가 | 손이 없어 `live-context.js:249` 필터에서 탈락. **없는 능력을 있다고 말하지는 않는다** |
| `local.capsule` | ①`capsule.js:296` ②`live-context.js:229` ③○(설명 과대 §3-4) | **오너 원장 12/17** (실패 5는 전부 「한 캡슐 200번 한도」) · 내 회차 미측정 | 범위 밖(지시) |
| 커넥터 연결 | ①`connector-connect.js:470` ②`live-context.js:341` ③○ | **오너 원장 0/9 (전부 failed — 자격 입력 대기)** | 자격이 없다(지시) |
| MCP | ①`tool-admission.js:93·143` ②연결 시 그 턴부터 편입 | 미측정 | 자격이 없다(지시) |
| 자동화 | §1-3 | daily·weekly **3/3 도착** · once **1/3** | **다시 안 돌렸다.** 기존 회차 기록 인용만 했다(지시) |
| `browser.act` 타이핑 | ①`browser-tool.js:230` ②`live-context.js:240` ③○ | **오너 원장 0/1** | 타이핑 안 함(지시) |

### 5-4. 자를 못 세워 「손밟음」으로만 적은 것

`web.search` · `agent.delegate` · `local.process` · `local.system` · `local.discovery` 다섯은
**목적달성 판정 자를 못 만들었다**(정답을 내가 모르거나, 답이 기계로 대조 불가).
그래서 ④ 를 **「그 손을 잡았나」 하나로만** 적었다. `0/3` 은 **손을 안 잡았다**는 뜻이지
**「그 손이 안 된다」는 뜻이 아니다** — §3-2·§3-3 을 그렇게 읽으면 안 된다.

`web.search` 는 이 구별이 특히 중요하다: 내 회차 0/3 인데 **오너 원장은 10/10 delivered** 다.
손은 멀쩡하고, 내가 고른 발화가 `web.collect` 로 갔을 뿐이다.

**안 잰 ③ 구멍 후보 넷** (§3-4 의 하나는 재서 틀렸다. 나머지는 **안 쟀다**):
`local.file` 문서 형식 미기재 · `local.file` CSV `table` 반환 미기재 ·
`local.file` 이웃 사실(`같은자리파일`·`같은자리표` `local-file.js:798,818`) 미기재 ·
`local.process` 의 `port`(`local-process.js:78`)·`settleMs`(`:137`)·`chars`(`:184`) 미노출.

### 5-5. **지시문의 전제 하나가 기계 사실과 어긋난다** — 화면 권한

지시문은 *"desktop.act 17동사 · desktop.screen — 이 셸에 화면(AX) 권한이 없다(오늘 확인).
`계측불가 — AX 권한 없음, 오너 터미널에서만` 으로 적어라"* 였다. 적었다(§5-3).
**그런데 내 회차의 기계 사실은 다르게 말한다**:

1. `desktop.screen`·`desktop.act` 가 **모델에게 실제로 갔다**(손제시 덤프 `준것` 17개에 둘 다 있다).
   그 손들은 백엔드가 있을 때만 선다(`live-context.js:145-186`) — 없으면 선언조차 안 생긴다.
2. 내 회차 답글에 **오너의 실제 창 이름이 실려 나왔다**:
   *"(이번 턴에 아직 안 본 자리 종류 — 화면: Claude — Claude · … - YouTube 🔊 — Google Chrome ·
   ChatGPT — ChatGPT · 개발원장 — Notion · 사장의 교본 (출판 2차본) — Notion)"*
   지어낸 값이 아니다 — 화면 백엔드가 **실제로 창을 열거했다.**
3. 오너 원장: `desktop.screen` **6/6 delivered**, `desktop.act` **0/7 failed**.

**즉 「권한이 없다」가 아니라 「보기는 되고 다루기가 안 된다」로 보인다.**
나는 이것을 **결함으로 승격하지 않는다**(재현 회차를 안 돌렸다 — 범위 밖이다).
**관측으로 적고, 전제를 고쳐야 다음 사람이 안 헤맨다는 것만 남긴다.**

### 5-6. 그 밖에 못 잰 것

- **UI 가 안 부르는 API 개수** — §4-4. 자동 계수가 세 번 다 다르게 나왔다(14·31·13). 계측불가
- **되돌리기 유효 표본** — 3회 중 1회는 앞 이동이 안 일어나 **무효**다. 유효 2/2
- **회차 수** — 각 3회다. 3회는 「늘 된다」를 못 말한다. `local.file 이동` 이 정확히 그 자리다
  (2/3 — 1회는 셸로 샜다). **3/3 도 3회일 뿐이다**
- **착수 점검의 「본선에 안 들어간 작업 24개 브랜치」** — 고치지 않았다.
  판정에 읽기가 필요하고 이 과업의 범위가 아니다. `node scripts/agent-start.mjs` 가 매번 말한다

---

## 6. 다시 돌리는 법

대본: **`scripts/live/asset-scorecard.mjs`** (문장표가 파일 안에 **동결**돼 있다 — 즉흥 발화 금지).

```bash
node scripts/live/asset-scorecard.mjs               # 전부 · 3회차 (약 12분 · 실모델을 부른다)
node scripts/live/asset-scorecard.mjs --n=3 --only='local.terminal'
node scripts/live/asset-scorecard.mjs --n=3 --only='문서읽기'
node scripts/live/asset-scorecard.mjs --손제시만     # ③ 만 · 모델 안 부름 · 몇 초
```

원장 두 자를 직접 세는 한 줄(오너 자리는 **읽기만**):
```bash
node -e "const m=require(require('os').homedir()+'/.local/state/gpao-t5/sessions/memory.json');
console.log('관측',m.observations.length,'묶음',m.bundles.length,'후보',m.candidates.length,
'승격',m.promoted.length,'replay',m.replayCases.length)"
```

**대본이 지키는 것**(전부 오늘 밟아서 얻은 것 — 주석에 이유를 박아 뒀다):
- `startLiveServer({port:0})` 를 **직접** 부른다. `bin/gpao-t5.mjs` 를 spawn 하면 기동마다
  **오너 크롬에 탭이 열린다**(2026-08-12 실제 피해). `port:0` 이라 남의 서버와 말할 수도 없다
- `GPAO_T5_HOME` 을 임시 방으로 **옮긴다**. `GPAO_T5_FILE_ROOTS` 만으로는 **안 가둬진다** —
  파일 손 강제가 `[...roots, home ?? homedir()]` 라 선언 뿌리는 더하기만 한다(`local-file.js:473` 외)
- `GPAO_T5_PROMPT_DUMP` 를 `process.env` 에**도** 심는다(`turn.js:976` 이 `ctx.processEnv ?? process.env`)
- `process.exit` 안 쓴다. `finally` 에서 서버를 닫는다
- 오너 자리에서 가져오는 것은 `model-connection.json`·`install.json` **복사 둘뿐**이고
  임시 방과 함께 사라진다
- ⚠️ **`local.terminal` 은 못 가둔다**(§5-2). 이 대본은 읽기 명령만 친다

**이 문서를 다시 쓸 때 지킬 것**: ①②③④ 를 **칸마다 따로** 적는다. 못 잰 것은
`계측불가` 로 적고 **0 이나 ✕ 로 적지 않는다.** 음성 결과가 나오면 **자를 먼저 의심한다**
(§5-1 이 그렇게 살아났다). 예측이 틀리면 **틀렸다고 적는다**(§3-4).

# 다음 세션 지시문 (새 대화에 이 파일 경로만 주면 된다)

> 새 대화를 열고 이렇게만 치면 됩니다:
> **`/Users/jyp/Developer/t5-p-op/design/NEXT-SESSION.md 읽고 그대로 진행해`**

---

저장소 `/Users/jyp/Developer/t5-p-op` (한국형 AI OS "T5"). 브랜치 `claude/p-op-1-a-system-view`.
**보고는 전부 한국어로.** 오너는 윤님이다. 응답 후반에 **오너용 쉬운 설명**을 붙인다
(전문 용어 없이, 사용자가 무엇을 겪게 되는지로).

## ★ 첫 줄 — 이 둘부터
```
node scripts/agent-start.mjs
cat design/T5-HANDOFF-2026-08-12-ko.md
```
착수 점검이 어긋난 칸을 내면 **고치고 시작한다.** 점검 자체가 깨져 있으면 **그것부터 고친다** —
2026-08-12 에 실제로 그랬다(문장 안의 백틱이 템플릿을 끊어 `SyntaxError` 로 아예 안 돌았다.
점검이 안 도는 동안은 **아무것도 안 막고 있었다**).

## 임무 — 「①②③은 섰는데 ④가 안 되는 것」 셋
`design/T5-ASSET-SCORECARD-ko.md` 가 좌표까지 적어 뒀다. **먼저 재고 시작한다** — 아래 숫자는
2026-08-12 자산 채점의 값이고, 그 뒤 자동화 레인이 손 이름 자리를 고쳤다(F-93).
```
local.terminal 이 답을 손에 쥐고도 안 준다   3/3 재현 · local-terminal.js:207·292-294
  원장에 stdout:"v24.14.0"·exitCode:0 이 있는데 답은 "확인만 했어요"뿐
agent.delegate 가 한 번도 돈 적이 없다      0/3 · 오너 원장 315건 중 0건
local.process·system·discovery             각 0/3
```
**착수 전에 닫는 문장을 먼저 적는다**(오너 2026-08-05). 본이 둘 있다:
`design/T5-AUTOMATION-CLOSE-ko.md`(닫혔다) · `design/T5-MEMORY-GRAPH-CLOSE-ko.md`(착수 대기).

## 그전에 볼 것 — **본선 게이트가 빨갛다** (F-94)
`npm run gate` 가 **exit 1** 이다. 내 변경 이전에도 같은 빨강이었다(stash 로 갈라 확인).
```
사유 ①  인수인계에 없는 sidecar worktree 수십 개 — ../gpao-t5/.claude/worktrees/agent-…
사유 ②  문서 "후속/아직" 표현 14 → 19 (§16-B)
```
`npm test` 는 3,995 초록이고 `audit:docs` 는 PASS 다. **게이트가 늘 빨가면 게이트가 아무것도
안 막는다** — 규율(*"본선은 늘 초록"*)이 지금 안 서 있다. 장부 F-94 에 등재해 뒀다.

## 방금 닫은 것 (2026-08-12 · F-93)
자동화 예약이 26회차 중 18회만 서던 자리 — 원인은 트리거가 아니라 **손 이름**이었다.
모델은 도구를 `local_file`·`functions.local_file` 로 적는데(`wireToolName` 이 바꾼 이름),
그 이름이 **인자 안에** 실려 오므로 호출 이름을 되돌리는 `byWire` 경계를 안 지났다.
**정규화는 입구 한 자리**(`자동화후보입장`)에서 돌고, 되찾는 규칙은 `kernelToolName` 하나다
(캡슐이 손으로 풀어 두었던 세 줄도 그것으로 합쳤다). 「아무 스킬에나 묶는 자리」 봉인은
**반대시험 ④로 다시 세운 채** 그대로다.

## 규율
- npm 의존성 0 · 헌장 넷 불변 · 안전 바닥 불변 · **판정 자를 고쳐 초록 만들기 금지**(C5)
- 새 저장소·표면·게이트 금지 · 한국어 주석 · 주변 관습 유지 · **선빨강 먼저**
- `git add -A` 금지(명시 경로만) · 커밋 전 `git branch --show-current` · 끝나면 원격에 푸시
- `scripts/s1/preflight.mjs:35` 기준지문 동결 · 허용파일 목록은 **두 벌**
  (`preflight.mjs` 와 `test/s1-preflight.test.js`) — 움직이면 **양쪽에** 손으로 옮기고 이유를 적어라
- 장부 `design/T5-FOLLOWUP-LEDGER-ko.md` 에 다음 번호로 등재(최신은 F-94)
- 에이전트를 쓰면 브리핑 첫 줄에 `node scripts/agent-start.mjs` 를 넣어라

## ⚠️ 계측 규율 — 데인 자리는 `scripts/agent-start.mjs` 가 매번 읽어 준다
```
서버는 node bin/gpao-t5.mjs --no-open      안 그러면 오너 크롬에 탭이 열린다
서버가 stdout 으로 알려준 포트를 써라        진입점은 포트가 막히면 조용히 옮긴다
process.exit 금지                          finally 를 건너뛰어 좀비가 남는다
회차마다 새 방·새 서버                      방을 재사용하면 중복에 걸려 「실패」로 읽힌다
응답과 저장은 다른 시각이다                  파일이 멎을 때까지 기다린 뒤 읽는다
시각을 옮길 때 아무 과거를 쓰지 마라          레코드의 다음 시각에서 한 주기를 뺀다
/tmp 에서 와일드카드로 지우지 마라           mkdtemp 가 돌려준 경로만
★ 자격 파일은 아예 열지 마라                model-connection.json 에 API 키 원문이 있다.
                                          2026-08-12 에 "provider·modelId 만 보려고" 열었다가
                                          가림막이 새서 **오너 키가 세션 기록에 찍혔다.**
                                          판·공급자는 화면·/toolbox·서버 로그에서 얻는다
```
**음성 결과가 나오면 자를 먼저 의심하고 다른 방법으로 한 번 더 재라.**

## 증명 문장
`npm test` 전체 초록(3,995+신규 · 실패 0) + 반대시험 초록 + **선빨강 원문** +
**라이브 판정표**(발화 종류별 5회 이상 · 실물 파일로) + 커밋 해시.
**밟지 않은 것은 판정칸에 적지 않는다** — F-93 이 라이브 15/15 를 내고도 *"수리 효과가 아니라
회귀 없음"* 이라고 적은 이유가 그것이다(그 표본에 실패 모양이 안 나왔다).

## 그다음
계획서 `design/T5-FINAL-ASSEMBLY-ko.md` §5 순서(5·6·8·9·10)와
`design/T5-MEMORY-GRAPH-CLOSE-ko.md`(착수 대기 · 닫는 문장 적혀 있음).
미병합 브랜치 `codex/operator-harness-p-op-3-discovery`(커밋 3개)는 **읽고 판정할 자리**로
그대로 둔다 — 이번 레인도 손대지 않았다. 자동 병합으로 밀지 마라.

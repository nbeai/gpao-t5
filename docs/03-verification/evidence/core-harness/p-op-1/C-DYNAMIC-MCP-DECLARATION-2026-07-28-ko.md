# P-OP-1 C · 동적 MCP 선언 라이브 증거

- 시각: 2026-07-28
- 실행 기준선: `5e07e0e` (브랜치 `claude/p-op-1-a-system-view`)
- 표면: 웹 화면(localhost:7331) · 실제 모델 `gpt-5.5`
- 회귀 기준: 테스트 1082건 통과 · 게이트 PASS

## 무엇이 닫혔는가

**C 전체가 아니다.** 닫힌 것은 **동적 MCP 경로** 하나다.

```
미선언 → 대화 중 선언 → 재시작 없이 연결·편입 → 실제 호출
→ 복수 주소형 MCP 공존 → 재시작 복원 → 재시작 뒤 실제 호출
→ 사용자 선언만 선택적 제거
```

## 단계별 관찰

### ① 선언 전 — 서비스 0

부팅 로그. 사용자가 올린 서비스가 하나도 없다.

```
[connector] notion 다시 연결됨 — 손 20개
[connector] naver 다시 연결됨 — 손 1개
```

`declared-connectors.json` 없음.

### ② 대화 중 선언 — 승인 카드

사용자 원문: `딥위키 붙여줘. 엠씨피 주소는 https://mcp.deepwiki.com/mcp 야.`

화면에 뜬 카드:

```
· 새 서비스 붙이기 A2 꼭 확인 — 딥위키을(를) 연결할 수 있게 준비해요
왜 확인하나요  계정에 접근·연결하는 일이라 먼저 확인받아요.
어디에        mcp.deepwiki.com 로 연결해요 · 끊을 때까지
무엇을        딥위키 로그인 화면이 열리고, 거기서 허용 한 번만 눌러 주시면 돼요.
              받아 오실 값은 없어요. 무엇을 할 수 있게 되는지는 붙고 나서 알려드릴게요.
되돌리기      "연결 끊어줘"라고 하시면 지워요 — 지금은 아무 값도 저장되지 않아요
```

승인 인자(원장): `connector.declare` — `authKind: mcp`, `url: https://mcp.deepwiki.com/mcp`.
비밀값 칸은 없다(원격 MCP 는 T5 가 클라이언트 등록까지 한다).

### ③ 재시작 없이 연결·편입 — 손 3개

같은 프로세스에서 그대로 이어졌다. 화면:

> 붙였어. 이제 딥위키로 바로 쓸 수 있어: 저장소/문서 질문하기 · 위키 목차 읽기 · 위키 내용 읽기

편입된 손 3개: `ask_question` · `read_wiki_structure` · `read_wiki_contents`.

### ④ 실제 호출 — 도구 승인 카드와 영수증

사용자 원문: `딥위키에 붙은 기능으로 vercel/next.js 저장소가 뭐 하는 건지 한 줄로 물어봐줘.`

```
· ask_question A2 — 딥위키에서 ask_question
어디에   딥위키 에서 · 이번 한 번
무엇을   repoName: vercel/next.js · question: What does this repository do? Answer in one concise Korean s…
```

기계 말 브레이스가 없다(같은 자리가 이전에는 `{"filter":{"operator":"and",…}}` 였다).

원장 영수증: `mcp.d-6c7cb2ed.ask_question` · `failureState: none`.
답변: "vercel/next.js 저장소는 React Server Components 기반의 App Router로 …"

### ⑤ 두 번째 주소형 MCP — 고유 접두사 공존

사용자 원문: `컨텍스트세븐도 붙여줘. 엠씨피 주소는 https://mcp.context7.com/mcp 야.`

```
d-6c7cb2ed · 딥위키
d-c4a93db9 · 컨텍스트세븐
```

도구 id 가 커넥터 id 로 떨어져 서로 덮어쓰지 않는다. 이전에는 둘 다
`mcp.undefined.<도구이름>` 이 되어 **나중 것이 앞의 손을 조용히 덮었다.**

### ⑥ 재시작 — 선언 복원

프로세스를 죽이고 다시 띄웠다.

```
[connector] 사용자가 올린 서비스 딥위키 · 컨텍스트세븐
[connector] notion 다시 연결됨 — 손 20개
[connector] naver 다시 연결됨 — 손 1개
```

### ⑦ 재시작 뒤 실제 호출 — **기능 복원**

⑥ 만으로는 **복원·재편입 증거**일 뿐이다. 그래서 한 번 더 실제로 불렀다.

첫 시도(`딥위키로 sveltejs/svelte …`)에서 T5 는 딥위키에 다시 붙긴 했으나
(`connector.connect` → "3개를 바로 쓸 수 있어요") **답은 `web.collect` 로 만들었다.**
그 회차는 기능 복원 증거가 아니다 — 원장으로 확인해 기록한다.

명시적으로 다시 걸었다: `웹 말고 딥위키에 붙은 ask_question 기능으로 직접 물어봐줘.`

원장 영수증:

```
[mcp.d-6c7cb2ed.ask_question]
  인자 {"repoName":"sveltejs/svelte","question":"What is this repository for? Answer in one sentence."}
  결과 This repository hosts the source code for Svelte, a compiler-based UI framework …
```

재시작 뒤 실제 MCP 호출이 돌았다. **기능 복원까지 닫힌다.**

### ⑧ 사용자 선언만 선택적 제거

사용자 원문: `컨텍스트세븐 연결 끊어줘.`

해제 전 저장 선언: `d-6c7cb2ed 딥위키` · `d-c4a93db9 컨텍스트세븐`
해제 후 저장 선언: `d-6c7cb2ed 딥위키` — **컨텍스트세븐만 사라졌다.**

화면: "컨텍스트세븐 연결 끊었어요. 다시 붙이려면 말씀만 해 주세요."
원장: `connector.connect` — `{"connector":"컨텍스트세븐","action":"disconnect"}`.

노션·네이버 등 소스 선언은 그대로 남는다(회귀 검사로 고정 —
`소스에 선언된 서비스는 끊어도 목록에서 사라지지 않는다`).

## 이 회차에서 드러나 고친 결함

| 결함 | 사용자에게 무엇이었나 |
|---|---|
| 주소형 MCP 도구 id 가 `mcp.undefined.*` | 두 서비스가 겹치면 A 를 불렀는데 B 가 돈다 |
| 승인 카드에 `undefined 서버에서` · 내부 id `notion` | 무엇을 허락하는지 모르는 승인 |
| 승인 카드 인자가 JSON 원문 | 밖으로 나가는 값을 읽고 판단할 수 없다 |
| 조회 카드에 "메시지를 실제로 밖으로 보내는 일이라" | 하는 일과 다른 이유로 승인을 받는다 |
| 붙이는 조건으로 끊기를 막음 | 만료된 서비스를 사용자가 끊지도 못한다 |
| **올린 서비스를 끊어도 선언이 남음** | 사용자가 올린 것을 되돌릴 방법이 없다 |

마지막 건은 별도 사고 기록으로 봉인했다 —
`INCIDENT-DECLARED-SERVICE-NOT-REMOVABLE-2026-07-28-ko.md`.

## 증거 등급

- 이 문서는 **표면 도달 · 실모델 라이브** 증거다. 사용자 원문·화면·원장 영수증을 근거로 한다.
- 테스트 1082건과 게이트 PASS 는 **회귀 안정성** 증거다(게이트는 스텁 모델을 쓴다).
  둘은 서로를 대신하지 못한다.

## 한계 — C 에서 아직 닫히지 않은 것

- **API 키 길의 실제 데이터 도달**: 안전 입력면이 열리는 것까지 확인했다. 실제 키는 사용자
  권한 경계라 이 회차에서 넘지 않았다.
- **앱 등록형 OAuth**(카페24 등): 검증할 계정이 없어 미검증.
- **실패 변수**: 잘못된 주소 · 네트워크 실패 · 붙었으나 도구 미편입 · 권한 부족. 미검증.
- 개인 환경의 구체적 경로·설정 내용·세션 식별자는 이 문서에 남기지 않는다.

# P5-B-1B Connector Operating Layer: Auth & Admission Core — 설계

작성: 2026-07-27 · 오너 정의 반영 · 상위: `design/P5-B-1-AUTHENTICATED-SURFACE-ACCESS-2026-07-27-ko.md`
감사 기준: `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md`

> **이 층은 서비스별 커넥터를 붙이는 구조가 아니다.**
> "어떤 외부 능력을 T5 의 손으로 편입하는가"를 다루는 층이다. (오너 정의)

## 이름을 바로잡은 이유 (기록)

첫 판의 이름은 "P5-B-1B Google OAuth" 였고, 구현도 `google-oauth.js` 라는 **서비스별 커넥터**로
시작했다. 폐기했다 — 그 방향이면 스마트스토어·카페24·카카오마다 하나씩 만들게 되고, 그게
곧 서비스별 분기다. 중심은 Google Drive 가 아니라 **연결 후보를 발견하고, 인증을 시작하고,
실제 도구로 승격시키는 공통 알고리즘**이다. Google Drive 는 **첫 검증 대상일 뿐**이다.

## 문제 (오너 실사용 대화, 2026-07-27)

전반부는 P5-B-1A 가 작동했다 — 상태를 정직하게 말하고 로컬 흔적까지 짚었다.
그런데 **"붙여줘"** 한 마디에서 무너졌다:

> "이 세션에 MCP 재연결/인증을 **실행하는 손**이 아직 안 열려 있어."
> "**네가 지금 해야 할 최소 행동은** Codex/ChatGPT 의 MCP 화면에서 Notion 연결을 눌러 OAuth 승인해줘."

세 가지가 틀렸다:
1. T5 가 **남의 도구(Codex/ChatGPT)의 설정**으로 사용자를 보냈다. T5 가 자기 손으로 해야 한다.
2. **6단계 절차를 사용자에게 시켰다** — 확인·클릭·승인·재연결·재보고.
3. 그리고 그 이유가 정확했다: **연결을 실행하는 손이 T5 에 없다.** 상태를 볼 수는 있는데
   (P5-B-1A) 무언가를 연결할 손이 없어서 남은 선택이 떠넘김뿐이었다.

**노션만의 문제가 아니다.** 스마트스토어·카페24·카카오·토스도 "붙여줘"에서 똑같이 무너진다.

## 층의 여섯 단계 (오너 정의 원문)

```
1. Connector Definition   이름·별칭·가능한 작업·필요한 권한·연결 방식 후보
2. Discovery              설치된 앱·CLI·MCP 설정·로컬 폴더·토큰/설정 흔적 확인
3. Capability Resolution  지금 실행 가능 / 인증하면 가능 / 제품상 예정 / 임시 대체 경로
4. Connection Orchestration  OAuth·MCP·API·CLI 연결 시작 · 승인 순간만 카드 · 승인 후 재확인
5. Tool Admission         실제 handler/schema/tool list 에 올라왔는지 확인 · 모델에게 공급
6. Ongoing Management     끊김·만료·권한 부족·scope 부족·재인증·제거·마스킹·원장
```

### 지금 서 있는 자리

| 단계 | 상태 | 근거 |
|---|---|---|
| 1 Connector Definition | ✅ 있음 | `defineConnector`(별칭·userJobs·requiredSetup·localSigns) |
| 2 Discovery | ✅ 있음 | P5-B-1A `local-signs.js`(app·dir·cli·mcp·file) + 신선도 재확인 |
| 3 Capability Resolution | ✅ 있음 | 2축 진실층(`executable` + `reason`) · `externalReality` |
| 4 **Connection Orchestration** | ❌ **없음 — 이번 범위** | 연결을 실행하는 손이 없다(위 대화의 막힌 자리) |
| 5 **Tool Admission** | ◐ 승격 경로만 | 연결 후 실제 노출 재확인 절차가 없다 — 이번 범위 |
| 6 Ongoing Management | ◐ 부분 | 만료·재인증·해제 — 이번 범위 일부 |

## 이번 범위 — Auth & Admission Core

### 새 손 두 개 (서비스가 아니라 **연결 방식**이 단위다)

| 도구 | 무엇을 하나 | 덮는 서비스 |
|---|---|---|
| `connector.connect` | 커넥터가 선언한 방식으로 연결을 **실행**한다 | OAuth·MCP·API키·CLI 전부 |
| `connector.disconnect` | 해제 + 토큰 파기 + 진실층 강등 | 전부 |

**커널·러너는 서비스를 모른다.** 서비스 지식은 `ConnectorDescriptor.authMethods` 선언에만 산다:

```js
authMethods: [
  { kind: 'oauth_pkce', authUrl, tokenUrl, scopes, clientIdRef, testUrl },
  { kind: 'mcp',        server: 'notion', url: 'https://mcp.notion.com/mcp' },
  { kind: 'api_key',    label: '…', testUrl },
]
```

러너는 `kind` 별 실행기만 안다(previewOf·subjectOf·localSigns 와 같은 계약 패턴).
새 서비스 = **선언 하나**. 새 연결 **방식**이 생길 때만 실행기가 는다.

### 실행기 (kind 단위)

- **`oauth_pkce`** — 루프백 + PKCE. client secret 없음. 사용자 기본 브라우저로 동의 화면을 열고
  (T5 임시 프로필이 아니라 **사용자 로그인이 있는 곳**), 코드→토큰 교환, **연결 테스트 통과해야
  성공**. 토큰은 기존 0600 저장소 패턴.
- **`mcp`** — 서버 등록 확인 → 인증 필요하면 그 서버의 OAuth 를 같은 루프백으로 → **도구 목록을
  받아와 T5 도구로 편입**(Tool Admission 의 실물).

### Tool Admission 계약 (5단계 — "연결됨"이라고 말만 하지 않는다)

```
연결 성공 → 도구 목록 재조회 → handler·schema 실재 확인
        → 진실층 승격(executable) → schema·도구함·능력 문장 동시 갱신
        → 원장 기록 → 다음 턴 승계
어느 하나라도 실패 → 연결 실패로 기록. "연결됐다"고 말하지 않는다.
```

이 계약이 P5-B-0 게이트(`schema ⊆ executable ⊆ 손`)를 그대로 탄다 — **커널 무변경 예상.**

### 승인 경계

- 연결 시작은 **A2**(외부 계정에 접근 권한을 주는 일). previewOf 필수 — 무엇을·어떤 범위·어떻게 끊는지.
- 로그인·동의는 사용자가 그 화면에서. **T5 는 비밀번호를 보지도 받지도 않는다.**
- 설치가 필요한 방식(CLI·MCP 서버 설치)은 **되돌리기 경로를 카드에 명시**, 못 하면 A3.
- 토큰·키는 transcript·receipt·로그·UI 노출 금지(기존 게이트).

## 첫 검증 대상 — 두 개를 함께

층이 서비스 무관임을 증명하려면 **연결 방식이 다른 둘**이 필요하다:

1. **MCP / 노션** — 오너 대화가 막힌 실제 자리. 설정이 이미 등록돼 있어 즉시 검증 가능
2. **OAuth / Google Drive 읽기** — 다른 kind. client_id 발급이 필요해 오너 참여 시점 있음

순서는 **MCP 먼저**(사전 준비물 없음), OAuth 는 client_id 준비되는 대로.

## 완료 판정 (나눠서)

코드 / 게이트(연결 전·후 전이 + 반대 검증: 토큰 삭제 → schema 소멸) / 실제 UI(연결 카드) /
**실제 대화**("붙여줘" → T5가 실행 → 승인 한 번 → "이제 찾아볼 수 있어") /
실제 외부 서비스 연결 / 라이브 미검증 / 잔여.

**성공의 기준 문장**: 사용자가 하는 일은 **동의 화면에서 허용 한 번**뿐이다.
그 외 확인·등록·재연결·재보고는 전부 T5 가 한다.

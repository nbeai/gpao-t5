# T5 NX-3 — Developer & Connection Intelligence

상태: `OWNER_PLANNED_SUCCESSOR · NX2_AND_PRESENTATION_STUDIO_CLOSEOUT_REQUIRED · PRODUCT_IMPLEMENTATION_NOT_OPEN`

현재 제품 정본: `T5-NX.md`

선행 완료 조건:

- NX2-HQ clean second whole-flow
- NX2-PS Presentation Studio `PS-HQ`
- exact completed source·evidence·Git clean
- 오너의 NX-3 CURRENT 개통 결정

GUI 정책: `DEFERRED · GENERIC_DESKTOP_COMPUTER_USE_NOT_IN_NX3`

Cloud execution 정책: `OPTIONAL_AFTER_LOCAL_CORE · NOT_A_PREREQUISITE`

---

## 1. NX-3의 한 문장

> 사용자는 API·MCP·CLI·코드·프로젝트 구조를 몰라도 평소 말로 “연결해줘, 자동화해줘, 고쳐줘, 만들어줘,
> 해내”라고 맡긴다. T5는 공식 연결 경로를 가장 먼저 사용하고, 현재 손이 부족하면 Terminal·CLI와 검증된 코드 제작으로
> 필요한 연결부·프로그램·Capability를 만들며, 실제 실행·효과·결과·복구를 영수증으로 닫는다.

NX-3의 목표는 T5를 개발자용 IDE로 바꾸는 것이 아니다.

> 일반 사용자가 현실에서 막히는 순간 T5 안의 개발자 함수가 필요한 기술을 대신 다뤄 목적을 끝내는 것.

---

## 2. 사용자 경험

사용자는 다음처럼 말한다.

```text
우리 CRM 연결해줘.
이 MCP를 쓸 수 있게 해줘.
이 API에서 매일 매출을 가져와줘.
거래처 CSV를 우리 ERP 양식으로 자동 변환해줘.
이 웹사이트 신청 버튼이 안 되는데 고쳐줘.
이 자료를 보는 대시보드 만들어줘.
지금 T5에 없는 기능이면 필요한 걸 만들어서 해결해줘.
```

사용자가 몰라도 되는 것:

- REST·GraphQL·OpenAPI
- MCP transport·Tool schema
- OAuth·API key·scope·redirect URI
- Python·Node·package manager
- webhook·pagination·rate limit
- Git·test·build·server·port
- Artifact·Effect·rollback 내부 계약

사용자에게 보이는 것은 다음뿐이다.

```text
무엇을 연결하거나 만들 것인지
어떤 권한이 필요한지
현재 무엇을 확인하고 있는지
실제로 무엇이 됐는지
무엇이 아직 안 됐는지
어떻게 중단·제거·되돌릴 수 있는지
```

---

## 3. 개발자 함수의 정의

```text
사용자 목적
→ 현재 T5 능력으로 가능한가
→ 공식 API·MCP·CLI·export/import·Browser 경로 발견
→ 가장 단순하고 충분한 경로 선택
→ 부족하면 bounded adapter·program·project 작성
→ fixture 검증
→ actual 실행
→ 독립 Observer
→ Artifact·Effect·Undo·Delivery
→ 반복 우위가 증명되면 managed Capability 후보
```

### 3.1 인문가

- 사용자가 실제로 해결하려는 불편
- 기술 설명 부담
- 현재 권한과 책임
- 새 연결·자동화가 사람과 업무에 미치는 영향

### 3.2 전략가

- 공식 경로 우선순위
- build vs buy vs connect
- 가장 작은 충분한 구현
- 현재 한번 쓸 것과 지속 능력의 구분
- 속도·비용·위험·유지보수

### 3.3 개발자

- Terminal·CLI
- API·MCP integration
- adapter·program·web app
- diagnose·edit·test·debug
- server·Browser QA
- package·dependency·version

### 3.4 디자이너

- 연결 설정의 최소 입력 UX
- 프로그램·dashboard·온보딩의 실제 사용 흐름
- 오류·권한·진행·결과의 이해 가능성
- 일반 사용자가 코드를 보지 않고 결과를 사용하는 형태

### 3.5 감시자

- official source·publisher·version
- credential flow
- 실행·Effect·external ACK
- test·Browser actual
- Artifact·rollback
- latency·calls·tokens·bytes

다섯 역할을 다섯 Agent로 고정 호출하지 않는다. 하나의 T5 모델 판단과 Runtime 경계에서 필요한 기능만 작동한다.

---

## 4. 현재 T5에서 재사용할 신체

NX-3는 새 Agent framework를 만들지 않는다.

| 현재 기관 | NX-3 재사용 |
|---|---|
| Work·Revision·Run | 연결·개발 목적과 교정·장기 상태 |
| Terminal·PTY·Process·Output Store | CLI·build·test·server·debug |
| Command explanation·Effect | 실제 명령 의미·변경 관측 |
| E Confinement·F publication | scratch·declared output·안전한 발행 |
| G Program/Project | 임시 프로그램·실제 입력·독립 검증 |
| File·Document Reality | spec·sample·source·result 관측 |
| Web·Browser | 공식 문서·OAuth·실제 UI·웹앱 QA |
| Secret Store·Authority | key·token·scope·전송·비용 |
| Connection Reality·Remote MCP | 현재 연결·route·capability truth |
| CLI Broker | 로그인된 CLI의 credential 비노출 실행 |
| Skill·Capability lifecycle | on-demand 발견·설치·archive·restore |
| Artifact·Version·Undo | 코드·프로그램·보고·설치 결과 |
| Receipt·Restart Reconcile | actual effect·unknown·중복 방지 |
| Automation·Telegram | 반복 실행·모바일 요청·결과 전달 |
| NX2-SE | 코드·결과 일부의 read-only 탐색·명시적 Apply |
| Experience Promotion | 반복 우위가 있는 방법만 승격 |

새 Store·Intent Router·별도 개발 Agent·별도 Artifact 시스템은 기본 후보가 아니다.

---

## 5. 도달 순서

```text
공식 MCP
→ 공식 API/OpenAPI/SDK
→ 공식 CLI
→ 공식 export/import·local sync
→ 기존 Browser DOM
→ bounded adapter·program
→ generic Desktop GUI는 NX-3 밖
```

Runtime이 업무 의미로 이 경로를 강제하지 않는다. 모델이 공식 현실·권한·비용·목적을 보고 선택하며 Runtime은 실제
가용성·identity·scope·execution을 제공한다.

---

## 6. 공통 Connection Reality

연결은 “key가 저장됐다”로 완료하지 않는다.

```yaml
connection:
  serviceIdentity: exact publisher and endpoint
  route: mcp | api | cli | browser | local_export
  authKind: api_key | oauth | app_password | cli_profile | none
  scopes: exact granted capabilities
  state: disconnected | preparing | connected | ready | expired | degraded | unknown
  readActual: verified or not
  writeActual: verified or not
  secretRefs: runtime only
  revision: exact
  lastVerifiedAt: timestamp
  removeAndRevoke: available or bounded
```

구분:

- credential accepted
- connection established
- read capability actual
- write capability actual
- 외부 delivery actual

이 다섯 사실을 하나의 `connected=true`로 합치지 않는다.

---

## 7. API·MCP의 한 칸 연결 UX

### 7.1 단순 API key 경로

```text
사용자: 이 MCP/API 연결해줘.

T5:
공식 Example CRM 연결이에요.
기본적으로 고객·주문 읽기만 사용하고 수정 권한은 열지 않을게요.

API key [                         ]
[연결]
```

T5가 뒤에서 수행:

1. official publisher·endpoint 확인
2. auth·scope·rate·version 확인
3. key를 Secret Store에 저장
4. 모델·Prompt·로그 전송 0
5. health 또는 read-only actual
6. schema·pagination·error 확인
7. capability catalog에 on-demand 등록
8. remove·revoke·refresh 안내

### 7.2 복잡한 인증

- OAuth browser handoff
- tenant/workspace selection
- redirect URL
- certificate·VPN
- app password
- local stdio server

사용자가 기술 단계를 직접 수행하지 않도록 T5가 현재 필요한 한 단계만 안내한다. 비밀 입력과 브라우저 즉시 승인은
기존 권한 경계를 따른다.

---

## 8. Connector Package Contract

```yaml
package:
  name: stable capability identity
  publisher: verified
  source: official URL or pinned repository
  version: exact
  license: observed
  transports: declared
  auth: declared
  capabilities:
    - name
      effect: observe | local_change | external_change
      requiredScopes: []
  runtime:
    platform: []
    entrypoint: exact
    dependencies: pinned
  security:
    networkHosts: []
    filesystem: []
    secrets: []
  tests:
    fixture: exact
    actualRead: status
    actualWrite: status
  rollback:
    previousGeneration: exact
```

package가 자기 capability·security를 선언했다고 신뢰하지 않는다. T5 preflight·sandbox·actual observer가 독립 검증한다.

---

## 9. 코드 제작 계약

모델이 코드를 작성했다는 사실은 능력 완성이 아니다.

```text
purpose·source·authority
→ program/project source
→ deterministic lint/type/build
→ synthetic fixture
→ actual input
→ independent observer
→ user result
→ cleanup·Artifact·Undo
```

필수:

- exact source handles
- declared dependencies
- declared network/filesystem/effects
- pinned runtime
- tests that fail when behavior is removed
- actual result readback
- no self-certified success
- Stop·deadline·restart
- owner dirty files preservation
- generated code provenance

---

## 10. NX-3 Gate

### NX3-0 — Current Developer Capability Baseline

제품 변경 0.

실제 Console에서 다음 기준선을 고정한다.

1. 공식 MCP 연결
2. API key read connector
3. CSV 변환 프로그램
4. 작은 dashboard
5. 기존 프로젝트 bug fix
6. localhost Browser QA
7. CLI profile 사용
8. dependency 없는 현재 한계

기록:

- purpose success
- first useful·final wall
- model/Tool rounds·tokens·bytes
- credential exposure
- actual Effect·Artifact·Undo
- 사용자 기술 입력·질문·승인 수

### NX3-1 — Connection Onboarding Reality

사용자 완료 문장:

> 사용자는 서비스 이름이나 공식 URL을 말하고 필요한 비밀값만 안전한 입력창에 넣으면, T5가 현재 연결 가능성·권한·
> 실제 읽기·쓰기 범위를 확인하고 연결·재연결·제거까지 관리한다.

개발:

- official source·endpoint·publisher identity
- auth/scope plan
- one-field key UX와 OAuth handoff
- SecretRef
- read-only positive control
- connection state·health·expiry
- remove·revoke·reconnect

금지:

- key를 chat·model·log에 넣기
- ping 성공을 read/write actual로 확대
- 모든 scope 기본 요청
- arbitrary URL 자동 신뢰

### NX3-2 — MCP Plug-and-Play

사용자 완료 문장:

> 정상적인 공식 MCP라면 사용자는 URL과 필요한 인증만 제공하고, T5는 Tools·Resources·Prompts를 안전하게 발견해
> 필요한 능력만 on-demand로 사용할 수 있다.

개발:

- HTTP·stdio transport identity
- OAuth 2.1·API key·local command
- `tools/list`·`resources/list`·schema validation
- name collision·duplicate·tool poisoning
- Tool definition Context cost
- read/write effect classification
- provider/server revision·cache·TTL
- disconnected/expired/revoked recovery

합격:

- 공식 MCP 세 종류 실제 연결
- key 한 칸 positive control
- malicious descriptor·foreign redirect·scope expansion 차단
- Direct Tool surface 무회귀

### NX3-3 — API Adapter Forge

사용자 완료 문장:

> 공식 MCP가 없어도 OpenAPI·SDK·문서·Postman·GraphQL schema가 있으면 T5가 필요한 최소 API adapter를 만들고 실제
> read 결과로 자격한다.

순서:

```text
official spec
→ exact operations·auth·scope
→ generated adapter in scratch
→ synthetic server fixture
→ read-only actual
→ pagination·rate·error
→ optional write opposing test
→ managed package candidate
```

금지:

- HTML 설명에서 endpoint 추측
- sample token 저장
- 모든 API method 노출
- write를 read success로 자격
- current schema 변화 무시

### NX3-4 — CLI Broker Expansion

사용자 완료 문장:

> 사용자가 이미 로그인한 공식 CLI가 있으면 T5는 재인증과 key 노출 없이 그 CLI를 필요한 범위에서 사용한다.

개발:

- `gh` 이외 실제 수요 CLI baseline
- binary/version/provider identity
- broker-owned credential environment
- output secret masking
- command/effect allow contract
- subprocess tree·Stop·restart
- CLI update·logout·missing state

후보 예:

- cloud CLI
- database CLI
- deployment CLI
- enterprise internal CLI

실제 사용자 목적 없는 CLI 수집은 금지한다.

### NX3-5 — Capability Forge

사용자 완료 문장:

> 현재 T5에 없는 작은 능력이 필요하면 T5가 그 목적에 맞는 프로그램을 만들어 한 번 안전하게 사용하고, 반복해서
> 더 낫다는 사실이 증명될 때만 관리 가능한 Capability로 승격한다.

상태:

```text
ephemeral candidate
→ fixture qualified
→ actual one-shot
→ field candidate
→ fresh-purpose AB/BA
→ managed active
→ stale/regression archive
```

승격 근거:

- 서로 다른 achieved Work
- exact code/dependency digest
- purpose·preconditions
- failure·negative evidence
- wall·calls·tokens·user burden improvement
- platform actual
- rollback generation

### NX3-6 — Project Developer

사용자 완료 문장:

> 사용자는 버그 수정·dashboard·온보딩·작은 웹앱·자동화처럼 원하는 결과를 말하고, T5는 현재 프로젝트를 보존하며
> 원인을 찾고 구현·테스트·실제 사용·교정·Undo까지 끝낸다.

개발 흐름:

```text
repo·dirty state
→ actual failure
→ source·dependency·test reality
→ 최소 구현
→ focused test
→ relevant full test
→ managed server
→ Browser actual use
→ visual/interaction check
→ stop server
→ change receipt·review·Undo
```

지원 목표:

- small/medium local web app
- dashboard·portal·onboarding
- data tool·converter
- connector admin surface
- existing project bounded repair

비목표:

- frontier Coding Agent 전체 복제
- 수백 파일 무감사 autonomous refactor
- 사용자 branch·dirty changes 임의 정리
- test 없이 코드 성공 주장

### NX3-7 — Developer Judgment & Natural Activation

별도 “개발자 모드”를 항상 켜지 않는다.

```text
현재 Hand로 충분 → 그대로 해결
CLI가 가장 단순 → CLI
한 번의 deterministic 처리 → ephemeral program
지속 연결 → connector
사용자 결과가 software 자체 → project development
```

모델이 의미·방법을 선택하고 Runtime은 현재 capability·cost·authority·effect를 공급한다.

자격:

- 같은 일반 사용자 표현과 전문가 표현
- Direct·Single Hand 비개입
- 불필요 coding 0
- Tool이 있는데 재구현 0
- 작은 코드로 충분한데 새 platform 0
- 현재 한계를 정직하게 설명

### NX3-8 — Platform·Package Qualification

- macOS actual
- Windows x64 actual
- Windows ARM64가 제품 target이면 별도 actual
- runtime·dependency·path·encoding·shell
- installed package에서 MCP/API/CLI/program/project 여정
- uninstall·upgrade·rollback

source 준비는 physical PASS가 아니다.

### NX3-HQ — Developer & Connection Human Qualification

한 실제 Console에서 일반 사용자가 다음을 말한다.

1. “이 공식 MCP 연결해줘.”
2. “이 API key로 주문을 읽을 수 있게 해줘.”
3. “이 두 파일을 매번 같은 양식으로 바꾸게 해줘.”
4. “이 자료를 보는 dashboard 만들어줘.”
5. “이 사이트 버튼이 안 되는데 고쳐줘.”
6. “지금 없는 기능이면 필요한 걸 만들어서 해결해줘.”
7. 중간 교정·Stop·restart·Undo
8. connector expiry·rate limit·ACK unknown
9. malicious Tool description·prompt injection·secret exfiltration 반대시험
10. fresh purpose에서 Capability 재사용·archive

T0 입력→진행→first useful→final→actual use→correction→recovery 전체를 기록하고 첫 pass 수리 뒤 clean second pass를 수행한다.

---

## 11. Optional NX3-R — Remote·Cloud Execution

상태: `OPTIONAL_AFTER_NX3_LOCAL_CORE · NOT_REQUIRED_FOR_NX3_CORE_COMPLETE`

Cloud execution은 개발자 함수의 선행 조건이 아니다.

로컬에서 먼저 닫을 것:

- Terminal·sandbox
- project workspace
- dependencies
- tests·Browser QA
- Artifact·Undo
- Connection·Secret·Receipt

그 뒤 다음 실제 수요에서만 연다.

- 장기 build·test
- 큰 model·GPU
- 여러 platform 자격
- 사용자의 컴퓨터를 켜두지 않는 장기 작업
- 팀 shared execution

계약:

- conversation·Work·credential owner는 T5
- remote host는 disposable 또는 paired exact identity
- provider secret remote 전달 0
- workspace reconcile·conflict·result receipt
- disconnect·replacement·Stop·orphan cleanup
- local fallback을 자동 성공으로 꾸미지 않음

---

## 12. 성능·제품 승격식

```text
정확성·source·authority·Effect truth 무회귀
AND 일반 사용자의 기술 설명·질문·승인 부담 감소
AND official MCP/API key 연결이 실제로 간단함
AND program/project 결과가 실제 실행·사용 가능
AND Direct·Single Hand 속도·Context 무회귀
AND model/Tool rounds·tokens·wall이 목적에 비례
AND connector·Capability stale/rollback 성립
AND 모델별 Prompt·업무 Router·별도 사용자-facing 개발 Agent 0
AND 실제 Console clean second pass PASS
```

코드 줄·connector 수·MCP Tool 수·지원 언어 수는 성공 지표가 아니다.

---

## 13. 절대 중단선

- 같은 연결 결함에 세 번째 Prompt·Tool description patch
- API key·OAuth token이 model Context나 log에 나타남
- external package 선언을 검증 없이 신뢰
- official route가 있는데 custom adapter 재개발
- 단순 사용자 요청을 무조건 coding Work로 전환
- 별도 Agent·Memory·Work·Artifact Store 생성
- generated program의 exit 0·self JSON을 성공으로 사용
- 테스트를 지우거나 약화해 connector를 green으로 만듦
- 현재 T5의 Terminal·G·F·Browser·Undo를 복제
- GUI나 cloud를 개발자 함수의 필수조건으로 확대
- source qualification을 package·platform PASS로 주장

---

## 14. 파일 책임 후보

실제 Gate 시작 시 current head에서 재감사한다.

| 후보 | 책임 |
|---|---|
| `connection-reality.js` | 현재 서비스·route·auth·scope·actual 상태 |
| `connector-package-contract.js` | package identity·capability·security·runtime |
| `mcp-admission.js` | official MCP transport·auth·schema·poisoning 검사 |
| `api-adapter-qualification.js` | spec→fixture→actual adapter 자격 |
| `capability-forge.js` | ephemeral→managed promotion coordinator |
| `developer-work-projection.js` | project·test·Browser·Artifact factual Context |
| `developer-capability-tool.js` | on-demand deferred product surface 후보 |

새 파일은 책임이 current source에 없고 두 실제 목적에서 공통 gap이 재현될 때만 만든다.

---

## 15. 커밋 순서

각 Gate:

1. current reality·exact failure·RED
2. contract·authority·non-goals
3. qualification-only candidate
4. deterministic opposing tests
5. actual model·service·platform A/B
6. minimal product integration 또는 제품 delta 0 폐기
7. actual Console·closeout

현재 NX-2 branch에 미리 구현하지 않는다.

---

## 16. NX-3 완료 문장

> T5는 일반 사용자가 기술을 몰라도 공식 서비스와 도구를 안전하고 간단하게 연결하고, 이미 있는 CLI를 활용하며,
> 현재 능력으로 부족한 문제에는 필요한 코드·adapter·프로그램·웹앱을 만들어 실제로 실행하고 검증한다. 사용자는
> 계속 하나의 T5와 대화하고, 연결·비밀·Effect·파일·테스트·복구는 T5 영수증에 남으며, 반복해서 우월한 방법만 새로운
> Capability로 성장한다.

이 문장은 NX3-HQ의 clean second whole-flow와 해당 physical platform 자격 전에는 사용할 수 없다.

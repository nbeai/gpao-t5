# T5 2차 완성 후 품질 고도화 — 연구 봉인 및 작업지시서

상태: `REFERENCE_SEALED · IMPLEMENTATION_NOT_STARTED`

## 1. 제품 완료 문장

> 사용자가 평소 말로 요청한 결과물은 내용이 맞는 데서 끝나지 않는다. 실제 사용 진입점이 작동하고,
> 도메인 검토가 가능하며, 화면과 인쇄에서 읽기 좋고, 후속 작업과 시각 자료가 정확한 시간·출처·identity로
> 전달돼야 완료다.

## 2. 이번에 확인된 구조 결함

| 결함 | 직접 원인 | 구조 원인 |
|---|---|---|
| 설치 ZIP의 `실행.command` 오류 | zsh 읽기 전용 `status` 변수에 대입 | ZIP 무결성·내부 앱 직접 실행을 사용자가 누르는 launcher 실행 증거로 승격 |
| Codex보다 낮은 도메인·디자인 품질 | 최소 구조와 임의 스타일로 생성 | 산출물 목적·도메인·화면·인쇄 품질 계약이 생성 전에 없음 |
| B `after_delivery` 불안정 | deferred 입력이 첫 surface 생성 모델 시야에도 들어감 | active steering과 later follow-up이 모델 projection에서 격리되지 않음 |
| 이미지 후보 수 편차 | 사실용 `web_research`의 provider/OG preview metadata에 의존 | image search가 독립 Evidence provider가 아니라 웹 읽기의 부산물 |
| XLSX 인쇄 폭·페이지 분할 | 화면 preview만 보고 완료 | screen render와 print render를 같은 품질 증거로 간주 |

같은 가족에 문구·예시·조건문을 더 붙이지 않는다. 아래 네 구조축만 연다.

## 3. 비교군·외부 표준에서 채택한 원리

### 실행 산출물

- Apple은 서명·공증 성공과 기능 성공을 같은 것으로 보지 않으며, 실제 배포 container에서 테스트하고 가능하면
  개발에 쓰지 않은 다른 Mac에서 시험하라고 요구한다.
  - https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution
  - https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- zsh 공식 문서는 `status`를 읽기 전용 특수 parameter로 정의한다.
  - https://zsh.sourceforge.io/Doc/zsh_a4.pdf
- Hermes는 Windows installer의 실제 PowerShell host 오류를 별도 회귀시험으로 고정한다.
  - 설치 소스: `~/.hermes/hermes-agent/tests/test_install_ps1_uv_powershell_host.py`

채택: `정확한 배포물 → 깨끗한 해제/설치 → 사용자가 실제 쓰는 진입점 → 실제 종료·출력`을 하나의
자격 단위로 본다.

### 문서·스프레드시트 품질

- Codex Documents는 DOCX를 page PNG로 렌더하고 모든 페이지를 실제 관찰한 뒤에만 전달한다. 명시적 page·margin·
  typography·table geometry와 목적별 design preset을 사용한다.
  - 설치 source: Codex `documents/SKILL.md`
- Codex Spreadsheets는 key range·formula·error scan과 모든 sheet의 시각 render를 완료 조건으로 둔다. source-backed
  결과는 원본 정의와 대표 수치를 reconcile한다.
  - 설치 source: Codex `spreadsheets/SKILL.md`
- Hermes XLSX는 formula output의 LibreOffice 재계산, formula error 0, cached value 재개방을 강제한다.
  - 설치 source: `~/.hermes/hermes-agent/skills/productivity/xlsx/SKILL.md`
- Open XML은 `fitToPage`, `fitToWidth`, `fitToHeight`, orientation, paperSize를 독립 print 계약으로 가진다.
  - https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.pagesetupproperties.fittopage
  - https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.pagesetup

채택: 의미 정확성·도메인 감사성·화면 렌더·인쇄 렌더를 네 증거로 분리한다.

### 실행 중 입력과 후속 작업

- OpenClaw은 active-run `steer`와 later-turn `followup`을 별도 queue로 유지한다. tool batch가 끝난 다음 모델
  boundary에 steer를 주입하며, followup은 active run 종료 뒤에만 시작한다.
  - https://github.com/openclaw/openclaw/blob/main/docs/concepts/queue.md
  - https://github.com/openclaw/openclaw/blob/main/packages/agent-core/src/agent.ts
- Codex app-server `turn/steer`는 exact `threadId·expectedTurnId·clientUserMessageId`에 결속되고 새 turn을 만들지 않는다.
  - https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Hermes ACP도 `/steer`와 `/queue`를 별도 명령으로 공개하고, transcript queue migration을 직렬화한 뒤 routing을
  publish한다.
  - 설치 source: `~/.hermes/hermes-agent/acp_adapter/server.py`
  - 설치 source: `~/.hermes/hermes-agent/gateway/session.py`

채택: 사용자 문장 의미와 실행 시각을 한 label로 합치지 않고 `active projection lane`과 `post-delivery lane`을
물리적으로 분리한다.

### 이미지 Evidence

- Codex Search API는 일반 `search_query`와 `image_query`를 독립 command로 제공한다.
  - https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/search.rs
- Google Custom Search도 `searchType=image`를 별도 surface로 두고 결과에 direct image link, context page,
  dimensions, byteSize, thumbnailLink를 제공한다.
  - https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list
  - https://developers.google.com/custom-search/v1/reference/rest/v1/Search

채택: 시각 자료는 페이지 readability나 OG image에 종속되지 않는 typed image candidate에서 시작한다.

## 4. QH-1 — Executable Artifact Qualification

### 사용자 완료 문장

> 결과 ZIP·앱·설치물의 안내에 적힌 실행 방법이 깨끗한 해제본에서 실제로 작동하고, 지원한다고 말한 플랫폼과
> 확인하지 못한 플랫폼이 구분된다.

### 최소 구조

산출물 등록 전에 모델이 bounded `deliverable contract`를 제안한다.

```text
artifact identity
expected files
advertised entrypoints[]: platform·interpreter·relative path·cwd
expected observable result
guide references
supported / structurally inspected / actually executed platform
```

런타임은 의미를 추측하지 않고 다음을 관측한다.

1. 새 격리 directory에 exact ZIP 해제
2. manifest·hash·권한·symlink/traversal 검증
3. guide가 가리킨 파일 존재 검증
4. 현재 OS용 advertised entrypoint를 그 exact interpreter와 cwd로 실행
5. exit·stdout/stderr·process 잔류 관측
6. expected result와 대조할 Evidence를 모델에 공급

직접 `node app.js` 성공은 `실행.command` 성공을 대신하지 않는다. macOS 실행은 Windows 실행 성공으로
승격하지 않는다.

### 종료 조건

- T5·Codex·Hermes 비교 fixture 세 패키지 반대시험에서 누락 launcher·read-only 변수·정상 launcher를 정확히 분리
- 안내와 ZIP 불일치 0
- 현재 OS advertised entrypoint exit 0·기대 출력·잔류 process 0
- 미실행 플랫폼의 `verified` 주장 0
- 실행 단계 하나를 제거하면 시험 실패

### 비목표

범용 CI 서비스, 모든 언어 package manager, Windows 구현, site-specific installer workflow.

## 5. QH-2 — Artifact Quality & Presentation Contract

### 사용자 완료 문장

> 결과물은 정확하고 감사 가능하며, 대상 사용자가 화면과 인쇄에서 바로 읽고 사용할 수 있다.

### 최소 구조

생성 전에 모델이 목적별 작은 계약을 만든다.

```text
audience · domain · decision/use purpose
delivery medium: screen | print | both
source facts and unresolved mappings
required calculations / traceability
required artifact forms
visual hierarchy goal
```

검증은 다섯 lane으로 분리한다.

1. Semantic: 요청 사실·누락·공란·원본 불변
2. Domain: source mapping·가역적 표준화·수식·감사 추적
3. Structural: file/schema/formula/cache/error scan
4. Screen: 모든 중요 sheet/page 렌더와 clipping·glyph·폭
5. Print: print area·paper·orientation·margin·fitToWidth/Height·PDF 전 페이지

도메인 규칙은 Core 거대 prompt가 아니라 필요한 경우에만 여는 작은 domain profile로 공급한다. 최소 공통축은
정확성·완전성·추적성·사용성·표현 품질이다.

### 종료 조건

- 비교 산출물 A/B/C를 blind 평가해 hard gate 오류를 모두 재현
- 통합 XLSX: 5건·68,300원·미확인 3,000원·원문 고객·매핑 근거·formula error 0
- 화면: 모든 핵심 숫자·표제·상태가 한 번 이상 실제 render에 보임
- 인쇄: 핵심 표가 가로 분할·clipping 없이 의도한 page 폭에 들어감
- DOCX: 모든 page PNG 실제 관측, glyph·table·page break 오류 0
- 사용자 결과에는 QA 중간 파일·내부 명령 노출 0

### 비목표

모든 문서에 화려한 template, 점수 하나로 미학 강제, domain별 전용 생성기 대량 추가, 작은 텍스트 파일까지
항상 시각 모델 호출.

## 6. QH-3 — Temporal Input & Publication Isolation

### 사용자 완료 문장

> “먼저 결과를 보여주고 다음 답에서 표로 정리해줘”가 첫 답과 다음 답으로 정확히 분리되고, delivery 실패·
> restart에서도 한 번만 이어진다.

### 최소 구조

```text
active steering lane: 현재 Run이 다음 model boundary에서 반영
post-delivery lane: 현재 Run model transcript에는 내용 비노출
publication barrier: exact delivery terminal 뒤 activation
```

모델이 `defer_after_delivery`를 선택한 경우 admitted text와 그 선택을 만든 assistant output을 현재 결과 생성
transcript에서 격리한다. 현재 Run은 admission 전 base revision projection으로 결과를 작성한다. deferred content는
exact input ID로 delivery terminal 뒤 새 Run에 처음 공급한다.

표현별 정답을 prompt example로 넣지 않는다. holdout은 평가에만 쓰고, runtime은 문자열·정규식으로 분기하지 않는다.

### 종료 조건

- 독립 작성 holdout의 `steer·followup·independent·cancel` 의미와 실제 surface sequence를 별도 채점
- Terra·gpt-5.5에서 after-delivery 10/10씩
- 첫 surface에 deferred 결과 포함 0, 다음 surface 누락 0
- delivery failed/unknown에서 조기 activation 0
- restart 뒤 exact input 실행 1회, duplicate surface 0
- 추가 few-shot·keyword rule·retry vote 0

### 비목표

일반 workflow engine, 자연어 label 사전, 모든 후속을 별도 Work로 강제, 모델 판단 제거.

## 7. QH-4 — Typed Visual Evidence Supply

### 사용자 완료 문장

> 이미지 세 개를 요청하면 실제 이미지 bytes·출처 페이지·시각 preview 세 개를 받거나, 부족한 exact 이유를
> 한 번에 알 수 있다.

### 최소 구조

```text
ImageSearchProvider
→ candidate(imageUrl, contextUrl, dimensions, bytes, thumbnail, rights, provider rank)
→ fetch/redirect/public-address
→ magic MIME·decode·size
→ sha/perceptual duplicate
→ managed attachment
→ source+preview result
```

먼저 현재 credential로 사용 가능한 dedicated image provider 후보를 자격화한다. Codex 전용 search endpoint를
T5에 있다고 가정하지 않는다. 공식 provider가 없으면 Google CSE 같은 선택형 연결과 기존 provider image field,
OG image fallback을 tier로 분리한다. 일반 `web_research`의 readable source 절단을 image candidate 정본으로
재사용하지 않는다.

### 종료 조건

- 디자인·인물·제품·한국 로컬 장소 등 10개 고정 query에서 requested 3의 실제 managed preview coverage 측정
- provider candidate·fetch·decode·attachment 단계별 failure 100% typed
- 0 preview/0 failure 금지
- source page와 direct image identity 모두 보존
- 중복 이미지 0, private address·비이미지·과대 bytes 0
- 일반 이미지 요청의 가시 Browser 0
- Terra·gpt-5.5 동일 tool receipt에서 결과 수 편차가 있어도 모델별 재검색 폭주 0

### 비목표

전용 브라우저 복귀, 페이지 screenshot을 일반 이미지 검색으로 승격, 무단 라이선스 보장, 이미지 생성 기능.

## 8. 개발 순서와 중단선

```text
QH-1 executable artifact
→ QH-2 artifact quality/print
→ QH-3 temporal isolation
→ QH-4 image provider qualification
→ 동일 인간 여정·blind 산출물 재평가
→ package Release
```

- 각 단계는 사용자 완료 문장과 실패 원본 하나로 시작한다.
- 같은 결함 가족에 세 번째 prompt/example patch가 필요하면 구현을 중단하고 구조를 다시 판정한다.
- QH-1·2가 닫히기 전 package·공증을 시작하지 않는다.
- QH-3 때문에 B 전체를 다시 쓰지 않는다. 이미 통과한 correction·cancel·restart·publication을 보존한다.
- QH-4에서 자격 provider가 없으면 provider 부재를 결과로 닫고 임의 scraping을 Core에 넣지 않는다.

## 9. 최종 통과 증거

```text
기존 T5 Terminal·Document 속도 무회귀
AND 설치 launcher 실제 실행
AND Codex 수준의 도메인·표현 품질 격차 축소
AND after_delivery exact two-surface
AND image 3개 actual artifact
AND false completion 0
AND 가시 Browser 0
AND 사용자 질문·승인 증가 0
```


# T5 Dev Studio 후보 엔진 리서치: oh-my-pi

날짜: 2026-07-27  
상태: 후보 리서치 / 부분검증  
대상: https://github.com/can1357/oh-my-pi  
목적: T5가 "개발하고 싶은 비개발자 사용자"를 지원할 때 `oh-my-pi`를 개발 모드 엔진으로 fork, 흡수, 연동, 참고할 가치가 있는지 판단한다.

## 결론

`oh-my-pi`는 T5의 개발 모드 후보 엔진으로 검토할 가치가 있다.

다만 지금 바로 fork하거나 T5 본류에 흡수하는 것은 보류한다. 가장 합리적인 다음 행동은 P2 안정화 이후 1~2주짜리 RPC/SDK 연동 스파이크를 통해, T5의 데스크탑 승인 카드, 원장, 복구, 미리보기 철학 아래에서 `oh-my-pi`를 외부 개발 실행 엔진처럼 붙일 수 있는지만 검증하는 것이다.

핵심 판단:

- 채택: 아직 아님
- 완전 fork: 지금은 비추천
- 부분검증: 권장
- 우선순위: P2 본류 안정화 이후, T5 Dev Studio 후보 검증으로 분리

## T5 관점의 전제

T5는 AI 모델이 아니다. 여러 AI 모델의 한계를 보완하고, 모델이 사용자의 현재 의도, 대화 흐름, 도구, 데이터, 앱/웹, 기억, 맥락, 승인, 복구를 자연스럽게 사용할 수 있게 하는 AI OS다.

따라서 개발 모드도 단순한 코딩 에이전트가 되어서는 안 된다. T5 개발 모드는 비개발자가 다음 흐름으로 개발을 시작할 수 있어야 한다.

1. 말로 원하는 것을 설명한다.
2. T5가 현재 프로젝트와 의도를 파악한다.
3. 바꿀 내용과 위험을 미리 보여준다.
4. 사용자가 승인한다.
5. 실행 결과와 검증 로그가 원장에 남는다.
6. 문제가 생기면 되돌릴 수 있다.

`oh-my-pi`가 강한 엔진이라면, T5는 그 엔진을 사람이 믿고 쓸 수 있는 운영 경험으로 감싸야 한다.

## 확인된 사실

원격 저장소와 README 기준으로 확인한 사실은 다음과 같다.

- 저장소는 terminal-first AI coding agent다.
- Rust core, Bun/TypeScript monorepo, Python 일부, 패키지형 SDK/CLI 구조를 가진다.
- 루트에는 `packages`, `crates`, `python`, `docs`, `scripts`, `Cargo.toml`, `package.json`, `bun.lock` 등이 있다.
- README는 40+ provider, 32 built-in tools, LSP, DAP debugger, browser, subagents, memory, hash-anchored edit를 핵심 기능으로 제시한다.
- 핵심 패키지는 `pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, `pi-natives`, `hashline`, `pi-mnemopi`, `swarm-extension` 등으로 나뉜다.
- Rust 쪽은 `pi-natives`, `pi-shell`, `pi-ast`, `pi-iso` 등이 있고, N-API addon으로 TypeScript 런타임에 붙는 구조다.
- 진입점은 TUI, one-shot, Node SDK, stdio RPC, ACP다.
- 특히 `omp --mode rpc`와 Node SDK는 T5가 실험하기 좋은 접점이다.
- 라이선스는 MIT다. 상업적 사용, 수정, 배포, sublicense, 판매가 가능하지만 copyright/license notice는 유지해야 한다.

참고 링크:

- GitHub: https://github.com/can1357/oh-my-pi
- README raw: https://raw.githubusercontent.com/can1357/oh-my-pi/main/README.md
- LICENSE: https://raw.githubusercontent.com/can1357/oh-my-pi/main/LICENSE

## README 주장과 검증 경계

README의 다음 항목들은 제품 주장으로 봐야 한다.

- "가장 capable한 agent surface"
- "edits that land on the first attempt"
- benchmark 수치
- browser/Slack 운용성
- memory 품질
- 다중 provider/tool routing 품질

이번 조사는 원격 소스와 문서 확인 중심이다. 실제 설치, 빌드, 실행, 보안 검증, 한국어 비개발자 UX 검증은 아직 하지 않았다.

따라서 위 주장을 T5 채택 근거로 바로 쓰면 안 된다. 모두 스파이크의 검증 항목으로 내려야 한다.

## 통합 방식 비교

| 방식 | 판단 |
|---|---|
| 완전 fork 후 데스크탑화 | 지금은 비추천. 터미널 중심 철학, 거대한 tool surface, Rust/Bun/TS/native addon 유지비가 T5 본류 P2 안정화 흐름을 흔들 수 있다. |
| 별도 엔진으로 RPC/SDK 연동 | 1순위. T5가 의도, 승인, 원장, 복구, UI를 소유하고, `oh-my-pi`는 코드 작업 실행 엔진으로 격리할 수 있다. |
| 특정 기능만 이식 | 2순위. Hashline edit, LSP rename/code action, tool card preview, subagent result schema, memory design은 부분 이식 또는 참고 후보가 될 수 있다. |
| 참고만 하고 T5 자체 구현 | 장기 기본값. 비개발자 AI OS 철학은 T5가 훨씬 다르므로 최종 UX, 권한, 복구 계층은 자체 구현이 맞다. |

## T5에 가치 있는 기능

### Hashline edit

내용 hash 기반 edit는 stale anchor를 막는 데 가치가 있다. 비개발자용 개발 모드에서 "엉뚱한 파일/줄을 고쳤다"는 사고를 줄일 수 있다.

### ast_edit preview -> accept

구조적 수정 제안 후 사용자가 승인하는 흐름은 T5의 승인 카드 철학과 잘 맞는다.

### LSP/DAP

rename, reference, diagnostics, code action, debugger를 실제로 붙이면 "AI가 진짜 IDE처럼 프로젝트를 이해한다"는 체감 품질을 올릴 수 있다.

### RPC/SDK/ACP

T5 데스크탑 앱이 `oh-my-pi`를 외부 엔진으로 감쌀 수 있는 실험 접점이다.

### Subagents + isolated worktrees

병렬 검토, 감사, 작업 분리에 참고 가치가 있다. 단, T5 본류에서는 사용자가 이해할 수 있는 단순한 진행 상태로 감싸야 한다.

### Memory/Hindsight

T5의 Context Mesh, 원장, 승인된 기억과 비교 실험할 만하다. 그대로 흡수하면 충돌 가능성이 있으므로 조심해야 한다.

## 위험한 기능과 충돌 지점

### 터미널 중심 UX

한국의 비개발자, 1인기업, 소상공인, 프리랜서, 크리에이터에게 터미널을 그대로 노출하면 제품성이 깨진다.

### Tool surface 과잉

32개 도구, 다중 provider/model routing, slash command, 특수 scheme, magic keyword는 초보 사용자에게 복잡하다. T5는 이를 사용자가 몰라도 되게 감싸야 한다.

### Browser/Electron/Slack 제어

개인정보, 권한, 실수 실행 리스크가 크다. T5의 승인, 범위 제한, 원장, 복구 경계 없이는 바로 노출하면 안 된다.

### 내부 memory와 T5 원장의 충돌

`oh-my-pi`의 retain/recall/reflect 계열 memory는 T5의 단일 진실 원장, 승인된 기억, 복구 가능한 맥락 원칙과 충돌할 수 있다.

### 완전 fork 유지비

upstream 변화, native addon, Rust/Bun 빌드, 보안 감사, 배포 이슈가 크다. T5 본류 안정화보다 유지비가 앞서면 안 된다.

## T5가 앞설 수 있는 지점

`oh-my-pi`는 강한 개발 엔진이다. 하지만 T5는 비개발자용 AI OS로서 다음 지점에서 앞설 수 있다.

- 자연어 의도 파악
- 한국어 맥락 회복
- 대화 흐름 기반 개발 모드
- 승인 카드
- 실행 전 미리보기
- 실행 후 원장
- 되돌리기
- 한국형 API/MCP 연결
- 모델/도구/기억/승인/복구 자기상태의 단일 진실화

T5는 코딩 도구의 성능만으로 이기는 제품이 아니다. 사람이 믿고 쓸 수 있는 운영 경험에서 이겨야 한다.

## 지금 할 것

- P2 본류 안정화가 끝난 뒤, T5 Dev Studio 후보 검증으로 별도 스파이크를 잡는다.
- `omp --mode rpc` 또는 Node SDK로 작은 개발 작업 3개를 실행해 본다.
- T5식 승인 카드, 원장, 복구, UI 흐름에 엔진 이벤트를 매핑할 수 있는지 본다.
- hashline edit, ast_edit preview, LSP rename/code action을 우선 검증 후보로 둔다.

## 지금 하지 말 것

- 완전 fork
- UI 전면 이식
- T5 본류 P2에 통합
- `oh-my-pi` memory를 T5 memory로 바로 채택
- browser/Slack/Electron 제어를 바로 사용자에게 노출
- "개발자용 강한 도구"를 "비개발자용 AI OS"라고 착각

## 나중에 검증할 것

- hashline edit 단독 이식 가능성
- LSP rename/code action만 분리 가능성
- memory/Hindsight와 T5 Context Mesh의 충돌 여부
- browser tool의 권한 샌드박스화
- RPC/SDK event stream을 T5 원장에 안정적으로 기록할 수 있는지
- native build/배포 부담이 T5 배포 전략과 맞는지

## 1~2주 기술 검증 스파이크

### 목표

T5 데스크탑이 `oh-my-pi`를 외부 엔진으로 호출해 다음 흐름을 만들 수 있는지 확인한다.

1. 파일 읽기
2. 변경 제안
3. 승인 카드
4. 적용
5. 검증 로그
6. 되돌리기 가능 원장

### 완료 기준

- `omp --mode rpc` 또는 Node SDK로 세션 생성이 가능하다.
- 간단한 웹앱, 문서, 스크립트 수정 작업 3개가 T5 UI 카드 모델로 표현된다.
- `edit` 또는 `ast_edit`의 preview를 T5 승인 카드로 변환할 수 있다.
- 적용 전/후 diff, 실행 결과, 실패 로그를 T5 원장에 남길 수 있다.
- 엔진 memory/tool state가 T5의 단일 상태 모델과 충돌하지 않는다는 최소 설계가 나온다.

### 실패 기준

- RPC/SDK event가 T5 승인/원장 모델에 안정적으로 매핑되지 않는다.
- file edit 적용과 rollback 경계가 불투명하다.
- memory/provider/tool 권한을 T5 쪽에서 통제하기 어렵다.
- 비개발자 UX로 감싸는 비용이 자체 구현보다 커진다.
- native build/배포/보안 부담이 T5 본류 안정화보다 커진다.

## 최종 보존 판단

이 문서는 본류 개발 계획이 아니다. 후보 엔진 리서치다.

보존 목적은 두 가지다.

1. 좋은 후보를 잊지 않는다.
2. 좋은 후보라는 이유로 T5 본류를 흔들지 않는다.

최종 권고:

> fork/흡수는 보류한다. P2 안정화 이후 RPC/SDK 부분검증만 진행한다. `oh-my-pi`는 좋은 참고 엔진 후보지만, T5의 본질은 여기서 가져올 코드보다 비개발자가 안전하게 개발을 시작하게 하는 운영 경험에 있다.

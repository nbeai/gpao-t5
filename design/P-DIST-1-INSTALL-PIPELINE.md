# P-DIST-1 · 최소 설치·배포 파이프라인 + 산출물 검증 게이트

날짜: 2026-07-26 · 현재 상태 갱신: 2026-08-03

- 상태: `MINIMUM_ARTIFACT_PATH_PASS`
- 소비자 설치 준비: `PLAN_READY_IMPLEMENTATION_NOT_STARTED`
- 현재 근거: `npm pack` 151개 파일 → 격리 폴더 압축 해제 → 실제 진입점 부팅 → `/health` →
  온보딩 진입 PASS (`f1270da` 제품 기준선)
- 이 문서의 최소 tarball 경로는 완료됐다. 아래 배경의 과거 결손은 역사이며 현재 결손이 아니다.

## 착수 전 필수 관문

이 문서의 설치 패키지 제작은
`docs/03-verification/T5-FINAL-DUAL-MODEL-HUMAN-SCENARIO-VALIDATION-PLAN-2026-07-28-ko.md`의 최종
이중 모델 실사용 판정이 `PASS`인 commit에서만 시작한다.

- Codex / GPT-5.6sol 검증선과 Claude / Opus 5 또는 Fable 5 검증선이 각각 독립 실행되어야 한다.
- 두 검증선의 블라인드 보고, 상호 반박, 결함 재현, 영향 회귀가 닫혀야 한다.
- `RETEST`, `BLOCKED`, 미확인 또는 조건부 통과 상태에서는 패키지를 만들지 않는다.
- 최종 `PASS` 뒤 제품 코드·프롬프트·스키마·실행 경계가 바뀌면 영향 시나리오를 다시 검증하고 새 SHA를
  패키지 기준선으로 삼는다.

## 배경 (실측)

- 당시 T5에는 설치 경로가 없었다. 현재는 `bin`·`files`·`verify:package`와 격리 산출물 부팅
  게이트가 있으며, 최소 tarball 경로의 전제는 채워졌다.
- T3 제1원칙("소스가 아니라 산출물을 검증한다")은 **전부 배포 단계에서 터진 사고**에서 나왔다:
  배포 치환이 디브랜딩 가드를 먹음 · postinstall 인라인 JS 의 `\n` 이 생성 시점에 깨짐 ·
  `npm install` 의 dist 정리가 제품 코드 146개를 지움. 이 사고 계열 때문에 산출물 게이트를 만들었고,
  현재 T5는 그 게이트를 통과한다.
- 회귀만으로 배포물 성공을 주장하지 않는다. 현재 주장은 `verify:package`가 펼친 산출물에서 직접
  확인한 최소 실행 경로에 한정한다.

## 범위 (첫 슬라이스 — 최소 경로 하나를 끝까지)

**목표: 클론/패키지 → 설치 → 실행 → `health check passed` → 온보딩이 뜬다** 를 자동 검증한다.

1. `package.json`
   - `bin: { "gpao-t5": "bin/gpao-t5.mjs" }` — 설치하면 명령 하나로 뜬다.
   - `files` 화이트리스트(`src`, `bin`) — 무엇이 실제로 나가는지 **명시**한다(누락·과다 둘 다 사고).
   - `private: true` 유지(레지스트리 게시는 이 슬라이스 밖). 패키징 자체는 `npm pack` 으로 검증한다.
2. `bin/gpao-t5.mjs` — 실행 진입점. `startLiveServer()` 재사용(§6.24 B2 순서 계약 그대로).
   `--port`·`--no-open` 지원. 준비되면 URL 을 출력하고, 가능하면 브라우저를 연다(실패해도 계속).
3. `GET /health` — 설치 검증이 물어볼 단일 신호. `{ok, version, model:{connected,state}, onboarding:{needed}}`.
   **거짓 초록 금지**: 모델 미연결이어도 `ok:true`(서버는 산 것) 이되 model.connected=false 로 정직하게.
4. `scripts/verify-package.mjs` — **산출물 검증 게이트(제1원칙)**
   - `npm pack` → tarball 을 **임시 디렉터리에 펼침** → 거기서 `node bin/gpao-t5.mjs` 실제 실행
   - `/health` 200 + `ok:true` 확인 → `/onboarding` 의 `needed:true` 확인(설치 직후엔 연결 0)
   - 펼친 산출물에 **테스트·설계 문서·프로세스 산출물이 섞이지 않았는지**, **필수 파일이 빠지지
     않았는지** 둘 다 검사(누락/과다 양방향).
   - 실패는 비-0 종료. `npm run verify:package` 로 노출하고 CI 에 넣는다.

## 경계

- 레지스트리 게시·서명·macOS pkg 는 이 슬라이스 밖(후속). 여기서는 **tarball → 설치 → 실행**까지.
- 의존성 0 원칙 유지 — 패키징 도구를 새로 들이지 않는다(`npm pack` + node 내장만).
- 검증은 소스가 아니라 **펼친 산출물**에서 실행한다. 개발 트리에서 도는 테스트로 대체하지 않는다.
- 사용자 데이터 경로(`GPAO_T5_DATA_DIR`)는 검증 시 임시 디렉터리로 격리한다(실 사용자 상태 오염 금지).

## 검증

- 단위: `/health` 응답 계약(미연결에서도 ok:true·connected:false), 진입점이 startLiveServer 계약을 지킴.
- **산출물**: `npm run verify:package` 가 실제로 tarball 을 펼쳐 실행하고 health·onboarding 을 확인.
  일부러 파일을 빼거나(누락) 테스트를 포함시켜(과다) 게이트가 실패하는지 반대 검증.
- CI: 테스트 뒤에 `verify:package` 를 추가한다.

## 후속 — 소비자 설치 lifecycle

- 레지스트리/사설 배포·서명 · macOS pkg · 자동 업데이트 · 설치 후 브라우저 자동 오픈의 OS 별 처리 ·
  재설치(실행 중 교체) 안전성(T3: bootout 먼저 + 원자적 교체).
- background service 설치·중지·재시작, 사용자 데이터 내보내기·보존·삭제 선택, uninstall과 복구,
  환경 자격 안내·진단, 설치 manifest가 함께 서야 소비자 설치 완료라고 부른다.
- 착수 순서는
  `docs/03-product-plan/T5-INSTALL-VS-STRUCTURAL-HARDENING-DECISION-2026-08-02-ko.md`의 오너 선택을 따른다.

### 착수 순서 (오너 결정 반영 · 2026-08-03)

소비자 설치 작업은 다듬기와 세 파일 정리가 끝난 제품 commit에서 다음 순서로 진행한다.

1. **설치 신분 동결**
   - 제품명, 버전 규칙, bundle id, LaunchAgent label, 기본 포트, 데이터 위치, update channel과
     서명 trust root를 정한다.
   - 현재 `0.1.0-development`, `gpao-t5`, `~/.local/state/gpao-t5`를 소비자 계약으로 그대로
     확정하지 않는다. 기존 개발 데이터의 새 위치 이관과 되돌림을 함께 정한다.
2. **자급 런타임 결정**
   - 깨끗한 Mac에 Node가 없다는 전제로 지원 CPU별 Node 런타임을 설치본에 포함한다.
   - 사용자가 Node, npm, 터미널 또는 환경변수를 준비하게 하지 않는다.
   - 포함 런타임의 버전·해시·출처를 manifest에 결합하고 설치 산출물에서 직접 부팅한다.
3. **로컬 표면 소유권 보호**
   - 루프백 바인딩에 더해 `Host`·`Origin`과 설치 인스턴스 신분을 검증한다.
   - 다른 웹페이지와 다른 로컬 프로세스가 세션·기억·자동화·연결 POST API를 호출하지 못하게 한다.
   - OAuth loopback callback의 state 계약과 제품 HTTP API의 소유권 계약을 섞지 않는다.
4. **macOS 권한과 실행 생명주기**
   - 서명된 실제 프로세스에서 Documents/Desktop 등 필요한 사용자 파일 권한과 TCC 동작을 검증한다.
   - Full Disk Access를 기본 전제로 삼지 않는다. 필요한 권한은 작업 시점에 사람말로 요청하고,
     거절 뒤에도 다른 폴더 선택과 재시도 경로를 제공한다.
   - 단일 실행, 포트 충돌, 로그인 뒤 시작, 열기·중지·재시작, sleep/wake, reboot와 고아 프로세스 0을
     하나의 service 계약으로 닫는다.
5. **자격·데이터 이관**
   - 모델·커넥터 자격을 Keychain으로 옮기고 성공 확인 뒤에만 옛 파일 자격을 제거한다.
   - snapshot, schema migration, 중단 재개와 rollback을 먼저 검증한다.
   - 내보낸 사용자 데이터는 새 설치본이 실제로 다시 가져와 복원할 수 있어야 한다.
6. **패키지·업데이트·제거 구현**
   - 앱/launcher, background service, signed pkg, notarization, 원자적 update, 서명된 rollback,
     preserve/export/delete 세 uninstall 경로를 구현한다.
   - 실패 진단은 비밀과 사용자 원문을 제외하고 크기·보존 기간을 제한한다.
7. **설치 산출물 관통**
   - 지원 행렬의 깨끗한 환경에서 신규 설치, 개발본 이관, 첫 대화, reboot, sleep/wake, update,
     손상 update 복구, export→제거→재설치→import를 수행한다.
   - 키보드만 사용, VoiceOver, 화면 확대와 한글 IME의 설치 후 핵심 대화 경로를 함께 확인한다.

공개 배포, Apple 서명 자격 사용, 실사용자 데이터 삭제는 기존대로 오너의 실행 시점 승인 뒤에만 한다.

## 설치 파일 제작 준비 조사 (2026-08-03)

### 확인한 현재 사실

- T5 GitHub 저장소는 private이고 Actions는 활성화돼 있다. 현재 workflow는 `ubuntu-latest` 한 종류이며,
  등록된 배포 environment, Actions secret, Release, self-hosted runner는 없다.
- 최근 원격 CI는 연속 실패했다. 로컬 `npm test`는 동시성 3을 고정하지만 CI는 `node --test`를 직접
  실행해 같은 계약이 아니다. 설치 matrix를 붙이기 전에 이 차이를 닫고 원격 초록 기준선을 회복한다.
- GitHub-hosted runner는 private 저장소에서도 Windows x64(`windows-2025`), macOS arm64
  (`macos-15`), macOS Intel(`macos-15-intel`)을 제공한다. 빌드와 깨끗한 VM smoke에는 쓸 수 있다.
- GitHub-hosted VM은 실제 소비자 컴퓨터를 완전히 대신하지 못한다. Windows runner는 UAC가 꺼져 있고,
  macOS runner는 실제 사용자 TCC 선택, sleep/wake, 재부팅 뒤 로그인 경험을 최종 증명하지 못한다.
- 과거 GPAO-T 배포에서는 서명·공증 제출까지 실제 수행했다. 당시 실패 원인은 무서명 zip, arm64 Node와
  시스템 Node 폴백, 개발 머신의 `node_modules` 동봉, 포트 충돌과 짧은 health 대기였다.
- 과거 Apple 개인 키는 로컬 보관 자료에 존재하며 저장소에는 없다. 이 자료를 GitHub, 로그, artifact,
  문서에 복사하지 않는다. 로컬 파일 권한은 소유자 전용으로 축소했다.

### 1차 사용자 산출물

| 운영체제 | 사용자에게 줄 파일 | 설치 방식 | 1차 지원 범위 |
|---|---|---|---|
| macOS | `T5-<version>.pkg` 하나 | Developer ID 서명·Apple 공증·staple | Apple Silicon + Intel |
| Windows | `T5-Setup-<version>-x64.msi` | WiX 기반 per-user 설치·Authenticode 서명 | Windows 11 x64 |

- macOS PKG는 두 아키텍처의 검증된 Node 런타임 중 현재 Mac에 맞는 것만 결정적으로 설치한다. 시스템
  Node로 폴백하지 않는다. 아키텍처 선택을 사용자에게 묻지 않는다.
- Windows MSI는 `%LocalAppData%` 아래에 앱과 공식 Node x64 런타임을 설치하고, 시작 메뉴 바로가기와
  로그인 뒤 사용자 세션의 background 실행을 제공한다. 관리자 권한을 기본 전제로 삼지 않는다.
- Windows ARM64는 x64 호환 실행을 실제 확인하기 전까지 지원한다고 쓰지 않는다. 필요하면 후속 native
  ARM64 산출물을 추가한다.
- Electron, Tauri 또는 별도 데스크톱 UI를 설치만을 위해 도입하지 않는다. 기존 T5 서버와 웹 표면을
  같은 제품 코드로 실행한다.

Windows의 공개 배포 파일은 서명 없이는 완료가 아니다. 한국 법인의 실제 선택지는 CA의 조직 검증
코드서명 또는 Microsoft Store 경로이며, 비용·심사·키 보관 방식을 확인한 뒤 하나를 고정한다. 자체
서명 인증서는 개발 smoke에만 사용하고 일반 사용자에게 배포하지 않는다.

### GitHub 실험 환경

1. **현재 CI 복구**
   - CI도 `npm test`를 호출해 로컬과 같은 동시성 계약을 쓴다.
   - 현재 Ubuntu 실패를 원인별로 닫고 같은 commit에서 `test`와 `verify:package`가 모두 PASS해야 한다.
2. **`installer-smoke` 수동 workflow**
   - 기본은 `workflow_dispatch`; 설치 관련 경로가 바뀐 PR에서만 자동 실행한다.
   - `macos-15`, `macos-15-intel`, `windows-2025`가 각자 자기 운영체제 산출물을 만든다.
   - 비밀 없이 무서명 PKG/MSI를 만들고 artifact로 올린 뒤, 같은 새 VM에서 설치 → 실행 → `/health` →
     온보딩 → 중지 → 제거 → 사용자 데이터 선택을 검증한다.
   - 소스 checkout이 아니라 방금 만든 설치 파일을 검증하며, 파일명·버전·SHA-256·크기·내장 Node
     버전·대상 아키텍처를 하나의 manifest로 남긴다.
3. **`release` 보호 workflow**
   - 설치 smoke가 통과한 tag에서만 수동 실행하고 GitHub Environment 승인을 요구한다.
   - signing/notarization과 Release 업로드는 이 workflow에만 둔다. PR과 일반 push에는 비밀을 주지 않는다.
   - 제3자 Action은 commit SHA로 고정한다. 실패한 서명·공증 산출물은 Release에 올리지 않는다.

Actions 사용량은 private 저장소 분량을 소비하므로, 전체 OS matrix는 설치 경로 변경과 수동 후보판에만
돌리고 일반 제품 회귀는 현재의 저비용 Ubuntu 경로를 유지한다.

### 실제 착수 순서

1. 현재 원격 CI를 초록으로 복구한다.
2. 제품 신분·버전·포트·데이터 위치와 Node 버전·공식 해시를 동결한다.
3. 비밀 없는 macOS PKG와 Windows MSI 제작 스크립트를 만들고 로컬/Actions 산출물을 대조한다.
4. `installer-smoke`에서 세 runner의 설치·실행·제거와 손상 산출물 반대시험을 통과시킨다.
5. Mac에서 기존 Developer ID 자격으로 서명·공증한 PKG를 만들고 깨끗한 사용자 계정에서 검증한다.
6. Windows 코드서명 경로를 확정한 뒤 서명 MSI를 실제 Windows에서 UAC·SmartScreen·한글 IME·재부팅까지
   검증한다.
7. update 실패 복구와 이전 버전 rollback을 통과한 뒤에만 보호된 Release workflow를 연다.

### 산출물별 완료 기준

- **Actions 빌드 성공**: 설치 파일을 만들었다는 뜻일 뿐 사용자 설치 완료가 아니다.
- **설치 smoke 성공**: 깨끗한 VM에서 설치·부팅·health·제거가 재현됐다는 뜻이다.
- **서명 산출물 성공**: macOS는 `pkgutil`·`spctl`·notary ticket, Windows는 Authenticode chain과 timestamp를
  산출물에서 다시 확인해야 한다.
- **1차 설치본 완료**: 실제 깨끗한 Mac과 Windows에서 신규 설치, 첫 대화, 재부팅, 업데이트 실패 복구,
  export→제거→재설치→import까지 통과하고 오너가 배포를 승인한 상태다.

### 조사 근거

- GitHub hosted runner: <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>
- Microsoft Windows 배포 방식 비교:
  <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path>
- Microsoft Windows 코드서명 선택:
  <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options>
- MSIX 격리와 full-trust 경계:
  <https://learn.microsoft.com/en-us/windows/msix/msix-containerization-overview>
- 비교 구현: Hermes는 Electron 제품에 NSIS와 MSI를 함께 만들지만, T5는 설치만을 위해 Electron을
  도입하지 않고 기존 런타임을 직접 패키징한다.

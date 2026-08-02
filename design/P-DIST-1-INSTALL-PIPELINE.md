# P-DIST-1 · 최소 설치·배포 파이프라인 + 산출물 검증 게이트

날짜: 2026-07-26 · 현재 상태 갱신: 2026-08-02

- 상태: `MINIMUM_ARTIFACT_PATH_PASS`
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

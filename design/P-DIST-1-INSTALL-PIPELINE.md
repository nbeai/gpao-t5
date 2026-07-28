# P-DIST-1 · 최소 설치·배포 파이프라인 + 산출물 검증 게이트

날짜: 2026-07-26 · 브랜치: `p-dist-1-install-pipeline`

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

- T5 에는 **설치가 없다**. `package.json` scripts 는 `test`·`start` 둘뿐, `bin` 도 `files` 도 없다.
- 그런데 §6.27 온보딩은 "설치 완료 후 즉시 전개"를 전제한다 — **전제가 비어 있다.**
- T3 제1원칙("소스가 아니라 산출물을 검증한다")은 **전부 배포 단계에서 터진 사고**에서 나왔다:
  배포 치환이 디브랜딩 가드를 먹음 · postinstall 인라인 JS 의 `\n` 이 생성 시점에 깨짐 ·
  `npm install` 의 dist 정리가 제품 코드 146개를 지움. **T5 는 이 단계를 한 번도 통과한 적이 없다.**
- 즉 지금의 388/388 은 "개발 트리가 멀쩡하다"는 뜻이지 "사용자에게 도달하는 것이 멀쩡하다"가 아니다.

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

## 후속

- 레지스트리/사설 배포·서명 · macOS pkg · 자동 업데이트 · 설치 후 브라우저 자동 오픈의 OS 별 처리 ·
  재설치(실행 중 교체) 안전성(T3: bootout 먼저 + 원자적 교체).

# TG-5A §0-C 감사 종료 4건 — 착수 전 배선 선언 (한 장)

- 2026-07-29 · Claude 구현선 · 대상: 인수인계 §0-C 종료 조건 4건 · 4건을 한 단위로 구현·제출한다.
- 오너 고정 조건: 정규식·한국어 목록 확대 금지 / 모르는 project 는 `unknown` / bounded grant 는
  실제 버튼·철회 관통 / 의미 결합은 자유문↔구조화 사실의 **단일 계약** / 게이트 PASS 전 TG-5B 금지.

| 계약 | ① 소비 지점 | ② 지나는 검사 | ③ 미배선 사유 |
|---|---|---|---|
| **실제 project 신분** — `currentPlaceOf(workingState)`(G 행렬이 확정한 「지금 자리」 사실)를 단일 원천으로. 없으면 `null`(추측 금지). `workspace`=T5 인스턴스(store.dir), `project`=확정 자리 | `anchorFor`(관찰 4경로) · `supplyAdmissionSources`(scope) · `buildTurnFacts.project` · grant scope | 서로 다른 자리 2개의 **생산 관통**(영수증→workingState→관찰→세포→admission 격리) | 없음 — 이번 커밋 배선 |
| **의미 결합 단일 계약** — `FACT_ATOMS`: turn-facts 가 사실을 **생산할 때 쓰는** 원자 어휘(목록 확대가 아니라 이미 생산되는 사실의 신분). 추출 **모델**이 자유문 경계를 원자에 결합(`binding`, 근거=추출 관찰 참조). 반대 지시는 추출기의 관계 판정(`contradicts`)을 세포 correction 으로 지속 → admission 이 조회. admission 은 순수·동기 유지(핫패스 모델 호출 0) | `judgeClause`(원자 매칭) · `judgeDirective`(지속된 correction) · `buildExtractionMessages`(어휘 공급) | 같은 뜻·반대 뜻·무관한 뜻을 **실제 OpenAI·Anthropic 어댑터 코드**(wire 형식 로컬 서버, OAuth 가짜 서버 선례)로 관통. 실키 있으면 라이브 1회씩 | 없음 — 이번 커밋 배선. 한계 명시: 반대 지시의 의미 판정은 모델이 있는 추출 자리(턴 후)에서 지속되므로 **다음 턴부터** 유효(shadow 에서 영향 0, 같은 턴 원문은 모델이 직접 본다) |
| **bounded grant 생산·재사용·철회** — 승인 카드에 [이번만]·[24시간 계속 허용] 실제 버튼(`grantKind`). 소비 시 원장 기록. 재사용은 기존 매듭 `ctx.허락한손` 으로(새 상태기계 금지). 대상 신분은 도구 종류가 아니라 **공통 필드 계약** `grantTargetOf(args)`(target/path/to). 철회는 `/grants` 목록 + 철회 버튼 | `runAndPersistTurn`(기록) · `turn.js` 재사용 판정 → `허락한손` · `/grants`·`/grants/revoke` · `index.html` | HTTP E2E: 부여→소비→**다음 턴 재확인 0**→철회→재확인 부활 + `이번만`은 재사용 안 됨 + 만료 | 없음 — 이번 커밋 배선 |
| **확인 원장 정직한 실패** — `ConfirmationStore` 가 ENOENT 만 「아직 없음」, 그 외 읽기 오류는 던지고 손상 줄은 `degraded` 로 표시(바이트 보존, 재작성 없음). 스냅샷 지연 공급자가 `degraded` 를 승계 | `buildAdmissionSnapshot` 의 지연 공급자 → `trace.status` | 저장 장애 주입: 읽기 불능(EISDIR)→degraded · 손상 줄+정상 줄→정상분 사용+degraded | 없음 — 이번 커밋 배선 |

**전수 훑기 약속**: ① anchor 소비자 4곳 전수(project 원천 교체) ② grant 생산·소비·조회 3층이 같은
키 규칙 하나(`grantKey`) ③ 저장소 3종(registry·observer·confirmation)의 실패 정직성 동일 계약 확인
④ 제출 전 fixture 폴백 전수 + 전체 회귀 + 게이트 + 보강 전 실패 실측.

**제출 시 채움(②열의 실제 검사)**: `test/tcell-audit-closure.test.js` 11건 —
§0-C-1 두 프로젝트 생산 격리 · §0-C-2 어댑터 2계열×3방향+correction 지속 · §0-C-3 버튼
E2E 3건(계속 허용·이번만·자리 미상) · §0-C-4 장애 주입 2건. 보강 전 실측 4/4 실패
(`evidence/tcell/tg-5/BEFORE-0C-REPRO.test.js.txt`). ③열 유예 0건 유지.

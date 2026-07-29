# TG-5 · 백그라운드 성장 생산 배선 증거 (2026-07-30)

> 이 문서는 **구현선(Claude)의 자체 검증** 기록이다. 독립 감사 통과가 아니다.
> 인수인계 `§0`은 수정하지 않았다. TG-5B·실제 영향 단계는 열지 않았다.

- 기준선: `e1cb07a` · 문서 정본 반영: `73c1a57 … 7ebf01f`, `a6a5f2f`
- 구현 커밋: `19a3633` (WIP 보존 `a461be9`)
- 근거 정본: 절대원칙 §0-A-2 · 결정문 §10·§11·§12 · 승인 수명주기 §0.6
- 비밀값은 이 문서·시험·로그에 없다.

---

## 1. 구조 감사 — 네 GAP 전부 PASS

시작 기준선(문서 반영 직후):

```
GAP  foreground_no_durable_io          builds=true storeReads=true publishedRead=false
GAP  published_snapshot_data_plane     producer=false consumer=false
GAP  background_per_session_lane       perSession=true globalLock=false rawUserText=true
GAP  m1_replay_m2_production_lifecycle transitionConsumers=0 replayCaseConsumers=0
```

제출 시점 (`npm run audit:tcell-plane -- --strict`, **exit 0**):

```
PASS foreground_no_durable_io          builds=false storeReads=false publishedRead=true awaitedRead=false
PASS published_snapshot_data_plane     producer=true consumer=true
PASS background_per_session_lane       detached=true perSession=true globalLock=false rawUserText=false
PASS m1_replay_m2_production_lifecycle transitionConsumers=3 replayCaseConsumers=5 legacyImportConsumers=0
```

`legacyImportConsumers=0`은 그대로다 — `importLegacyMemory()`는 이번 범위가 아니며 유예 원장에 남아 있다.

---

## 2. 무엇을 옮겼나

### §10 · 데이터면과 제어면 분리

- **전경**(`kernel/turn.js`): `principleSnapshotStore.read(scopeKey)` **동기 조회** 하나.
  registry·관찰·확인·권한 원장 읽기 0, 모델 호출 0, `await` 0.
  이전에는 `pre_model` 단계에서 그 전부를 `await` 했고, 결과는 `principleTrace`로만 나가
  답에는 들어가지도 않았다 — **이득 0, 대기만**. 성장이 자랄수록 대화가 느려지는 구조였다.
- **제어면**(`kernel/l5-growth/principle-publish.js`): 스냅샷 생산이 여기로 왔다.
  게시는 **완성된 한 벌의 원자 교체**이고, 자리를 모르면 게시도 조회도 하지 않는다.
- **부팅 게시**(§10.2): 자리가 확정되면 뒤에서 한 벌 만든다. 전경은 기다리지 않고 그 턴은 미스로 간다.
- **게시 자격은 데이터면과 같은 판정기**(`admitFromSnapshot`)로 본다. 두 층이 각자 필터를
  만들면 "같은 사실을 두 층이 따로 계산하면 덜 아는 쪽이 이긴다"가 된다.
  턴에 따라 달라지는 사유(경계·무효·재검토·현재지시충돌)로 막힌 것만 게시본에 싣고,
  턴과 무관한 사유(성숙도·권한·확인·범위·근거)로 막힌 것은 아예 싣지 않는다.

### §11 · M1 → ReplayCase → transitionCell → registry → snapshot

- `makeReplayCase()`와 `transitionCell()`이 **실제 생산 소비자**를 얻었다(각각 5·3 호출).
- **replay 는 외부 행동을 하지 않는다.** admission 이 순수 함수이므로, §0-C-2 에서 만든
  **결합된 원자**를 사실로 실체화해 다시 판정하는 것이 곧 재현이다. 결합이 없는 절은 재현할 수
  없고 그런 원리는 M1 에 남는다 — 결합을 만든 이유가 여기서 쓰인다(매듭).
- 판정은 **목표 성숙도의 반사실 사본**에 한다. M1 은 정의상 영향 0 이라 원본으로 돌리면
  positive 가 언제나 성숙도로 막힌다. 재현이 묻는 것은 "**승격되면** 옳게 행동하는가"이고,
  사본은 메모리에만 있고 저장되지 않는다. 실제 승격 통로는 그대로 `transitionCell()` 하나다.
- 실측: suite `verdict: passed` · 다섯 축(positive/negative/boundary/authority/trace) 전원 통과.

### §12 · 가역 학습 자동 반영

- 사용자가 **직접 말한 가역 선호**는 카드 없이 반영한다. 승격은 그대로 단일 통로
  (`confirmCandidate`)를 지난다 — 게이트를 우회하지 않고, **묻는 자리를 없앤 것**이다.
- 그 확인이 지키던 경계를 따져보면 없었다: 로컬 저장 · 되돌리기 경로 존재 · 기억은 권한이 아님 ·
  대상 확정. 절대원칙 §0-A-2 의 판정 그대로 **마찰 회귀**였다.
- 자동이 아닌 것: 추정 학습 · 운영 원리 · 비가역 · 비밀 모양. 그 경우에도 **학습 순간에 카드를
  띄우지 않는다** — 조용히 후보로 남기고 실제 영향·권한 경계에서만 기존 Authority 가 묻는다.

---

## 3. 같은 계열 결함 다섯 — "게시본이 비어도 정상처럼 보인다"

구현 중 실측으로 잡은 것들이다. 다섯 다 **조용히 아무 일도 안 하면서 초록**인 모양이었다.

| # | 결함 | 결과 |
|---|---|---|
| 1 | `M3_scoped` — 존재하지 않는 성숙도 이름을 손으로 적음 | M3 이상이 통째로, 조용히 게시 제외 |
| 2 | 부팅 게시가 `ctx.projectId` 대입 **앞**에 있었음 | 자리가 늘 `null` → 게시가 한 번도 안 돎 |
| 3 | 게시 자격 판정을 `project: null` 로 돌림 | 전부 `scope_mismatch` → 게시본 영원히 빔 |
| 4 | 게시 자격을 **빈 사실**로 판정 | 경계에서 먼저 걸려 확인·권한 관문이 실행조차 안 됨 |
| 5 | 확인을 세션 사실로 찾음 | 확인된 원리도 확인 없음으로 취급 |

고친 방식도 함께 남긴다. ①은 **계약에서 유도**한다(영향 상한이 전경 세 역할 중 하나라도
허용하면 게시 대상) — 이름을 두 곳에 적으면 언젠가 갈라진다. ④는 **최선 턴**으로 판정한다:
게시가 물어야 할 것은 "지금 들어오는가"가 아니라 "들어올 수 있는 턴이 하나라도 있는가"다.
⑤는 확인이 **세션 사실이 아니라 사용자 사실**이므로 원장 전체에서 찾는다(`ConfirmationStore.byCell`).

---

## 4. 보장 이전 — 삭제하지 않고 판정이 일어나는 층으로

옛 검사 8건은 "전경이 registry 를 읽는다"를 정답으로 고정하고 있었다. 새 계약에서 그건 금지다.
**보장은 하나도 지우지 않았고**, 증명 위치만 옮겼다.

| 보장 | 예전 증명 | 지금 증명 |
|---|---|---|
| 승인·거절 경로도 같은 경계를 지난다 | `retrievedIds.length === 1` | 게시본 조회 흔적(`scopeKey`·`snapshotRevision`) |
| 확인 없는 원리는 입장 못 한다 | 턴 trace 의 `confirmation` 사유 | 게시본에 없음 + `publishableIds` 가 정확히 그 사유로 거절 + **반대 방향**(확인 id 만으로는 통과 못 함) |
| 자리 미상이면 추측하지 않는다 | `scope_unknown` 거절 | **조회 자체가 없다** — `scopeKey === null`, `reason === 'snapshot_miss'` |
| 두 프로젝트 격리 | 전경 `scopeFiltered` | 게시본이 자기 자리 원리만 담는다 |
| A2 무권한 차단 | 턴 trace 의 `authority` 사유 | 게시 자격 판정에서 제외(턴과 무관한 관문) |

---

## 5. 인간 마찰 비교 (같은 5문장 시나리오, 각 3회)

| | 카드 | 클릭 | 완료 턴 | 전경 대기 |
|---|---|---|---|---|
| 변경 전 `e1cb07a` | **1** | **1** | 5 | 25~27ms |
| 변경 후 `19a3633` | **0** | **0** | 5 | 26~27ms |

"보고서는 항상 글로 받는 게 좋아" 한마디에서 **카드 1개와 클릭 1회가 사라졌다.**
전경 대기는 같은 범위다(이 시나리오에는 게시된 원리가 없어 조회가 즉시 끝난다) — 저장소 읽기를
없앤 효과는 원리가 쌓일수록 벌어지며, 지금 값은 **악화되지 않았다**는 사실까지가 측정된 것이다.

---

## 6. 정직하게 열어 둔 것

**승격은 아직 일어나지 않는다.** counterfactual 비교의 candidate 쪽을 실사용으로 측정하려면
원리가 실제로 적용된 세계가 있어야 하는데, 영향이 0(TG-5B 미개방)이라 그 세계가 없다.
그래서 `friction-meter` 는 **저장된 관찰에서만** 세고, 못 재는 값은 `0` 이 아니라 `null` 로 둔다.
`counterfactualReplay` 는 null 을 "나빠지지 않았다"가 아니라 **판정 불가**로 읽는다.

즉 지금 이 비교가 증명하는 것은 **개선이 아니라 무해**다. 생산선은 실제로 돌고, 재현은 통과하며,
승격만 측정 부재로 멈춘다 — 그것이 오늘의 사실이다. TG-5B 로 영향이 열리면 candidate 쪽이
실사용 측정으로 바뀌고 그때 승격이 닫힌다.

`importLegacyMemory()` 도 여전히 소비자가 없다(유예 원장에 사유와 함께 남아 있다).

---

## 7. 실행 결과

| 검사 | 결과 |
|---|---|
| `npm run audit:docs` | **PASS** · 18 documents |
| `npm run audit:tcell-plane -- --strict` | **PASS 4/4** · exit 0 |
| `npm test` | **1,345건 · 실패 0** |
| `node scripts/gate.mjs` | **PASS** · 테스트 1,345건 · CPU **23.8s / 40s** · 벽시계 20.0s |

기준선은 올리지 않았다. 감사선의 1,342건·23.9초는 승계하지 않고 본진에서 새로 측정한 값이다.

---

## 8. 남는 것

- TG-5B(실제 영향) — 열지 않았다.
- 승격 완결 — 실사용 마찰 측정이 붙어야 한다.
- `importLegacyMemory()` 배선.
- 인수인계 §0 갱신과 봉인 판정 — **Codex 독립 감사 몫.** 여기서 선언하지 않는다.

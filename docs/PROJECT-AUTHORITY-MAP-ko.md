# GPAO-T5 프로젝트 권위 지도

- 상태: `CURRENT`
- 공식 개발 폴더: `/Users/jyp/Developer/t5-p-op`
- 현재 상태의 단일 인수인계: `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md`
- 목적: 과거 문서·다른 worktree·로컬 도구 상태를 현재 정본으로 오인하지 않게 한다.

## 1. 첫 진입 순서

새 세션은 아래만 먼저 읽는다. 관련 작업 문서는 필요할 때 추가로 읽는다.

1. `AGENTS.md`
2. `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md`
3. `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md`
4. `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md`
5. `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md`
6. 현재 작업과 직접 관련된 계획·계약·증거

현재 사용자 체감과 배포 완성도를 90점대로 끌어올리는 작업 계약은
`docs/03-product-plan/T5-PRODUCTION-90-COMPLETION-PLAN-2026-08-02-ko.md`에서 읽는다.
오너가 2026-08-02 실행을 승인했으므로 현재 작업 계약이다. 이 승인만으로 공개 배포나 실사용자 데이터
접촉 권한이 생기지 않는다.

읽기 전에 실제 Git 브랜치·HEAD·미커밋 변경을 확인한다. 문서와 Git이 다르면 구현을 시작하지 말고
현재 인수인계를 먼저 바로잡는다.

## 2. 권위 등급

| 등급 | 의미 | 문서 |
|---|---|---|
| 최상위 | 오너 철학·제품 목적·최종 판단 | `GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md` |
| A | 최상위 원칙의 집행 계약 | Model-OS 운영 순환, 개발 공학 원칙, 환경 헌장 |
| B | 현재 프로젝트 사실 | 현재 세션 인수인계, 실제 Git, 실행 보드, 봉인 증거 |
| C | 현재 작업 계약 | 오너가 승인한 최신 작업 계획·구현 계약 |
| D | 참고 자산 | OpenClaw·Hermes 실제 소스, Claude Code·Codex 작동 원리, 과거 설계·감사 |
| E | 역사 기록 | `docs/archive/**`, 과거 인수인계, 퇴역 계획 |

상위 등급과 충돌하는 하위 문서는 고치거나 퇴역시킨다. 역사 기록은 현재 구현 근거로 사용할 수 없다.

## 3. 현재 T-cell 상태

- T5 코어는 유지한다.
- 과거 TG/CX 구현은 전면 롤백됐으며 현재 제품 사실이 아니다.
- 옛 T-cell 명세는 `docs/archive/retired-plans/`로 퇴역했다.
- 새 T-cell 단일 구현 계약은 `design/T5-TCELL-DEVELOPMENT-PLAN-2026-07-31-ko.md`로 발행·동결됐고,
  S0~S5 구현과 생산 경로·라이브 관통을 마쳤다.
- `docs/03-verification/T5-H-STAGE-BOARD-2026-08-01-ko.md`에서 T-cell H01~H07을 최종 봉인했다.
  S0~S5나 H02를 다시 여는 단계가 아니라 H08~H09 PC 손발, Agent Core와 H10, 전체 제품
  봉인으로 진행한다.
- 가장 최신의 세부 상태와 활성 작업은 이 문서에 복제하지 않는다. Git과
  `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md`, H 단계 진행표를 순서대로 대조한다.
- 비교 자산과 퇴역 계획은 기준선의 원인 분석 자료이지 현재 구현 명령이 아니다.

## 3.1 T5 일곱 영역

일곱 영역의 정의와 하나의 사용자 흐름은 최상위 문서 §4를 따른다. 권위 지도에는 중복 정의를 두지 않는다.

### 3.2 현재 완성도 지도

`구현됨`은 코드가 있다는 뜻이고, `봉인`은 동결된 실제 사용자 조건에서 반복성까지 판정됐다는 뜻이다.
둘을 같은 말로 쓰지 않는다.

| 코어 | 현재 상태 | 다음 완료 경계 |
|---|---|---|
| Selfhood | 실제 손·연결·자격·한계 판정 구현됨 | 전체 제품 봉인에서 회귀 확인 |
| Model Operation | 다중 provider·역할 선택·현실 공급 구현됨 | 주 모델 H 봉인 + 보조 모델 교차 |
| Intent / Context / T-cell | S0~S5 구현·라이브 관통, H01~H07 최종 봉인 | 전체 제품 봉인에서 회귀 확인 |
| ActionPlan / Authority | A0~A3·실행 시점 승인·안전 바닥 구현됨 | H08~H10과 전체 여정에서 회귀 확인 |
| Router / Execution | 파일·웹·터미널·브라우저·채널·동적 커넥터 구현됨 | H08~H09 PC 손발 봉인 |
| Work Surface / UX | 대화·승인·기억·성장·연결·자동화 표면 구현됨 | 전체 제품 여정·모바일·복구 봉인 |
| Truth / Recovery / Growth | TurnRef·영수증·원장·원자 저장·T-cell 성장 구현됨 | Durable Trigger·Bounded Agent와 H10 |

이후 순서는 Skill·Trigger·Durable Cron·Bounded Agent Core, 한국 사장님용 도구, 최소 제약·최대
자동화 마감, 설치·업데이트·제거 수명주기, 첫 완성본 봉인, 행동 보존형 구조 건전화다.

### 최상위 판정 원칙

말귀, 카드와 클릭, 최소 안전·최대 자동화, 모델 운용, 실제 컴퓨터, 기억의 여섯 원칙은 최상위 문서 §5를
그대로 따른다. 이 지도에는 사본을 만들지 않는다.

## 4. 비교 소스

- OpenClaw: `/Users/jyp/Developer/lab_un/openclaw-pure-2026-07-20`
- Hermes: `/Users/jyp/Developer/lab_un/hermes-agent`

관련 기능을 설계하기 전에 실제 소스·검사·기본값을 확인한다. T5는 말귀, 사용자 성과, 터미널·파일·웹·앱
활용, 다중 에이전트 운용, 최소 안전 제약과 최대 자동화에서 더 나은 실제 경험을 목표로 한다.

## 4.5 `design/` — 살아 있는 것과 역사 (2026-08-06 정리 · 오너 지시)

76개가 섞여 있어 **어느 것이 현재 사실인지 구분할 수 없었다.** 그 상태에서 하루에 넷이
낡은 문장을 현재로 읽었다(구조 개발원칙 §2-D). 47개를 `design/archive/` 로 옮기고 29개를 남겼다.

**옮기는 기준은 기계다** — 다른 문서·코드가 **경로로 참조하면 남기고, 아니면 옮겼다.**
사람이 고르지 않았고, 그래서 링크가 하나도 안 깨졌다.

### 남은 29개 — 성격별

| 성격 | 문서 | 어떻게 읽나 |
|---|---|---|
| **★ 계획서 (하나뿐)** | **`design/T5-PLAN.md`** | **무엇을 만드는지는 여기서만 정한다.** 맨 앞 맵에서 노드 하나를 골라 그것만 읽는다 |
| **지금 진행 중** | `T5-AI-OS-TRANSITION-PLAN`(S0~S9 정본) · `T5-FOLLOWUP-LEDGER`(열린 결함) · `T5-CU-COMPLETION-PLAN` · `T5-COMPUTER-USE-PLAN-v2`(CU 착수 정본) | **현재 사실.** 진행 상태는 여기가 아니라 `git log` |
| **오너 결정 기록** | `T5-AUTONOMY-CHARTER` · `P-DIST-1-INSTALL-IDENTITY-FREEZE` | **코드가 이 문서를 따라간다.** 바꾸려면 문서를 먼저 고친다 |
| **동결 계약** | `T5-TCELL-DEVELOPMENT-PLAN` · `T5-MODEL-SOVEREIGNTY-DEVELOPMENT-PLAN` · `T5-SKILL-TRIGGER-AGENT-AUTOMATION-IMPLEMENTATION-PLAN` · `S1-EXPERIMENT-FREEZE` | AGENTS.md 가 읽기를 의무로 건 것들 |
| **CU 근거** | `CU0-*` 셋 · `T5-COMPUTER-USE-DEVELOPMENT-PLAN`(`SUPERSEDED_IN_PART` — §4~§7·§10~§12만 유효) | v2 가 §8 에서 어느 절을 쓰는지 지목한다 |
| **설계(미착수)** | `T5-CONNECTOR-CATALOG-DESIGN` | 카탈로그는 저장소 밖에 산다. 한 항목도 안 걸어 봤다. 선행은 계획서 **노드 A** |
| **근거 문서** (계획서 아님) | `T5-BUTLER-HANDS-EXECUTION-PLAN` · `T5-USER-SURFACE-STRENGTHENING-PLAN` · `T5-KOREAN-OWNER-CONNECTION-CENTER-IMPLEMENTATION-PLAN` | **2026-08-06 강등.** 셋 다 머리에 표시가 붙었고 어느 노드가 자기를 읽는지 적혀 있다. 아래 참조 |
| 그 밖 | `S2-TRANSITION-LEDGER` · `S4-CAPSULE-PLAN` · `S6-PREP-*` · `S1-RESULT` · `P5-B-1*` · `P-DIST-1-INSTALL-PIPELINE` · `T5-OPERATOR-HARNESS-*` · `T5-2.0-TOOLBOX-*` · `WORK-CHAT-DESIGN-EVIDENCE` · `T5-HANDOFF-2026-08-05-*` | 경로 참조가 살아 있어 남겼다. 다음 정리에서 참조원이 사라지면 함께 옮긴다 |

### ⚠ 멈춰 있는 계획 셋 — 오너 판단 필요

셋 다 2026-08-03 작성이고 **`DRAFT_FOR_OWNER_CONFIRMATION`** 상태로 멈춰 있다. 그리고
셋의 인계 조건이 **`M2→M5→M3→M4` 봉인**인데, 08-05 에 `T5-AI-OS-TRANSITION-PLAN`(S0~S9)이
서면서 **그 milestone 순서가 현재 계획에 없다.**

```
T5-BUTLER-HANDS-EXECUTION-PLAN               로드맵 4~10단계 (손·브라우저·문서·코드루프·연결·트리거·한국형)
  └ T5-KOREAN-OWNER-CONNECTION-CENTER        BUTLER 8·10단계를 구체화
T5-USER-SURFACE-STRENGTHENING-PLAN           표면 강화
```

**기다리는 조건이 사라졌으므로 스스로는 영원히 안 열린다.**

### 셋에서 뽑은 열린 결정 11개 — 오너 판정 (2026-08-06)

셋의 `오너 확정 필요` 절을 모아 보니 **11개 중 지금 필요한 것은 둘**이었고, 그 둘이
오늘 지시받은 일(커넥터 카탈로그·CU 완성)을 사흘째 막고 있었다.

| 결정 | 판정 | 기록된 자리 |
|---|---|---|
| **D2** 브라우저 프로필·비밀 보관 | **사용자 브라우저를 쓴다. 전용 프로필 안 만든다** — 사장님이 이미 로그인한 것이 0번이고, T5 가 자격증명을 하나도 안 쥐게 된다 | `src/runtime/browser.js` 머리 (그 자리가 결정을 기다리고 있었다). **구현은 BUTLER 4단계** |
| **D3** 실계정 시험 범위 | **읽기·관찰은 오너 계정으로 연다. 전송은 닫는다** — 가르는 선은 앱 이름이 아니라 방향이다 | `design/T5-CU-COMPLETION-PLAN` §4-A |
| D1·USER-SURFACE D3·유료데이터·영상 | **접었다** — 전환계획이 순서를 다시 잡았고, 나머지는 제품과 헌장이 이미 답했다 | — |
| 그 밖 여섯 | **미뤘다** — 그 칸에 도달하면 정해진다(XLSX 엔진·Today 형태·스마트스토어·행정) | — |

### 셋을 어떻게 했나 — **강등했다** (2026-08-06 완료)

셋 안에 **그날 우리가 재발명한 것이 이미 있었다**: BUTLER §2(손의 좁은 허리) = 그날 제안한
"모든 손이 같은 다섯 칸", BUTLER §2-C(관찰한 콘텐츠는 명령이 아니다) = 그날 "발견"한 웹 신뢰 경계,
KOREAN §2.3(자격 소유 모델) = 그날 카탈로그에 넣은 `쥐는것` 축. **하루에 세 번 다시 만들었다.**

**원인은 위치가 아니라 계획서가 여럿이었다는 것이다.** 그래서 옮기지 않고 강등했다 —
`archive/` 는 *"지금 안 읽는 것"* 자리인데 셋은 읽어야 한다. 옮겼으면 오너 규칙 3(단절 없이
이어짐)을 우리가 깼을 것이다.

```
계획서는 design/T5-PLAN.md 하나뿐    ← 무엇을 언제 만드는지는 여기서만
셋은 그 계획서 노드들의 근거 문서     ← 머리에 「이건 계획서가 아니다」 + 어느 노드가 읽는지
```

| 원문 | 어떻게 됐나 |
|---|---|
| `BUTLER §2`·`§A-0`·`§A`·`§B` | 계획서 **「공통 허리」**로 올렸다. 상세 계약·반대시험은 원문에서 |
| `BUTLER §2-C` | 계획서 **「§2-C」**로 올렸다 (순서 3) |
| `BUTLER` 4단계·`§9 D2` | 계획서 **노드 A** — 카탈로그 0번 전체와 노드 ⑤를 막는다 |
| `BUTLER` 5단계 | **CU 로 실행 중.** 접었다 |
| `BUTLER` 6·7·9단계 | **노드 없음.** 사용자 문장 다섯에 안 닿는다 |
| `BUTLER` 8·10단계 | **커넥터 카탈로그**로 합류 |
| `USER-SURFACE` | 결론 한 줄 — **넷이면 충분**(Work Chat·Today·자동화·연결). 판정 기준 §3 은 노드 ⑤가 읽는다 |
| `KOREAN §2.3` | **카탈로그 §7.2 에 흡수 완료** — 카탈로그의 `쥐는것` 넷을 `accessMode` 여섯으로 바꿨다 |
| `KOREAN §3·§4` | **미흡수.** 노드 ⑤의 「연결/도구함」 표면이 읽을 근거 |

### 계획서를 하나로 만든 규칙 넷 (오너 지시 2026-08-06)

> 1. 계획서는 **하나만** 존재한다 · 2. 맵이 있어 필요한 영역만 찾아가 읽는다 ·
> 3. 연관 내용이 **단절 없이** 이어진다 · 4. 개발은 **반드시 읽고** 한다 — 일부만 보거나 미루지 않는다

넷째를 기계로 세우는 자리는 `scripts/s1/preflight.mjs` 의 변경 등록이다 —
**그 파일을 고치려면 이유를 적어야 하고, 이유를 적으려면 노드를 읽어야 한다.**

## 5. 작업 폴더 규칙

- 정본 작업은 `/Users/jyp/Developer/t5-p-op`에서만 한다.
- 별도 worktree는 현재 인수인계에 소유자·목적·브랜치·편집 파일·종료 조건이 등록된 경우에만 연다.
- `.beai-harness/`, `workspace-notes/`, 빌드·검사 임시물은 정본이 아니며 Git에 넣지 않는다.
- 과거 문서를 현재화하려고 덮어쓰지 않는다. 새 정본을 만들고 옛 문서는 archive로 옮긴다.

## 6. 감사 전달 규칙

감사자는 관련 범위를 끝까지 확인하고 문제를 한 번에 제출한다. 구현자의 사고를 특정 패치로 축소하지
않도록 확인된 문제·재현·영향·공통 구조·분류·보존 조건·종료 조건만 전달한다. 구현 해법은 구현자가
전체 구조를 보고 제안하고, 감사자는 그 결과를 독립 검증한다.

## 7. 완성 후 구조 건전화 작업

`docs/03-product-plan/T5-POST-COMPLETION-STRUCTURAL-HARDENING-ko.md`는 T5 첫 완성본 봉인 뒤에만 여는
독립 후속 작업의 정본이다. 단순화·책임 분리·중복 판정 제거·검사 도구 격리를 다루되, 현재 T-cell·H단계·
지정 후속 기능 개발을 차단하거나 계획을 다시 여는 근거로 쓰지 않는다. 착수 전에는 사용자 행동, 저장
데이터, 승인 경계, 원장, 복구를 포함한 완성 기준선을 먼저 고정한다.

## 8. 프로덕션 90 완성 패스

`docs/03-product-plan/T5-PRODUCTION-90-COMPLETION-PLAN-2026-08-02-ko.md`는 현재 확인된 네 미완성인
장기 작업상태, 도구 턴 지연, 설치 생명주기, 실제 사용 폭을 각각 90점대로 닫는 실행 계약이다.
기존 W1~W6을 다시 여는 문서가 아니며, 결과 맞춤 튜닝이나 광범위한 구조 재작성의 근거로 쓰지 않는다.
2026-08-02 오너 승인으로 `APPROVED_FOR_EXECUTION`에 진입했으며, 현재 Wave 0 기준선을 구현한다.

# H01~H10 비교 — OpenClaw · Hermes 코드 사실 대조 (1차)

- 상태: `CODE_FACTS_ONLY` — **라이브 행동 측정 아님.** 판정은 감사·오너 몫.
- 근거: 브리핑 §3-4 `같은 시나리오와 **코드 사실**로 OpenClaw·Hermes를 비교한다`
- 대상 소스
  - OpenClaw `/Users/jyp/Developer/lab_un/openclaw-pure-2026-07-20`
  - Hermes `/Users/jyp/Developer/lab_un/hermes-agent`
- T5 기준선: `9b0b50c` 봉인분

## 0. 라이브 측정을 못 한 이유 (오너 결정 필요)

두 비교군을 실제로 돌리려면 각자의 자격이 필요하다.

- Hermes: `.venv` 는 있고 Python 3.11.15 로 동작하지만 `~/.hermes` 설정이 없다 → 모델 자격 미구성
- OpenClaw: `package.json` 존재, 자격 설정 미확인

자격 입력은 오너 전용 경계(`API 키·비밀번호 같은 비밀 입력`)다. **T5 의 저장된 자격을 다른 제품에
복사하는 것도 하지 않았다** — 그건 오너 자격을 제3의 애플리케이션에 제공하는 일이다.
그래서 이번 문서는 코드 사실만 담는다. 라이브 행동 비교는 오너가 자격 구성을 허락할 때 진행한다.

## 1. T5 가 실패한 항목별 대조

### H02 · 반복 경험의 자가학습 — T5 **0**

| | 사실 |
|---|---|
| **T5** | 3회 반복 뒤 `/memory` 후보 0 · 반영 0. 학습 기관이 없다. |
| **Hermes** | `agent/background_review.py` — 턴 종료 뒤 **fork 한 AIAgent** 가 대화 스냅샷을 스스로 평가해 memory/skill 을 만든다. `agent/curator.py:maybe_run_curator` 는 **유휴 상태**에서(`min_idle_hours`, `interval_hours`) 주기적으로 스킬을 검토·정리한다. |
| **OpenClaw** | 워크스페이스 루트 `MEMORY.md` 를 기억의 정본 파일로 둔다(`src/memory/root-memory-files.ts`, `src/agents/workspace.ts`). 자동 distill 경로는 이번 확인 범위에서 찾지 못했다 — **미확인으로 남긴다.** |

**대조 결론(재료)**: Hermes 에는 T5 에 없는 **응답 뒤 자기평가 fork + 유휴 큐레이터**가 있다.
T5 의 H02 공백은 "모델이 못 해서"가 아니라 그 기관이 없어서다.

### H05 · 새 대화 승계 — T5 **3/3 실패** (재시작 뒤 같은 대화는 성공)

| | 사실 |
|---|---|
| **T5** | 대화 경계에서 의미가 끊긴다. 승계 수단은 사용자가 직접 누르는 `지난 대화 찾기` 뿐이다. |
| **Hermes** | `agent/system_prompt.py:18` — volatile 층에 **memory snapshot · USER.md 프로필 · 외부 기억**이 들어간다. `:488` `USER.md is always included when enabled`. 즉 **세션이 새로 시작해도 기억 파일이 매번 프롬프트에 실린다.** |
| **OpenClaw** | `MEMORY.md` 가 워크스페이스 파일이므로 어느 세션에서든 같은 파일을 읽는다(`DEFAULT_MEMORY_FILENAME` 을 workspace 조립이 소비). |

**대조 결론(재료)**: 둘 다 승계를 **대화 밖 파일**로 해결한다. T5 는 승계를 대화 안에만 두었고,
그래서 새 대화에서 끊긴다. 이것이 H05 의 구조적 차이다.

### H10 · 에이전트 위임·회수·통합 — T5 **0**

| | 사실 |
|---|---|
| **T5** | 위임을 명시 허락해도 에이전트 언급 0 · 갈래 나눔 0 · 통합 0. 계획만 세우고 다음 턴으로 미룬다. |
| **OpenClaw** | 도구로 존재한다: `agents-list-tool.ts:88` — `List ids allowed for sessions_spawn(runtime:"subagent")`, `agents-wait-tool.ts:198` — `name: "agents_wait"`, `:200` `Wait until one collector child completes, or until timeout.` **띄우고(spawn) 기다려 회수(wait)하는 계약이 실제 도구다.** `src/agents/acp-spawn.ts`, `src/cron/isolated-agent` 도 있다. |
| **Hermes** | `background_review.py` 가 **fork 한 AIAgent** 를 쓰고 `moa_loop.py`(mixture-of-agents)가 있다. 다만 사용자 작업을 여러 갈래로 나누는 범용 위임 도구는 이번 범위에서 확인하지 못했다 — **미확인.** |

**대조 결론(재료)**: OpenClaw 는 위임·회수를 **모델이 부를 수 있는 도구**로 노출한다.
T5 는 그 손이 없다. H10 은 말귀 문제가 아니라 손 문제다.

### H01 · H04 · 기억 입출구 마찰 — T5 **카드 1 · 클릭 1** (3/3)

| | 사실 |
|---|---|
| **T5** | 선언한 선호도 카드로 재확인. 취소는 대화로 닿지 않고 엉뚱한 파일 승인 카드가 뜬다. |
| **Hermes** | `tools/write_approval.py:265` — `gate off (default) → allow (writes flow freely)`, `:274-275` `if not write_approval_enabled(subsystem): return GateDecision(allow=True)`. **기억 쓰기는 기본적으로 카드 없이 흐른다.** 그리고 `:270` `there is no config-driven "blocked" outcome` — 게이트는 막지 않고 보류(staged)만 한다. |
| **OpenClaw** | 기억이 워크스페이스 파일이라 파일 편집 경로를 그대로 탄다. 별도 승격 카드 절차가 이번 범위에서 확인되지 않았다. |

**대조 결론(재료)**: 두 비교군 모두 기억을 **파일 또는 자동 흐름**으로 다룬다.
T5 만 기억에 승인 절차를 얹었고, 그 카드가 지키는 위험은 앞선 측정에서 0 이었다.

### H08 · 파일 손 범위 — T5 루트 1개

| | 사실 |
|---|---|
| **T5** | `src/runtime/file-scope.js:19` → `~/GPAO-T5` 한 폴더. `local-locate.js` 는 파일을 아예 버린다. |
| **OpenClaw** | 도구 범위가 `workspaceDir` 기준이며 터미널·컴퓨터 도구(`terminal-tool`, `computer-tool`)가 별도로 있다. 정확한 허용 경계는 **미확인**(이번 범위에서 파일 읽기 도구 파일을 특정하지 못했다). |
| **Hermes** | 미확인. |

**이 항목은 비교를 완결하지 못했다.** T5 쪽 사실만 확정돼 있다.

## 2. 이번에 확정한 것 / 못 한 것

확정(코드 인용 가능):
- Hermes 기억 쓰기 기본 자동(`write_approval.py:265,274`)
- Hermes 응답 뒤 자기평가 fork(`background_review.py:1-10`) + 유휴 큐레이터(`curator.py:2002-2012`)
- Hermes 새 세션마다 기억·프로필 프롬프트 적재(`system_prompt.py:18,488`)
- OpenClaw 기억 = 워크스페이스 `MEMORY.md`(`root-memory-files.ts`, `workspace.ts`)
- OpenClaw 위임·회수 도구 존재(`agents-list-tool.ts:88`, `agents-wait-tool.ts:198-200`)

못 한 것(추정하지 않는다):
- 두 비교군의 **라이브 H01~H10 행동 측정** (자격 미구성 · 오너 결정 필요)
- OpenClaw 자동 distill 경로 유무
- Hermes 범용 위임 도구 유무
- 두 비교군의 파일 도구 허용 경계
- Claude Code · Codex 대조(다음 순서 2번, 미착수)

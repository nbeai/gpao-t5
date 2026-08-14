# Prime Agent 오픈북 참고서

작성: 2026-08-13  
상태: `REFERENCE_EVIDENCE · NON_AUTHORITY · NON_PLAN`  
대상: GPAO-T5 개발·감사 담당자

## 0. 이 문서의 자리

이 문서는 Prime Agent를 T5의 새 계획, 새 구현축, 새 정본 또는 공식 비교군으로 만들지 않는다.

- T5의 유일한 계획은 `design/T5-PLAN.md`다.
- 제품 판단은 `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md`를 따른다.
- OpenClaw·Hermes·Codex·Claude Code는 제품 철학이 확정한 공식 비교군이다. Prime Agent는 **참고 원천**이다.
- 결과를 본 뒤 Prime Agent를 비교군에 넣어 점수를 바꾸지 않는다.
- Prime에 있는 기능을 이유로 T5 일을 새로 만들지 않는다. 먼저 T5의 재현된 빨강과 기존 계획 노드를 찾는다.
- 현재 터미널 결속·라이브 순서를 멈추거나 바꾸지 않는다.

이 문서의 용도는 하나다.

> T5의 실제 문제를 먼저 고정한 뒤, Prime Agent가 같은 문제를 어떻게 풀었는지 실제 소스에서 빠르게 찾아
> 검증된 원리만 T5의 기존 계약과 시험 안으로 번역한다.

## 1. 조사 기준점

| 항목 | 값 |
|---|---|
| 저장소 | `https://github.com/PrimeIntellect-ai/prime-agent` |
| 조사 커밋 | `7787f07415d843b9a800f6a4720e0c739bd608e5` |
| 조사일 | 2026-08-13 |
| 라이선스 | MIT (`Mario Zechner`, `Prime Intellect`) |
| 계보 | `pi-mono` 하드포크에서 출발해 독립 개발 |
| 임시 조사 경로 | `/private/tmp/prime-agent-t5-review` — 휘발성 경로이며 T5 정본이나 의존성이 아니다 |

아래 GitHub 링크는 모두 위 커밋에 고정한다. 최신 `main`과 다르면 먼저 변경 내용을 확인하고, 이 문서의
과거 소스 사실을 최신 사실인 것처럼 쓰지 않는다.

소스 신뢰 순서:

```text
실제 구현과 테스트 > 같은 커밋의 설계 문서 > README·홍보 문구
```

문서와 코드가 다르면 코드 경로와 실제 동작을 따른다. 코드 존재만으로 사용자 경로의 효과를 단정하지 않는다.

## 2. Prime Agent는 무엇인가

Prime Agent는 T5·OpenClaw·Hermes와 같은 큰 계열인 **로컬 에이전트 운영환경**이다. 모델 자체가 아니라
모델 주변에 실행환경, 세션, 도구, 기억, 자동 반복, 장기 작업을 결속한다.

중심은 서로 다르다.

| 제품 | 중심 |
|---|---|
| OpenClaw | Gateway·채널·플러그인·장치·상시 운영 |
| Hermes | 터미널·여러 실행 backend·스킬·자율 작업·자기개선 |
| Prime Agent | 지속 IPython 제어환경·프로그램식 도구 호출·재귀 에이전트·장기 세션 |
| T5 | 말귀→현실 조립→권위→실행 영수증→복구→다음 손→최종 답의 공통 원장 시스템 |

Prime Agent의 기본 실행 경로:

```text
사용자 표면
→ AgentConnection
→ daemon supervisor
→ 세션 전용 worker
→ AgentSessionRuntime / AgentSession
→ 모델 provider
→ 지속 IPython kernel
→ 파일·터미널·스킬·자식 에이전트
→ append-only JSONL 세션과 기능별 mutable artifact
```

구현 경계는 [architecture.md](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/docs/architecture.md)와
[agent-session.ts](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/src/core/agent-session.ts)에서 시작한다.

## 3. 질문별 소스 진입 지도

Prime 저장소를 처음부터 읽지 않는다. T5에서 고정한 질문에 해당하는 파일부터 연다.

| T5에서 묻는 질문 | 먼저 읽을 Prime 소스 | 확인할 사실 |
|---|---|---|
| 입력·후속·자동 반복이 겹칠 때 누가 먼저 가나 | [`session-action-store.ts`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/src/core/session-action-store.ts) | steering/follow-up lane, delivery·wake policy, 행동 상태 전이, rollback proof |
| 세션 전체 실행을 누가 소유하나 | [`agent-session.ts`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/src/core/agent-session.ts), [`agent-session-runtime.ts`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/src/core/agent-session-runtime.ts) | provider·queue·tool·compaction·goal·child·transcript 소유와 세션 교체 경계 |
| 실패 검사가 모델의 다음 행동으로 돌아오나 | [`autonomous.ts`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/src/core/autonomous.ts) | gate 실패 출력의 continuation, 예산, 동일 worktree 재실행 억제 |
| 명령 결과는 무엇을 보존하나 | [`bash-executor.ts`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/src/core/bash-executor.ts), [`messages.ts`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/src/core/messages.ts) | output·exitCode·cancelled·truncated·fullOutputPath와 모델 문맥 변환 |
| 큰 결과와 여러 도구를 적은 왕복으로 다루나 | [`prompts/rlm.ts`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/src/core/prompts/rlm.ts), [`rlm.md`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/docs/rlm.md) | 지속 Python 변수, 프로그램식 skill/tool 호출, 임시 shell과 지속 kernel 상태의 차이 |
| 대화와 실행 이력은 어떻게 남나 | [`session-manager.ts`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/src/core/session-manager.ts), [`session-format.md`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/docs/session-format.md) | append-only JSONL, id/parentId/leaf, branch·fork·compaction·Git 상태 |
| UI를 닫거나 프로세스가 죽어도 이어지나 | [`daemon.md`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/docs/daemon.md), [`long-running-agents.md`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/docs/long-running-agents.md) | supervisor/worker 소유, lease, detach/reattach, generation cursor, crash recovery |
| 예약이 중복·유실 없이 전달되나 | [`cron-jobs.ts`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/src/core/cron-jobs.ts), [`daemon.md`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/docs/daemon.md) | 전달 전 tick claim·advance, missed tick coalescing, 불확실 delivery 재생 금지 |
| 지속 목표의 완료와 예산은 어떻게 다루나 | [`goals.ts`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/src/core/goals.ts) | active/paused/budget_limited/complete와 명시적 `goal.complete()` |
| 기억·스킬·보조 지침을 어떻게 고치고 되돌리나 | [`refinement.ts`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/src/core/refinement/refinement.ts) | base prompt 불변, local/global scope, 작은 evidence-backed edit, plan/apply 분리, snapshot rollback |
| 프로세스 격리가 보안 sandbox인가 | [`architecture.md`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/docs/architecture.md), [`rlm.md`](https://github.com/PrimeIntellect-ai/prime-agent/blob/7787f07415d843b9a800f6a4720e0c739bd608e5/packages/coding-agent/docs/rlm.md) | worker/kernel은 장애 격리이며 같은 OS 사용자 권한으로 실행됨 |

## 4. 오픈북 사용법

### 4-1. 열기 전

먼저 다음 넷을 적는다.

```text
T5의 수정 전 빨강      실제 사용자 결과·콘솔·영수증·실물 중 무엇인가
기존 계획 자리          T5-PLAN의 어느 노드인가
보존할 계약             권위·안전·원장·기억·모델 판단 중 무엇을 깨면 안 되는가
Prime에 물을 한 질문    한 문장으로 무엇을 찾는가
```

이 넷이 없으면 Prime을 열지 않는다. 외부 기능을 구경한 뒤 T5 일을 만드는 순서를 막기 위해서다.

### 4-2. 소스에서 확인할 것

한 파일 이름이나 타입 이름을 발견한 것으로 끝내지 않는다.

1. 호출하는 쪽과 호출받는 쪽을 함께 찾는다.
2. 성공뿐 아니라 실패·취소·timeout·재시작 경로를 읽는다.
3. 상태의 실제 writer와 persistence 위치를 확인한다.
4. 모델 문맥에 무엇이 들어가고 무엇이 기록에만 남는지 구분한다.
5. 테스트가 지키는 보존 조건과 테스트가 재지 않는 빈칸을 나눈다.
6. 같은 커밋의 문서와 코드가 다르면 차이를 기록한다.

### 4-3. T5로 가져올 때

외부 이름과 형태를 복사하지 않고 다음만 남긴다.

```text
Prime 소스 사실        파일·기호·커밋으로 재현 가능한 사실
해결한 실패            그 구조가 막는 실제 실패
보존 조건              함께 지키는 순서·권한·복구·소유권
T5 번역                기존 T5 계약의 어느 필드·흐름·시험으로 들어가는가
비흡수                  T5에 필요 없거나 정체성·안전·의존성 경계를 깨는 부분
반증                    번역을 되돌리거나 조건을 바꾸면 다시 빨개지는가
```

번역 결과가 기존 노드에 들어가지 않으면 새 문서를 먼저 만들지 않는다. 정말 기존 계약이 담을 수 없는지
확인한 뒤에만 `T5-PLAN.md`의 한 노드로 다룬다.

## 5. 지금 배울 가치가 있는 것

### 5-1. 현재 코어 결속과 터미널

#### 행동 입장과 전달 상태기계

`SessionActionStore`는 입력을 `queued → selected → preparing → committing → running → terminal`로 나누고,
현재 턴 조정과 다음 턴 후속을 별도 lane으로 둔다. `committing`에서 되돌릴 때는 메시지가 transcript에
아직 굳지 않았다는 증명까지 요구한다.

T5에서는 이것을 새 상태기계로 복사하지 않는다. `task-context → turn → model-provider` 통합에서 다음을
감사하는 질문으로 쓴다.

- 같은 입력이 두 번 입장하거나 유실되는 경계가 있는가.
- 후속 모델 호출이 첫 호출과 다른 비밀·권위·맥락을 받는가.
- 모델 호출은 끝났지만 원장·답 전달이 아직인 상태를 성공으로 읽는가.
- rollback 뒤 이미 전달된 메시지나 실행 효과가 다시 살아나는가.

#### 자동 실패 되먹임

Prime은 configured shell gate가 실패하면 bounded stdout/stderr를 다음 continuation으로 보내고, Git worktree가
그대로면 같은 gate를 실제로 다시 실행하지 않는다. 제한 도달은 성공이 아니다.

T5에서는 다음을 대조한다.

- 같은 실패가 새 증거 없이 반복되는가.
- 실패 출력이 모델의 다음 판단에 실제로 도달하는가.
- 횟수·시간·토큰 소진을 완료로 꾸미는가.
- gate 통과가 확인하지 않은 사용자 목적까지 완료로 넓어지는가.

#### 프로그램식 도구 조합

Prime은 지속 IPython에 중간 자료를 변수로 남기고, 파일·shell·skill·subagent 호출을 코드로 조합한다.
큰 결과의 필요한 부분만 다음 판단에 쓰므로 모델 왕복과 문맥 소비를 줄일 수 있다.

T5에서는 현재 터미널 3과업과 결속을 먼저 닫는다. 그 뒤 같은 과업에서 기존 프로그램식 실행 경로가
다음 효과를 내는지만 측정한다.

- 모델 호출 수 감소
- 큰 출력 재독해 감소
- 계산·집계 정확도 유지
- 실패 뒤 대안 선택 가능
- 실행 영수증·원장·최종 답 일치 유지

IPython을 T5의 새 중심으로 넣는 일은 이 참고서의 작업이 아니다.

### 5-2. 이후 장시간·자동화

Prime의 daemon은 UI와 실행 소유자를 분리하고, root session tree마다 worker·lease·recovery journal을 둔다.
예약 tick은 전달 전에 claim·advance하고, 불확실한 전달을 재생하지 않으며 놓친 tick을 무한 적재하지 않는다.

T5의 장시간 작업·예약·재접속 단계에서 다음을 대조할 가치가 있다.

- UI 종료가 작업 종료를 뜻하지 않는가.
- 한 세션의 crash가 다른 세션으로 번지는가.
- 같은 세션 파일을 둘이 쓰는가.
- 재접속 snapshot과 증분 event가 같은 세대인가.
- crash 직전 예약을 중복 전달하는가.

### 5-3. 이후 기억·Selfhood·스킬

Prime의 continual harness에서 배울 구현 규율:

- 기본 system prompt는 불변이고 보조 state만 바꾼다.
- 세션 local과 cross-session global을 분리한다.
- 변경은 작고 evidence-backed여야 한다. local에는 현재 과업 진행·임시 blocker·세션 조정도 들어갈 수 있고,
  global에는 안정적인 cross-session 교훈·선호·재사용 skill/subagent·명시적으로 한정된 프로젝트 사실만 올린다.
- 기억·skill·subagent·prompt note의 생성·수정·삭제와 잘못된 entry의 검증·rollback까지 admission 범위다.
- proposal 생성과 state 적용을 분리한다.
- 전후 snapshot과 rollback 이력을 남긴다.

T5는 여기서 멈추지 않는다. 현재 T-cell 계약의 `관찰→후보→replay→제한 영향→효과 감사→약화·rollback`
을 유지한다. Prime의 자동 refinement가 T5의 admission과 replay를 대신하지 않는다.

## 6. 가져오지 않을 것과 더 약한 자리

| Prime의 구조 | T5 처분 | 이유 |
|---|---|---|
| 일반 Bash에서 stdout·stderr를 한 output으로 병합 | 복사하지 않음 | 현재 T5의 stderr provenance와 실행 진실 목표보다 약함 |
| 모델이 명시적으로 호출하는 `goal.complete()` | 범용 완료 판정으로 쓰지 않음 | 호출 사실이 목적 달성 증거는 아님 |
| kernel·worker 프로세스 격리 | 보안 sandbox로 간주하지 않음 | 같은 OS 사용자 권한으로 실행됨 |
| IPython을 사실상 단일 기본 model tool로 사용 | 현재 T5 core를 교체하지 않음 | JS runtime 의존성 0·일반 사용자 OS 정체성·현재 결속을 흔듦 |
| 재귀 subagent와 직접 agent messaging | 현재 확장하지 않음 | 현재 병목은 에이전트 수가 아니라 손의 정확도·복구·결속임 |
| coding/research TUI와 daemon 표면 | 제품 표면으로 복사하지 않음 | T5 사용자는 backend와 session 운영법을 배워서는 안 됨 |
| Prime 이름·경로·환경변수·release 방식 | 복사하지 않음 | 제품 정체성과 운영 경계가 다름 |

MIT 라이선스는 코드 사용 가능성을 뜻하지만, 라이선스 허용이 T5에 코드 의존성을 추가할 이유는 아니다.
Prime 코드의 전부 또는 substantial portion을 복사·수정·배포하면 원 저작권 고지와 MIT permission notice를
해당 copy에 포함해야 한다. 코드 재사용이 정말 필요해지면 먼저 기존 T5 구현으로 같은 원리를 달성할 수
없는지 확인하고, 고지 의무·의존성·업데이트·보안·배포 비용을 별도 감사한다.

## 7. Prime의 기록과 T5 원장 시스템의 차이

Prime에는 다음 기록과 부분 폐쇄고리가 있다.

- append-only session tree
- action lifecycle와 delivery ticket
- goal state와 budget
- autonomous quality gate
- refinement history와 rollback
- worker·command recovery journal

그러나 조사한 일반 실행 경로에서는 사용자 목적, 권위, 실행 영수증, 남은 목적, 다음 손, 최종 답을 매 턴
하나의 공통 원장으로 결속하는 구조를 확인하지 못했다. configured gate 실패는 답 이후 continuation을 만들지만,
gate가 확인하지 않은 의미까지 판정하지 않는다. `output-guard.ts`도 의미적 답 검사가 아니라 프로세스 stdout
보호 장치다.

따라서 Prime의 append-only session은 Git과 닮은 대화·실행 계보에 가깝고, T5의 원장 시스템을 대체하지
않는다. 반대로 T5도 설계 목표가 더 넓다는 이유만으로 우위를 주장하지 않는다. 실제 콘솔에서 실행 사실이
다음 행동과 최종 답을 바로잡는지 증명해야 한다.

## 8. 현재 개발 흐름에서 쓰는 자리

이 표는 새 순서나 진행상태표가 아니다. 2026-08-13에 오너가 제시한 7단계에서 Prime 소스가 어디를
보조할 수 있는지만 가리킨다. 각 단계의 현재 PASS·BLOCK은 Git과 독립 감사 결과를 다시 확인한다.

| 현재 단계 | Prime 오픈북 사용 |
|---|---|
| terminal authority 감사 | 통과한 계약을 Prime만을 이유로 다시 열지 않음. 이후 후속 커밋은 별도 독립 감사 결과를 따름 |
| outcome/parser stderr provenance | Prime 일반 Bash는 stderr를 합치므로 구현 답으로 쓰지 않음 |
| outcome→parser→authority→web 순차 통합 | `SessionActionStore`로 입장·commit·후속 전달의 의미 충돌 질문을 보강 |
| 고정 터미널 3과업 실제 콘솔 | Prime 경로를 넣지 않고 T5 자체 기준선을 먼저 확정 |
| 조건·근거·관찰 세대 holdout | 동일 worktree 실패 억제, worker 지속성, 세대 snapshot을 반례 원천으로 사용 |
| 같은 과업·모델·환경 비교 | Prime은 참고군으로만 둠. 채점 전에 확정되지 않은 공식 비교군으로 승격하지 않음 |
| 전체 회귀 뒤 남은 영역 | 장시간·자동화에는 daemon, 기억·스킬에는 refinement를 해당 기존 노드에서만 다시 엶 |

## 9. 사용 결과 기록 최소 형식

Prime을 실제 수리에 사용했다면 커밋 설명이나 기존 증거 기록에 다음 사실만 남긴다. 이 형식을 위한 별도
계획·대장·백로그를 만들지 않는다.

```text
T5 빨강:
T5-PLAN 노드:
Prime 커밋·파일·기호:
확인한 소스 사실:
Prime이 보존한 조건:
T5에 번역한 원리:
의도적으로 가져오지 않은 것:
수정 전 실패·반대시험·라이브 결과:
```

“Prime에도 있다”는 근거가 아니다. 마지막 줄의 T5 실물 결과가 달라지지 않으면 흡수하지 않은 것이다.

## 10. 갱신 규칙

- 시간만 흘렀다는 이유로 Prime 전체를 재조사하지 않는다.
- T5에 재현된 새 문제가 있고 이 문서의 고정 커밋으로 답할 수 없을 때만 최신 소스를 연다.
- 최신 소스를 열면 새 SHA, 변경된 파일, 이전 판단이 달라진 부분만 같은 증거 폴더에 기록한다.
- 과거 소스 사실을 지우지 않는다. 어느 버전에서 무엇을 배웠는지 남긴다.
- Prime의 새 기능 발표를 T5 백로그로 자동 변환하지 않는다.

이 참고서의 성공 조건은 문서가 길어지는 것이 아니다. 개발자가 막힌 T5 문제에서 정확한 Prime 소스로
곧장 들어가고, 불필요한 구조는 가져오지 않은 채 기존 T5 사용자 결과를 더 낫게 만드는 것이다.

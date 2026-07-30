# GPAO-T5 프로젝트 권위 지도

- 상태: `CURRENT`
- 공식 개발 폴더: `/Users/jyp/Developer/t5-p-op`
- 현재 상태의 단일 인수인계: `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md`
- 목적: 과거 문서·다른 worktree·로컬 도구 상태를 현재 정본으로 오인하지 않게 한다.

## 1. 첫 진입 순서

새 세션은 아래만 먼저 읽는다. 관련 작업 문서는 필요할 때 추가로 읽는다.

1. `AGENTS.md`
2. `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md`
3. `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md`
4. `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md`
5. `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md`
6. 현재 작업과 직접 관련된 계획·계약·증거

읽기 전에 실제 Git 브랜치·HEAD·미커밋 변경을 확인한다. 문서와 Git이 다르면 구현을 시작하지 말고
현재 인수인계를 먼저 바로잡는다.

## 2. 권위 등급

| 등급 | 의미 | 문서 |
|---|---|---|
| A | 오너 철학·제품 목적 | 비전·성능 철학, 절대 원칙, Model-OS 운영 순환 |
| B | 현재 프로젝트 사실 | 현재 세션 인수인계, 실제 Git, 실행 보드, 봉인 증거 |
| C | 현재 작업 계약 | 오너가 승인한 최신 작업 계획·구현 계약 |
| D | 참고 자산 | OpenClaw·Hermes 실제 소스, Claude Code·Codex 작동 원리, 과거 설계·감사 |
| E | 역사 기록 | `docs/archive/**`, 과거 인수인계, 퇴역 계획 |

상위 등급과 충돌하는 하위 문서는 고치거나 퇴역시킨다. 역사 기록은 현재 구현 근거로 사용할 수 없다.

## 3. 현재 T-cell 상태

- T5 코어는 유지한다.
- 과거 TG/CX 구현은 전면 롤백됐으며 현재 제품 사실이 아니다.
- 옛 T-cell 명세는 `docs/archive/retired-plans/`로 퇴역했다.
- 새 T-cell 계획은 아직 작성 전이다.
- 새 계획은 오너 철학, 현재 코어, 실제 OpenClaw·Hermes 소스, Claude Code·Codex의 검증된 작동
  방식을 대조해 작성하고 오너 확인 뒤에만 구현한다.
- 새 계획 작성 전에 현재 코어에서 잃은 안전 보장을 복구하고,
  `docs/03-verification/T5-TCELL-CURRENT-CORE-HUMAN-BASELINE-2026-07-30-ko.md`의 인간 시나리오
  10개를 실제로 실행해 현재 사용 비용과 성능을 고정한다.
- 비교 자산과 퇴역 계획은 기준선의 원인 분석 자료이지 현재 구현 명령이 아니다.

## 4. 비교 소스

- OpenClaw: `/Users/jyp/Developer/lab_un/openclaw-pure-2026-07-20`
- Hermes: `/Users/jyp/Developer/lab_un/hermes-agent`

관련 기능을 설계하기 전에 실제 소스·검사·기본값을 확인한다. T5는 말귀, 사용자 성과, 터미널·파일·웹·앱
활용, 다중 에이전트 운용, 최소 안전 제약과 최대 자동화에서 더 나은 실제 경험을 목표로 한다.

## 5. 작업 폴더 규칙

- 정본 작업은 `/Users/jyp/Developer/t5-p-op`에서만 한다.
- 별도 worktree는 현재 인수인계에 소유자·목적·브랜치·편집 파일·종료 조건이 등록된 경우에만 연다.
- `.beai-harness/`, `workspace-notes/`, 빌드·검사 임시물은 정본이 아니며 Git에 넣지 않는다.
- 과거 문서를 현재화하려고 덮어쓰지 않는다. 새 정본을 만들고 옛 문서는 archive로 옮긴다.

## 6. 감사 전달 규칙

감사자는 관련 범위를 끝까지 확인하고 문제를 한 번에 제출한다. 구현자의 사고를 특정 패치로 축소하지
않도록 확인된 문제·재현·영향·공통 구조·분류·보존 조건·종료 조건만 전달한다. 구현 해법은 구현자가
전체 구조를 보고 제안하고, 감사자는 그 결과를 독립 검증한다.

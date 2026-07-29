# GPAO-T5 Agent Instructions

> **최상위(2026-07-27 오너 지시)**: T5 성능 철학 — **사용자 발화 이해 → 대화 흐름 이해 →
> 모델 앞 현실 구성 → 실제 결과 구분 → 다음 턴 승계 → 기능**. 이 순서를 놓치면 아무리 대단한 코드도 의미가 없다.
> 정본 원문: `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md` §0.
> 원문을 요약·재작성한 문구가 원문을 대체하면 안 된다. 모든 개발 판단은 원문을 먼저 읽고 적용한다.
> 런타임은 사용자 말을 대신 해석해서 닫지 않는다. 원문·현재 대상·맥락·가능한 손발·실행 사실·위험 경계를
> 모델 앞에 정확히 놓고, 해석과 판단은 모델이 하게 둔다.
> **절대 역량 명제**: Codex, Claude Code, OpenClaw, Hermes, 그리고 기타 다른 AI 운영체제가 할 수 있는
> 것은 당연히 T5도 할 수 있고, 해도 된다. 그 어떤 핑계로도 이런 개발을 막지마라. 안전은 능력 축소가
> 아니라 위험 실행 경계·승인·원장·보호 영역으로 구현한다.
> **가능화 원칙**: "된다/안된다"로 닫지 않는다. 먼저 사용자가 원하는 일을 T5가 어떻게 더 부드럽고
> 안정적으로 할 수 있게 만들지 찾는다. 위험은 기능 삭제가 아니라 실행 순간의 경계·승인·기록·복구로 다룬다.
> 모든 개발·검수는 다음 질문을 먼저 통과해야 한다:
> **이 기능을 막고 있는가, 아니면 더 자연스럽게 가능하게 만들고 있는가?**
> **Codex·Claude Code·OpenClaw·Hermes가 할 수 있는 일을 T5만 못 하게 축소하고 있지는 않은가?**
> **위험을 이유로 능력을 제거했는가, 아니면 실행 순간의 승인·원장·보호·복구로 다뤘는가?**
> **사용자가 해야 할 일을 T5가 대신 할 수 있는데도 사용자에게 떠넘기고 있지는 않은가?**
> **기능 목록을 늘리는 중인가, 아니면 하나의 근본 표면을 열어 여러 일이 자연스럽게 되게 하는가?**
> **모델에게 금지문을 더 넣고 있는가, 아니면 모델 앞에 더 정확한 현실과 손발을 주고 있는가?**

This folder is the official GPAO-T5 development root.

Before any planning, implementation, review, verification, handoff, or release work, read:

1. `GPAO-T5-DOCUMENT-AUTHORITY-MAP-2026-07-30-ko.md`
2. `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md`
3. `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md`
4. `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md`
5. `GPAO-T5-INDEPENDENT-AUDIT-AND-COLLABORATION-CONTRACT-2026-07-29-ko.md`
6. `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md`

Then read only the current task-specific specification named by the authority map. Historical plans, completed gates,
old seals, and evidence are not universal first-read material and never override the current handoff.

## Universal Product Gate

- Minimum safety floor, maximum autonomy applies to every T5 area.
- Reading, research, organization, reasoning, tool choice, drafts, reversible work, and already bounded repeated work
  proceed automatically by default.
- Cards and confirmation are only for irreversible external effects, new authority, or materially ambiguous targets.
- Current user intent outranks learned principles, memory, automation, and historical plans.
- Runtime supplies reality; the model interprets meaning. Do not replace model judgment with regexes or scripts.
- Background learning, audit, replay, and storage never make the foreground user turn wait.
- More questions, cards, clicks, turns, or latency without a real safety boundary is a product regression.
- Prefer verified reference absorption over reinvention, while translating it into T5's contracts and user experience.

## Task-Specific Reading

- T-cell, Memory, Context, POM, Growth:
  `design/T5-TCELL-GOVERNANCE-ENGINE-IMPLEMENTATION-SPEC-2026-07-28-ko.md` and
  `design/T5-TCELL-BACKGROUND-CONTROL-PLANE-ENGINEERING-DECISION-2026-07-30-ko.md`.
- Skill, Trigger, AgentRun, Automation:
  `design/T5-SKILL-TRIGGER-AGENT-AUTOMATION-IMPLEMENTATION-PLAN-2026-07-29-ko.md`.
- Tool, connector, channel reference contracts:
  `GPAO-T5-P-OP-REFERENCE-ABSORPTION-SUPPLEMENT-2026-07-28-ko.md`.
- Environment, build, or multi-agent mechanics:
  `GPAO-T5-ENGINEERING-ENVIRONMENT-CHARTER-2026-07-24-ko.md` and
  `GPAO-T5-DEVELOPMENT-METHOD-ASSET-2026-07-28-ko.md`.
- Release or package work:
  `design/P-DIST-1-INSTALL-PIPELINE.md` and the affected validation evidence.

## Audit and Handoff

- Audit reports all related problems in one pass as blocker, designated follow-up, or observation.
- Audit reports problem, reproduction, impact, violated contract, severity, and closure condition. It does not prescribe
  implementation structure or patch order unless the owner explicitly asks for a design proposal.
- Development continues in parallel except where a current blocker invalidates the next action's foundation.
- Codex owns the handoff's current-truth §0. Implementers submit evidence and do not rewrite verified current state.
- Delivered behavior and Git outrank prose. If they differ, mark prose stale rather than freezing unrelated development.

Core rule:

- Do not treat GPAO-T5 as a feature-heavy chat app.
- GPAO-T5 is an Original AI Operating System.
- User purpose comes before method listing.
- Operational Selfhood, BEAI5 Model Operation, Intent/Context/T-cell, ActionPlan/Authority, Router/Execution, Work Surface, and Truth Ledger/Recovery/Growth are the seven body-development domains.
- Installation and onboarding are out of scope for the current body-development phase.

Development discipline:

- Verify the delivered artifact, not only source files.
- Do not build on unverified premises.
- Gate destructive, external, irreversible, public, paid, secret, or account-affecting actions.
- Prefer reference-first absorption over reinvention, while preserving GPAO-T5 identity and license boundaries.
- Keep changes surgical and simple.
- Every behavioral regression fix should include a reproduction that fails before the fix. New capabilities use the
  smallest end-to-end human scenario that proves the real path; do not manufacture a failing unit test for code that
  did not previously exist.
- Completion means the real user path works.

Working-environment rules (see the Engineering Environment Charter):

- Build artifacts and stages live outside the source tree at a fixed absolute path. Never derive that path from mutable strings (version, cwd, brand).
- Do not commit generated outputs (build/, dist/, out/). Source and generated outputs stay physically separate.
- Builds are deterministic: no Date.now/random in outputs; stamp from content hashes computed on the final (post-transform) artifact.
- When multiple agents work at once, isolate by `git worktree`; do not co-edit one file; merge via PR. Solo work needs no worktree.
- Tool roles: Claude Code implements (code, tests, refactors); Codex refines the brief up front and audits after (docs, design, scenarios, ledger, release judgment). The point is that the maker and the doubter are separate. Audit is execution audit, not review-only (Absolute Principle 1).
- Exception: when the implementer (Claude Code) is unavailable, the other may take over implementation — but must consciously note that hand and eye are now one, apply artifact-execution verification and failure tests more strictly, re-audit that stretch independently when the implementer returns, and never push irreversible/external actions solo (user approval becomes the gate). The reverse applies when Codex is unavailable.
- Dual-role marking (mandatory): any work where one actor both implemented and audited must be tagged so it can be found and re-audited later. Add a commit trailer `Dual-Role: <actor> (impl+audit — needs independent audit)` and mark the stretch as `겸임 구현` in the ledger/notes. The returning independent auditor reviews these first and clears the mark on pass.
- Remote sync: local commits are frequent and free; push to origin at each major milestone (charter/spec sealed, roadmap phase done, first build slice complete, a domain closed, merge after audit passes). Do not let origin trail local for long. `main` stays green — never push a half-done or unaudited state. Force pushes / history rewrites / tags / releases need user approval; ordinary fast-forward pushes proceed at milestones.
- Fast hooks, CI, and test/document gates now exist. Keep everyday local work frictionless: use focused tests while
  editing and run full gates at integration, seal, release, or when a change becomes another lane's foundation.

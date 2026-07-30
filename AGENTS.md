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

Canonical entry map: `docs/PROJECT-AUTHORITY-MAP-ko.md`.
Official working folder: `/Users/jyp/Developer/t5-p-op`.
Do not treat another T5 worktree, an archived handoff, or local harness notes as current project truth.
Run `npm run audit:workspace` before starting a new implementation line and after changing authority, handoff,
archive, or worktree state.

Before any planning, implementation, review, verification, handoff, or release work, read these top authority documents:

1. `README.md`
2. `GPAO-T5-FINAL-DEVELOPMENT-PLAN-2026-07-24-ko.md`
3. `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md`
4. `GPAO-T5-ENGINEERING-ENVIRONMENT-CHARTER-2026-07-24-ko.md`
5. `GPAO-T5-DEVELOPMENT-METHOD-ASSET-2026-07-28-ko.md`
   - Preserves the reusable method that turns owner philosophy into human scenarios, shared contracts,
     implementation, live evidence, independent audit, and durable project knowledge.
   - Use it as the operating cycle for new work. It does not replace the authority documents above.

Mandatory reference absorption supplement:

6. `GPAO-T5-P-OP-REFERENCE-ABSORPTION-SUPPLEMENT-2026-07-28-ko.md`
   - Defines what T5 should absorb from OpenClaw and Hermes for current and future P-OP work.
   - Do not copy their dashboards, channel breadth, CLI/TUI posture, infrastructure, paths, branding, or service-specific connector code.
   - Absorb only the T5-translated operating contracts: `OperatorRealitySnapshot`, `ConversationLane`, `SurfaceCapabilityDescriptor`, delivery recovery discipline, automation wake discipline, repair narrative, and scope isolation.

T-cell hold:

7. The previous T-cell specification is retired under `docs/archive/retired-plans/`.
   - TG/CX product work was rolled back and is not current product truth.
   - Preserve the current T5 core.
   - Do not implement Memory/Context/POM/self-growth changes under the retired plan.
   - T-cell resumes only after a new plan is written from owner philosophy, current core, actual OpenClaw/Hermes
     source, and Claude Code/Codex operating assets, then explicitly confirmed by the owner.
   - Before writing that plan, read and execute
     `docs/03-verification/T5-TCELL-CURRENT-CORE-HUMAN-BASELINE-2026-07-30-ko.md`.
     The ten human scenarios, not an internal contract matrix, are the measurement ruler for current-core comparison
     and the new plan's success criteria.
   - Also read `docs/03-verification/T5-TCELL-PRESTART-BRIEFING-2026-07-30-ko.md` for the verified pre-start facts,
     restored current-core safety boundary, gate-calibration rule, exact next sequence, and prohibited shortcuts.

Owner-operation boundary:
   - The development and audit teams operate the terminal, browser, local UI, tests, fixtures, screenshots, and
     routine verification themselves.
   - Ask the owner to act only when the action cannot be delegated: account login, consent, secret entry, irreversible
     external authority, spending, or a genuinely subjective final product choice.
   - Never make the owner run commands, click routine test UI, reproduce engineering defects, or arbitrate technical
     scope between agents merely because the team has not completed its own investigation.

Mandatory final pre-human validation gate:

8. `docs/03-verification/T5-FINAL-DUAL-MODEL-HUMAN-SCENARIO-VALIDATION-PLAN-2026-07-28-ko.md`
   - Run only after P-OP A-H is sealed and before human user testing or installation-package production.
   - Codex must use GPT-5.6sol. Claude must use Opus 5 or Fable 5. Record the exact provider-exposed model
     identity; do not silently substitute a lower or auto-selected model.
   - The two lanes run blind first, then cross-audit and reproduce each other's findings.
   - No final dual-model `PASS` means no installation-package production. Any product change after `PASS`
     requires impact analysis and the affected dual-model scenarios to run again.

Mandatory independent audit and collaboration contract:

9. `GPAO-T5-INDEPENDENT-AUDIT-AND-COLLABORATION-CONTRACT-2026-07-29-ko.md`
   - Every implementation, audit, resumed, handoff, and release session must read and obey it.
   - Audit must inspect the whole relevant range and submit the complete problem set together: reproduction,
     impact, shared structural scope, classification, preserved behavior, and stop condition.
   - Do not prescribe implementation patches in the audit handoff. The implementer reasons over the whole
     structure; the auditor independently verifies the resulting design and behavior.
   - Do not drip-feed findings, reopen a passed scenario for peripheral issues, lower product quality for a
     deadline, or make the owner arbitrate technical scope between agents.
   - Claude implements and produces live evidence; Codex audits the whole plan and recommends the most
     effective path. Do not co-edit the same files or turn independent audit into serial rework.
   - Its parallel-development contract is also mandatory: stabilize one shared contract first, isolate sidecar
     work by worktree and disjoint file ownership, and let one integration owner admit audited contract units.
     Parallel agents never merge directly into the canonical line or make the owner arbitrate technical choices.

Mandatory current-session handoff:

10. `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md`
   - Every new, resumed, or takeover session reads this after the audit contract and current execution board.
   - It records the latest verified baseline, current file ownership, blockers, designated follow-ups, next work,
     and stop condition. Verify it against Git before acting because active implementation may have advanced.
   - Update this fixed-path document at each major P-OP handoff instead of creating disconnected handoff notes.

Mandatory skill, scheduling, agent, and automation implementation plan:

11. `design/T5-SKILL-TRIGGER-AGENT-AUTOMATION-IMPLEMENTATION-PLAN-2026-07-29-ko.md`
   - Read before changing skills, recurring or scheduled work, background execution, agent creation/delegation,
     automation UI, scheduler persistence, or T-cell automation learning.
   - Defines one shared structure: Skill is how, Trigger is when, AgentRun is the bounded executor, and
     AutomationJob binds them under the existing P-OP authority, ledger, recovery, and delivery contracts.
   - Core user-created skills, durable scheduling, and bounded agents are pre-human-beta and pre-package work.
     External skill/plugin ecosystems, agent swarms, and recursive multi-agent orchestration are not.

## T5 Core Three-Axis Rule (2026-07-28 owner direction)

The following three documents are the mandatory product-core reading sequence for every new session, handoff, resumed context, planning, implementation, audit, and completion claim:

1. `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md`
   - Axis 1: user purpose, performance philosophy, and the full meaning of 말귀.
2. `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md`
   - Axis 2: model/runtime responsibility split, reality assembly, execution truth, and next-turn continuity.
3. `GPAO-T5-CORE-OPERATOR-HARNESS-WORK-ORDER-2026-07-28-ko.md`
   - Axis 3: current core execution order, process audit, real-user scenarios, and completion evidence.

Then read the current execution board and alignment audit when present. The axes cooperate and constrain one another:

- Axis 1 prevents developer-centric, feature-count, or user-purpose drift.
- Axis 2 prevents model control, invented reality, and missing ledger/continuity.
- Axis 3 prevents overbuilding, endless work, single-case patching, and completion claims without real-model/user/surface evidence.

No axis alone can justify a feature or completion claim. Do not advance the next core step while the current one still has a user-visible gap, unrun counter-verification, or live verification missing. Keep each step to one shared operating contract; defer scope that does not improve a current human scenario.

For current (v3.x) development, also read — these define what "done" means now:

4a. `GPAO-T5-DEVELOPMENT-PLAN-v3.0-2026-07-26-ko.md` (owner, canonical identity §0 and Phases 1-9)
4b. `GPAO-T5-DEVELOPMENT-PLAN-v3.1-SUPPLEMENT-2026-07-26-ko.md` (completion definition, target list,
    performance floor, Phase 0 debt). **A slice is not done while any "다만 ~는 아직" remains.**

For Phase 0 reference inventory, also read:

5. `GPAO-T5-REFERENCE-INVENTORY-PROTOCOL-2026-07-24-ko.md`

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
- Every fix should include a failing reproduction or scenario gate.
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
- Enforcement gates (hooks/CI/test gates) are intentionally deferred to Phase 5, when real code and a build pipeline exist. Everyday local work stays frictionless.

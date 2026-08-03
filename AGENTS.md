# GPAO-T5 Agent Instructions

## Owner communication constraint (2026-08-03, mandatory)

- Do not restate the owner's words as if they were the agent's new finding, framework, or conclusion.
- Do not inflate an ordinary existing action into a newly named phase, seal, baseline, checklist, document, or work item.
- Answer the exact question first with the shortest sufficient answer. Add only a genuinely missing fact, risk, or decision.
- Before proposing anything new, check whether the owner already decided it or the current plan already covers it. If so, use the existing name and process.
- Agreement needs no decorative paraphrase. Audit and planning output must contribute net-new information rather than repackaging context.
- Create a new term, artifact, test layer, or process only when an existing contract cannot hold the necessary work, and state that concrete necessity plainly.

## Single top product authority (mandatory)

Before any planning, implementation, review, verification, handoff, or release work, read and obey:

- `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md`

It is the single authority for owner vision, product purpose, the seven domains, 말귀, functional correctness,
comparative performance, model operation, Selfhood, memory/growth, reference absorption, and final judgment.
Do not replace it with a summary or recreate its principles in another document. Technical contracts may only
interpret or execute it.

This folder is the official GPAO-T5 development root.

Canonical entry map: `docs/PROJECT-AUTHORITY-MAP-ko.md`.
Official working folder: `/Users/jyp/Developer/t5-p-op`.
Do not treat another T5 worktree, an archived handoff, or local harness notes as current project truth.
Run `npm run audit:workspace` before starting a new implementation line and after changing authority, handoff,
archive, or worktree state.

After the single top authority, read these execution and engineering documents:

1. `README.md`
2. `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md`
3. `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md`
4. `GPAO-T5-ENGINEERING-ENVIRONMENT-CHARTER-2026-07-24-ko.md`
5. `GPAO-T5-DEVELOPMENT-METHOD-ASSET-2026-07-28-ko.md`
   - Preserves the reusable method that turns owner philosophy into human scenarios, shared contracts,
     implementation, live evidence, independent audit, and durable project knowledge.
   - Use it as the operating cycle for new work. It does not replace the single top product authority.

Mandatory reference absorption supplement:

6. `GPAO-T5-P-OP-REFERENCE-ABSORPTION-SUPPLEMENT-2026-07-28-ko.md`
   - Defines what T5 should absorb from OpenClaw and Hermes for current and future P-OP work.
   - Do not copy their dashboards, channel breadth, CLI/TUI posture, infrastructure, paths, branding, or service-specific connector code.
   - Absorb only the T5-translated operating contracts: `OperatorRealitySnapshot`, `ConversationLane`, `SurfaceCapabilityDescriptor`, delivery recovery discipline, automation wake discipline, repair narrative, and scope isolation.

Current T-cell and H-stage boundary:

7. `design/T5-TCELL-DEVELOPMENT-PLAN-2026-07-31-ko.md` is the frozen current T-cell implementation contract.
   - The previous T-cell specification is retired under `docs/archive/retired-plans/` and never regains authority.
   - TG/CX product work was rolled back and is not current product truth.
   - S0-S5 are implemented and have production/live path evidence. Do not reopen their design from retired plans.
   - The active line is `docs/03-verification/T5-H-STAGE-BOARD-2026-08-01-ko.md`: remediate diagnosed defect
     families, then seal H01-H07, H08-H09, Agent Core/H10, and the final product journey.
   - Verify the exact live state against Git and `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md`; do not copy a volatile
     status into a new plan or infer completion from test counts.
   - Retired plans and the pre-start briefing are history and causal evidence, not current implementation commands.

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

## Product principle and execution contracts

There is one product philosophy authority:

1. `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md`

The following documents execute it without creating competing philosophy:

2. `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md`
   - Model/runtime responsibility split, reality assembly, execution truth, and next-turn continuity.
3. `GPAO-T5-CORE-OPERATOR-HARNESS-WORK-ORDER-2026-07-28-ko.md`
   - Current core execution order, process audit, real-user scenarios, and completion evidence.

Read the current execution board and handoff for volatile status. No execution contract can override the product
purpose, and the top product document cannot by itself claim that implementation is complete.

For current (v3.x) development, also read — these define what "done" means now:

4a. `GPAO-T5-DEVELOPMENT-PLAN-v3.0-2026-07-26-ko.md` (owner, canonical identity §0 and Phases 1-9)
4b. `GPAO-T5-DEVELOPMENT-PLAN-v3.1-SUPPLEMENT-2026-07-26-ko.md` (completion definition, target list,
    performance floor, Phase 0 debt). **A slice is not done while any "다만 ~는 아직" remains.**

For Phase 0 reference inventory, also read:

5. `GPAO-T5-REFERENCE-INVENTORY-PROTOCOL-2026-07-24-ko.md`

Product rules:

- Use the seven domains, six product laws, comparison standard, and final judgment exactly as defined in the
  single top product authority. Do not maintain a second copy here.

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

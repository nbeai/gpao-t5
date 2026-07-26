# GPAO-T5 Agent Instructions

This folder is the official GPAO-T5 development root.

Before any planning, implementation, review, verification, handoff, or release work, read these top authority documents:

1. `README.md`
2. `GPAO-T5-FINAL-DEVELOPMENT-PLAN-2026-07-24-ko.md`
3. `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md`
4. `GPAO-T5-ENGINEERING-ENVIRONMENT-CHARTER-2026-07-24-ko.md`

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

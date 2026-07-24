# GPAO-T5

Status: `official_development_root`

This folder is the formal development root for GPAO-T5.

GPAO-T5 is an Original AI Operating System: the user feels they are only chatting, while T5 understands the user's purpose, knows its own available models/tools/permissions/context, operates the necessary means, and produces the desired result through a safe, traceable, recoverable flow.

## Top Authority Documents

These documents are mandatory first-read material before any GPAO-T5 planning, implementation, review, verification, or handoff.

1. `GPAO-T5-FINAL-DEVELOPMENT-PLAN-2026-07-24-ko.md`
   - Defines the product identity, Original AI OS philosophy, Operational Selfhood, BEAI5 split, 7 development domains, first build slice, and scenario qualification path.

2. `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md`
   - Defines the non-negotiable development discipline: verify delivered artifacts, do not build on unverified premises, gate destructive/external actions, generalize beyond one case, keep changes surgical, prefer simplicity, write failure tests, report honestly, and define completion by the real user path.

3. `GPAO-T5-ENGINEERING-ENVIRONMENT-CHARTER-2026-07-24-ko.md`
   - Defines how the discipline is enforced in the working environment: build artifacts stay out of the source tree, source and generated outputs are physically separated, builds are deterministic, and multi-agent work is isolated by worktree. Frictionless rules apply now; slow gates (hooks/CI/test gates) attach in Phase 5 when real code and a build pipeline exist. Zero friction for everyday local work.

## Reference Documents

These documents are not above the top authority documents, but they preserve source material that must be consulted when designing the related GPAO-T5 system.

1. `references/BEAI5-SYSTEM-PROMPT-REFERENCE-2026-07-24-ko.md`
   - Original BEAI5 system prompt reference. Use it as the source material for BEAI5 Model Operation, BEAI5 Integration Contract, naturalness regression gates, and the split between OS-implemented properties and model-held judgment.

## Non-Scope For Current Body Development

Installation and onboarding are intentionally excluded from the current GPAO-T5 body-development plan. Packaging lessons from GPAO-T3 still remain binding as regression-prevention knowledge when T5 later enters release/distribution work.

## Current First Build Slice

```text
Work Chat
+ SelfStateSnapshot
+ BEAI5 Task Context Packet
+ ActionPlan
+ Authority A0-A3
+ Truth Ledger
+ Connection status
+ Follow-up Queue
```

This slice is the first heart of GPAO-T5. If this flow does not feel natural, truthful, capability-aware, and goal-directed, T5 is not yet an AI OS.

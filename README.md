# GPAO-T5

Status: `official_development_root`

GPAO-T5 is an Original AI Operating System for ordinary human users. The user speaks naturally; T5 understands the
current purpose and conversation, assembles the available models, tools, permissions, context, and external reality,
does everything it safely can, and returns truthful results that continue into the next turn.

## Start Here

Do not read every historical plan before acting. Use the current authority map:

1. `GPAO-T5-DOCUMENT-AUTHORITY-MAP-2026-07-30-ko.md`
2. `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md`
3. `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md`
4. `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md`
5. `GPAO-T5-INDEPENDENT-AUDIT-AND-COLLABORATION-CONTRACT-2026-07-29-ko.md`
6. `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md`

Then read only the task-specific specification named by the authority map.

## Product Invariant

```text
Understand the user's words
→ preserve the conversation flow
→ assemble accurate reality for the model
→ let the model judge
→ execute automatically inside the minimum safety floor
→ ask only at real irreversible or authority boundaries
→ report actual results
→ carry them into the next turn
```

Safety is not a default refusal mode. Reading, research, organization, reasoning, tool choice, drafts, reversible work,
background learning, and already bounded repeated work proceed automatically. Cards and confirmation are reserved for
irreversible external effects, new durable authority, and materially ambiguous high-impact targets.

If a change adds questions, cards, clicks, turns, or foreground latency without protecting one of those boundaries,
it is a product regression even when its tests pass.

## Current Development

The verified P-OP human-scenario gate is complete. Current product work is:

- T-cell background growth control plane and published foreground snapshots
- user-owned learned-principle surface with edit, pause, pin, archive, restore, and rollback
- Skill, Trigger, AgentRun, and Automation core development in isolated sidecar work
- human-scenario verification of reduced questions, clicks, turns, and latency

The exact branch, commit, dirty files, blockers, and next integration point live only in
`GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md` §0.

## Task Specifications

- T-cell, Memory, Context, POM, Growth:
  `design/T5-TCELL-GOVERNANCE-ENGINE-IMPLEMENTATION-SPEC-2026-07-28-ko.md`
  and `design/T5-TCELL-BACKGROUND-CONTROL-PLANE-ENGINEERING-DECISION-2026-07-30-ko.md`
- Skill, Trigger, AgentRun, Automation:
  `design/T5-SKILL-TRIGGER-AGENT-AUTOMATION-IMPLEMENTATION-PLAN-2026-07-29-ko.md`
- Tool, connector, channel reference contracts:
  `GPAO-T5-P-OP-REFERENCE-ABSORPTION-SUPPLEMENT-2026-07-28-ko.md`
- Build and multi-agent environment:
  `GPAO-T5-ENGINEERING-ENVIRONMENT-CHARTER-2026-07-24-ko.md`
- Release and package:
  `design/P-DIST-1-INSTALL-PIPELINE.md`

The original final plan, v3.0/v3.1, P-OP work order, final dual-model validation plan, and evidence remain valuable
historical foundations. They do not override the current authority map or handoff.

## Running T5

Plain ESM JavaScript, Node 20+, zero build step, zero runtime package dependencies.

```bash
npm test
npm start
npm run gate
npm run audit:docs
npm run audit:tcell-plane
```

The shipped runtime is the JavaScript that tests execute. Generated build artifacts stay outside the source tree.

## Source Layout

```text
src/kernel/l0-evidence/   reality, receipts, ledgers, observations
src/kernel/l1-intent/     intent, context, current target
src/kernel/l2-plan/       plans, authority, approvals, continuation
src/kernel/l5-growth/     learning, replay, T-cell lifecycle
src/runtime/              model and tool adapters
src/surface/              server, storage, Work Chat UI
test/                     contract, integration, and human-scenario regression
```

Completion means the real user path is smoother and more capable, not that more contracts or tests exist.

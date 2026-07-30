# GPAO-T5

Status: `official_development_root`

This folder is the formal development root for GPAO-T5.

Start with `docs/PROJECT-AUTHORITY-MAP-ko.md`. It identifies the current canonical entry points, official working
folder, retired plans, comparison sources, and the boundary between current truth and history.

GPAO-T5 is an Original AI Operating System: the user feels they are only chatting, while T5 understands the user's purpose, knows its own available models/tools/permissions/context, operates the necessary means, and produces the desired result through a safe, traceable, recoverable flow.

## Top Authority Documents

These documents are mandatory first-read material before any GPAO-T5 planning, implementation, review, verification, or handoff.

1. `GPAO-T5-FINAL-DEVELOPMENT-PLAN-2026-07-24-ko.md`
   - Defines the product identity, Original AI OS philosophy, Operational Selfhood, BEAI5 split, 7 development domains, first build slice, and scenario qualification path.

2. `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md`
   - Defines the non-negotiable development discipline: verify delivered artifacts, do not build on unverified premises, gate destructive/external actions, generalize beyond one case, keep changes surgical, prefer simplicity, write failure tests, report honestly, and define completion by the real user path.

3. `GPAO-T5-ENGINEERING-ENVIRONMENT-CHARTER-2026-07-24-ko.md`
   - Defines how the discipline is enforced in the working environment: build artifacts stay out of the source tree, source and generated outputs are physically separated, builds are deterministic, and multi-agent work is isolated by worktree. Frictionless rules apply now; slow gates (hooks/CI/test gates) attach in Phase 5 when real code and a build pipeline exist. Zero friction for everyday local work.

## Development Method Asset

`GPAO-T5-DEVELOPMENT-METHOD-ASSET-2026-07-28-ko.md` preserves the reusable way T5 is built: owner philosophy
becomes human scenarios, one shared operating contract, isolated implementation, layered live evidence, independent
Codex-Claude audit, incident-derived invariants, clean handoff, and durable project knowledge. It is mandatory operating
guidance for new work and does not replace the authority documents above.

`GPAO-T5-INDEPENDENT-AUDIT-AND-COLLABORATION-CONTRACT-2026-07-29-ko.md` governs both independent audit and
parallel development. T5 may run a canonical verification line and isolated sidecar implementation lines at the same
time, but only after one shared contract is stable. Each sidecar owns disjoint files in its own worktree; one integration
owner audits and admits contract-sized changes so the product grows faster without making the owner resolve technical
conflicts.

## Core Three-Axis Reading Order

Every resumed or new T5 development session reads these before choosing work:

1. `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md` — user purpose, performance philosophy, and 말귀.
2. `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md` — model/runtime operating loop and judgment boundary.
3. `GPAO-T5-CORE-OPERATOR-HARNESS-WORK-ORDER-2026-07-28-ko.md` — current core work sequence, process audit, live scenarios, and completion evidence.

They are deliberately complementary: purpose prevents developer-tool drift, the operating loop prevents model-control drift, and the work order prevents overbuilding or completion claims without actual user evidence.

## Foundational Reference Documents

These documents do not sit above the top authority documents, but they are the source material the plan is built on. Consulting them is mandatory when designing the related GPAO-T5 systems — the plan draws its reasoning from them.

1. `references/BEAI5-SYSTEM-PROMPT-REFERENCE-2026-07-24-ko.md`
   - Foundational. BEAI5 underlies the development plan itself: it is development domain 2 of 7, part of the first build slice, and the basis of the BEAI5 Dual-Implementation Principle (plan §5.6). This is the source material for BEAI5 Model Operation, the BEAI5 Integration Contract, naturalness regression gates, and the split between OS-implemented properties and model-held judgment. Read it before any BEAI5-related design, implementation, or audit.

2. `GPAO-T5-P-OP-REFERENCE-ABSORPTION-SUPPLEMENT-2026-07-28-ko.md`
   - Mandatory when touching P-OP, connectors, sessions, channel surfaces, delivery/recovery, automation, repair, or scope isolation. It records what T5 should absorb from OpenClaw and Hermes, why it matters, and how to translate it without drifting into dashboard/channel/CLI feature copying.
   - Its post-P-OP source re-audit also separates what is already absorbed, what belongs to productization, what T-cell must govern, and what the current pure-JavaScript/zero-runtime-package choice does and does not mean.

3. T-cell implementation plan: **not yet issued**
   - The previous specification is retired under `docs/archive/retired-plans/`.
   - Do not resume TG/CX work from it. Preserve the current T5 core and wait for the new owner-approved plan.

4. `design/T5-SKILL-TRIGGER-AGENT-AUTOMATION-IMPLEMENTATION-PLAN-2026-07-29-ko.md`
   - Mandatory before changing skills, scheduling, background work, agent creation/delegation, or automation
     surfaces. It translates audited OpenClaw and Hermes contracts into one T5 structure and separates the
     pre-package automation core from later plugin ecosystems and agent swarms.

## Phase 0 Working Protocols

These documents govern the pre-code research seal. They are not product code, but they define what must be true before product code starts.

1. `GPAO-T5-REFERENCE-INVENTORY-PROTOCOL-2026-07-24-ko.md`
   - Defines the Reference Inventory table schema, reuse classification rules, lab_un/OpenClaw boundary, coverage bar, and Codex audit criteria for Phase 0.

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

## Running the First Build Slice (Phase 5)

Plain ESM JavaScript, zero build step, zero runtime dependencies. There is no compile/transform layer, so what the tests run is exactly what ships — this deliberately closes the GPAO-T3 "source is fine but the distribution is broken" failure class (absolute principle 1). Node 20+.

```bash
npm test     # node --test — 계약 불변식 + 시나리오 재생 테스트
npm start    # http://localhost:4173 — Work Chat (데모 환경)
```

Enforcement gates (Phase 5, 환경헌장): enable the fast pre-commit guard with
`git config core.hooksPath .githooks` (grep-only: blocks staged build artifacts/secrets, milliseconds).
CI (`.github/workflows/ci.yml`) runs the full `node --test` on push/PR. Full visual (mobile widths,
approval card) is reproducible via `design/evidence/capture.mjs` (Chrome headless).

Source layout maps to the sealed L0–L5 architecture (plan §6.2):

```text
src/kernel/contracts.js          봉인된 Kernel Contract 를 코드 타입(JSDoc)으로
src/kernel/l0-evidence/          SelfStateSnapshot · ToolReceipt · Truth Ledger
src/kernel/l1-intent/            IntentPacket(말귀) · Task Context Packet
src/kernel/l2-plan/              ActionPlan · Authority(A0-A3) · Follow-up
src/kernel/turn.js               한 턴 오케스트레이터(L0-L2 배선)
src/runtime/                     ModelClient · ToolRunner (L3, 슬라이스-1 스텁)
src/surface/                     Work Chat 서버 + 웹 UI (L4)
test/                            실패-우선 시나리오 테스트
```

Build artifacts are never committed; releases are generated out-of-tree per the Engineering Charter.

# GPAO-T5

Copyright © 2026 YOON. All rights reserved.

This repository is private and UNLICENSED. It grants no public permission to
use, copy, modify, or distribute the original GPAO-T5 materials. Third-party
components retain their original licenses; see [COPYRIGHT](COPYRIGHT),
[NOTICE](NOTICE), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Status: `official_development_root`

This folder is the formal development root for GPAO-T5.

**새로 합류했다면 `docs/00-START-HERE/README.md` 부터 읽어라.** 목적·철학·현재 상황·열려 있는
결함까지 한 시간 안에 잡을 수 있는 읽는 순서와, 문서보다 먼저 밟아야 할 명령이 적혀 있다.
새 세션에게 그대로 붙여 넣을 첫 메시지도 같은 폴더에 있다.

Start with `docs/PROJECT-AUTHORITY-MAP-ko.md`. It identifies the current canonical entry points, official working
folder, retired plans, comparison sources, and the boundary between current truth and history.

GPAO-T5 is an Original AI Operating System: the user feels they are only chatting, while T5 understands the user's purpose, knows its own available models/tools/permissions/context, operates the necessary means, and produces the desired result through a safe, traceable, recoverable flow.

Current development stage: the seven-core local runtime, T-cell S0-S5, H01-H10, durable automation, bounded
delegation, practical document workflows, and the deterministic whole-product seal are implemented. This is not a
public release claim. Signed installation, updates, uninstall/recovery, public distribution, and the owner's choice
between packaging now or doing the separately scoped structural hardening pass remain explicit work.

The approved execution path from the current development-complete baseline to a 90-point production candidate is
`docs/03-product-plan/T5-PRODUCTION-90-COMPLETION-PLAN-2026-08-02-ko.md`. It treats long-lived work state,
tool-turn latency, the consumer installation lifecycle, and broad real-world use as four independently scored product
gates. It does not reopen the sealed core or authorize public distribution.

## Single Top Product Authority

This is the single top product document for all GPAO-T5 planning, implementation, review, verification, and handoff.

1. `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md`
   - The single top authority for owner vision, product identity, the seven domains, 말귀, functional correctness,
     comparative performance, model operation, Selfhood, memory/growth, and final development judgment.

## Mandatory Engineering Contracts

1. `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md`
   - Implements the top product authority as engineering discipline: verify delivered artifacts, reject unverified
     premises, keep changes surgical, write failure tests, report honestly, and complete the real user path.

2. `GPAO-T5-ENGINEERING-ENVIRONMENT-CHARTER-2026-07-24-ko.md`
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

## Product Execution Reading Order

Every resumed or new T5 development session reads these before choosing work:

1. `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md` — single top product authority.
2. `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md` — model/runtime operating loop and judgment boundary.
3. `GPAO-T5-CORE-OPERATOR-HARNESS-WORK-ORDER-2026-07-28-ko.md` — current core work sequence, process audit, live scenarios, and completion evidence.

The latter two do not define a competing philosophy. They execute the top authority: the operating loop defines the
model/runtime boundary, and the work order defines implementation and evidence.

## Foundational Reference Documents

These documents do not sit above the top authority documents, but they are the source material the plan is built on. Consulting them is mandatory when designing the related GPAO-T5 systems — the plan draws its reasoning from them.

1. `references/BEAI5-SYSTEM-PROMPT-REFERENCE-2026-07-24-ko.md`
   - Foundational. BEAI5 underlies the development plan itself: it is development domain 2 of 7, part of the first build slice, and the basis of the BEAI5 Dual-Implementation Principle (plan §5.6). This is the source material for BEAI5 Model Operation, the BEAI5 Integration Contract, naturalness regression gates, and the split between OS-implemented properties and model-held judgment. Read it before any BEAI5-related design, implementation, or audit.

2. `GPAO-T5-P-OP-REFERENCE-ABSORPTION-SUPPLEMENT-2026-07-28-ko.md`
   - Mandatory when touching P-OP, connectors, sessions, channel surfaces, delivery/recovery, automation, repair, or scope isolation. It records what T5 should absorb from OpenClaw and Hermes, why it matters, and how to translate it without drifting into dashboard/channel/CLI feature copying.
   - Its post-P-OP source re-audit also separates what is already absorbed, what belongs to productization, what T-cell must govern, and what the current pure-JavaScript/zero-runtime-package choice does and does not mean.

3. `design/T5-TCELL-DEVELOPMENT-PLAN-2026-07-31-ko.md`
   - The owner-approved, frozen T-cell implementation contract. S0-S5 are implemented; the current execution line is
     the H-stage board, not a reopening of the retired TG/CX specification.
   - Current status belongs to `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md` and
     `docs/03-verification/T5-H-STAGE-BOARD-2026-08-01-ko.md`.

4. `design/T5-SKILL-TRIGGER-AGENT-AUTOMATION-IMPLEMENTATION-PLAN-2026-07-29-ko.md`
   - Mandatory before changing skills, scheduling, background work, agent creation/delegation, or automation
     surfaces. It translates audited OpenClaw and Hermes contracts into one T5 structure and separates the
     pre-package automation core from later plugin ecosystems and agent swarms.

## Phase 0 Working Protocols

These documents govern the pre-code research seal. They are not product code, but they define what must be true before product code starts.

1. `GPAO-T5-REFERENCE-INVENTORY-PROTOCOL-2026-07-24-ko.md`
   - Defines the Reference Inventory table schema, reuse classification rules, lab_un/OpenClaw boundary, coverage bar, and Codex audit criteria for Phase 0.

## Release Boundary

The repository already verifies an `npm pack` artifact by unpacking and booting what would ship. That is an artifact
gate, not a completed consumer installation lifecycle. Signed macOS packaging, background-service installation,
updates, uninstall/recovery, and public distribution remain after the H and Agent Core seals.

The owner-facing next-step comparison is
`docs/03-product-plan/T5-INSTALL-VS-STRUCTURAL-HARDENING-DECISION-2026-08-02-ko.md`. It keeps installation work and
behavior-preserving structural hardening as separate choices instead of mixing both into one risky change.

## Current Product Body

```text
Work Chat
+ Operational Selfhood and model/context reality
+ Intent / Context / T-cell memory, continuity, learning, and correction
+ ActionPlan / Authority A0-A3
+ File, web, browser, terminal, channel, MCP/API/CLI/OAuth execution
+ Work Surface for sessions, approvals, memory, growth, tools, and connections
+ TurnRef, receipts, Truth Ledger, recovery, and in-process automation
```

The current body is the completed local development line, not the 2026-07-24 first slice. Its deterministic product
journey is sealed; consumer installation and release lifecycle are deliberately separate from that development seal.

## Running the Current Development Build

Plain ESM JavaScript, zero build step, zero runtime dependencies. There is no compile/transform layer, so what the tests run is exactly what ships — this deliberately closes the GPAO-T3 "source is fine but the distribution is broken" failure class (absolute principle 1). Node 20+.

```bash
npm test     # node --test — 계약 불변식 + 시나리오 재생 테스트
npm start    # http://localhost:4173 — local T5 Work Surface
npm run verify:package  # pack → unpack → boot → health/onboarding artifact gate
```

Enforcement gates (Phase 5, 환경헌장): enable the fast pre-commit guard with
`git config core.hooksPath .githooks` (grep-only: blocks staged build artifacts/secrets, milliseconds).
CI (`.github/workflows/ci.yml`) runs the full `node --test` on push/PR. Full visual (mobile widths,
approval card) is reproducible via `design/evidence/capture.mjs` (Chrome headless).

Human-use verification is a separate product gate. It uses the visible browser rather than replacing user actions
with direct API calls:

```bash
npm run human-use:prepare -- --suite smoke
npm run human-use:verify -- /absolute/path/to/evidence.json
```

The scenario registry and agent contract live under `scripts/human-use/` and
`.agents/skills/t5-human-use-testing/`. The current seven-domain capability assessment, including the failed
30-turn continuity run, is `docs/03-verification/T5-SEVEN-DOMAIN-CAPABILITY-REPORT-2026-08-02-ko.md`.

Source layout maps to the sealed L0–L5 architecture (plan §6.2):

```text
src/kernel/contracts.js          봉인된 Kernel Contract 를 코드 타입(JSDoc)으로
src/kernel/l0-evidence/          SelfStateSnapshot · ToolReceipt · Truth Ledger
src/kernel/l1-intent/            IntentPacket(말귀) · Task Context Packet
src/kernel/l2-plan/              ActionPlan · Authority(A0-A3) · Follow-up
src/kernel/turn.js               한 턴 오케스트레이터(L0-L2 배선)
src/runtime/                     실제 모델·도구·커넥터·자동화 실행(L3)
src/surface/                     Work Chat 서버 + 웹 UI (L4)
test/                            실패-우선 시나리오 테스트
```

Build artifacts are never committed; releases are generated out-of-tree per the Engineering Charter.

## Reserved Post-Completion Structural Hardening

After T-cell, H-stage verification and remediation, the designated follow-up capabilities, and the full T5 product
finish are complete, T5 enters a separate behavior-preserving structural hardening track. This work simplifies
responsibilities, removes duplicate judgments, isolates verification tooling, and preserves existing user behavior,
stored data, authority boundaries, and recovery paths. It must not delay or reopen the current product-development
sequence.

Canonical scope and entry conditions:
`docs/03-product-plan/T5-POST-COMPLETION-STRUCTURAL-HARDENING-ko.md`.

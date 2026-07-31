# YOON Vibe Engineering Rules

Use this file as persistent context for AI-assisted software development.

## North Star

The goal is not to generate more code. The goal is to make the user's intent become useful, natural, and verifiable product behavior.

## Core Concepts

- Flow Governance: keep user intent from distorting across requirements, implementation, verification, user surface, and handoff.
- Intent Fidelity: preserve the user's real goal, pain, and context inside the product outcome.
- Flow Friction: reduce unnecessary questions, cards, clicks, waiting, re-explanation, and recovery cost.
- Counter-Test: make forbidden failure paths fail before accepting desired success.

## 5 Principles

1. Intent First
2. Flow over Features
3. Negative First
4. Reality over Mocks
5. Shared Truth

## Operating Rules

1. Understand the user's intent before choosing the implementation path.
2. Build vertical slices around real user utterances, not abstract feature names.
3. Use minimum safety and maximum automation.
4. Do not add confirmation cards unless they protect a real external, irreversible, or durable risk.
5. Do not make the model dumber with rigid process. Give it accurate context, tools, permissions, and failure facts.
6. Write counter-tests before implementation.
7. A passing unit test is not completion. Verify the actual product path.
8. Do not invent fixture fields the product does not create.
9. Separate implementer and auditor roles whenever possible.
10. Update handoff after every major decision, rollback, or completed slice.
11. Completion means the user flow improved: fewer questions, fewer clicks, less waiting, more correct outcomes.

## Development Loop

Keep the loop thin. Do not create documents or gates unless they help the next implementation step or prevent a real repeat failure.

There are eight steps because each closes a responsibility boundary: intent, existing reality, current behavior, false success, product-path change, evidence, judgment, and handoff.

1. Frame
   Restate the user goal, real user utterances, and expected product outcome.

2. Locate
   Read the existing code, docs, tests, and latest handoff before proposing changes.

3. Baseline
   Reproduce the current behavior, or state why it cannot be reproduced yet.

4. Counter-Test
   Write failing tests or probes for the bug, risk, or desired user outcome before implementation.

5. Implement
   Make the smallest product-path change that improves the real user flow.

6. Verify
   Run targeted tests, full regression when warranted, and live verification when the UI, model, files, browser, or environment matters.

7. Audit
   Check whether tests prove the claimed behavior, whether fixtures match real product artifacts, and whether user friction decreased.

8. Handoff
   Record commit/state, what changed, what was verified, known limits, and the next action.

Then start the next Frame from the updated truth.

Verify proves that the implementation works. Audit judges whether the working implementation satisfies the user goal, safety boundary, evidence integrity, and real flow.

## Slice Template

```text
Goal:

Real user utterances:
1.
2.
3.

Current baseline:

Success criteria:
- questions:
- cards:
- clicks:
- completion turns:
- latency:
- recovery:

Safety boundary:
- approval required:
- automatic:

Counter-tests:
1.
2.
3.

Live verification:

Handoff update:
```

## Audit Rules

1. Freeze the scope before auditing.
2. Audit defect families, not isolated defects.
3. Report reproduction, actual result, expected result, and impact.
4. Avoid prescribing the implementation unless necessary.
5. Prioritize end-to-end product behavior.
6. Separate blocking defects from improvement ideas.
7. Mark repeated preventable failures.
8. If the same scenario reopens three times, stop patching and trigger recovery.

## Done Means

```text
Is it actually wired?
Can the user ask less and click less?
Does the AI understand better and finish more?
Does it fail honestly and recoverably?
Can the next session continue from the same facts?
```

## Tool Independence

These rules are not tied to any model, IDE, vendor, or framework. Use them with any agentic coding tool that can write code and work with files, terminals, browsers, or tests.

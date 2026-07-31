# YOON Vibe Engineering Manifesto

The most dangerous illusion in AI-assisted development is mistaking "the code was generated quickly" for "the product got better."

Vibe coding opened the door. The next step is a method that turns AI speed into finished product quality.

I call this **YOON Flow-Governed Vibe Engineering**.

## One Sentence

> The human preserves intent and user judgment. The AI implementer creates speed. The auditor preserves fact and direction. The live user flow makes the final call.

## Why It Matters

AI coding tools are astonishing. But real product work exposes recurring failures:

- The agent seems to understand, then drifts into the wrong task.
- Tests pass while the actual screen becomes worse.
- Documents and plans become polished while the product stops moving.
- Long sessions lose context and revive stale assumptions.
- The agent reports completion before behavior is proven.
- Safety turns into unnecessary cards, confirmations, and clicks.
- Automation moves too fast and lets bad learning affect real behavior.

AI development therefore needs more than prompts. It needs **roles, flow, verification, and handoff**.

## Core Terms

- **Flow Governance**: The flow that keeps user intent from distorting as it moves through requirements, implementation, verification, user surface, and handoff.
- **Intent Fidelity**: The degree to which the user's real goal, pain, and context survive inside the product outcome.
- **Flow Friction**: Unnecessary questions, cards, clicks, waiting, re-explanation, or recovery cost.
- **Counter-Test**: A test that makes forbidden failure paths fail before desired success is accepted.

## 5 Principles

1. **Intent First**: User intent comes before code.
2. **Flow over Features**: Improve user flow before adding feature count.
3. **Negative First**: Write counter-tests first.
4. **Reality over Mocks**: Treat the real environment as closer to final judgment.
5. **Shared Truth**: Code, tests, documents, commits, and handoff must describe the same current reality.

## 10 Principles

1. **Intent understanding comes first.**  
   Writing more code is less important than understanding what the user means.

2. **Do not punish users with cards and clicks.**  
   A confirmation that protects no real risk is usability debt.

3. **Minimum safety, maximum automation.**  
   Strongly gate external sends, payments, public posting, irreversible deletion, and new durable permissions. Automate reversible local work.

4. **Do not make the model dumber.**  
   Give the model accurate context, tools, permissions, and failure facts. Do not bury it under rigid rules.

5. **Green tests are not product success.**  
   Separate unit tests, counter-tests, full regression, and live product verification.

6. **Develop around real user utterances.**  
   Do not close "memory feature implemented." Close "From now on, format reports as short bullet lists."

7. **Separate implementer and auditor roles.**  
   The same agent that built the structure is likely to miss the assumptions inside it.

8. **Use comparisons as absorption material, not rankings.**  
   Learn from what other systems do well. Do not copy their risks.

9. **Handoff is current truth, not paperwork.**  
   The next agent must be able to continue from the same facts.

10. **Completion is flow, not feature count.**  
    The product is better when the user asks less, clicks less, waits less, and gets more correct outcomes.

## How To Give Work To AI

Do not only say "fix this file." Give the agent this structure:

```text
Goal:
What real outcome should the user get?

User utterances:
List 3-5 actual sentences this feature must handle.

Success criteria:
Define questions, cards, clicks, completion turns, recovery behavior, and performance.

Safety boundary:
Separate what needs approval from what should be automatic.

Roles:
The implementer writes and runs code. The auditor checks defect families and user flow.

Verification:
Write counter-tests first, run regression, and verify in the real product environment.

Handoff:
Record commit, current state, known limits, and next action.
```

## The 8-Step Flow Loop

There are eight steps because each one closes a responsibility boundary where AI development often breaks: preserving intent, reading existing reality, reproducing current behavior, preventing false success, changing the product path, gathering evidence, judging product fit, and preserving truth for the next session.

```text
1. Frame
   Restate the goal and real user utterances.

2. Locate
   Read the existing code, docs, tests, and latest handoff.

3. Baseline
   Reproduce current behavior or explain why it cannot be reproduced yet.

4. Counter-Test
   Create failing counter-tests before implementation.

5. Implement
   Make the smallest product-path change.

6. Verify
   Separate targeted tests, needed regression, and real-environment verification.

7. Audit
   Check that tests are not narrower than the claim and that user friction decreased.

8. Handoff
   Record commit, verification, known limits, and next action.

→ next Frame
```

Keep the loop thin. Do not create documents or gates unless they help the next implementation step or prevent a real repeat failure.

Verify and Audit are different. Verify **proves that the implementation works**. Audit **judges whether that working implementation satisfies the user goal and real flow**.

## Drop-In Project Rules

Paste this into `YOON.md`, `AGENTS.md`, or `CLAUDE.md`.

```md
# YOON Vibe Engineering Rules

1. Understand the user's intent before choosing the implementation path.
2. Build vertical slices around real user utterances, not abstract feature names.
3. Use minimum safety and maximum automation.
4. Do not add confirmation cards unless they protect a real external, irreversible, or durable risk.
5. Write counter-tests before implementation.
6. A passing unit test is not completion. Verify the actual product path.
7. Do not invent fixture fields the product does not create.
8. Separate implementer and auditor roles whenever possible.
9. Update handoff after every major decision, rollback, or completed slice.
10. Completion means the user flow improved: fewer questions, fewer clicks, less waiting, more correct outcomes.

Development loop: Frame -> Locate -> Baseline -> Counter-Test -> Implement -> Verify -> Audit -> Handoff.
```

These rules are not tied to any single model or IDE. They can be used with any agentic coding tool where an LLM writes code and works with files, terminals, browsers, or tests.

## Final Questions Before Calling Work Done

```text
Is it actually wired?
Can the user ask less and click less?
Does the AI understand better and finish more?
Does it fail honestly and recoverably?
Can the next session continue from the same facts?
```

Vibe coding is the beginning.  
To finish products, govern the vibe with flow.

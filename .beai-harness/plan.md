# Build Plan

## Goal

P6-19 Natural Governance: timeout/failure/approval/memory 상태를 사용자가 자연스럽게 이해하고 다음 행동으로 회복하게 만들기

## Adaptive Flow

- Level: light
- Summary: Use a lightweight flow: quick facts, one scenario confirmation, small reversible change, quick verify.
- No-ceremony: no (guided flow still useful)
- Product scale: lightweight
- Ambiguity: partly clear; confirm the first scenario and saved data

## Chosen Scenario

### First Useful Version

- Fit: best when the user wants speed and has not clarified every detail yet
- User story: End users can use main page to complete the primary user flow so that a user can complete the first valuable end-to-end flow.
- Includes:
  - one end-to-end path for complete the primary user flow
  - saved data: id, title, status, createdAt
  - plain-language result summary
- Confirm: Is this first useful version enough to start, or should the scope include another user path?

## Cost-Aware Verification Profile

- Level: scenario
- Name: scenario-guided verification
- Cost: balanced
- Reason: Product-shaped or ambiguous work benefits from scenario evidence while avoiding release-level simulation by default.
- Field-readiness: not default
- Field-readiness reason: Escalate only for public/release/product-confidence work or explicit user request.
- User direct request priority: Fulfill the user's stated goal first. Use BEAI gates to accelerate, clarify, verify, and protect the work; do not turn them into ceremony unless an authority, safety, secret, destructive, public-release, money, legal, or external-action boundary changes the path.

Commands:

- beai preflight
- beai brief --apply
- beai plan --apply
- implementation
- developer scenario checks
- beai verify --scenario --meaning

## Flow State Summary

- 요청 형식: 직접 답변
- AI가 할 일: 작업 순서와 경계를 정하기
- 사용자 승인 경계: 지금은 사용자 승인 없이 로컬 검토/수정 가능
- 검증 깊이: output pending
- 마지막에 남길 하나: 요청 형식, AI가 할 일, 사용자 승인 경계, 검증 깊이, 마지막에 남길 하나

## User Experience Layer

- Plain status: 이 요청은 짧은 계획과 검증을 거쳐 진행하는 것이 가장 좋습니다.
- What Codex will do: Move from planning into reversible local implementation with verification evidence. 만들고, 필요한 확인까지 같이 진행합니다. 다음 행동은 선택된 작업 흐름 (build)에 따라 구현하고 검증 증거를 남깁니다.
- User needed now: 지금 사용자가 할 일은 없습니다.
- One next action: 선택된 작업 흐름 (build)에 따라 구현하고 검증 증거를 남깁니다.
- Hidden expert patterns: build
- Approval boundary: none

## Knowledge Loop Bridge

- Status: connected
- Mode: read-review-only
- Memory influence: none
- Next action: 선택된 작업 흐름 (build)에 따라 구현하고 검증 증거를 남깁니다.
- Guardrail: Do not promote durable memory, send externally, or override the user's current request from Knowledge Loop output.

## Context Mesh

- Status: not-configured
- Vault: /Users/jyp/Developer/gpao-t5/beai-vault
- Selected context: 0
- Message: Context Mesh vault is not configured for this workspace.
- Next action: Continue without Context Mesh, or run beai mesh init --apply when shared cross-tool context matters.

## Assumptions

- A saved product brief exists.
- JavaScript project metadata is available.
- Project intelligence summary: language signals JavaScript(87), Markdown(56), HTML(1); framework unknown; layers tests, docs, delivery; 1 verification commands; completion 88/100

## Steps

1. Confirm the recommended first scenario in one sentence.
2. Make the smallest reversible local change that proves the scenario.
3. Run a focused check or smoke test.
4. Explain the result, what changed, and the next optional improvement in plain language.

## User Path

1. The AI/developer starts from scenario: First Useful Version.
2. The first usable result should let End users can use main page to complete the primary user flow so that a user can complete the first valuable end-to-end flow.
3. The assumed first user is end users; proceed with this assumption unless it changes the product direction.
4. The AI/developer makes visible: one end-to-end path for complete the primary user flow.
5. The AI/developer makes visible: saved data: id, title, status, createdAt.
6. The AI/developer makes visible: plain-language result summary.
7. Run the smallest visible result and confirm it does the one promised thing.

## Developer Companion Contract

- Principle: AI does the work. User keeps authority.
- Posture: The user should only do what the AI cannot do: judge intent, approve real-world actions, choose preferences, and give final lived-context feedback.

### AI-Owned Work

- Translate vague intent into a concrete first product scenario before asking technical questions.
- Choose the smallest useful version and keep broader scope as later options.
- Proceed through reversible local implementation and checks without asking for step-by-step approval.
- Design, implement, document, and verify the local product flow before asking the user to test.
- Run the first success path, empty or first-time state, and failure or recovery state when the project surface allows it.
- Use dry-run, mock, preview, or test mode before any external send, payment, deployment, or automation activation.
- Report checked, changed, verified, unverified, and next safe action separately.

### User Authority

- Correct the product direction only when the AI's safe assumption is wrong.
- Choose taste, brand, operating policy, or business preference when there is no technical source of truth.
- Give final lived-environment feedback only after the AI/developer has completed its own scenario checks.

## Approval Gates

- none now; AI/developer proceeds through reversible local work and pauses only at a real authority boundary

## Scenario-First Developer Verification

1. First success path: complete First Useful Version once from the user's starting point to the intended result.
2. Empty or first-time state: check what the user sees before any saved data or configuration exists.
3. Failure or recovery state: check the most likely wrong input, missing setup, failed command, or unavailable data path.
4. Visual flow: inspect the main screen path for main page before asking for user review.

## Verification Path

1. AI/developer runs the First Useful Version path end to end before final user review.
2. AI/developer checks the empty, success, and failure states that matter for the chosen scenario.
3. AI/developer runs BEAI verify and reports checked, changed, verified, unverified, and next safe action.
4. User only performs final direction or real-world approval checks that the AI cannot perform.

## Developer Work

1. Check only the files and commands needed for the requested change.
2. Implement scenario path: First Useful Version.
3. Create or update main page for the chosen scenario.
4. Model id only as needed for First Useful Version.
5. Model title only as needed for First Useful Version.
6. Model status only as needed for First Useful Version.
7. Model createdAt only as needed for First Useful Version.
8. Proceed with the chosen first scenario as a working assumption; do not pause for scope approval unless the direction becomes subjective, external, destructive, public, or irreversible.
9. Add or update a smoke check for First Useful Version.
10. Run scenario-first developer verification before asking the user for final lived-context review.
11. Run an existing focused check or add the smallest useful smoke check.
12. Run BEAI verify and report remaining risks.
13. Report what changed, what was checked, and what remains outside this small scope.

## Delegation Units

- DU-1: shape delegated outcome -> clear scope and non-goals; evidence: scope and first workflow are reviewable
- DU-2: implement local reversible work -> working local candidate; evidence: local implementation exists with changed files reviewed
- DU-3: verify and attribute failures -> evidence-backed result; evidence: checks pass or failures have owners
- DU-4: closeout and handoff -> continuable project state; evidence: closeout is ready or blockers are explicit

## Product Risk Review

- Scope may expand unless the first usable version is kept small.

## Approval Required

- Deployment
- External account or API connection
- Secret storage
- Data deletion
- Public repository push
- Project-wide destructive rewrite

## Detected Checks

- npm run test

## Project Impact

- tests: detected and should be considered in implementation planning
- docs: detected and should be considered in implementation planning
- delivery: detected and should be considered in implementation planning

## Completion Gaps

- none detected

## Plain Completion Focus

- no blocking completion focus

## Final User Check

- Does the first scenario feel like the product you wanted?
- Is any real account, message, payment, deletion, or deployment approved now, or should it remain in preview/test mode?
- What is the one next improvement after the verified first version?

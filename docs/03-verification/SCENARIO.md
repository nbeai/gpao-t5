# BEAI Scenario

## Workflow

- Name: Guided First Workflow
- Mode: beginner
- Task type: unknown

## V0 Goal

The first real user can route a vague request, see the plan, run checks, and understand the result without reading the whole codebase so that a user can move from vague request to safer implementation with visible gates and evidence.

## First Success Path

1. User starts the Guided First Workflow from the first visible entry point.
2. User creates, selects, or previews one request without needing technical setup knowledge.
3. System shows the intended result in plain language.
4. AI/developer verifies the result with a repeatable check before final user review.

## Empty Or First-Time State

1. Open the command surface before any real user data exists.
2. Explain what Guided First Workflow is for without exposing implementation jargon.
3. Show the next safe action instead of a blank or confusing state.

## Failure Or Recovery Path

1. Trigger the most likely failed or missing-input state for Guided First Workflow.
2. Show a recoverable explanation and next safe action.
3. Do not claim completion while the failure path is unknown.

## Included

- route contract
- plain-language plan
- verification evidence
- next action

## Excluded

- unapproved external activation
- unrelated refactor
- large rewrite

## Approval Gates

- User confirms the first workflow matches the real intention.
- User approves taste, business policy, or operating preference where there is no technical source of truth.

## AI Verification

- AI/developer verifies first success path for Guided First Workflow.
- AI/developer verifies empty or first-time state.
- AI/developer verifies failure or recovery state.
- AI/developer inspects the main user-facing surface when possible.

## Final User Authority

- User judges whether the result matches the real-world intention.
- User approves preferences and final lived-context fit.

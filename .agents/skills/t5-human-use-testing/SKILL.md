# T5 Human Use Testing

Use this skill when T5 must be tested as a person would use it through the visible web UI.

## Purpose

Measure whether a non-developer can hold a natural conversation, finish real work, understand approvals, and recover from failure. This is not an HTTP conformance runner and not a prompt benchmark.

## Required Flow

1. Read `scripts/human-use/scenarios.json` and choose one registered suite.
2. Run `npm run human-use:prepare -- --suite <suite>` before starting the server.
3. Use a fresh data directory and fixture folder. Reuse the configured model connection without copying user conversations or memories.
4. Open the actual T5 page in a visible browser. Type into the composer, click visible buttons, scroll, open settings, and approve or reject through the UI.
5. Do not use `/turn`, approval APIs, or direct store edits as a substitute for a user action. Read-only API or file inspection is allowed after the visible action to verify facts.
6. Capture response text, first-progress time, first-answer time, completion time, browser console errors, approval actions, receipts, source hashes, and output hashes.
7. Attribute every failure to one of `product`, `model`, `test_agent`, or `environment`. Do not change the expected result after seeing the output.
8. Run `npm run human-use:verify -- <evidence.json>` before reporting.

## Judgment Boundary

- Machine checks decide artifacts, hashes, receipts, approvals, sensitive-data persistence, empty replies, duplicated execution, and console errors.
- A reviewer may judge naturalness, intent fit, needless stock phrases, context continuity, and whether the user burden was reasonable.
- A reviewer cannot override a failed machine check.
- A model's self-report is never proof that a tool ran or a file exists.

## Stop Immediately

Stop the run on sensitive data persistence, unapproved external effect, source loss, false success, execution duplication, or use of real user files outside the registered fixture. Preserve evidence and do not continue to collect a better-looking score.

## Cadence

- `smoke`: after user-facing changes.
- `long_conversation`: daily or after context/memory/model changes.
- `project_completion`: after planning, authority, tool, recovery, automation, or agent changes.
- `milestone`: before a release or installer decision.

Do not repeat one scenario indefinitely. When the same cause appears twice, stop measuring and open one product defect for that cause.

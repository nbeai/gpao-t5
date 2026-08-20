---
name: github-workflow
description: Work with a GitHub repository through verified local Git and GitHub CLI access. Use to inspect repository state, issues, pull requests, checks, or prepare a deliberate change without assuming authentication or publishing externally.
---

# GitHub workflow

## When to use

Use for GitHub repository, issue, pull request, review, or check work when local `git` and optionally `gh` access are available.

## Prerequisites

Confirm the repository path, current Git state, remote, and whether `gh` is installed and authenticated before selecting a GitHub operation. Do not assume the intended account, repository, branch, or permission.

## Procedure

1. Inspect repository status and the user's requested scope before changing files or branches.
2. Use local Git for local facts and `gh` only when it is verified available for the remote fact needed.
3. Read the exact issue, pull request, review, or check context before acting on it.
4. Verify local changes and relevant checks before presenting a result. Keep external publication separate from preparation.

## Verification

Report observed repository state, commit or branch identity, and check results. Verify remote facts through the available GitHub route rather than local assumptions.

## Failure and stop conditions

Stop if the repository, remote target, authentication, or requested external action is unclear. A first send to a new external recipient or publication still follows the runtime approval boundary.

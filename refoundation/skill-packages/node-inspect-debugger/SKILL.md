---
name: node-inspect-debugger
description: Debug a local Node.js program with the built-in inspector when Node is available. Use to reproduce an error, inspect a narrow execution point, and verify the resulting fix with the project's own checks.
---

# Node inspector debugging

## When to use

Use when a local Node.js program needs inspector-oriented debugging.

## Prerequisites

Confirm the project, reproduction command, Node version, and availability of the built-in inspector. Do not change dependencies or configuration simply to make an inspector session start.

## Procedure

1. Reproduce the failure with the smallest normal project command.
2. Identify the relevant script and point of failure from the real output.
3. Start the Node inspector in the fitting local mode; use PTY only when an interactive inspector session actually requires it.
4. Make the smallest justified correction and rerun the original failure command and focused project checks.

## Verification

Confirm the original failure is resolved through actual command output and relevant tests. Preserve the observed error and final result in the run receipt.

## Failure and stop conditions

Stop if the issue does not reproduce, the target environment is unclear, or the requested change has no evidence from the inspector or tests. Do not label an unverified workaround a repair.

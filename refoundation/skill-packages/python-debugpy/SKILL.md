---
name: python-debugpy
description: Debug a local Python program with debugpy when Python and debugpy are available in the relevant environment. Use to reproduce an error, inspect a narrow execution point, and verify the fix without changing unrelated code.
---

# Python debugpy

## When to use

Use when a local Python program needs breakpoint-oriented debugging and the environment supports debugpy.

## Prerequisites

Confirm the target project, Python environment, reproduction command, and availability of `debugpy`. Do not install packages, alter environments, or expose secrets merely to start debugging.

## Procedure

1. Reproduce the reported failure using the project's normal narrow command.
2. Identify the smallest relevant module, input, and execution point.
3. Start debugpy in a way compatible with the local environment; use PTY only if the debugger or target truly requires an interactive terminal.
4. Inspect the failure, make the smallest justified change, and rerun the original reproduction plus relevant tests.

## Verification

Verify that the original failure no longer reproduces and that the relevant test or command passes. Keep the observed traceback or debugger evidence in the run record.

## Failure and stop conditions

Stop if the failure cannot be reproduced, the environment is uncertain, or the debug target would require unavailable credentials or network effects. Do not present a speculative code change as a fix.

---
name: apple-reminders
description: Work with Apple Reminders on macOS when a verified local automation route is available. Use to find, create, complete, or update reminders with the intended list and due information.
---

# Apple Reminders

## When to use

Use for a request about the user's Apple Reminders lists or reminders on macOS.

## Prerequisites

Confirm macOS and an available, authorized local route for Reminders before acting. Do not assume the route, a list name, timezone, or permission.

## Procedure

1. Separate the requested title, list, date or time, recurrence, and completion state.
2. Read the relevant list or exact matching reminder first when updating or completing it.
3. Create or alter only the requested reminder fields.
4. Read it again to confirm its list, title, completion state, and due details.

## Verification

Confirm the observed reminder after the operation. State date and timezone plainly when a due time matters.

## Failure and stop conditions

Stop if the required automation route is unavailable, a target is ambiguous, or recurrence or time is materially unclear. Do not silently choose a list or mark multiple reminders complete.

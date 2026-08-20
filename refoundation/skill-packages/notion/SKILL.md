---
name: notion
description: Work with Notion only through an available, already authorized local CLI, connector, or API route. Use to find, read, draft, or update pages while confirming the exact workspace target and externally visible change.
---

# Notion

## When to use

Use for a request about a Notion page, database, or workspace that the current environment can already access.

## Prerequisites

First discover a locally available, authorized Notion route. Do not ask for an API token in terminal input, invent page IDs, or assume workspace access.

## Procedure

1. Identify the workspace target, intended page or database, and requested read or change.
2. Search narrowly and read the exact target before modifying it.
3. Apply the smallest requested update, preserving unrelated content and properties.
4. Re-read the page or database entry and verify the intended visible result.

## Verification

Report only contents or changes confirmed by the available route after the operation.

## Failure and stop conditions

Stop if access, target identity, or requested database property is unavailable or ambiguous. Treat a first external share or invitation as a separate approval boundary.

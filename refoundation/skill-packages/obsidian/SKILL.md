---
name: obsidian
description: Work with an existing Obsidian vault as local Markdown files. Use to find, read, create, update, or link notes after confirming the vault root and verifying the resulting file content.
---

# Obsidian

## When to use

Use for requests about notes in an existing Obsidian vault.

## Prerequisites

Locate the actual vault root from the user's context or filesystem evidence. Do not assume a default vault path or use Obsidian sync state as proof that a file is current.

## Procedure

1. Identify the vault, note title or path, requested tags, links, and desired change.
2. Search within that vault only, using filename and frontmatter clues where useful.
3. Read the target note before changing it; preserve existing Markdown and links unless asked otherwise.
4. Re-read the changed or created file and verify its path, title, links, and requested content.

## Verification

Base completion on the final file observation, not on a presumed Obsidian app refresh.

## Failure and stop conditions

Stop if the vault or note is ambiguous, or if changing a generated or conflicted file would risk overwriting work. Ask one minimal question rather than choosing among materially different vaults.

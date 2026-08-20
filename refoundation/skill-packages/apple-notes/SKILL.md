---
name: apple-notes
description: Work with Apple Notes on macOS when the available computer has a verified Notes automation route. Use to find, read, create, or update notes while preserving the user's intended notebook and content.
---

# Apple Notes

## When to use

Use for a request about the user's Apple Notes. This is macOS-specific and is not a substitute for arbitrary file search.

## Prerequisites

First establish that the current computer is macOS and that a locally available, authorized Notes automation route exists. Do not assume one, prompt for credentials, or invent a note ID.

## Procedure

1. Identify whether the request is to find, read, create, or change a note, and preserve any folder and title clues.
2. Inspect the available local route and its safe read capability before choosing a command.
3. For a change, locate the exact note and read its current content first. Keep the requested change narrow.
4. Re-read the resulting note and confirm title, folder, and the requested content.

## Verification

Report only a note that the available route observed after the operation. For a change, verify the post-change content rather than relying on a successful command.

## Failure and stop conditions

Stop if macOS, an authorized route, the intended note, or a unique target cannot be established. If several notes match, present the small set and ask one minimal disambiguating question. Never expose note contents beyond the user's request.

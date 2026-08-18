---
name: file-discovery
description: Find the local file or folder the user means when they provide a title, filename, extension, file kind, approximate location, or recency clue. Use for requests to locate, identify, compare, or open a user file, especially when exact filename matching is slow or fails, the extension may be mistaken or omitted, visually identical Unicode names differ, multiple copies exist, or the user asks for the newest or most recently changed match.
---

# File discovery

Use the existing terminal. Treat the request as evidence about identity, not as one literal search string.

## Interpret the target

Separate these clues when present:

- title or stem
- stated extension or file kind
- explicit or implied location
- whether “recent” means creation, modification, download, or last use
- whether the user wants one best match or all matches

Keep the original wording. Normalize both the requested name and candidate names for comparison, including Unicode normalization and appropriate case folding. Treat a trailing extension as a strong constraint, not as part of the semantic title.

## Search progressively

1. Start with the narrowest relevant scope supported by the request and conversation. Do not pre-scan unrelated locations.
2. Try the fastest available filename index or targeted directory search for the normalized full basename.
3. If an exact full-name search fails, stalls, or produces no useful candidate, search the normalized stem without the extension. Then compare the candidate extension or file kind separately.
4. If an index is unavailable or stale, switch to a targeted filesystem traversal. Avoid an unbounded whole-computer walk when a smaller relevant scope remains.
5. Filter or aggregate near the data so a large listing does not consume the observation window.

Choose commands and platform facilities from the computer that is actually available. The procedure matters; no particular command is mandatory.

## Rank and verify

Rank candidates using the clues the user actually supplied. Prefer, in order of relevance:

- normalized basename equality
- normalized stem equality plus matching extension or file kind
- explicit location match
- requested creation or modification ordering
- weaker partial-title or token similarity

Before answering, observe the winning path again and verify that it exists, has the expected type, and has the metadata used to distinguish it. Do not call a file “newest” from modification time when the user asked for creation time. If creation time is unavailable on the current filesystem, state that limitation rather than substituting silently.

## Ambiguity and stopping

Return one file when the evidence produces a unique best match. If materially different candidates remain tied and the request contains no discriminator, show the small candidate set and ask one minimal question.

After a reasonable indexed method and a targeted traversal both fail in the relevant scope, stop. Report what scope was checked and what clue is missing before proposing a materially broader search. Do not keep repeating equivalent searches.

Never claim a match from a command string or model guess alone. Base the answer on the final filesystem observation.

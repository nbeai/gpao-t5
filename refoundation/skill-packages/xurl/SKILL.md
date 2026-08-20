---
name: xurl
description: Resolve, inspect, or summarize a user-provided X link through an available local or permitted network route. Use to preserve the exact post, author, timestamp, media links, and quoted context without guessing from a URL alone.
---

# X link work

## When to use

Use when the user provides an X or Twitter URL and asks to inspect, summarize, archive, or extract it.

## Prerequisites

Confirm that an available route can access the supplied link. Do not assume login, bypass access controls, or infer post content from the URL.

## Procedure

1. Keep the original URL and resolve redirects only through the available route.
2. Read the post metadata, text, media references, and any quoted or thread context needed for the request.
3. Separate the author's statements from quoted material and replies.
4. Preserve the canonical link and observed timestamp in the result when relevant.

## Verification

Verify the requested facts against content actually retrieved from the link or its canonical destination.

## Failure and stop conditions

Stop if access is unavailable, the link is deleted or private, or the source cannot establish identity. Say that the post could not be observed; do not fabricate a summary.

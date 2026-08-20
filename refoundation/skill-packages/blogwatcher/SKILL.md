---
name: blogwatcher
description: Check a blog, RSS, or Atom feed through an available local feed reader or network route. Use to find recent posts, compare updates, or summarize newly published items without treating a stale feed as current.
---

# Blog watcher

## When to use

Use when the user asks what is new on a named blog, newsletter archive, RSS feed, or Atom feed.

## Prerequisites

Confirm that the current environment has a suitable feed reader or permitted network route. Verify the source URL or known local subscription; do not guess it.

## Procedure

1. Identify the source, requested time window, and whether the user wants titles, links, or a summary.
2. Fetch or inspect the feed using the available route and note its publication or update timestamps.
3. Filter by the requested window, deduplicate entries, and open source pages only when the feed is insufficient.
4. Preserve direct source links and distinguish publication time from feed retrieval time.

## Verification

Confirm each reported item against the feed or source page actually read. State the checked time and timezone when recency matters.

## Failure and stop conditions

Stop when no valid source can be identified, access is unavailable, or the feed is stale and no source page can confirm it. Do not claim that there are no updates from a failed fetch.

---
name: songsee
description: Identify or look up a song through an available local music recognition or metadata tool. Use when the user supplies a track, audio clip, title fragment, or artist clue and needs a verified song match.
---

# Song lookup

## When to use

Use to identify a song or retrieve factual music metadata from available local or permitted network tools.

## Prerequisites

Discover a suitable available recognition or metadata route. Do not assume microphone access, a music service login, or that a title fragment uniquely identifies one track.

## Procedure

1. Separate the evidence the user supplied: audio, lyric fragment, title, artist, album, or date.
2. Query the available route with the strongest clues first.
3. Compare artist, title, version, release, and duration clues before selecting a result.
4. Present alternatives when evidence does not uniquely identify a recording.

## Verification

Report a match only when the available source confirms the relevant identity fields. Mark inferred matches as uncertain.

## Failure and stop conditions

Stop when no compatible route exists or candidate evidence remains tied. Do not claim lyrics, ownership, or availability that the source did not establish.

---
name: diagrams
description: Create or update a diagram using a verified available local diagram format or renderer, such as Mermaid, Graphviz, or an existing project tool. Use to turn a requested relationship or flow into an inspectable artifact.
---

# Diagrams

## When to use

Use when a relationship, sequence, system structure, or comparison is clearer as a diagram than prose.

## Prerequisites

Identify the requested artifact path and discover an available local format or renderer. Do not assume a renderer, overwrite an existing diagram, or claim visual output was checked when only source text was created.

## Procedure

1. Extract the entities, relationships, direction, and labels that the user actually needs.
2. Choose the simplest supported representation: text source alone when sufficient, or a local renderer when visual verification matters.
3. Create the artifact at the requested or clearly scoped path without altering unrelated files.
4. Read the source back and, when a renderer exists, render or parse it to confirm validity.

## Verification

Confirm the saved source and any rendered output actually observed. State whether verification was source-level or visual.

## Failure and stop conditions

Stop if the relationships are materially ambiguous, no suitable local format is available, or rendering errors remain. Do not substitute decorative complexity for missing facts.

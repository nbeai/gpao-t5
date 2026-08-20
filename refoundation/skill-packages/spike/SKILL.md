---
name: spike
description: Run a short, bounded technical investigation using the existing terminal and available project tools. Use to answer an uncertain implementation question with a small experiment, observed result, and a clear stop point.
---

# Technical spike

## When to use

Use when the user needs a focused answer to a technical uncertainty before committing to a larger change.

## Prerequisites

State the question, evidence needed, time or scope boundary, and safe workspace before exploring. Use existing local tools; do not install, deploy, or contact external systems without a separate basis.

## Procedure

1. Turn the uncertainty into one observable question and a smallest useful experiment.
2. Inspect relevant code, documentation already present, and real commands or fixtures.
3. Run the experiment, preserve the key output, and compare it to the stated question.
4. Summarize what is known, what remains unknown, and the narrowest next action.

## Verification

Treat an answer as established only when the experiment or source directly supports it. Distinguish observation from inference.

## Failure and stop conditions

Stop at the agreed scope boundary or when the question cannot be answered safely from available evidence. Do not let a spike become an unbounded implementation project.

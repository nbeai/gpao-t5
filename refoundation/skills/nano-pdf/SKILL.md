---
name: nano-pdf
description: Inspect, extract from, create, split, merge, or verify PDF files through an available local PDF toolchain. Use when the requested result is a PDF and the final file must be checked, not merely written.
---

# PDF work

## When to use

Use when the user asks to read, summarize, assemble, alter, or verify a local PDF.

## Prerequisites

Discover the available local PDF capability before selecting commands. Do not claim support for OCR, form editing, encryption, or visual rendering unless the available toolchain demonstrates it.

## Procedure

1. Locate and identify the source PDF and requested output path.
2. Inspect page count and extractable content before altering it; choose the smallest fitting local tool.
3. Write to a deliberate output path, preserving the original unless replacement is explicitly requested.
4. Re-open the resulting PDF and verify page count, readable content, and the requested transformation.

## Verification

Report the observed output path and the checks that passed. Use visual rendering only when layout, images, or placement matters to the request.

## Failure and stop conditions

Stop if the source is unreadable, encrypted without an available authorized path, or the requested visual change cannot be observed. Do not call a PDF valid just because a command exited successfully.

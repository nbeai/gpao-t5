---
name: visual-deliverables
description: Create or improve a visual business artifact by choosing an appropriate editable, screen, print, or diagram format, rendering the actual result, and repairing observed defects before delivery.
---

# Visual Deliverables

## When to use

Use when readability, visual hierarchy, layout, chart or diagram quality, print appearance, or brand consistency is part of the requested result. Do not add visual complexity when plain prose or a small table is clearer.

## Choose the result surface

- Use HTML/CSS for screen-first reports, dashboards, onboarding, and fixed artboards with paragraphs.
- Use SVG, Mermaid, Graphviz, or another verified renderer for shapes, relationships, diagram labels, chart marks, and icons.
- Use the qualified DOCX or PPTX structure when the user needs an editable office file. A beautiful HTML or PDF is not an editable office result.
- Use PDF for fixed print or distribution only when the exact pages can be rendered and reopened.

Do not place paragraph-length text by raw SVG coordinates. Preserve semantic text and the source structure alongside raster or vector previews.

## Procedure

1. Extract the exact content facts, data values, units, required result form, audience, and delivery medium.
   Translate source field names and machine identifiers into audience language. Keep raw keys, paths, and internal labels out of the visible artifact unless the user needs them.
2. Reuse only user-approved brand sources: logo, font, color ramp, spacing, and tone. Do not infer a durable brand from old outputs.
3. Establish information hierarchy and geometry before decorative color. Use color, labels, shapes, and patterns together; never rely on color alone for meaning.
4. For HTML artboards, mark the complete surface with `data-vd-artboard` and independent layout blocks with `data-vd-block`. Keep scripts, forms, network resources, and external fonts out of the artifact.
5. Create the actual requested file. Use the attachment tool with `inspect`, the exact current-Run file path or output handle, and no attachmentId to render HTML, SVG, PDF, DOCX, or an image.
6. Read the factual DesignReceipt and the actual rendered pixels. Repair content overflow, declared-block overlap, unavailable fonts, missing text, low contrast, missing alternative text or captions, and incorrect source data.
7. Re-render after a material correction. Stop when the requested purpose is satisfied, a precise capability boundary remains, or a repeated result adds no new evidence.
8. Register and deliver the verified artifact through the existing attachment result path. State any unmeasured medium such as editable PPTX or print output.

## Verification

Verify content and visual facts separately:

- source data, labels, units, and text are complete and unchanged;
- every required page or artboard was rendered;
- no required content is clipped, outside bounds, or unintentionally overlapped;
- requested fonts loaded or fallback is disclosed;
- contrast and color distinctions are usable with labels or shapes;
- semantic headings, tables, alt text, captions, and extractable text remain where required;
- the delivered medium is actually screen, print, vector, or editable as claimed.

DesignReceipt is not an aesthetic score. Use model judgment and, when material, human review for whether the result feels clear, appropriate, and on brand.

## Failure and stop conditions

Do not claim visual verification from source parsing alone. Do not replace editable DOCX or PPTX with HTML, SVG, PNG, or PDF. Do not retry the same render without a changed source or new evidence. Stop with the exact capability boundary when the current platform lacks a qualified renderer.

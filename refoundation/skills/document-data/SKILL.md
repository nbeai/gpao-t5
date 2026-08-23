---
name: document-data
description: Inspect XLSX, PDF, and DOCX business documents with source locations; create bounded auditable XLSX or DOCX results; and re-open them for verification.
---

# Document and spreadsheet data

## When to use

Use when XLSX, PDF, or DOCX files are primary business inputs or when the user wants a new XLSX or DOCX result assembled from them. This procedure supplies a method; the terminal performs the work and the model decides what the documents mean.

## Observe sources

1. Locate only the files relevant to the request. Do not sweep unrelated folders.
2. Inspect every selected source with `"$T5_DOCUMENT_CLI" inspect "ABSOLUTE_PATH"`. Use `--max-cells` or `--max-pages` when the default projection is too broad.
3. Read the returned projection limits. If cells or pages were omitted, narrow the source or deliberately inspect with a sufficient bound; never claim unseen rows or pages were checked.
4. Cite spreadsheet facts as `filename · sheet!cell` or an exact range, and PDF facts as `filename · page N` in the output data. Preserve enough source detail for a person to trace each important value.

## Interpret without inventing

- Treat merged headings, hidden rows and sheets, cell number formats, formulas, and cached formula results as different facts.
- A cached formula result is not proof that the formula is logically correct. Reconcile representative calculations against their source cells.
- Do not silently combine different currencies, tax inclusion rules, quantities, units, customer identities, or periods.
- Mark conflicts and missing values explicitly. If a consequential conflict or missing discriminator cannot be resolved from observed sources, do not infer it; ask the user.
- A PDF with `requiresOcrOrVision: true` has no extractable text in the observed pages. Stop unless an available authorized OCR or visual method can actually read it.

## Create an XLSX result

1. Keep every original file unchanged and choose a new absolute `.xlsx` output path.
2. Write a JSON specification containing one or more sheets. Each sheet uses `name`, optional `title`, `columns`, `rows`, and optional `formulas`. Keep a visible source column for source-backed rows.
3. Every formula entry requires `cell`, `formula`, and an independently computed `result`; the creator refuses result-less formulas because ExcelJS does not evaluate formulas.
4. Run `"$T5_DOCUMENT_CLI" create-xlsx --spec "ABSOLUTE_SPEC_JSON" --output "ABSOLUTE_OUTPUT_XLSX"`. Existing output is not overwritten unless the current user explicitly requested replacement and `--replace` is used.

Minimal specification shape:

```json
{
  "sheets": [{
    "name": "Combined",
    "title": "Monthly combined data",
    "columns": [
      {"key": "item", "header": "Item", "width": 24},
      {"key": "amount", "header": "Amount", "width": 14, "numberFormat": "#,##0"},
      {"key": "source", "header": "Source", "width": 36}
    ],
    "rows": [{"item": "Example", "amount": 1000, "source": "quote.xlsx · Sheet1!D4"}],
    "formulas": [{"cell": "B4", "formula": "SUM(B3:B3)", "result": 1000, "numberFormat": "#,##0"}]
  }]
}
```

## Verify and stop

1. Re-open the output with `"$T5_DOCUMENT_CLI" inspect "ABSOLUTE_OUTPUT_XLSX"`.
2. Confirm required sheets, headers, typed numbers and dates, formulas and results, source cells, and projection completeness.
3. Reconcile row counts and key totals with every source. A clean command exit only proves the file was written and reopened, not that the business meaning is correct.
4. Report the output path, what was reconciled, and any unresolved conflicts. Stop rather than presenting a workbook as complete when required source pages, cells, OCR, formula results, or unit definitions remain unobserved.

## Create a DOCX result

1. Keep source files unchanged and write a bounded JSON spec with `title`, optional `paragraphs`, and actual row/column `tables`.
2. Run `"$T5_DOCUMENT_CLI" create-docx --spec "ABSOLUTE_SPEC_JSON" --output "ABSOLUTE_OUTPUT_DOCX"`.
3. The creator writes deterministic OOXML and immediately reopens text and table structure. This does not prove visual readability.
4. For a customer-facing current-Run DOCX, call attachment `inspect` with `attachmentId=null` and the exact output path. On qualified macOS this supplies a Quick Look page image and isolated no-answer visual transcript.
5. Register only the same visually checked output, then inspect the registered attachment by its exact ID before claiming completion.

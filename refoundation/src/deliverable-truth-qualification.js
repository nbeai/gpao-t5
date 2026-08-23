export const DOCX_REQUIRED_ANCHORS = Object.freeze([
  '상담 후속 조치', '2026-08-23', '매주 화요일 15:00', '최종 비용', '홍길동', '확인 필요',
]);

function normalized(value) { return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim(); }

export function assessDocxDeliverableTruth({
  turns = [], observation = null, previewHtml = '', renderedPages = [], visualTranscript = '',
  sourceSha256Before = null, sourceSha256After = null, outputRegistered = false, outputInspected = false,
  boundedCreatorUsed = false,
} = {}) {
  const text = normalized(observation?.text); const visual = normalized(visualTranscript);
  const visualDefect = /읽을 수 없(?:습니다|음)|누락(?:됨|되었습니다)|잘림(?:이|이 있습니다|발생)|겹침(?:이|이 있습니다|발생)|unreadable|missing glyphs?|clipped text|overlapping text/iu.test(visual);
  const tableCells = (observation?.structure?.tables ?? []).flatMap((table) => table.cells.flat())
    .map((cell) => normalized(cell.text));
  const final = turns.at(-1)?.answer ?? '';
  const checks = {
    allTurnsAnswered: turns.length === 3
      && turns.every((turn) => turn.runStatus === 'completed' && String(turn.answer ?? '').trim()),
    sourceUnchanged: sourceSha256Before != null && sourceSha256Before === sourceSha256After,
    outputObserved: observation?.kind === 'qualified_document' && observation?.format === 'docx'
      && observation?.state === 'observed',
    allAnchorsExtracted: DOCX_REQUIRED_ANCHORS.every((anchor) => text.includes(normalized(anchor))),
    structuredTablePresent: (observation?.structure?.tables?.length ?? 0) >= 1
      && ['구분', '내용', '상태'].every((anchor) => tableCells.includes(anchor)),
    previewContainsContent: DOCX_REQUIRED_ANCHORS.every((anchor) => normalized(previewHtml).includes(normalized(anchor))),
    exactlyOneRenderedPage: renderedPages.length === 1 && renderedPages[0]?.bytes > 0
      && renderedPages[0]?.width > 0 && renderedPages[0]?.height > 0,
    visualTranscriptVerified: DOCX_REQUIRED_ANCHORS.every((anchor) => visual.includes(normalized(anchor)))
      && !visualDefect,
    outputRegistered: outputRegistered === true,
    outputReopenedByModel: outputInspected === true,
    boundedCreatorUsed: boundedCreatorUsed === true,
    finalSeparatesDoneAndUnknown: /만들|생성|완료/u.test(final) && /다시|열어|재확인/u.test(final)
      && /최종 비용/u.test(final) && /(미정|확인 필요|미확인)/u.test(final),
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

export function assessDeliverableTruthSuite({
  documentEvidence, pdfEvidence, textEvidence, structureEvidence, docxRuns = [], brandControl = null,
} = {}) {
  const checks = {
    multiDocumentExcelPassed: documentEvidence?.passed === true,
    multiDocumentCounterfactualsPresent: documentEvidence?.multiDocumentReconciliation?.counterfactualTests?.length >= 5,
    koreanPdfPassedTwoModels: pdfEvidence?.passed === true
      && pdfEvidence.qualifiedRuns?.length >= 2 && pdfEvidence.qualifiedRuns.every((run) => run.passed && run.falseCompletion === false),
    workTimePositiveControl: textEvidence?.passed === true
      && textEvidence.liveRuns?.length >= 2 && textEvidence.liveRuns.every((run) => run.passed),
    structurePositiveControl: structureEvidence?.passed === true,
    docxPassedTwoModels: docxRuns.length === 2 && docxRuns.every((run) => run.verdict?.passed === true),
    brandWorkbookPositiveControl: brandControl?.rows === 3 && brandControl.uniqueSources === 3
      && brandControl.duplicateSources === 0 && brandControl.formulaErrors === 0,
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

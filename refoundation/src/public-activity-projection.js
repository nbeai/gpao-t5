const TOOL_EVENT = 'tool_completed';

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function length(value) {
  return Array.isArray(value) ? value.length : null;
}

function sum(values) {
  let total = 0;
  for (const value of values) {
    const exact = count(value);
    if (exact == null) return null;
    total += exact;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function occurredAt(event) {
  const text = String(event?.recordedAt ?? '');
  return Number.isFinite(Date.parse(text)) ? text : null;
}

function activity(kind, text, parts, event) {
  const projected = {
    schema: 't5.public-activity-fact.v1', kind, text,
    dedupeKey: [kind, ...parts].join(':'),
  };
  const at = occurredAt(event);
  if (at) projected.occurredAt = at;
  return projected;
}

function receiptFrom(input) {
  if (input?.type === TOOL_EVENT) return { event: input, receipt: input.payload?.receipt ?? null };
  if (input?.requestedCall && Object.hasOwn(input, 'outcome')) return { event: null, receipt: input };
  return { event: input, receipt: null };
}

function fileReality(receipt, event) {
  const action = receipt.requestedCall?.args?.action;
  const result = receipt.result ?? {};
  if (action === 'search' || action === 'image_candidates') {
    const primary = length(result.candidates); if (primary == null) return null;
    const recent = result.recentDocumentCandidates == null ? 0 : length(result.recentDocumentCandidates);
    const candidates = recent == null ? null : sum([primary, recent]); if (candidates == null) return null;
    const visited = count(result.coverage?.filesystemFilesVisited);
    const text = visited == null
      ? `관련 파일 후보 ${candidates}개를 찾았어요.`
      : `파일 ${visited}개를 확인해 관련 후보 ${candidates}개를 찾았어요.`;
    return activity('file_candidates_found', text, [visited ?? 'unknown', candidates], event);
  }
  if (action === 'inspect' && result.state === 'observed') {
    const chars = typeof result.content === 'string' ? result.content.length : null;
    const ocr = count(result.ocr?.observationCount);
    if (ocr != null) return activity('image_text_observed',
      `이미지에서 글자 단서 ${ocr}개를 확인했어요.`, [ocr], event);
    if (chars != null) return activity('file_content_observed',
      `선택한 파일에서 내용 ${chars}자를 확인했어요.`, [chars], event);
    return activity('file_observed', '선택한 파일 1개를 다시 확인했어요.', [1], event);
  }
  if (action === 'compare' && result.state === 'observed') {
    const files = length(result.files); const comparisons = length(result.comparisons);
    if (files == null || comparisons == null) return null;
    return activity('files_compared', `파일 ${files}개에서 비교 관계 ${comparisons}건을 확인했어요.`,
      [files, comparisons], event);
  }
  if (action === 'apply' && result.state === 'applied') {
    const moved = count(result.filesMoved); if (moved == null) return null;
    return activity('files_moved', `파일 ${moved}개를 옮긴 것을 확인했어요.`, [moved], event);
  }
  if (action === 'rollback' && result.state === 'rolled_back') {
    const restored = count(result.filesRestored); if (restored == null) return null;
    return activity('files_restored', `파일 ${restored}개를 원래 위치로 복원했어요.`, [restored], event);
  }
  return null;
}

function webSearch(receipt, event) {
  const candidates = length(receipt.result?.candidates);
  if (receipt.result?.state !== 'candidates' || candidates == null) return null;
  return activity('web_candidates_found', `웹에서 관련 자료 후보 ${candidates}개를 찾았어요.`,
    [candidates], event);
}

function webRead(receipt, event) {
  const result = receipt.result ?? {};
  if (!['read', 'partial_dynamic'].includes(result.state)) return null;
  const pages = count(result.source?.coverage?.pageCount);
  if (pages != null) return activity('web_document_read', `웹 문서 ${pages}쪽을 확인했어요.`, [pages], event);
  const chars = count(result.content?.totalChars)
    ?? (typeof result.content?.text === 'string' ? result.content.text.length : null);
  if (chars == null) return null;
  return activity('web_content_read', `웹 자료에서 내용 ${chars}자를 확인했어요.`, [chars], event);
}

function webResearch(receipt, event) {
  const result = receipt.result ?? {};
  const candidates = count(result.candidateCount);
  const readable = count(result.coverage?.readableSources);
  if (candidates == null || readable == null) return null;
  return activity('web_sources_read', `자료 후보 ${candidates}개 중 읽을 수 있는 자료 ${readable}개를 확인했어요.`,
    [candidates, readable], event);
}

function qualifiedRows(observation) {
  const direct = count(observation?.table?.rowCount) ?? count(observation?.coverage?.rowCount);
  if (direct != null) return direct;
  const sheets = observation?.workbook?.sheets ?? observation?.structure?.sheets;
  return Array.isArray(sheets) ? sum(sheets.map((sheet) => sheet?.rowCount)) : null;
}

function qualifiedColumns(observation) {
  const direct = count(observation?.table?.columnCount) ?? count(observation?.coverage?.columnCount);
  if (direct != null) return direct;
  const sheets = observation?.workbook?.sheets ?? observation?.structure?.sheets;
  if (!Array.isArray(sheets) || !sheets.length) return null;
  const values = sheets.map((sheet) => count(sheet?.columnCount));
  if (values.some((value) => value == null)) return null;
  return Math.max(...values);
}

function attachment(receipt, event) {
  const action = receipt.requestedCall?.args?.action;
  const result = receipt.result ?? {};
  if (action === 'list' && result.state === 'listed') {
    const files = length(result.attachments); if (files == null) return null;
    return activity('attachments_listed', `받은 파일 ${files}개를 확인했어요.`, [files], event);
  }
  if (action === 'search_document' && result.state === 'observed') {
    const observation = result.observation ?? {};
    const pages = count(observation.locallySearchedPages) ?? count(observation.totalPages);
    const candidates = length(observation.candidates);
    if (pages == null || candidates == null) return null;
    return activity('document_pages_searched', `문서 ${pages}쪽을 검색해 관련 후보 ${candidates}쪽을 찾았어요.`,
      [pages, candidates], event);
  }
  if (action === 'reopen_document_pages' && result.state === 'observed') {
    const pages = length(result.observation?.pages); if (pages == null) return null;
    return activity('document_pages_reopened', `선택한 문서 ${pages}쪽을 정확히 다시 열었어요.`, [pages], event);
  }
  if (action === 'extract_archive' && result.state === 'extracted') {
    const files = length(result.files); if (files == null) return null;
    return activity('archive_files_checked', `압축파일에서 안전한 파일 ${files}개를 확인했어요.`, [files], event);
  }
  if (action === 'inspect' && result.state === 'observed') {
    const observation = result.observation ?? {};
    const rows = qualifiedRows(observation); const columns = qualifiedColumns(observation);
    if (rows != null && columns != null) return activity('table_structure_observed',
      `표의 전체 ${rows}행과 ${columns}열 구조를 확인했어요.`, [rows, columns], event);
    const pages = count(observation.coverage?.totalPages) ?? count(observation.structure?.pageCount);
    if (pages != null) return activity('document_observed', `문서 ${pages}쪽의 구조를 확인했어요.`, [pages], event);
    const chars = typeof observation.text === 'string' ? observation.text.length : null;
    if (chars != null) return activity('attachment_content_observed',
      `첨부 파일에서 내용 ${chars}자를 확인했어요.`, [chars], event);
  }
  if (action === 'register_output' && result.state === 'registered') {
    const reconciliation = result.sourceReconciliation;
    const rows = count(reconciliation?.rowCount);
    const columns = length(reconciliation?.outputColumns);
    if (reconciliation?.state === 'verified' && rows != null && columns != null) {
      return activity('output_reconciled', `결과의 전체 ${rows}행과 ${columns}열을 원본과 다시 맞췄어요.`,
        [rows, columns], event);
    }
    if (result.artifact?.attachmentId) return activity('artifact_registered',
      '결과 파일 1개를 대화에 준비했어요.', [1], event);
  }
  return null;
}

function browser(receipt, event) {
  const action = receipt.requestedCall?.args?.action;
  const result = receipt.result ?? {};
  if (['navigate', 'snapshot', 'login_status'].includes(action) && result.state === 'observed') {
    const shown = count(result.observation?.shownChars);
    const controls = result.observation?.refs && typeof result.observation.refs === 'object'
      ? Object.keys(result.observation.refs).length : null;
    if (shown == null || controls == null) return null;
    return activity('browser_page_observed', `현재 화면에서 내용 ${shown}자와 조작 가능한 항목 ${controls}개를 확인했어요.`,
      [shown, controls], event);
  }
  if (['click', 'fill', 'fill_editable', 'submit', 'download', 'upload'].includes(action)
    && !['failed', 'blocked', 'unavailable', 'not_executed'].includes(result.state)) {
    return activity('browser_action_completed', '화면에서 요청한 동작 1단계를 마쳤어요.', [action], event);
  }
  return null;
}

function program(receipt, event) {
  const result = receipt.result ?? {};
  if (result.outputCoverage?.independentlyVerified !== true) return null;
  const outputs = count(result.outputCoverage.outputCount);
  if (outputs == null) return null;
  const outputRows = Array.isArray(result.outputs) && result.outputs.length === outputs
    ? result.outputs.map((output) => count(output.rows)) : [];
  const rows = outputRows.length === outputs && outputRows.every((value) => value != null)
    ? sum(outputRows) : null;
  const suffix = rows != null && rows > 0 ? ` 전체 ${rows}행도 확인했어요.` : '';
  return activity('program_outputs_verified', `프로그램 결과 ${outputs}개를 독립적으로 검증했어요.${suffix}`,
    [outputs, rows ?? 'unknown'], event);
}

function toolCompleted(receipt, event) {
  if (!receipt || receipt.outcome !== 'succeeded' || !receipt.actualCall
    || receipt.result?.effectUnknown === true) return null;
  const name = receipt.actualCall.name ?? receipt.requestedCall?.name;
  if (name === 'file_reality') return fileReality(receipt, event);
  if (name === 'web_search') return webSearch(receipt, event);
  if (name === 'web_read') return webRead(receipt, event);
  if (name === 'web_research') return webResearch(receipt, event);
  if (name === 'attachment') return attachment(receipt, event);
  if (name === 'browser') return browser(receipt, event);
  if (name === 'exec') return program(receipt, event);
  return null;
}

function runEvent(event) {
  if (event?.type === 'output_produced' && event.payload?.verified === true
    && event.payload?.reopened === true && count(event.payload?.bytes) != null) {
    return activity('verified_output_produced', '검증된 결과 파일 1개를 만들었어요.', [1], event);
  }
  if (event?.type === 'completion_verified' && event.verifiedOutcome === 'achieved') {
    return activity('completion_verified', '요청한 결과가 완료 기준과 맞는지 확인했어요.', [1], event);
  }
  if (event?.type === 'result_surface_persisted') {
    return activity('result_surface_persisted', '확인한 결과를 대화에 준비했어요.', [1], event);
  }
  if (event?.type === 'result_delivery_terminal'
    && ['persisted', 'sent', 'succeeded', 'not_requested'].includes(event.delivery?.state)) {
    return activity('result_delivery_verified', '결과 전달 상태를 확인했어요.', [event.delivery.state], event);
  }
  return null;
}

export function projectPublicActivityFact(input) {
  const { event, receipt } = receiptFrom(input);
  if (receipt) return toolCompleted(receipt, event);
  return runEvent(event);
}

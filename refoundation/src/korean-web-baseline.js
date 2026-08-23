function compact(value) {
  return String(value ?? '').replace(/[\s,원%]/gu, '').trim();
}

function normalizedDate(value) {
  const match = String(value ?? '').match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/u);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : compact(value);
}

function normalizedNumber(value) {
  const match = compact(value).match(/[-+]?\d+(?:\.\d+)?/u);
  if (!match) return compact(value);
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? String(numeric) : match[0];
}

function normalizedUrl(value) {
  const match = String(value ?? '').match(/https?:\/\/[^\s)>|]+/u);
  if (!match) return '';
  try {
    const url = new URL(match[0]);
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function normalizeCell(column, value) {
  if (/URL/u.test(column)) return normalizedUrl(value);
  if (/일$/u.test(column)) return normalizedDate(value);
  if (/(연도|시간급|환산액|금리|인상률|변동폭)/u.test(column)) return normalizedNumber(value);
  return compact(value);
}

export function extractMarkdownTables(text) {
  const lines = String(text ?? '').split(/\r?\n/u);
  const tables = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes('|') || !/^\s*\|?\s*:?-{3,}/u.test(lines[index + 1])) continue;
    const split = (line) => line.trim().replace(/^\||\|$/gu, '').split('|').map((cell) => cell.trim());
    const columns = split(lines[index]);
    const rows = [];
    index += 2;
    while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
      const cells = split(lines[index]);
      if (cells.length === columns.length) rows.push(Object.fromEntries(columns.map((column, at) => [column, cells[at]])));
      index += 1;
    }
    tables.push({ columns, rows });
    index -= 1;
  }
  return tables;
}

function f1(correct, predicted, expected) {
  const precision = predicted ? correct / predicted : expected ? 0 : 1;
  const recall = expected ? correct / expected : predicted ? 0 : 1;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
}

function columnFor(table, required) {
  const identity = (value) => compact(value).replace(/URL/giu, '');
  const exact = table.columns.find((column) => identity(column) === identity(required));
  if (exact) return exact;
  if (/공식출처/u.test(identity(required))) {
    return table.columns.find((column) => /공식출처/u.test(identity(column))) ?? null;
  }
  return null;
}

function equivalentCell(column, predicted, expected, gold) {
  if (!/URL/u.test(column)) return predicted === expected;
  try { return gold.sourceHosts.includes(new URL(predicted).hostname); }
  catch { return false; }
}

export function scoreClosedSetTable({ answer, task, gold }) {
  const required = task.requiredColumns;
  const candidates = extractMarkdownTables(answer).map((table) => ({
    table,
    mapping: Object.fromEntries(required.map((column) => [column, columnFor(table, column)])),
  }));
  const selected = candidates.sort((a, b) => (
    Object.values(b.mapping).filter(Boolean).length - Object.values(a.mapping).filter(Boolean).length
  ))[0] ?? { table: { columns: [], rows: [] }, mapping: {} };
  const key = gold.keyColumn;
  const predicted = selected.table.rows.map((row) => Object.fromEntries(required.map((column) => [
    column, selected.mapping[column] ? normalizeCell(column, row[selected.mapping[column]]) : '',
  ])));
  const expected = gold.rows.map((row) => Object.fromEntries(required.map((column) => [
    column, normalizeCell(column, row[column]),
  ])));
  const expectedByKey = new Map(expected.map((row) => [row[key], row]));
  const predictedByKey = new Map(predicted.filter((row) => row[key]).map((row) => [row[key], row]));
  const correctItems = [...predictedByKey.keys()].filter((value) => expectedByKey.has(value)).length;
  const item = f1(correctItems, predictedByKey.size, expectedByKey.size);
  const valueColumns = required.filter((column) => column !== key);
  let correctCells = 0;
  for (const [itemKey, expectedRow] of expectedByKey) {
    const predictedRow = predictedByKey.get(itemKey);
    if (!predictedRow) continue;
    for (const column of valueColumns) {
      if (equivalentCell(column, predictedRow[column], expectedRow[column], gold)) correctCells += 1;
    }
  }
  const cells = f1(correctCells, predictedByKey.size * valueColumns.length, expectedByKey.size * valueColumns.length);
  const correctRows = [...predictedByKey].filter(([itemKey, row]) => {
    const expectedRow = expectedByKey.get(itemKey);
    return expectedRow && required.every((column) => equivalentCell(column, row[column], expectedRow[column], gold));
  }).length;
  const rows = f1(correctRows, predictedByKey.size, expectedByKey.size);
  const sourceUrls = predicted.map((row) => row[required.find((column) => /URL/u.test(column))]).filter(Boolean);
  const officialSources = sourceUrls.filter((raw) => {
    try { return gold.sourceHosts.includes(new URL(raw).hostname); } catch { return false; }
  }).length;
  return {
    parsedTable: selected.table.columns.length > 0,
    mappedColumns: Object.values(selected.mapping).filter(Boolean).length,
    requiredColumns: required.length,
    predictedRows: predictedByKey.size,
    expectedRows: expectedByKey.size,
    item,
    cells,
    rows,
    sourceAuthority: f1(officialSources, sourceUrls.length, expectedByKey.size),
    exactPurposeComplete: rows.f1 === 1 && selected.table.columns.length > 0,
  };
}

export function summarizeWebRun(run) {
  const events = run?.events ?? [];
  const receipts = events.filter((event) => event.type === 'tool_completed').map((event) => event.payload.receipt);
  const usage = events.filter((event) => event.type === 'model_completed').reduce((total, event) => ({
    input: total.input + Number(event.payload?.response?.usage?.input_tokens ?? 0),
    output: total.output + Number(event.payload?.response?.usage?.output_tokens ?? 0),
    total: total.total + Number(event.payload?.response?.usage?.total_tokens ?? 0),
  }), { input: 0, output: 0, total: 0 });
  const urls = receipts.flatMap((receipt) => {
    if (receipt.requestedCall?.name === 'web_read') return [receipt.requestedCall.args?.url];
    if (receipt.requestedCall?.name === 'web_research') return (receipt.result?.sources ?? []).map((source) => source.candidateUrl);
    return [];
  }).filter(Boolean);
  return {
    modelTurns: events.filter((event) => event.type === 'model_completed').length,
    toolCalls: receipts.length,
    tools: receipts.map((receipt) => receipt.requestedCall?.name),
    usage,
    observedUrls: [...new Set(urls)],
    duplicateObservedUrls: urls.length - new Set(urls).size,
  };
}

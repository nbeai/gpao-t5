import test from 'node:test';
import assert from 'node:assert/strict';

import { extractMarkdownTables, scoreClosedSetTable, summarizeWebRun } from '../src/korean-web-baseline.js';

const task = {
  requiredColumns: ['적용 연도', '시간급', '월 환산액', '전년 대비 인상률', '공식 출처 URL'],
};
const gold = {
  keyColumn: '적용 연도', sourceHosts: ['official.example'], rows: [
    {'적용 연도':'2025', '시간급':'10030', '월 환산액':'2096270', '전년 대비 인상률':'1.7', '공식 출처 URL':'https://official.example/a'},
    {'적용 연도':'2026', '시간급':'10320', '월 환산액':'2156880', '전년 대비 인상률':'2.9', '공식 출처 URL':'https://official.example/b'},
  ],
};

test('extractMarkdownTables reads a normal Korean markdown table', () => {
  const tables = extractMarkdownTables('| 적용 연도 | 시간급 |\n|---|---|\n| 2026 | 10,320원 |');
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].rows, [{'적용 연도':'2026', '시간급':'10,320원'}]);
});

test('closed-set scoring requires every factual cell and official source in every row', () => {
  const answer = [
    '| 적용 연도 | 시간급 | 월 환산액 | 전년 대비 인상률 | 공식 출처 URL |',
    '|---|---:|---:|---:|---|',
    '| 2025 | 10,030원 | 2,096,270원 | 1.7% | https://official.example/a |',
    '| 2026 | 10,320원 | 2,156,880원 | 2.9% | https://official.example/b |',
  ].join('\n');
  const score = scoreClosedSetTable({ answer, task, gold });
  assert.equal(score.item.f1, 1);
  assert.equal(score.cells.f1, 1);
  assert.equal(score.rows.f1, 1);
  assert.equal(score.sourceAuthority.f1, 1);
  assert.equal(score.exactPurposeComplete, true);
});

test('removing one value preserves item discovery but fails row completion', () => {
  const answer = [
    '| 적용 연도 | 시간급 | 월 환산액 | 전년 대비 인상률 | 공식 출처 URL |',
    '|---|---:|---:|---:|---|',
    '| 2025 | 10,030원 | 2,096,270원 | 1.7% | https://official.example/a |',
    '| 2026 | 10,320원 |  | 2.9% | https://official.example/b |',
  ].join('\n');
  const score = scoreClosedSetTable({ answer, task, gold });
  assert.equal(score.item.f1, 1);
  assert.ok(score.cells.f1 < 1);
  assert.ok(score.rows.f1 < 1);
  assert.equal(score.exactPurposeComplete, false);
});

test('semantic source header and a different official page do not create a false failure', () => {
  const answer = [
    '| 적용 연도 | 시간급 | 월 환산액 | 전년 대비 인상률 | 값을 확인한 공식 출처 URL |',
    '|---|---:|---:|---:|---|',
    '| 2025 | 10,030원 | 2,096,270원 | 1.7% | [결정문](https://official.example/detail/2025) |',
    '| 2026 | 10,320원 | 2,156,880원 | 2.9% | [결정문](https://official.example/detail/2026) |',
  ].join('\n');
  const score = scoreClosedSetTable({ answer, task, gold });
  assert.equal(score.mappedColumns, 5);
  assert.equal(score.cells.f1, 1);
  assert.equal(score.rows.f1, 1);
  assert.equal(score.sourceAuthority.f1, 1);
  assert.equal(score.exactPurposeComplete, true);
});

test('run summary separates tool calls, model usage, and duplicate observations', () => {
  const run = { events: [
    {type:'model_completed', payload:{response:{usage:{input_tokens:10, output_tokens:2, total_tokens:12}}}},
    {type:'tool_completed', payload:{receipt:{requestedCall:{name:'web_read',args:{url:'https://a.example/'}}}}},
    {type:'tool_completed', payload:{receipt:{requestedCall:{name:'web_read',args:{url:'https://a.example/'}}}}},
  ]};
  assert.deepEqual(summarizeWebRun(run), {
    modelTurns: 1, toolCalls: 2, tools: ['web_read', 'web_read'],
    usage: {input:10, output:2, total:12}, observedUrls:['https://a.example/'], duplicateObservedUrls:1,
  });
});

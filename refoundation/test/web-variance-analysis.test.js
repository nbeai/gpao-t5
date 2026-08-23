import test from 'node:test';
import assert from 'node:assert/strict';

import { queryPlanAgreement, rankedCandidateAgreement } from '../src/web-variance-analysis.js';

test('ranked candidate agreement separates top result, set, and exact-order variance', () => {
  const score = rankedCandidateAgreement([
    { candidates: [{url:'https://a/'},{url:'https://b/'},{url:'https://c/'}] },
    { candidates: [{url:'https://a/'},{url:'https://c/'},{url:'https://b/'}] },
    { candidates: [{url:'https://d/'},{url:'https://a/'},{url:'https://b/'}] },
  ], 3);
  assert.equal(score.runs, 3);
  assert.equal(score.comparedPairs, 3);
  assert.equal(score.top1Agreement, 1 / 3);
  assert.ok(score.meanSetJaccard > score.meanExactRankOverlap);
  assert.equal(score.unionCandidateCount, 4);
});

test('query plan agreement normalizes spacing but does not hide different searches', () => {
  const score = queryPlanAgreement([
    {queries:['한국은행  기준금리', '2025 금리']},
    {queries:['한국은행 기준금리', '2025 금리']},
    {queries:['BOK rate', '2025 금리']},
  ]);
  assert.equal(score.plans, 3);
  assert.equal(score.exactPlanAgreement, 1 / 3);
  assert.equal(score.unionQueryCount, 3);
  assert.ok(score.meanQuerySetJaccard < 1);
});

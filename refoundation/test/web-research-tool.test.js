import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWebResearchTool } from '../src/web-research-tool.js';

test('여러 출처 연구는 검색 한 번 뒤 서로 다른 도메인을 병렬로 읽고 실패 범위를 보존한다', async () => {
  let active = 0; let peak = 0;
  const searchTool = { async execute() { return { state: 'candidates', provider: { id: 'fixture' }, candidates: [
    { rank: 1, title: 'A', url: 'https://a.example/1', snippet: 'a' },
    { rank: 2, title: 'A duplicate', url: 'https://a.example/2', snippet: 'a2' },
    { rank: 3, title: 'B', url: 'https://b.example/1', snippet: 'b' },
    { rank: 4, title: 'C', url: 'https://c.example/1', snippet: 'c' },
  ] }; } };
  const readTool = { async execute({ url }) {
    active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 15)); active -= 1;
    if (url.includes('c.example')) return { state: 'dynamic_required', source: { finalUrl: url }, content: null };
    return { state: 'read', source: { finalUrl: url }, content: { format: 'text', text: `read:${url}`, observedChars: 20, outputTruncated: false } };
  } };
  const result = await makeWebResearchTool({ searchTool, readTool }).execute({
    query: '시장 조사', queries: null, sourceLimit: 3, domains: null,
  });
  assert.equal(peak, 3);
  assert.equal(result.selectedCount, 3);
  assert.equal(result.readableCount, 2);
  assert.equal(result.stopFurtherResearch, false);
  assert.deepEqual(result.sources.map((source) => new URL(source.candidateUrl).hostname), [
    'a.example', 'b.example', 'c.example',
  ]);
  assert.equal(result.sources[2].state, 'dynamic_required');
});

test('넓은 연구의 여러 각도 검색은 한 모델 도구 호출 안에서 함께 실행된다', async () => {
  let active = 0; let peak = 0;
  const searchTool = { async execute({ query }) { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1;
      return { state: 'candidates', provider: { id: 'fixture' }, candidates: [{ rank: 1, title: query, url: `https://${query}.example/`, snippet: query }] }; } };
  const readTool = { async execute({ url }) { return { state: 'read', source: { finalUrl: url }, content: { format: 'text', text: url, observedChars: url.length, outputTruncated: false } }; } };
  const result = await makeWebResearchTool({ searchTool, readTool }).execute({
    query: '전체', queries: ['소비', '물가', '경기'], sourceLimit: 3, domains: null,
  });
  assert.equal(peak, 3); assert.deepEqual(result.queries, ['소비', '물가', '경기']); assert.equal(result.readableCount, 3);
  assert.equal(result.stopFurtherResearch, true);
  assert.equal(result.completedCapabilityGroups, undefined);
});

test('여러 검색 결과는 첫 질의로 채우지 않고 각 관점의 상위 후보를 번갈아 고른다', async () => {
  const searchTool = { async execute({ query }) { return { state: 'candidates', provider: { id: 'fixture' }, candidates: [1, 2, 3].map((rank) => ({
      rank, title: `${query}-${rank}`, url: `https://${query}${rank}.example/`, snippet: query,
    })) }; } };
  const readTool = { async execute({ url }) { return { state: 'read', source: { finalUrl: url }, content: { format: 'text', text: url, observedChars: url.length, outputTruncated: false } }; } };
  const result = await makeWebResearchTool({ searchTool, readTool }).execute({
    query: '전체', queries: ['소비', '물가', '경기'], sourceLimit: 3, domains: null,
  });
  assert.deepEqual(result.sources.map((source) => source.title), ['소비-1', '물가-1', '경기-1']);
});

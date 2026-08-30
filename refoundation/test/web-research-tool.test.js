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
  let active = 0; let peak = 0; const childIds = [];
  const searchTool = { async execute({ query }, context) { childIds.push(context.resourceChildId); active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1;
      return { state: 'candidates', provider: { id: 'fixture' }, candidates: [{ rank: 1, title: query, url: `https://${query}.example/`, snippet: query }] }; } };
  const readTool = { async execute({ url }) { return { state: 'read', source: { finalUrl: url }, content: { format: 'text', text: url, observedChars: url.length, outputTruncated: false } }; } };
  const result = await makeWebResearchTool({ searchTool, readTool }).execute({
    query: '전체', queries: ['소비', '물가', '경기'], sourceLimit: 3, domains: null,
  });
  assert.equal(peak, 3); assert.deepEqual(result.queries, ['소비', '물가', '경기']); assert.equal(result.readableCount, 3);
  assert.deepEqual(childIds.toSorted(), ['query-1', 'query-2', 'query-3']);
  assert.equal(result.stopFurtherResearch, true);
  assert.deepEqual(result.deactivatedTools, ['web_research', 'web_search']);
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

test('Reuters 전재 페이지는 관측 호스트와 본문 wire 주장을 분리하고 원문 URL을 발명하지 않는다', async () => {
  const republished = 'https://localnews.example/world/reuters-story';
  const searchTool = { async execute() { return { state: 'candidates', provider: { id: 'fixture' }, candidates: [
    { rank: 1, title: '재게시 기사', url: republished, snippet: 'Reuters 보도' },
  ] }; } };
  const readTool = { async execute() { return {
    state: 'read',
    source: {
      finalUrl: republished, canonicalUrl: republished,
      contentAttributionClaims: [{ kind: 'wire_origin', name: 'Reuters', basis: 'page_body' }],
    },
    content: { format: 'text', text: 'This report was supplied by Reuters.', observedChars: 36, outputTruncated: false },
  }; } };
  const result = await makeWebResearchTool({ searchTool, readTool }).execute({
    query: '전재 기사', queries: null, sourceLimit: 3, domains: null,
  });
  const provenance = result.sources[0].provenance;
  assert.equal(provenance.responsePublisher.host, 'localnews.example');
  assert.equal(provenance.canonicalPublisher.host, 'localnews.example');
  assert.deepEqual(provenance.contentAttribution.claims, [
    { kind: 'wire_origin', name: 'Reuters', basis: 'page_body' },
  ]);
  assert.equal(provenance.exactOriginalUrl, null);
  assert.equal(provenance.directOriginalLabelAllowed, false);
  assert.equal(provenance.verificationMissing, 'exact_original_url_not_observed');
});

test('읽기 subset 밖 검색 이미지와 OG 이미지를 selected preview metadata에 모두 보존한다', async () => {
  const candidates = [1, 2, 3, 4].map((rank) => ({
    rank, title: `S${rank}`, url: `https://s${rank}.example/article`, snippet: '',
    ...(rank <= 3 ? { previewImages: [{
      url: `https://images.example/${rank}.jpg`, provenance: 'search_provider_result', providerField: 'image_url',
    }] } : {}),
  }));
  const searchTool = { async execute() { return { state: 'candidates', provider: { id: 'fixture' }, candidates }; } };
  const readTool = { async execute({ url }) {
    const rank = Number(new URL(url).hostname[1]);
    if (rank === 1) return { state: 'read', source: {
      finalUrl: url, previewImageUrl: 'https://images.example/og.jpg',
    }, content: { format: 'text', text: 'readable', observedChars: 8, outputTruncated: false } };
    return { state: 'blocked', source: { finalUrl: url }, content: null };
  } };
  const result = await makeWebResearchTool({ searchTool, readTool }).execute({
    query: 'visual', queries: null, sourceLimit: 3, domains: null,
  });
  assert.equal(result.sources.length, 3);
  assert.equal(result.selectedPreviewMetadata.length, 4);
  assert.deepEqual(result.selectedPreviewMetadata.slice(0, 3).map((item) => item.images[0].url), [
    'https://images.example/1.jpg', 'https://images.example/2.jpg', 'https://images.example/3.jpg',
  ]);
  assert.equal(result.selectedPreviewMetadata[0].images[1].url, 'https://images.example/og.jpg');
});

test('검색 provider가 중단 신호를 무시해도 전체 연구 deadline에서 끝난다', async () => {
  const searchTool = { async execute() { return await new Promise(() => {}); } };
  const readTool = { async execute() { throw new Error('read must not start'); } };
  const startedAt = Date.now();
  const result = await makeWebResearchTool({ searchTool, readTool, timeoutMs: 20 }).execute({
    query: '서울 날씨', queries: ['서울 현재 날씨'], sourceLimit: 1, domains: null,
  });
  assert.equal(result.state, 'research_timeout');
  assert.equal(result.observedPageContent, false);
  assert.equal(result.stopFurtherResearch, true);
  assert.ok(Date.now() - startedAt < 250);
});

test('페이지 reader가 중단 신호를 무시해도 전체 연구 deadline에서 끝난다', async () => {
  const searchTool = { async execute() { return { state: 'candidates', provider: { id: 'fixture' }, candidates: [
    { rank: 1, title: '날씨', url: 'https://weather.example/current', snippet: '서울' },
  ] }; } };
  const readTool = { async execute() { return await new Promise(() => {}); } };
  const startedAt = Date.now();
  const result = await makeWebResearchTool({ searchTool, readTool, timeoutMs: 20 }).execute({
    query: '서울 날씨', queries: null, sourceLimit: 1, domains: null,
  });
  assert.equal(result.state, 'research_timeout');
  assert.equal(result.readableCount, 0);
  assert.equal(result.stopFurtherResearch, true);
  assert.ok(Date.now() - startedAt < 250);
});

test('검색 provider가 멈춰도 사용자 취소는 Tool deadline보다 먼저 terminal이 된다', async () => {
  const controller = new AbortController();
  const searchTool = { async execute() { return await new Promise(() => {}); } };
  const readTool = { async execute() { throw new Error('read must not start'); } };
  setTimeout(() => controller.abort(new Error('user cancelled')), 20);
  const startedAt = Date.now();
  const result = await makeWebResearchTool({ searchTool, readTool, timeoutMs: 1_000 }).execute({
    query: '서울 날씨', queries: null, sourceLimit: 1, domains: null,
  }, { signal: controller.signal });
  assert.equal(result.state, 'cancelled');
  assert.equal(result.stopFurtherResearch, true);
  assert.ok(Date.now() - startedAt < 250);
});

test('페이지 reader가 멈춰도 사용자 취소는 Tool을 즉시 terminal로 만든다', async () => {
  const controller = new AbortController();
  const searchTool = { async execute() { return { state: 'candidates', provider: { id: 'fixture' }, candidates: [
    { rank: 1, title: '날씨', url: 'https://weather.example/current', snippet: '서울' },
  ] }; } };
  const readTool = { async execute() { return await new Promise(() => {}); } };
  setTimeout(() => controller.abort(new Error('user cancelled')), 20);
  const result = await makeWebResearchTool({ searchTool, readTool, timeoutMs: 1_000 }).execute({
    query: '서울 날씨', queries: null, sourceLimit: 1, domains: null,
  }, { signal: controller.signal });
  assert.equal(result.state, 'cancelled');
  assert.equal(result.readableCount, 0);
});

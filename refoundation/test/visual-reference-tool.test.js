import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AttachmentStore } from '../src/attachment-store.js';
import { makeImageSearchTool } from '../src/image-search-tool.js';
import { makeVisualReferenceTool } from '../src/visual-reference-tool.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const QUERIES = [
  '미니멀 카페 브랜드 디자인', '윤동주 인물 사진', '무선 헤드폰 제품 사진', '서울 북촌 한옥마을',
  '편집 디자인 레이아웃', '마리 퀴리 인물 사진', '세라믹 찻잔 제품 사진', '부산 감천문화마을',
  '모바일 앱 UI 디자인', '제주 성산일출봉',
];

function imageResponse(bodyInput, { status = 200, headers = {} } = {}) {
  const body = Buffer.from(bodyInput); const normalized = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]),
  );
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get(name) { return normalized.get(String(name).toLowerCase()) ?? null; } },
    async arrayBuffer() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength); },
  };
}

function fixtureProvider() {
  let calls = 0;
  return {
    id: 'fixture-images', label: 'Fixture Images',
    async available() { return { available: true }; },
    async searchImages(query, { limit }) {
      calls += 1;
      return Array.from({ length: Math.min(4, limit) }, (_, index) => ({
        title: `${query} ${index + 1}`,
        imageUrl: `https://images.example/${calls}-${index + 1}.png`,
        contextUrl: `https://sources.example/${calls}/${index + 1}`,
        width: 1, height: 1, rights: 'fixture',
      }));
    },
    get calls() { return calls; },
  };
}

test('10개 디자인·인물·제품·한국 장소 query가 typed candidate→fetch→decode→attachment preview 3개를 만든다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qh4-visual-reference-'));
  try {
    const attachments = new AttachmentStore(join(room, 'attachments'));
    const provider = fixtureProvider();
    const imageSearchTool = makeImageSearchTool({ providers: [provider] });
    let serial = 0;
    const server = createServer((_request, response) => {
      serial += 1;
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(Buffer.concat([PNG, Buffer.from([serial])]));
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    try {
      const loopback = `http://127.0.0.1:${server.address().port}`;
      const fetchImpl = async (url) => new Promise((resolveResponse, rejectResponse) => {
        const request = get(`${loopback}${new URL(url).pathname}`, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.once('error', rejectResponse);
          response.once('end', () => {
            const body = Buffer.concat(chunks);
            resolveResponse(imageResponse(body, { status: response.statusCode, headers: response.headers }));
          });
        });
        request.once('error', rejectResponse);
      });
      const startedAt = performance.now();
      const results = [];
      for (const query of QUERIES) {
        const tool = makeVisualReferenceTool({
          imageSearchTool, attachments, sessionId: SESSION, fetchImpl,
          resolveHost: async () => ['93.184.216.34'],
        });
        results.push(await tool.execute({ query, limit: 3, domains: null }));
      }
      const wallMs = performance.now() - startedAt;
      assert.equal(provider.calls, 10); assert.ok(wallMs >= 0);
      for (const result of results) {
        assert.equal(result.state, 'previewed');
        assert.equal(result.coverage.requested, 3); assert.equal(result.coverage.previewed, 3);
        assert.equal(result.providerQualification.dedicated, 'available');
        assert.equal(result.verificationMissing, false); assert.equal(result.failures.length, 0);
        assert.equal(new Set(result.previews.map((row) => row.sha256)).size, 3);
        assert.ok(result.previews.every((row) => row.sourceUrl.startsWith('https://sources.example/')));
        assert.ok(result.previews.every((row) => row.imageSourceUrl.startsWith('https://images.example/')));
        assert.ok(result.previews.every((row) => row.previewUrl.includes('/attachments/')));
        assert.ok(result.previews.every((row) => row.width === 1 && row.height === 1));
        assert.ok(result.previews.every((row) => row.stages.map((stage) => stage.stage).join(',')
          === 'candidate,fetch,qualification,attachment'));
      }
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('자격 image provider가 없으면 0 preview와 함께 exact typed failure를 한 번 반환하고 route를 닫는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qh4-provider-absent-'));
  try {
    const attachments = new AttachmentStore(join(room, 'attachments'));
    const tool = makeVisualReferenceTool({
      imageSearchTool: makeImageSearchTool({ providers: [] }), attachments, sessionId: SESSION,
    });
    const result = await tool.execute({ query: '인테리어 이미지', limit: 3, domains: null });
    assert.equal(result.state, 'no_previews'); assert.equal(result.previews.length, 0);
    assert.equal(result.providerQualification.dedicated, 'unavailable');
    assert.equal(result.failures[0].failureCode, 'dedicated_image_provider_unavailable');
    assert.equal(result.failures[0].failedStage, 'candidate');
    assert.equal(result.stopFurtherResearch, true); assert.equal(result.verificationMissing, true);
    assert.deepEqual(result.deactivatedTools, [
      'visual_reference', 'web_research', 'web_search', 'web_read', 'browser',
    ]);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('OpenAI 같은 일반 search의 structured image fields는 보존하지만 존재를 가정하지 않는다', async () => {
  const provider = {
    id: 'structured', label: 'Structured Search', imageCandidateMode: 'structured_search_fields',
    async available() { return { available: true }; }, async search() { return []; },
  };
  const sourceSearchTool = { async execute() { return {
    state: 'candidates', candidates: [{ rank: 1, title: 'plain', url: 'https://source.example/page' }],
  }; } };
  const result = await makeImageSearchTool({ providers: [provider], sourceSearchTool }).execute({
    query: 'plain', limit: 3, domains: [],
  });
  assert.equal(result.state, 'unavailable'); assert.equal(result.candidates.length, 0);
  assert.equal(result.providerQualification.dedicated, 'unavailable');
  assert.equal(result.providerQualification.structuredImageFields, 'available_not_guaranteed');
  assert.equal(result.failures[0].code, 'provider_image_fields_absent');
});

test('magic MIME·decode·size·private address failure는 attachment 전에 typed된다', async () => {
  const cases = [
    { name: 'non-image', url: 'https://images.example/not-image', body: Buffer.from('not an image'),
      headers: { 'content-type': 'image/png' }, code: 'invalid_image_bytes', stage: 'qualification' },
    { name: 'undecodable', url: 'https://images.example/truncated.png', body: PNG.subarray(0, 20),
      headers: { 'content-type': 'image/png' }, code: 'image_decode_failed', stage: 'qualification' },
    { name: 'too-large', url: 'https://images.example/large.png', body: PNG,
      headers: { 'content-type': 'image/png', 'content-length': String(11 * 1024 * 1024) },
      code: 'image_too_large', stage: 'qualification' },
    { name: 'private', url: 'http://127.0.0.1/private.png', body: PNG,
      headers: { 'content-type': 'image/png' }, code: 'image_address_not_public', stage: 'fetch' },
  ];
  for (const fixture of cases) {
    const room = await mkdtemp(join(tmpdir(), `t5-qh4-${fixture.name}-`));
    try {
      const attachments = new AttachmentStore(join(room, 'attachments'));
      const imageSearchTool = { async execute() { return {
        state: 'candidates', query: fixture.name, candidates: [{
          title: fixture.name, imageUrl: fixture.url, contextUrl: 'https://source.example/page',
          provider: { id: 'fixture', tier: 'dedicated' },
        }], failures: [], calls: [], providerQualification: { dedicated: 'available' },
      }; } };
      const tool = makeVisualReferenceTool({
        imageSearchTool, attachments, sessionId: SESSION,
        resolveHost: async () => ['93.184.216.34'],
        fetchImpl: async () => imageResponse(fixture.body, { status: 200, headers: fixture.headers }),
      });
      const result = await tool.execute({ query: fixture.name, limit: 3, domains: null });
      assert.equal(result.previews.length, 0); assert.ok(result.failures.length > 0);
      assert.equal(result.failures[0].failureCode, fixture.code);
      assert.equal(result.failures[0].failedStage, fixture.stage);
      assert.equal((await attachments.list({ sessionId: SESSION })).length, 0);
    } finally { await rm(room, { recursive: true, force: true }); }
  }
});

test('같은 image bytes는 sha duplicate로 제외하고 다음 candidate로 requested 3을 채운다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qh4-sha-dedupe-'));
  try {
    const attachments = new AttachmentStore(join(room, 'attachments'));
    const imageSearchTool = { async execute() { return {
      state: 'candidates', query: 'duplicate', candidates: [1, 2, 3, 4].map((rank) => ({
        rank, title: `image ${rank}`, imageUrl: `https://images.example/${rank}.png`,
        contextUrl: `https://sources.example/${rank}`, provider: { id: 'fixture', tier: 'dedicated' },
      })), failures: [], calls: [], providerQualification: { dedicated: 'available' },
    }; } };
    let call = 0;
    const tool = makeVisualReferenceTool({
      imageSearchTool, attachments, sessionId: SESSION,
      resolveHost: async () => ['93.184.216.34'],
      fetchImpl: async () => {
        call += 1;
        const suffix = call === 2 ? 1 : call;
        return imageResponse(Buffer.concat([PNG, Buffer.from([suffix])]), { status: 200 });
      },
    });
    const result = await tool.execute({ query: 'duplicate', limit: 3, domains: null });
    assert.equal(result.previews.length, 3);
    assert.equal(new Set(result.previews.map((row) => row.sha256)).size, 3);
    assert.ok(result.failures.some((row) => row.failureCode === 'duplicate_image_sha'));
  } finally { await rm(room, { recursive: true, force: true }); }
});

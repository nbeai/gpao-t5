import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import { AttachmentStore } from '../src/attachment-store.js';
import { makeImageSearchTool } from '../src/image-search-tool.js';
import { makeVisualReferenceTool } from '../src/visual-reference-tool.js';
import { runAgent } from '../src/agent-loop.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const QUERIES = [
  '미니멀 카페 브랜드 디자인', '윤동주 인물 사진', '무선 헤드폰 제품 사진', '서울 북촌 한옥마을',
  '편집 디자인 레이아웃', '마리 퀴리 인물 사진', '세라믹 찻잔 제품 사진', '부산 감천문화마을',
  '모바일 앱 UI 디자인', '제주 성산일출봉',
];

test('실제 decoder는 refoundation production runtime에 exact dependency와 platform binary로 포함된다', async () => {
  const runtimePackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const installer = await readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8');
  assert.equal(runtimePackage.dependencies.sharp, '0.35.3');
  assert.match(installer, /npm', \['ci', '--omit=dev', '--omit=optional', '--ignore-scripts'\]/u);
  assert.match(installer, /@img\/sharp-darwin-arm64@0\.35\.3/u);
  assert.match(installer, /@img\/sharp-darwin-x64@0\.35\.3/u);
});

function imageResponse(bodyInput, { status = 200, headers = {} } = {}) {
  const body = Buffer.from(bodyInput); const normalized = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]),
  );
  let sent = false; let cancelled = false;
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get(name) { return normalized.get(String(name).toLowerCase()) ?? null; } },
    body: { getReader() { return {
      async read() { if (sent) return { done: true }; sent = true; return { done: false, value: body }; },
      async cancel() { cancelled = true; }, releaseLock() {},
    }; } },
    async arrayBuffer() { throw new Error('visual fetch must not use arrayBuffer'); },
    get cancelled() { return cancelled; },
  };
}

async function coloredPng(serial) {
  return sharp({ create: { width: 1, height: 1, channels: 4,
    background: { r: serial % 255, g: (serial * 7) % 255, b: (serial * 13) % 255, alpha: 1 } } })
    .png().toBuffer();
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
    const server = createServer(async (_request, response) => {
      serial += 1;
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
            response.end(await coloredPng(serial));
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
    assert.deepEqual(result.deactivatedTools, ['visual_reference']);
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
        return imageResponse(await coloredPng(suffix), { status: 200 });
      },
    });
    const result = await tool.execute({ query: 'duplicate', limit: 3, domains: null });
    assert.equal(result.previews.length, 3);
    assert.equal(new Set(result.previews.map((row) => row.sha256)).size, 3);
    assert.ok(result.failures.some((row) => row.failureCode === 'duplicate_image_sha'));
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('CRC와 압축 payload가 무효인 header-only PNG는 preview로 승격하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qh4-real-decode-'));
  try {
    const attachments = new AttachmentStore(join(room, 'attachments'));
    const chunk = (type, data) => { const output = Buffer.alloc(12 + data.length);
      output.writeUInt32BE(data.length, 0); output.write(type, 4, 4, 'ascii'); data.copy(output, 8); return output; };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
    const invalid = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
      chunk('IDAT', Buffer.from([0])), chunk('IEND', Buffer.alloc(0))]);
    const imageSearchTool = { async execute() { return { state: 'candidates', query: 'invalid',
      candidates: [1, 2, 3].map((rank) => ({ title: `invalid ${rank}`,
        imageUrl: `https://images.example/${rank}.png`, contextUrl: `https://source.example/${rank}`,
        provider: { id: 'fixture', tier: 'dedicated' } })), failures: [], calls: [],
      providerQualification: { dedicated: 'available' } }; } };
    const result = await makeVisualReferenceTool({ imageSearchTool, attachments, sessionId: SESSION,
      resolveHost: async () => ['93.184.216.34'], fetchImpl: async () => imageResponse(invalid) })
      .execute({ query: 'invalid', limit: 3, domains: null });
    assert.equal(result.state, 'no_previews'); assert.equal(result.previews.length, 0);
    assert.deepEqual(new Set(result.failures.map((row) => row.failureCode)), new Set(['image_decode_failed']));
    assert.equal((await attachments.list({ sessionId: SESSION })).length, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('header-only JPEG·GIF·WebP도 실제 pixel decode 없이는 preview로 승격하지 않는다', async () => {
  const invalids = [
    ['jpeg', Buffer.from('ffd8ffc00011080001000103011100021100031100ffd9', 'hex')],
    ['gif', Buffer.from('47494638396101000100800000000000ffffff3b', 'hex')],
    ['webp', Buffer.from('524946461600000057454250565038580a0000000000000000000000000000', 'hex')],
  ];
  for (const [label, invalid] of invalids) {
    const room = await mkdtemp(join(tmpdir(), `t5-qh4-real-decode-${label}-`));
    try {
      const attachments = new AttachmentStore(join(room, 'attachments'));
      const imageSearchTool = { async execute() { return { state: 'candidates', query: label,
        candidates: [{ title: label, imageUrl: `https://images.example/${label}`,
          contextUrl: `https://source.example/${label}`, provider: { id: 'fixture', tier: 'dedicated' } }],
        failures: [], calls: [], providerQualification: { dedicated: 'available' } }; } };
      const result = await makeVisualReferenceTool({ imageSearchTool, attachments, sessionId: SESSION,
        resolveHost: async () => ['93.184.216.34'], fetchImpl: async () => imageResponse(invalid) })
        .execute({ query: label, limit: 3, domains: null });
      assert.equal(result.previews.length, 0, label);
      assert.equal(result.failures[0].failureCode, 'image_decode_failed', label);
      assert.equal((await attachments.list({ sessionId: SESSION })).length, 0, label);
    } finally { await rm(room, { recursive: true, force: true }); }
  }
});

test('Content-Length 없는 과대 body도 10MB에서 reader를 취소하고 attachment 전에 멈춘다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qh4-stream-bound-'));
  try {
    const attachments = new AttachmentStore(join(room, 'attachments')); let cancelled = false; let reads = 0;
    const response = { status: 200, ok: true, headers: { get() { return null; } }, body: { getReader() { return {
      async read() { reads += 1; return reads <= 11
        ? { done: false, value: Buffer.alloc(1024 * 1024) } : { done: true }; },
      async cancel() { cancelled = true; }, releaseLock() {},
    }; } }, async arrayBuffer() { throw new Error('must not allocate the whole body'); } };
    const imageSearchTool = { async execute() { return { state: 'candidates', query: 'large', candidates: [{
      title: 'large', imageUrl: 'https://images.example/large.png', contextUrl: 'https://source.example/large',
      provider: { id: 'fixture', tier: 'dedicated' } }], failures: [], calls: [],
      providerQualification: { dedicated: 'available' } }; } };
    const result = await makeVisualReferenceTool({ imageSearchTool, attachments, sessionId: SESSION,
      resolveHost: async () => ['93.184.216.34'], fetchImpl: async () => response })
      .execute({ query: 'large', limit: 3, domains: null });
    assert.equal(cancelled, true); assert.equal(reads, 11);
    assert.equal(result.failures[0].failureCode, 'image_too_large');
    assert.equal((await attachments.list({ sessionId: SESSION })).length, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('visual lane의 성공·실패는 같은 요청의 factual web lane을 비활성화하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qh4-lane-separation-'));
  try {
    const attachments = new AttachmentStore(join(room, 'attachments'));
    const visual = makeVisualReferenceTool({ imageSearchTool: makeImageSearchTool({ providers: [] }),
      attachments, sessionId: SESSION });
    const read = { name: 'web_read', description: 'read one factual public URL',
      parameters: { type: 'object' }, async execute() { return { state: 'read' }; } };
    let turn = 0;
    const result = await runAgent({ request: '이미지와 사실 출처를 함께 찾아줘', tools: [visual, read], model: {
      async respond({ tools }) { turn += 1;
        if (turn === 1) return { text: '', toolCalls: [{ id: 'visual', name: 'visual_reference',
          args: { query: 'reference', limit: 3, domains: null } }] };
        assert.deepEqual(tools.map((tool) => tool.name), ['web_read']);
        return { text: '이미지는 없지만 사실 조사는 계속할 수 있어요.', toolCalls: [] };
      },
    } });
    assert.equal(result.answer, '이미지는 없지만 사실 조사는 계속할 수 있어요.');
  } finally { await rm(room, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';
import { AttachmentStore } from '../src/attachment-store.js';
import { deliverAutomationArtifacts } from '../src/automation-artifact-delivery.js';

const effect = { kind: 'local_change', targets: ['T5 자동화 원장'],
  confirmation: 'not_applicable', rollbackOfToolCallId: null };
function page(number) {
  return `<html><body>${[1, 2].map((item) => `<article class="item"><h3><a title="Book ${number}-${item}">Book</a></h3><p class="price">£${number}${item}</p></article>`).join('')}<li class="next"><a href="/page-${number + 1}">next</a></li></body></html>`;
}

test('자동 결과 전달이 surface crash 뒤 재개돼도 같은 bytes를 한 번만 materialize한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-artifact-delivery-'));
  const store = new AttachmentStore(join(room, 'attachments'));
  const sourceSessionId = randomUUID(); const destinationSessionId = randomUUID();
  const source = await store.receive({ sessionId: sourceSessionId, originalName: 'result.xlsx',
    bytes: Buffer.from('exact-result-bytes'), direction: 'output' });
  const input = { attachmentStore: store, sourceSessionId, destinationSessionId,
    sourceArtifacts: [source], jobId: randomUUID(), automationRunId: randomUUID(),
    sourceRunId: randomUUID() };
  try {
    const first = await deliverAutomationArtifacts(input);
    const recovered = await deliverAutomationArtifacts(input);
    assert.equal(first[0].attachmentId, recovered[0].attachmentId);
    assert.equal(first[0].sha256, source.sha256);
    assert.equal((await store.list({ sessionId: destinationSessionId })).length, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('반복 Web 수집은 기존 Automation이 매 실행 새 structure를 관측해 origin Session에 XLSX를 전달한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-web-collection-automation-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let executionCalls = 0; let networkCalls = 0; const errors = [];
  const server = makeConsoleServer({ stateDir, workspace,
    onError: (error) => errors.push(error),
    webReadOptions: { resolveHost: async () => ['93.184.216.34'], fetchImpl: async (url) => {
      networkCalls += 1; const number = Number(String(url).match(/page-(\d+)/u)?.[1] ?? 1);
      return new Response(page(number), { status: 200, headers: { 'content-type': 'text/html' } });
    } },
    modelFactory: () => ({ async respond({ messages, tools }) {
      const automationExecution = tools.some((tool) => tool.name === 'automation_outcome')
        || messages.some((message) => String(message.content).includes('T5 CURRENT SCHEDULED EXECUTION'));
      const last = messages.at(-1);
      if (!automationExecution) {
        if (last.role === 'tool') return { text: '매일 공개 카탈로그를 확인해 결과 파일을 만들도록 예약했어요.', toolCalls: [] };
        return { text: '', toolCalls: [{ id: 'create-web-job', name: 'automation', args: {
          action: 'create', jobId: null, name: '공개 카탈로그 수집',
          prompt: 'https://catalog.example/page-1 에서 시작해 첫 두 페이지의 title과 price를 수집하고 catalog.xlsx로 만들어줘.',
          scheduleKind: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Seoul',
          requiredTools: ['web_read', 'web_collection'], requiredEffect: null,
          requireResultUrl: false, delivery: 'origin_session', preparationToolCallIds: [],
          delegatedTool: null, delegatedEffect: null, effect,
        } }] };
      }
      executionCalls += 1;
      if (last.role !== 'tool') return { text: '', toolCalls: [{ id: 'scheduled-read', name: 'web_read', args: {
        url: 'https://catalog.example/page-1', maxChars: 5_000, visibleBrowser: 'never',
      } }] };
      const receipt = JSON.parse(last.content);
      if (receipt.requestedCall.name === 'web_read') return { text: '', toolCalls: [{
        id: 'scheduled-collect', name: 'web_collection', args: {
          action: 'collect', url: null,
          structureHandle: receipt.result.collectionAffordance.structureHandle,
          urls: ['https://catalog.example/page-1', 'https://catalog.example/page-2'],
          itemSelector: 'article.item', fields: [
            { key: 'title', selector: 'h3 a', source: 'attribute', attribute: 'title', required: true },
            { key: 'price', selector: 'p.price', source: 'text', attribute: null, required: true },
          ], uniqueBy: ['title'], expectedMinimum: 4, expectedMaximum: 4,
          outputForm: 'xlsx', outputName: 'catalog.xlsx',
        },
      }] };
      if (receipt.requestedCall.name === 'web_collection') return { text: '', toolCalls: [{
        id: 'scheduled-outcome', name: 'automation_outcome', args: {
          status: 'achieved', summary: '현재 구조에서 네 항목을 수집해 Excel 결과를 만들었습니다.',
          remaining: null, evidenceToolCallIds: ['scheduled-read', receipt.toolCallId], resultUrls: [],
        },
      }] };
      return { text: '자동 수집 결과를 만들었어요.', toolCalls: [] };
    } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  await server.startAutomations(); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const created = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '매일 오전 9시에 공개 카탈로그를 수집해 Excel로 줘.' }) }).then((response) => response.json());
    assert.match(created.reply, /예약했어요/u);
    let state = await fetch(`${base}/automation`).then((response) => response.json());
    const internalJob = (await server.automationStore.list()).jobs[0];
    assert.deepEqual(internalJob.requirements.requiredTools, ['web_read', 'web_collection']);
    await fetch(`${base}/automation/run`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: state.jobs[0].id }) });
    for (let attempt = 0; attempt < 300; attempt += 1) {
      state = await fetch(`${base}/automation`).then((response) => response.json());
      if (state.runs[0]?.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(state.runs[0].status, 'succeeded', JSON.stringify({ run: state.runs[0],
      attachments: (await server.attachmentStore.list({ sessionId: session.id })).map((item) => ({
        name: item.originalName, direction: item.direction, providerIdentity: item.providerIdentity,
      })), transcript: (await server.sessionStore.load(session.id)).transcript,
      errors: errors.map((error) => ({ message: error?.message, stack: error?.stack })) })); assert.equal(networkCalls, 3);
    assert.equal(executionCalls, 4);
    const origin = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    const result = origin.transcript.findLast((entry) => entry.result?.artifacts?.some(
      (artifact) => artifact.originalName === 'catalog.xlsx'))?.result;
    assert.ok(result, JSON.stringify(origin.transcript));
    assert.equal(result.artifacts[0].originalName, 'catalog.xlsx');
    assert.equal(result.artifacts[0].humanReceipt.title, '새 결과 파일을 준비했어요.');
    assert.equal(result.artifacts[0].humanReceipt.delivery, '전달을 마쳤어요.');
    const download = await fetch(`${base}${result.artifacts[0].downloadUrl}`);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(download.status, 200); assert.equal(bytes.length, result.artifacts[0].bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), result.artifacts[0].sha256);
    assert.equal((await fetch(`${base}${result.artifacts[0].previewUrl}`)).status, 200);
  } finally {
    await server.closeAutomations(); server.closeWakeStreams(); await server.closeMessengers(); await server.closeBrowsers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

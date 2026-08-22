import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';

import { makeConsoleServer } from '../src/console-server.js';

function png(width = 3, height = 2) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function fixtureServer(modelFactory) {
  const room = await mkdtemp(join(tmpdir(), 't5-attachment-console-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const server = makeConsoleServer({
    stateDir, workspace, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'attachment-model' }),
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return {
    room, stateDir, workspace, server,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeWakeStreams();
      await server.managedProcesses.stopAll('test_shutdown');
      await new Promise((resolveClose) => server.close(resolveClose));
      await rm(room, { recursive: true, force: true });
    },
  };
}

async function newSession(base) {
  return fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
}

async function upload(base, sessionId, filename, type, bytes) {
  const response = await fetch(`${base}/attachments?sessionId=${sessionId}&filename=${encodeURIComponent(filename)}`, {
    method: 'POST', headers: { 'content-type': type }, body: bytes,
  });
  return { status: response.status, body: await response.json() };
}

test('콘솔 첨부는 raw upload→managed identity→현재 Run inspect→Conversation 연결을 관통한다', async () => {
  let turn = 0;
  const app = await fixtureServer(() => ({ async respond(input) {
    turn += 1;
    const attachment = input.tools.find((tool) => tool.name === 'attachment');
    assert.ok(attachment);
    if (turn === 1) {
      assert.match(input.messages.at(-1).content, /ATTACHMENTS.*payroll\.txt/is);
      return { text: '', toolCalls: [{ id: 'inspect-attachment', name: 'attachment', args: {
        action: 'inspect', attachmentId: input.messages.at(-1).content.match(/attachmentId=([0-9a-f-]+)/i)[1],
        filePath: null, maxChars: 1000, maxCells: null, maxPages: null,
      } }] };
    }
    const receipt = JSON.parse(input.messages.at(-1).content);
    assert.equal(receipt.result.trust, 'untrusted_external');
    assert.match(receipt.result.observation.text, /PAYROLL-7391/);
    return { text: '급여 자료의 PAYROLL-7391을 확인했습니다.', toolCalls: [] };
  } }));
  try {
    const session = await newSession(app.base);
    const uploaded = await upload(app.base, session.id, 'payroll.txt', 'text/plain', Buffer.from('PAYROLL-7391'));
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.kind, 'text');
    const denied = await fetch(`${app.base}${uploaded.body.downloadUrl.replace(session.id, '44444444-4444-4444-8444-444444444444')}`);
    assert.equal(denied.status, 404);
    const downloaded = await fetch(`${app.base}${uploaded.body.downloadUrl}`);
    assert.equal(await downloaded.text(), 'PAYROLL-7391');

    const reply = await fetch(`${app.base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id, text: '첨부한 급여 자료를 확인해줘.',
        attachmentIds: [uploaded.body.attachmentId],
      }),
    }).then((response) => response.json());
    assert.match(reply.reply, /PAYROLL-7391/);
    const run = await fetch(`${app.base}/runs/${reply.runId}`).then((response) => response.json());
    assert.equal(run.events.filter((event) => event.type === 'attachments_linked').length, 1);
    const restored = await fetch(`${app.base}/sessions/${session.id}`).then((response) => response.json());
    assert.equal(restored.transcript[0].attachments[0].attachmentId, uploaded.body.attachmentId);
  } finally { await app.close(); }
});

test('현재 이미지 첨부만 모델 input_image로 전달되고 과거 transcript에는 base64가 남지 않는다', async () => {
  const app = await fixtureServer(() => ({ async respond(input) {
    const current = input.messages.at(-1);
    assert.equal(current.modelAttachments.length, 1);
    assert.match(current.modelAttachments[0].image_url, /^data:image\/png;base64,/);
    return { text: '가로 8, 세로 6 이미지가 첨부됐습니다.', toolCalls: [] };
  } }));
  try {
    const session = await newSession(app.base);
    const uploaded = await upload(app.base, session.id, 'photo.png', 'text/plain', png(8, 6));
    const reply = await fetch(`${app.base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '이미지를 확인해줘.', attachmentIds: [uploaded.body.attachmentId] }),
    }).then((response) => response.json());
    assert.match(reply.reply, /8.*6/);
    const conversation = await app.server.conversationLedger.read(session.id);
    assert.doesNotMatch(JSON.stringify(conversation), /data:image|aW1hZ2U/);
    assert.equal(conversation.entries[0].message.attachments[0].kind, 'image');
  } finally { await app.close(); }
});

test('모델이 만든 workspace 결과는 attachment register 뒤 surface 다운로드 artifact가 된다', async () => {
  let turn = 0;
  let outputPath;
  const app = await fixtureServer(() => ({ async respond(input) {
    turn += 1;
    if (turn === 1) {
      outputPath = join(app.workspace, 'result.txt');
      return { text: '', toolCalls: [{ id: 'make-output', name: 'exec', args: {
        command: `printf 'RESULT-8842' > '${outputPath}'`, cwd: null,
        effect: { kind: 'local_change', summary: '결과 파일 생성', targets: [outputPath], reversible: true, backupAvailable: false, recipientNew: false, approvalToken: null },
      } }] };
    }
    if (turn === 2) return { text: '', toolCalls: [{ id: 'find-output-tool', name: 'tool_search', args: {
      query: 'register created result file for user preview and download',
    } }] };
    if (turn === 3) return { text: '', toolCalls: [{ id: 'register-output', name: 'attachment', args: {
      action: 'register_output', attachmentId: null, filePath: outputPath,
      maxChars: null, maxCells: null, maxPages: null,
    } }] };
    const receipt = JSON.parse(input.messages.at(-1).content);
    assert.equal(receipt.result.state, 'registered');
    return { text: '결과 파일을 만들었습니다.', toolCalls: [] };
  } }));
  try {
    const session = await newSession(app.base);
    const reply = await fetch(`${app.base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '결과 텍스트 파일을 만들어줘.' }),
    }).then((response) => response.json());
    assert.ok(reply.artifacts, JSON.stringify(reply));
    assert.equal(reply.artifacts.length, 1);
    assert.equal(reply.artifacts[0].originalName, 'result.txt');
    assert.equal(await fetch(`${app.base}${reply.artifacts[0].downloadUrl}`).then((response) => response.text()), 'RESULT-8842');
    const restored = await fetch(`${app.base}/sessions/${session.id}`).then((response) => response.json());
    assert.equal(restored.transcript[1].result.artifacts[0].attachmentId, reply.artifacts[0].attachmentId);
  } finally { await app.close(); }
});

test('HTML과 여러 파일 웹앱 preview는 Session 권한·CSP·원문/manifest 경계를 관통한다', async () => {
  const app = await fixtureServer(() => ({ async respond() {
    return { text: '결과물을 확인했습니다.', toolCalls: [] };
  } }));
  try {
    const session = await newSession(app.base);
    const html = await upload(app.base, session.id, '시안.html', 'text/html', Buffer.from(
      '<!doctype html><h1>말의 힘</h1><script>document.body.dataset.ready="yes"</script>',
    ));
    assert.equal(html.status, 201);
    assert.equal(html.body.previewKind, 'web');
    const preview = await fetch(`${app.base}${html.body.previewUrl}`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-security-policy'), /connect-src 'none'/);
    const previewHtml = await preview.text();
    assert.match(previewHtml, /말의 힘/);
    assert.match(previewHtml, /t5-artifact-log/);
    assert.match(await fetch(`${app.base}${html.body.sourceUrl}`).then((response) => response.text()), /<h1>/);
    const denied = await fetch(`${app.base}${html.body.previewUrl.replace(session.id, '44444444-4444-4444-8444-444444444444')}`);
    assert.equal(denied.status, 404);

    const bundleBytes = Buffer.from(zipSync({
      'index.html': strToU8('<!doctype html><h1>React build</h1><script src="assets/app.js"></script>'),
      'assets/app.js': strToU8('document.body.dataset.app="ready"'),
    }));
    const bundle = await upload(app.base, session.id, 'app.zip', 'application/zip', bundleBytes);
    assert.equal(bundle.body.previewKind, 'web_app');
    const index = await fetch(`${app.base}${bundle.body.previewUrl}`);
    assert.equal(index.headers.get('cross-origin-resource-policy'), 'cross-origin');
    const indexHtml = await index.text();
    assert.match(indexHtml, /React build/);
    assert.match(indexHtml, /t5-artifact-log/);
    const assetUrl = bundle.body.previewUrl.replace('index.html', 'assets/app.js');
    assert.match(await fetch(`${app.base}${assetUrl}`).then((response) => response.text()), /dataset\.app/);
    const sourceAsset = await fetch(`${app.base}${assetUrl}?source=1`);
    assert.match(sourceAsset.headers.get('content-type'), /^text\/plain/);
    assert.match(await sourceAsset.text(), /dataset\.app/);
    const manifest = await fetch(`${app.base}${bundle.body.sourceUrl}`).then((response) => response.json());
    assert.deepEqual(manifest.files.map((file) => file.path), ['assets/app.js', 'index.html']);
  } finally { await app.close(); }
});

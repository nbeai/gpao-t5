import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { strToU8, zipSync } from 'fflate';

import { makeConsoleServer } from '../src/console-server.js';
import { createGeneratedCompatibilityFixtures } from '../src/document-compatibility-baseline.js';

function png(width = 3, height = 2) {
  const crc = (input) => {
    let value = 0xffffffff;
    for (const byte of input) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const name = Buffer.from(type); const output = Buffer.alloc(data.length + 12);
    output.writeUInt32BE(data.length); name.copy(output, 4); data.copy(output, 8);
    output.writeUInt32BE(crc(Buffer.concat([name, data])), data.length + 8); return output;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(height * (1 + width * 3)))), chunk('IEND', Buffer.alloc(0))]);
}

async function fixtureServer(modelFactory, options = {}) {
  const room = await mkdtemp(join(tmpdir(), 't5-attachment-console-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const server = makeConsoleServer({
    stateDir, workspace, modelFactory,
    ...options,
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
    assert.equal(input.tools.some((tool) => tool.name === 'work_completion'), false);
    const receipt = JSON.parse(input.messages.at(-1).content);
    assert.equal(receipt.result.trust, 'untrusted_external');
    assert.match(receipt.result.observation.text, /PAYROLL-7391/);
    return { text: '급여 자료의 PAYROLL-7391을 확인했습니다.', toolCalls: [] };
  } }), { capabilitySurfaceMode: 'directory-first-v1' });
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
    assert.equal(turn, 2);
    const run = await fetch(`${app.base}/runs/${reply.runId}`).then((response) => response.json());
    assert.equal(run.events.filter((event) => event.type === 'attachments_linked').length, 1);
    const restored = await fetch(`${app.base}/sessions/${session.id}`).then((response) => response.json());
    assert.equal(restored.transcript[0].attachments[0].attachmentId, uploaded.body.attachmentId);
  } finally { await app.close(); }
});

test('exact audio/video 첨부에서는 Auditory Hand가 첫 모델 응답에만 자연스럽게 열린다', async () => {
  const seen = [];
  const auditoryTranscriptionSpine = {
    start: async () => ({ state: 'running', operationId: 'unused' }),
    poll: async () => ({ state: 'running', operationId: 'unused' }),
    stop: async () => ({ state: 'cancelled', operationId: 'unused' }),
  };
  const app = await fixtureServer(() => ({ async respond(input) {
    seen.push(input.tools.map((tool) => tool.name));
    return { text: '현재 첨부 종류를 확인했습니다.', toolCalls: [] };
  } }), {
    capabilitySurfaceMode: 'directory-first-v1', auditoryTranscriptionSpine,
    auditoryScratchRoot: join(tmpdir(), 't5-auditory-surface-unused'),
  });
  try {
    const session = await newSession(app.base);
    const wav = Buffer.alloc(64); wav.write('RIFF', 0); wav.write('WAVE', 8);
    const audio = await upload(app.base, session.id, 'meeting.wav', 'audio/wav', wav);
    assert.equal(audio.status, 201);
    const audioTurn = await fetch(`${app.base}/turn`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        sessionId: session.id, text: '이 음성을 확인해줘.',
        attachmentIds: [audio.body.attachmentId],
      }) });
    assert.equal(audioTurn.status, 200);
    assert.equal(seen[0].includes('auditory'), true);

    const second = await newSession(app.base);
    const textFile = await upload(app.base, second.id, 'notes.txt', 'text/plain', Buffer.from('hello'));
    assert.equal(textFile.status, 201);
    const textTurn = await fetch(`${app.base}/turn`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        sessionId: second.id, text: '이 문서를 확인해줘.',
        attachmentIds: [textFile.body.attachmentId],
      }) });
    assert.equal(textTurn.status, 200);
    assert.equal(seen[1].includes('auditory'), false);
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

test('Telegram incident의 손상 PNG는 자동 주입하지 않고 XLSX·DOCX·PDF 세 문서는 같은 Turn에서 읽는다', async () => {
  let modelTurn = 0;
  const app = await fixtureServer(() => ({ async respond(input) {
    modelTurn += 1;
    if (modelTurn === 1) {
      const current = input.messages.at(-1);
      assert.deepEqual(current.modelAttachments ?? [], []);
      const records = [...current.content.matchAll(/attachmentId=([0-9a-f-]+).*?name="([^"]+)"/gu)];
      assert.equal(records.length, 4);
      const attachment = input.tools.find((tool) => tool.name === 'attachment');
      assert.ok(attachment);
      return { text: '', toolCalls: records.filter((match) => /\.(?:xlsx|docx|pdf)$/u.test(match[2]))
        .map((match, index) => ({ id: `inspect-${index}`, name: 'attachment', args: {
          action: 'inspect', attachmentId: match[1], filePath: null,
          maxChars: 4_000, maxCells: 2_000, maxPages: 10,
        } })) };
    }
    const receipts = input.messages.filter((message) => message.role === 'tool').map((message) => message.content);
    assert.equal(receipts.length, 3);
    assert.ok(receipts.map(JSON.parse).every((receipt) => receipt.result?.state === 'observed'));
    assert.match(receipts.join('\n'), /40300/u);
    return { text: '엑셀·워드·PDF 세 파일을 모두 읽었고 손상 이미지는 내용 확인 대상으로 남겼어요.', toolCalls: [] };
  } }));
  try {
    const session = await newSession(app.base);
    const fixtures = await createGeneratedCompatibilityFixtures(join(app.room, 'documents'));
    const wanted = fixtures.filter((item) => ['modern-xlsx', 'modern-docx', 'text-pdf'].includes(item.caseId));
    const uploaded = [];
    for (const item of wanted) uploaded.push((await upload(app.base, session.id,
      item.fileName, 'application/octet-stream', await readFile(item.path))).body);
    const invalidPng = Buffer.from(
      '89504e470d0a1a0a0000000d4948445200000040000000400802000000250be6890000000b4944415478daedcf010d0000080320d73ff4ade11c5420135bce39b95c2e974be572b95c2e97cbe572b95c2e97cbe572b95c2e97cbe572b95c2e97cbe572b95c2ed76b0104dcdcbdbe0000000049454e44ae426082',
      'hex',
    );
    uploaded.push((await upload(app.base, session.id, '브랜드_색상.png', 'image/png', invalidPng)).body);
    const response = await fetch(`${app.base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '이 네 파일을 각각 실제로 읽고 핵심을 한 답으로 정리해줘.',
        attachmentIds: uploaded.map((item) => item.attachmentId) }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.match(payload.reply, /세 파일을 모두 읽었/u);
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
    const human = restored.transcript[1].result.artifacts[0].humanReceipt;
    assert.match(human.title, /새 결과 파일/u);
    assert.match(human.verification, /다시 확인/u);
    assert.doesNotMatch(JSON.stringify(human), /attachmentId|runId|sha256|\/workspace|[a-f0-9]{64}/u);
    assert.equal(restored.transcript[1].result.humanEffects, undefined,
      'Artifact의 출처·검증·전달 영수증이 같은 파일 변경 영수증을 대신한다');
  } finally { await app.close(); }
});

test('exec가 workspace 상대 target으로 만든 결과도 같은 Run의 exact output으로 등록한다', async () => {
  let turn = 0;
  let outputPath;
  let registrationReceipt;
  const app = await fixtureServer(() => ({ async respond(input) {
    turn += 1;
    if (turn === 1) {
      outputPath = join(app.workspace, 'nested', 'result-relative.txt');
      return { text: '', toolCalls: [{ id: 'make-relative-output', name: 'exec', args: {
        command: `mkdir -p '${join(app.workspace, 'nested')}' && printf 'RELATIVE-8842' > '${outputPath}'`,
        cwd: null,
        effect: {
          kind: 'local_change', summary: '상대경로 결과 파일 생성',
          targets: ['nested/result-relative.txt'], reversible: true,
          backupAvailable: false, recipientNew: false, approvalToken: null,
        },
      } }] };
    }
    if (turn === 2) {
      const outputHandle = input.runtimeContext.match(/"outputHandle":"([0-9a-f-]{36})"/iu)?.[1];
      assert.ok(outputHandle, input.runtimeContext);
      return { text: '', toolCalls: [{ id: 'register-relative-output', name: 'attachment', args: {
        action: 'register_output', attachmentId: null, filePath: null,
        maxChars: null, maxCells: null, maxPages: null,
        outputName: null, resultRelativePath: null, expectedResultJson: null,
        expectedStdoutIncludes: null, operationHandle: null, outputHandle,
      } }] };
    }
    registrationReceipt = JSON.parse(input.messages.at(-1).content);
    return { text: '상대경로 결과 파일을 만들었습니다.', toolCalls: [] };
  } }));
  try {
    const session = await newSession(app.base);
    const response = await fetch(`${app.base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: 'nested 폴더에 결과 파일을 만들어줘.' }),
    });
    const reply = await response.json();
    assert.equal(registrationReceipt?.result?.state, 'registered', JSON.stringify(registrationReceipt));
    assert.equal(response.status, 200, JSON.stringify(reply));
    assert.equal(reply.artifacts?.[0]?.originalName, 'result-relative.txt', JSON.stringify(reply));
    assert.equal(await fetch(`${app.base}${reply.artifacts[0].downloadUrl}`).then((item) => item.text()),
      'RELATIVE-8842');
  } finally { await app.close(); }
});

test('생성 뒤 Run 실패는 200 unresolved로 handle을 보존하고 다음 턴이 재생성 없이 등록한다', async () => {
  let modelTurn = 0;
  let createCalls = 0;
  let outputPath;
  const app = await fixtureServer(() => ({ async respond(input) {
    modelTurn += 1;
    if (modelTurn === 1) {
      outputPath = join(app.workspace, 'recoverable-result.txt');
      createCalls += 1;
      return { text: '', toolCalls: [{ id: 'create-before-failure', name: 'exec', args: {
        command: `printf 'RECOVERABLE-9901' > '${outputPath}'`, cwd: null,
        effect: {
          kind: 'local_change', summary: '복구할 결과 생성',
          targets: ['recoverable-result.txt'], reversible: true,
          backupAvailable: false, recipientNew: false, approvalToken: null,
        },
      } }] };
    }
    if (modelTurn === 2) throw new Error('fixture model failed after producing output');
    if (modelTurn === 3) {
      assert.match(input.runtimeContext, /pendingOutputs=/u);
      const outputHandle = input.runtimeContext.match(/"outputHandle":"([0-9a-f-]{36})"/iu)?.[1];
      assert.ok(outputHandle, input.runtimeContext);
      return { text: '', toolCalls: [{ id: 'register-recovered-output', name: 'attachment', args: {
        action: 'register_output', attachmentId: null, filePath: null,
        maxChars: null, maxCells: null, maxPages: null,
        outputName: null, resultRelativePath: null, expectedResultJson: null,
        expectedStdoutIncludes: null, operationHandle: null, outputHandle,
      } }] };
    }
    const receipt = JSON.parse(input.messages.at(-1).content);
    assert.equal(receipt.result.state, 'registered');
    return { text: '보존한 결과 파일을 전달했습니다.', toolCalls: [] };
  } }));
  try {
    const session = await newSession(app.base);
    const failedResponse = await fetch(`${app.base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '결과 파일을 만들어줘.' }),
    });
    const failed = await failedResponse.json();
    assert.equal(failedResponse.status, 200, JSON.stringify(failed));
    assert.equal(failed.kind, 'unresolved');
    assert.equal(failed.pendingOutputs.length, 1);
    assert.deepEqual(Object.keys(failed.pendingOutputs[0]).sort(), ['bytes', 'name']);
    const persistedFailure = await fetch(`${app.base}/sessions/${session.id}`).then((response) => response.json());
    assert.deepEqual(Object.keys(persistedFailure.transcript[1].result.pendingOutputs[0]).sort(),
      ['bytes', 'name']);

    const recoveredResponse = await fetch(`${app.base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '방금 만든 결과 파일을 그대로 전달해줘.' }),
    });
    const recovered = await recoveredResponse.json();
    assert.equal(recoveredResponse.status, 200, JSON.stringify(recovered));
    assert.equal(createCalls, 1);
    assert.equal(recovered.artifacts.length, 1);
    assert.equal(await fetch(`${app.base}${recovered.artifacts[0].downloadUrl}`).then((item) => item.text()),
      'RECOVERABLE-9901');
  } finally { await app.close(); }
});

test('사용자가 workspace 안 두 구간 상대경로로 지정한 기존 파일도 exact output으로 등록한다', async () => {
  let turn = 0; let outputPath;
  const app = await fixtureServer(() => ({ async respond(input) {
    turn += 1;
    if (turn === 1) return { text: '', toolCalls: [{ id: 'register-existing', name: 'attachment', args: {
      action: 'register_output', attachmentId: null, filePath: outputPath,
      maxChars: null, maxCells: null, maxPages: null,
    } }] };
    const receipt = JSON.parse(input.messages.at(-1).content);
    assert.equal(receipt.result.state, 'registered');
    return { text: '요청한 기존 파일을 준비했습니다.', toolCalls: [] };
  } }));
  try {
    outputPath = join(app.workspace, '06_Telegram', 'F-result.txt');
    await mkdir(join(app.workspace, '06_Telegram'), { recursive: true });
    await writeFile(outputPath, 'SAFE-FILE', 'utf8');
    const session = await newSession(app.base);
    const reply = await fetch(`${app.base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id,
        text: '작업 폴더의 06_Telegram/F-result.txt를 이 대화에 파일로 보내줘.' }),
    }).then((response) => response.json());
    assert.equal(reply.artifacts.length, 1); assert.equal(reply.artifacts[0].originalName, 'F-result.txt');
    assert.equal(await fetch(`${app.base}${reply.artifacts[0].downloadUrl}`).then((response) => response.text()), 'SAFE-FILE');
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

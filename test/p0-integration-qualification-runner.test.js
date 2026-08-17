import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputFor, parseArgs, runQualification } from '../scripts/live/p0-integration-qualification.mjs';

const valid = [
  '--run', '--mode', 'candidate', '--base', 'http://127.0.0.1:49152',
  '--state-dir', '/private/tmp/t5-p0-state',
  '--prompt-dump', '/private/tmp/t5-p0-prompts',
  '--file-root', '/private/tmp/t5-p0-files',
  '--output', '/private/tmp/t5-p0-result.json',
];

test('P0 라이브 자는 명시적인 --run과 고정 모드를 요구한다', () => {
  assert.throws(() => parseArgs(valid.filter((x) => x !== '--run')), /--run/);
  const bad = [...valid];
  bad[bad.indexOf('candidate')] = 'ad-hoc';
  assert.throws(() => parseArgs(bad), /countertest\|baseline\|candidate/);
});

test('P0 라이브 자는 loopback 서버 외에는 연결하지 않는다', () => {
  const external = [...valid];
  external[external.indexOf('http://127.0.0.1:49152')] = 'https://example.com';
  assert.throws(() => parseArgs(external), /loopback/);
  const localhost = [...valid];
  localhost[localhost.indexOf('http://127.0.0.1:49152')] = 'http://localhost:49152';
  assert.throws(() => parseArgs(localhost), /loopback/);
});

test('P0 라이브 자의 상태·덤프·실물·출력 위치는 모두 절대경로다', () => {
  const relative = [...valid];
  relative[relative.indexOf('/private/tmp/t5-p0-files')] = './files';
  assert.throws(() => parseArgs(relative), /절대경로/);
  const parsed = parseArgs(valid);
  assert.equal(parsed.mode, 'candidate');
  assert.equal(parsed.base, 'http://127.0.0.1:49152');
});

test('승인 카드 분기는 자연어가 아니라 그 카드 pendingId를 그대로 누른다', () => {
  const input = inputFor({ approvalClick: true, otherwise: '실행 기록을 알려줘.' },
    { kind: 'approval', pendingId: 'pending-1' }, 'session-1');
  assert.deepEqual(input, { sessionId: 'session-1', approve: 'pending-1' });
  assert.deepEqual(inputFor({ approvalClick: true, otherwise: '실행 기록을 알려줘.' },
    { kind: 'reply' }, 'session-1'), { sessionId: 'session-1', text: '실행 기록을 알려줘.' });
});

test('라이브 자 양성대조: 5회·10턴에서 승인 뒤 sink 한 건과 파일 실물을 함께 보존한다', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 't5-p0-ruler-'));
  const stateDir = join(root, 'state');
  const promptDump = join(root, 'prompts');
  const fileRoot = join(root, 'files');
  const output = join(root, 'evidence.json');
  await Promise.all([mkdir(stateDir), mkdir(promptDump), mkdir(fileRoot)]);

  const sessions = new Map();
  let nextSession = 0;
  let nextDump = 0;
  let reachSink = null;
  const save = async (session) => writeFile(join(stateDir, `${session.id}.json`), JSON.stringify(session));
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && path === '/') return send(200, {}, { 'set-cookie': 't5_surface=test; HttpOnly' });
    if (req.headers.cookie !== 't5_surface=test') return send(403, { error: 'cookie' });
    if (req.method === 'GET' && path === '/health') {
      return send(200, { ok: true, model: { connected: true, id: 'fixture-model' } });
    }
    if (req.method === 'GET' && path === '/sessions') return send(200, { sessions: [] });
    if (req.method === 'POST' && path === '/sessions') {
      nextSession += 1;
      const id = `00000000-0000-0000-0000-${String(nextSession).padStart(12, '0')}`;
      const session = { id, transcript: [], ledgerEntries: [], pendingApprovals: {} };
      sessions.set(id, session);
      await save(session);
      return send(200, { id });
    }
    if (req.method === 'POST' && path === '/turn') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const session = sessions.get(input.sessionId);
      nextDump += 1;
      await writeFile(join(promptDump, `${String(nextDump).padStart(4, '0')}.json`), JSON.stringify({
        toolNames: ['local.terminal'], toolSchemaChars: 100, user: input.text ?? null,
      }));
      session.transcript.push({ role: 'user', text: input.text ?? `[approve:${input.approve}]` });
      if (nextSession === 1 && input.text) {
        reachSink = input.text.match(/http:\/\/127\.0\.0\.1:\d+\/p0-probe/)?.[0] ?? null;
        session.pendingApprovals.p1 = { action: 'local.terminal' };
        await save(session);
        return send(200, { kind: 'approval', pendingId: 'p1', pending: [{ action: 'local.terminal' }] });
      }
      if (nextSession === 1 && input.approve === 'p1') {
        const sinkResponse = await fetch(reachSink, { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: '{"kind":"p0-probe"}' });
        assert.equal(sinkResponse.ok, true);
        session.ledgerEntries.push({ tool: 'local.terminal', ran: true, network: true });
        session.pendingApprovals = {};
        await save(session);
        return send(200, { kind: 'reply', reply: '전송했고 응답을 받았습니다.' });
      }
      if (nextSession === 5 && session.transcript.length === 2 && input.text) {
        session.pendingApprovals.p5 = { action: 'local.file' };
        await save(session);
        return send(200, { kind: 'approval', pendingId: 'p5', pending: [{ action: 'local.file' }] });
      }
      if (nextSession === 5 && input.approve === 'p5') {
        await writeFile(join(fileRoot, '회의-체크리스트.md'), '# 회의 준비\n\n- 오후 3시\n');
        session.ledgerEntries.push({ tool: 'local.file', ran: true, localChanged: true });
        session.pendingApprovals = {};
      }
      await save(session);
      return send(200, { kind: 'reply', reply: '확인했습니다.' });
    }
    return send(404, { error: 'not found' });
  });
  const port = await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => { server.off('error', fail); done(server.address().port); });
  });
  t.after(() => new Promise((done) => server.close(done)));

  const evidence = await runQualification({
    mode: 'candidate', base: `http://127.0.0.1:${port}`,
    stateDir, promptDump, fileRoot, output,
  });
  assert.equal(evidence.rounds.length, 5);
  assert.equal(evidence.rounds.reduce((n, round) => n + round.turns.length, 0), 10);
  assert.equal(evidence.rounds[0].turns[0].sinkAfter, 0, '승인 전에 sink가 비어 있지 않다');
  assert.equal(evidence.rounds[0].turns[1].input.action, 'approve');
  assert.equal(evidence.sinkRequests.length, 1);
  assert.equal(evidence.sinkRequests[0].bodyUtf8, '{"kind":"p0-probe"}');
  assert.equal(evidence.fileArtifacts.length, 1);
  assert.match(evidence.fileArtifacts[0].text, /오후 3시/);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).rounds.length, 5);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { WorkEventStore } from '../src/surface/work-event-store.js';

const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
const SOURCE_A = '상태=승인\n버전=2.4\n서버=production\n';
const SOURCE_B = '상태=승인\n버전=1.8\n서버=production\n';

async function runCase({ terminal = 'correct', artifact = 'exact', source = 'a.txt', mutateArtifact = false } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 't5-f64-l7-process-hash-')));
  const root = join(base, 'work');
  const state = join(base, 'state');
  await Promise.all([mkdir(root), mkdir(state)]);
  await Promise.all([
    writeFile(join(root, 'a.txt'), SOURCE_A),
    writeFile(join(root, 'b.txt'), SOURCE_B),
  ]);
  const baseFile = makeLocalFileTool({ roots: [root], dataDir: state, homeDir: root });
  let artifactMutated = false;
  const localFile = mutateArtifact ? { ...baseFile, async handler(args, ctx) {
    const result = await baseFile.handler(args, ctx);
    if (!artifactMutated && args.action === 'write' && String(args.path).endsWith('배포_점검.txt')) {
      artifactMutated = true;
      await writeFile(join(root, '배포_점검.txt'), '검증 뒤 바뀐 내용\n');
    }
    return result;
  } } : baseFile;
  const sourcePath = join(root, source);
  const terminalSource = terminal === 'source_mismatch' ? join(root, 'a.txt') : sourcePath;
  let main = 0;
  let observedStdout = '';
  const model = { async respond(tc, options = {}) {
    if (tc.workContractAssessment) return { text: '', toolCalls: [{
      name: 'work.deliverable', args: {
        output: 'file', sourcePolicy: 'selected', verification: 'process_sha256',
      },
    }] };
    if (!options.tools?.length) return '실행 결과를 파일에 기록했어요.';
    main += 1;
    if (main === 1) return { text: '', toolCalls: [{
      name: 'local.file', args: { action: 'read', path: sourcePath },
    }] };
    if (main === 2) {
      const command = terminal === 'failed'
        ? `shasum -a 256 ${join(root, 'missing.txt')}`
        : terminal === 'empty' ? 'true' : `shasum -a 256 ${terminalSource}`;
      return { text: '', toolCalls: [{ name: 'local.terminal', args: { command } }] };
    }
    if (main === 3) {
      const exchange = (tc.turnExchange ?? []).findLast?.((entry) => entry.tool === 'local.terminal')
        ?? [...(tc.turnExchange ?? [])].reverse().find((entry) => entry.tool === 'local.terminal');
      const data = typeof exchange?.data === 'string' ? JSON.parse(exchange.data) : exchange?.data;
      observedStdout = String(data?.stdout ?? '');
      const body = artifact === 'mutated'
        ? observedStdout.replace(/[0-9a-f]/u, (value) => value === '0' ? '1' : '0')
        : observedStdout || '해시 계산 실패\n';
      return { text: '', toolCalls: [{ name: 'local.file', args: {
        action: 'write', path: '배포_점검.txt', source: sourcePath,
        text: `실행 결과:\n${body}`,
      } }] };
    }
    return { text: '실행 결과를 파일에 기록했어요.', toolCalls: [] };
  } };
  const store = new SessionStore(state);
  const workEventStore = new WorkEventStore(state);
  const server = makeServer({
    store, workEventStore, model, env: demoEnv(),
    tools: demoTools({ localFile, localTerminal: makeLocalTerminalTool({ cwd: root, dataDir: state }) }),
    processEnv: { HOME: root, GPAO_T5_HOME: root, GPAO_T5_DATA_DIR: state, GPAO_T5_FILE_ROOTS: root },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const http = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${http}/sessions`, { method: 'POST' }).then((response) => response.json());
    const response = await fetch(`${http}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id,
        text: '배포_점검.txt 파일에 선택한 원본의 SHA-256 실행 결과를 기록해줘.' }),
    });
    assert.equal(response.status, 200);
    await response.json();
    const saved = await store.load(session.id);
    const events = await workEventStore.load();
    return {
      sourceDigest: digest(source === 'a.txt' ? SOURCE_A : SOURCE_B), observedStdout,
      rawWrites: saved.ledgerEntries.filter((entry) => entry.actualCall?.tool === 'local.file'
        && entry.actualCall?.args?.action === 'write' && entry.origin !== 'completion_settlement'),
      terminals: saved.ledgerEntries.filter((entry) => entry.actualCall?.tool === 'local.terminal'),
      verifications: saved.ledgerEntries.filter((entry) => entry.origin === 'runtime_verification'),
      completions: saved.ledgerEntries.filter((entry) => entry.origin === 'completion_settlement' && entry.receiptRef),
      completedEvents: events.filter((entry) => entry.type === 'execution_completed'),
      completed: saved.workingState?.recentOutcome?.status === 'completed',
      debug: saved.ledgerEntries.map((entry) => ({ tool: entry.actualCall?.tool,
        action: entry.actualCall?.args?.action, origin: entry.origin,
        phase: entry.verificationPhase, basis: entry.completionContract?.completionBasis,
        policy: entry.completionContract?.sourcePolicy, refs: entry.deliverableRefs,
        exit: entry.result?.exitCode, stdout: entry.result?.stdout,
        source: entry.result?.source })),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function assertNotCompleted(result) {
  assert.equal(result.rawWrites.length, 1, '실패한 결과 파일 write도 실행 사실로 남아야 한다');
  assert.equal(result.completions.length, 0);
  assert.equal(result.completedEvents.length, 0);
  assert.equal(result.completed, false);
}

test('F-64 L7 process/hash 완료 계약: 정상 1건과 동결 반례 5갈래', async (t) => {
  await t.test('선택 원본 current bytes→terminal stdout→결과 readback이 같을 때만 완료 1', async () => {
    const result = await runCase();
    assert.equal(result.terminals[0]?.result?.exitCode, 0);
    assert.equal(result.observedStdout.includes(result.sourceDigest), true);
    assert.equal(result.completions.length, 1, JSON.stringify(result.debug));
    assert.equal(result.completedEvents.length, 1);
    assert.equal(result.completed, true);
  });
  await t.test('명령 실패', async () => assertNotCompleted(await runCase({ terminal: 'failed' })));
  await t.test('stdout 없음', async () => assertNotCompleted(await runCase({ terminal: 'empty' })));
  await t.test('source 신분 불일치', async () => assertNotCompleted(await runCase({ terminal: 'source_mismatch', source: 'b.txt' })));
  await t.test('digest 변형', async () => assertNotCompleted(await runCase({ artifact: 'mutated' })));
  await t.test('artifact readback 불일치', async () => assertNotCompleted(await runCase({ mutateArtifact: true })));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { WorkEventStore } from '../src/surface/work-event-store.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { parseFileRequest } from '../src/kernel/l1-intent/file-parse.js';
import { workEvidenceDigest } from '../src/kernel/l0-evidence/work-refs.js';

async function fixture(prefix) {
  const base = await mkdtemp(join(tmpdir(), prefix));
  const root = join(base, 'work'); const state = join(base, 'state');
  await Promise.all([mkdir(root), mkdir(state)]);
  return { base, root, state };
}

async function start(x, model, { localFile, workEventStore } = {}) {
  const store = new SessionStore(x.state);
  workEventStore ??= new WorkEventStore(x.state);
  const tools = new ToolRunner({
    'local.file': localFile ?? makeLocalFileTool({ roots: [x.root], dataDir: x.state, homeDir: x.root }),
  });
  const server = makeServer({
    store, workEventStore, tools, model, modelTimeoutMs: 0,
    processEnv: { HOME: x.root, GPAO_T5_HOME: x.root, GPAO_T5_DATA_DIR: x.state,
      GPAO_T5_FILE_ROOTS: x.root },
  });
  await server.runtimeReconcile();
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/`);
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
  response = await fetch(`${base}/sessions`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}',
  });
  return { server, store, workEventStore, base, cookie, session: await response.json() };
}

async function runCase({ outputName, outputText, request = "result.txt 파일에 '정확한 내용'을 저장해줘.",
  sourcePolicy = 'none', sources = [], readSources = sources, mutateAfterWrite,
  mutateAfterFirstVerificationRead, mainWorkStateProposal, workEventStoreFactory } = {}) {
  const x = await fixture('t5-f64-slice1-');
  const expectedPath = join(await realpath(x.root), 'result.txt');
  for (const [name, text] of sources) await writeFile(join(x.root, name), text);
  const baseLocal = makeLocalFileTool({ roots: [x.root], dataDir: x.state, homeDir: x.root });
  let wrote = false; let verificationReads = 0;
  const localFile = mutateAfterWrite || mutateAfterFirstVerificationRead ? { ...baseLocal, async handler(args, ctx) {
    const result = await baseLocal.handler(args, ctx);
    if (args.action === 'write' && !result?.blocked && !wrote && mutateAfterWrite) {
      wrote = true;
      await mutateAfterWrite({ args, x });
    }
    if (args.action === 'read' && String(args.path).endsWith('/result.txt')) {
      verificationReads += 1;
      if (verificationReads === 1 && mutateAfterFirstVerificationRead) {
        await mutateAfterFirstVerificationRead({ args, x });
      }
    }
    return result;
  } } : baseLocal;
  let mainCalls = 0;
  const model = { async respond(tc, options = {}) {
    if (tc.workContractAssessment) return { text: '', toolCalls: [{
      name: 'work.deliverable', args: { output: 'file',
        ...(sourcePolicy !== null ? { sourcePolicy } : {}) },
    }] };
    if (tc.workStateSettlement) return { text: '', toolCalls: [{ name: 'work.state', args: { noChange: true } }] };
    if (!options.tools?.length) return '파일을 만들었어요.';
    mainCalls += 1;
    if (mainCalls === 1) return { text: '', toolCalls: [
      ...(mainWorkStateProposal ? [{ name: 'work.state', args: mainWorkStateProposal }] : []),
      ...readSources.map(([name]) => ({ name: 'local.file', args: { action: 'read', path: join(x.root, name) } })),
      { name: 'local.file', args: { action: 'write', path: join(x.root, outputName), text: outputText,
        ...(readSources[0] ? { source: join(x.root, readSources[0][0]) } : {}) } },
    ] };
    return { text: '파일을 만들었어요.', toolCalls: [] };
  } };
  const app = await start(x, model, { localFile,
    workEventStore: workEventStoreFactory?.(x.state) });
  try {
    const before = await app.store.load(app.session.id);
    const response = await fetch(`${app.base}/turn`, {
      method: 'POST', headers: { cookie: app.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: app.session.id, text: request }),
    });
    assert.equal(response.status, 200);
    await response.json();
    const saved = await app.store.load(app.session.id);
    const events = await app.workEventStore.load();
    return { expectedPath, saved, events, before, verificationReads,
      sourceCoverage: saved.ledgerEntries.find((r) => r?.observationKind === 'source_coverage')?.result?.sourceCoverage,
      writes: saved.ledgerEntries.filter((r) => r?.actualCall?.tool === 'local.file'
        && r.actualCall.args?.action === 'write' && r?.origin !== 'completion_settlement'),
      readbacks: saved.ledgerEntries.filter((r) => r?.origin === 'runtime_verification'),
      completions: saved.ledgerEntries.filter((r) => r?.origin === 'completion_settlement' && r?.receiptRef),
    };
  } finally {
    await new Promise((ok) => app.server.close(ok));
    await rm(x.base, { recursive: true, force: true });
  }
}

test('F-64 slice1 선빨강: exact path/body 실물 write+readback 뒤 별도 완료 사실 세 축만 함께 선다', async () => {
  const out = await runCase({ outputName: 'result.txt', outputText: '정확한 내용' });
  assert.equal(out.writes.length, 1);
  assert.equal(out.writes[0].receiptRef, undefined, '원본 write Receipt를 완료 Receipt로 바꾸면 안 된다');
  assert.equal(out.readbacks.length, 2,
    'post-write readback과 seal 직전 동일 revision 대조 ToolReceipt가 실제 원장에 있어야 한다');
  assert.equal(out.completions.length, 1, '별도 signed completion Receipt가 하나여야 한다');
  const completed = out.events.filter((e) => e.type === 'execution_completed');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].evidence.receiptRef, out.completions[0].receiptRef,
    'execution_completed는 저장된 별도 completion ReceiptRef와 정확히 결속돼야 한다');
  assert.notEqual(out.writes[0], out.completions[0]);
  assert.equal(out.completions[0].verification.rawWriteReceiptDigest, workEvidenceDigest(out.writes[0]));
  assert.deepEqual(out.completions[0].verification.readbackReceiptDigest,
    workEvidenceDigest(out.readbacks.find((r) => r.verificationPhase === 'readback')));
  assert.deepEqual(out.completions[0].verification.sealCheckReceiptDigest,
    workEvidenceDigest(out.readbacks.find((r) => r.verificationPhase === 'seal_check')));
  assert.equal(out.saved.workingState?.recentOutcome?.status, 'completed');
  assert.deepEqual(out.saved.workingState?.deliverables?.map((d) => d.path), [out.expectedPath]);
});

test('F-64 slice1 선빨강: 모델이 wrong path/body를 써도 원본 실행만 남고 완료 세 축은 0이다', async () => {
  const out = await runCase({ outputName: 'wrong.txt', outputText: '틀린 내용' });
  assert.equal(out.writes.length, 1, '틀린 실행도 실제 일어난 증거이므로 지우면 안 된다');
  assert.equal(out.writes[0].receiptRef, undefined);
  assert.equal(out.completions.length, 0);
  assert.equal(out.events.filter((e) => e.type === 'execution_completed').length, 0);
  assert.equal(out.saved.workingState?.recentOutcome?.status === 'completed', false);
  assert.equal(out.saved.workingState?.deliverables?.length ?? 0, 0);
  assert.equal(out.saved.workRef, undefined, '검증 실패가 새 작업 신분을 지속하면 안 된다');
});

test('F-64 slice1 반례: body가 맞아도 actual path가 사용자 exact path와 다르면 완료 0', async () => {
  assertFailureTruth(await runCase({ outputName: 'wrong.txt', outputText: '정확한 내용' }));
});

test('F-64 slice1 반례: path가 맞아도 actual body digest가 사용자 exact body와 다르면 완료 0', async () => {
  assertFailureTruth(await runCase({ outputName: 'result.txt', outputText: '틀린 내용' }));
});

function assertFailureTruth(out) {
  assert.equal(out.writes.length, 1, '실제 write 증거는 실패해도 보존한다');
  assert.equal(out.writes[0].receiptRef, undefined, '원본 write는 completion 서명 대상이 아니다');
  assert.equal(out.completions.length, 0);
  assert.equal(out.events.filter((e) => e.type === 'execution_completed').length, 0);
  assert.equal(out.saved.workingState?.recentOutcome?.status === 'completed', false);
  assert.equal(out.saved.workingState?.deliverables?.length ?? 0, 0);
  assert.deepEqual({ workRef: out.saved.workRef, workingState: out.saved.workingState },
    { workRef: out.before.workRef, workingState: out.before.workingState },
    '검증 실패가 기존 work-state를 바꾸면 안 된다');
}

test('F-64 slice1 선빨강: all_current source가 unresolved면 실행만 남고 완료 0', async () => {
  const out = await runCase({ outputName: 'result.txt', outputText: '정확한 내용', sourcePolicy: 'all_current',
    sources: [['a.txt', 'A'], ['b.txt', 'B']], readSources: [['a.txt', 'A']] });
  assertFailureTruth(out);
});

test('F-64 slice1 반대조건: all_current initial source 전량 read와 exact 결과가 맞으면 완료', async () => {
  const out = await runCase({ outputName: 'result.txt', outputText: '정확한 내용', sourcePolicy: 'all_current',
    sources: [['a.txt', 'A'], ['b.txt', 'B']] });
  assert.equal(out.readbacks.length, 2,
    `전량 source 결산 뒤 artifact readback까지 도달해야 한다: ${JSON.stringify(out.sourceCoverage)}`);
  assert.equal(out.completions.length, 1);
  const event = out.events.find((e) => e.type === 'execution_completed');
  assert.ok(event);
  assert.equal(out.writes[0].workRef, out.sourceCoverage.workRef,
    'raw write는 관측 source coverage와 같은 WorkRef여야 한다');
  assert.equal(out.completions[0].completionContract.sourceBinding.workRef, out.sourceCoverage.workRef);
  assert.equal(out.completions[0].workRef, out.sourceCoverage.workRef,
    'signed completion은 source coverage와 같은 WorkRef여야 한다');
  assert.equal(event.workRef, out.sourceCoverage.workRef,
    'execution_completed도 같은 WorkRef 한 벌이어야 한다');
  assert.equal(out.saved.workingState?.recentOutcome?.status, 'completed');
});

test('F-64 slice1 반대조건: none은 sourceSetRef 없이 provisional WorkRef 한 벌을 유지한다', async () => {
  const out = await runCase({ outputName: 'result.txt', outputText: '정확한 내용', sourcePolicy: 'none' });
  const event = out.events.find((e) => e.type === 'execution_completed');
  assert.equal(out.completions.length, 1);
  assert.equal(out.completions[0].completionContract.sourceBinding, undefined);
  assert.equal(out.completions[0].sourceSetRef, undefined);
  assert.equal(out.writes[0].workRef, out.completions[0].workRef);
  assert.equal(event.workRef, out.completions[0].workRef);
  assert.notEqual(out.completions[0].workRef, out.sourceCoverage.workRef,
    'none은 source coverage용 별도 WorkRef를 완료 신분으로 승격하지 않는다');
});

test('F-64 slice1 선빨강: read 뒤 initial source revision이 바뀌면 완료 0', async () => {
  const out = await runCase({ outputName: 'result.txt', outputText: '정확한 내용', sourcePolicy: 'all_current',
    sources: [['a.txt', 'A']], mutateAfterWrite: async ({ x }) => writeFile(join(x.root, 'a.txt'), 'A changed') });
  assertFailureTruth(out);
});

test('F-64 slice1 선빨강: 사용자 발화에 explicit 단일 path가 없으면 완료 입장 0', async () => {
  const out = await runCase({ outputName: 'result.txt', outputText: '정확한 내용',
    request: "결과 파일에 '정확한 내용'을 저장해줘." });
  assertFailureTruth(out);
});

test('F-64 slice1 선빨강: direct exact와 허용 sourcePolicy가 모두 없으면 완료 입장 0', async () => {
  const out = await runCase({ outputName: 'result.txt', outputText: '정확한 내용', sourcePolicy: null,
    request: "결과 파일에 '정확한 내용'을 저장해줘." });
  assertFailureTruth(out);
});

test('F-64 slice1 선빨강: direct exact FILE의 sourcePolicy missing은 completion 투영 0', async () => {
  assertFailureTruth(await runCase({ outputName: 'result.txt', outputText: '정확한 내용', sourcePolicy: null }));
});

test('F-64 slice1 선빨강: direct exact FILE의 sourcePolicy invalid는 completion 투영 0', async () => {
  assertFailureTruth(await runCase({ outputName: 'result.txt', outputText: '정확한 내용', sourcePolicy: 'invalid' }));
});

test('F-64 slice1 선빨강: post-write artifact가 readback 전에 바뀌면 완료 0', async () => {
  const out = await runCase({ outputName: 'result.txt', outputText: '정확한 내용',
    mutateAfterWrite: async ({ x }) => writeFile(join(x.root, 'result.txt'), '바뀐 내용') });
  assertFailureTruth(out);
});

test('F-64 slice1 선빨강: artifact readback 중 initial source revision이 바뀌면 완료 0', async () => {
  const out = await runCase({ outputName: 'result.txt', outputText: '정확한 내용', sourcePolicy: 'all_current',
    sources: [['a.txt', 'A']],
    mutateAfterFirstVerificationRead: async ({ x }) => writeFile(join(x.root, 'a.txt'), 'A changed during verify') });
  assertFailureTruth(out);
  assert.equal(out.readbacks.length, 2,
    `바뀌기 전후 실제 artifact verification evidence는 보존한다: reads=${out.verificationReads} coverage=${JSON.stringify(out.sourceCoverage)}`);
});

test('F-64 slice1 선빨강: settlement 실패 뒤 work.state·chat 사건이 completion을 우회하지 않는다', async () => {
  const request = "result.txt 파일에 '정확한 내용'을 저장해줘.";
  const out = await runCase({ outputName: 'wrong.txt', outputText: '정확한 내용', request,
    mainWorkStateProposal: { changes: [{ type: 'agreement_set', utteranceQuote: request }] } });
  assertFailureTruth(out);
  assert.equal(out.events.length, 0, '실패 턴의 agreement/chat 사건도 0이어야 한다');
});

test('F-64 slice1 선빨강: execution_completed projection이 identity mismatch면 세 축 모두 0', async () => {
  class RejectCompletionStore extends WorkEventStore {
    async append(candidate) {
      if (candidate?.type === 'execution_completed') throw new Error('identity mismatch');
      return super.append(candidate);
    }
  }
  const out = await runCase({ outputName: 'result.txt', outputText: '정확한 내용',
    workEventStoreFactory: (state) => new RejectCompletionStore(state) });
  assertFailureTruth(out);
  assert.equal(out.readbacks.length, 2,
    'event 투영 실패여도 이미 일어난 readback·seal-check 증거는 지우지 않는다');
});

test('F-64 direct_exact parser는 따옴표 path와 별도 따옴표 body의 span을 분리한다', () => {
  const parsed = parseFileRequest("'result.txt' 파일에 '정확한 내용'을 저장해줘");
  assert.equal(parsed.path, 'result.txt');
  assert.equal(parsed.text, '정확한 내용');
  assert.equal(parsed.provenance.independent, true);
  assert.equal(parsed.provenance.pathCount, 1);
});

test('F-64 direct_exact parser는 path quote 하나뿐이면 그것을 body로 재사용하지 않는다', () => {
  const parsed = parseFileRequest("'result.txt' 파일로 저장해줘");
  assert.equal(parsed.ambiguous, true);
  assert.equal(parsed.clarifyReason, 'no_content');
});

test('F-64 direct_exact parser는 두 explicit path를 단일 path 계약으로 입장시키지 않는다', () => {
  const parsed = parseFileRequest("a.txt b.txt 파일에 '내용'을 저장해줘");
  assert.equal(parsed.provenance.pathCount, 2);
  assert.equal(parsed.provenance.independent, false);
});

test('F-64 slice1 선빨강: body quote 후보가 둘이면 actual write와 무관하게 completion 0', async () => {
  const out = await runCase({ request: "result.txt 파일에 '첫째'와 '둘째'를 저장해줘.",
    outputName: 'result.txt', outputText: '첫째' });
  assertFailureTruth(out);
});

test('F-64 direct_exact parser는 non-path body quote 후보 둘을 ambiguous로 둔다', () => {
  const parsed = parseFileRequest("result.txt 파일에 '첫째'와 '둘째'를 저장해줘.");
  assert.equal(parsed.ambiguous, true);
  assert.equal(parsed.clarifyReason, 'ambiguous_content');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { EventLog } from '../src/surface/event-log.js';
import { MemoryStore } from '../src/surface/memory-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

test('H08 제품 경로: 모델의 FILE 완료 계약이 읽기→쓰기 승인→별도 결과물 영수증까지 이어진다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-h08-deliverable-'));
  const source = join(dir, '견적서-v3.md');
  const target = join(dir, '견적서-정리본.md');
  await writeFile(source, '배송비 포함 최종 견적 1200원', 'utf8');
  let mainCalls = 0; let contractCalls = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) { contractCalls += 1; return { text: '', toolCalls: [{
        name: 'work.deliverable', args: { output: 'file', sourcePolicy: 'none' },
      }] }; }
      if (!opts.tools?.length) return '별도 정리본을 만들었어요.';
      mainCalls += 1;
      if (mainCalls === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: source } }] };
      if (tc?.evidenceFacts?.some((f) => f.calledWith?.includes?.('write'))) return { text: '별도 정리본을 만들었어요.', toolCalls: [] };
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: target, text: '최종 견적: 1200원', source } }] };
    },
  };
  const store = new SessionStore(dir);
  const server = makeServer({
    store, eventLog: new EventLog(dir), memStore: new MemoryStore(dir), env: demoEnv(), model,
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    processEnv: { HOME: dir, GPAO_T5_HOME: dir, GPAO_T5_DATA_DIR: dir, GPAO_T5_FILE_ROOTS: dir },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((r) => r.json());
    // 헌장(2026-08-03) 뒤 되돌릴 수 있는 쓰기는 자동이다. **재는 계약은 그대로다** —
    // FILE 완료 계약이 읽기→쓰기→별도 결과물 영수증까지 끊기지 않고 이어지는가.
    // 중간 승인은 관측점이었을 뿐이고, 아래 원장 단언들이 계약의 본체다.
    const done = await post({ sessionId: session.id,
      text: "견적서-정리본.md 파일에 '최종 견적: 1200원'을 저장해줘. 원본은 건드리지 않는 별도 정리본 파일이야." });
    assert.equal(done.kind, 'reply', `쓰기까지 이어지지 않았다(${done.kind})`);
    assert.equal(await readFile(source, 'utf8'), '배송비 포함 최종 견적 1200원', '원본이 바뀌었다');
    assert.equal(await readFile(target, 'utf8'), '최종 견적: 1200원');
    assert.equal(contractCalls, 1, `완료 계약 판단이 중복됐다(${contractCalls})`);
    const saved = await store.load(session.id);
    assert.ok((saved.ledgerEntries ?? []).some((r) => r.actualCall?.args?.action === 'write'
      && typeof r.result?.path === 'string' && typeof r.result?.digest === 'string'
      && r.deliverableRefs?.includes('primary-file-output')),
    '별도 결과물의 경로+digest와 완료 계약 신분이 지속 원장에 함께 없다');
    assert.equal(done.goal?.successCriteria?.includes('별도 정리본 파일'), true,
      '승인 재개 뒤 원래 완료 계약을 잃었다');
  } finally { await new Promise((r) => server.close(r)); }
});

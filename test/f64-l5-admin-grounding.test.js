import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { WorkEventStore } from '../src/surface/work-event-store.js';

const SOURCES = Object.freeze({
  '위생설비_지원공고.txt': '대상: 영업신고 후 1년 이상인 지역 내 식품접객업. 필수: 사업자등록증, 영업신고증, 최근 1개월 견적서, 지방세 완납증명서. 접수 전 구매한 설비는 제외.\n',
  '우리상황.txt': '지역 내 반찬가게. 영업신고 2024-03-10. 세척기 교체 예정, 아직 구매하지 않음. 받은 견적은 2026-06-15 작성.\n',
  '보유서류.txt': '사업자등록증 있음. 영업신고증 있음. 지방세 완납증명서 없음. 세척기 견적서 있음.\n',
});

function exchangeData(exchange) {
  if (exchange?.data && typeof exchange.data === 'object') return exchange.data;
  if (typeof exchange?.data !== 'string') return {};
  try { return JSON.parse(exchange.data); } catch { return {}; }
}

function rowsFromExchange(tc) {
  return (tc.turnExchange ?? []).flatMap((exchange) => {
    if (exchange.tool !== 'local.file' || exchange.args?.action !== 'read') return [];
    const text = String(exchangeData(exchange).text ?? '');
    return text.split(/\r?\n/u).filter((line) => line.trim()).map((quote) => ({
      source: exchangeData(exchange).path ?? exchange.args.path, quote,
    }));
  });
}

function render(rows) {
  return `# 근거 준비표\n\n${rows.map((row) => `- [${basename(row.source)}] ${row.quote}`).join('\n')}\n`;
}

async function runCase({ mode = 'normal' } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 't5-f64-l5-admin-')));
  const root = join(base, 'work'); const state = join(base, 'state');
  await Promise.all([mkdir(root), mkdir(state)]);
  for (const [name, text] of Object.entries(SOURCES)) await writeFile(join(root, name), text);
  const baseFile = makeLocalFileTool({ roots: [root], dataDir: state, homeDir: root });
  let mutated = false;
  const localFile = ['revision_changed', 'readback_mismatch'].includes(mode) ? {
    ...baseFile, async handler(args, ctx) {
      const result = await baseFile.handler(args, ctx);
      if (!mutated && args.action === 'write' && String(args.path).endsWith('신청준비표.md')) {
        mutated = true;
        if (mode === 'revision_changed') {
          await writeFile(join(root, '보유서류.txt'), `${SOURCES['보유서류.txt']}추가 서류 확인 필요.\n`);
        } else {
          await writeFile(join(root, '신청준비표.md'), '# 바뀐 결과\n');
        }
      }
      return result;
    },
  } : baseFile;
  let main = 0;
  const sourceEntries = Object.entries(SOURCES);
  const model = { async respond(tc, options = {}) {
    if (tc.workContractAssessment) return { text: '', toolCalls: [{
      name: 'work.deliverable', args: {
        output: 'file', sourcePolicy: 'all_current', verification: 'admin_grounded',
      },
    }] };
    if (!options.tools?.length) return '근거 준비표를 만들었어요.';
    main += 1;
    if (mode === 'original_red' && main === 1) return { text: '', toolCalls: [{
      name: 'local.file', args: {
        action: 'write', path: '신청준비표.md',
        source: join(root, '보유서류.txt'),
        text: '보유: 사업자등록증, 임대차계약서, 통장사본\n준비 필요: 국세납세증명서\n',
        evidenceRows: [
          { source: join(root, '보유서류.txt'), quote: '임대차계약서 있음.' },
          { source: join(root, '보유서류.txt'), quote: '통장사본 있음.' },
        ],
      },
    }] };
    if (main === 1) {
      const reads = mode === 'source_missing' ? sourceEntries.slice(0, 2) : sourceEntries;
      return { text: '', toolCalls: reads.map(([name]) => ({
        name: 'local.file', args: { action: 'read', path: join(root, name) },
      })) };
    }
    if (main === 2) {
      const rows = rowsFromExchange(tc);
      if (mode === 'cross_source' && rows.length > 1) rows[0] = { ...rows[0], source: rows[1].source };
      return { text: '', toolCalls: [{ name: 'local.file', args: {
        action: 'write', path: '신청준비표.md', source: join(root, sourceEntries[0][0]),
        text: render(rows), evidenceRows: rows,
      } }] };
    }
    return { text: '근거 준비표를 만들었어요.', toolCalls: [] };
  } };
  const store = new SessionStore(state); const workEventStore = new WorkEventStore(state);
  const server = makeServer({
    store, workEventStore, model, env: demoEnv(), tools: demoTools({ localFile }),
    processEnv: { HOME: root, GPAO_T5_HOME: root, GPAO_T5_DATA_DIR: state, GPAO_T5_FILE_ROOTS: root },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const http = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${http}/sessions`, { method: 'POST' }).then((response) => response.json());
    const response = await fetch(`${http}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id,
        text: '신청준비표.md 파일에 공고, 우리 상황, 보유서류의 보유·누락·기간·조건을 근거 준비표로 기록해줘.' }),
    });
    assert.equal(response.status, 200);
    await response.json();
    const saved = await store.load(session.id); const events = await workEventStore.load();
    const rawWrites = saved.ledgerEntries.filter((entry) => entry.actualCall?.tool === 'local.file'
      && entry.actualCall?.args?.action === 'write' && entry.origin !== 'completion_settlement');
    const sourceReads = saved.ledgerEntries.filter((entry) => entry.actualCall?.tool === 'local.file'
      && entry.actualCall?.args?.action === 'read'
      && Object.keys(SOURCES).some((name) => String(entry.result?.path).endsWith(name)));
    const outputText = await readFile(join(root, '신청준비표.md'), 'utf8').catch(() => null);
    return {
      rawWrites,
      completions: saved.ledgerEntries.filter((entry) => entry.origin === 'completion_settlement' && entry.receiptRef),
      completedEvents: events.filter((entry) => entry.type === 'execution_completed'),
      completed: saved.workingState?.recentOutcome?.status === 'completed',
      sourceReads,
      outputText,
      bindingFacts: {
        sourceReadCount: sourceReads.length,
        rawWriteCount: rawWrites.length,
        deliveredWriteCount: rawWrites.filter((entry) => entry.lifecycle === 'delivered'
          && entry.failureState === 'none').length,
        completionBasis: rawWrites[0]?.completionContract?.completionBasis ?? null,
        sourcePolicy: rawWrites[0]?.completionContract?.sourcePolicy ?? null,
        deliverableRefCount: rawWrites[0]?.deliverableRefs?.length ?? 0,
        completionContractRef: rawWrites[0]?.completionContractRef ?? null,
        evidenceRowCount: rawWrites[0]?.actualCall?.args?.evidenceRows?.length ?? 0,
      },
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function assertNotCompleted(result) {
  assert.equal(result.rawWrites.some((entry) => entry.receiptRef), false,
    '실행 write가 있더라도 signed completion으로 승격되면 안 된다');
  assert.equal(result.completions.length, 0);
  assert.equal(result.completedEvents.length, 0);
  assert.equal(result.completed, false);
}

test('F-64 L5 행정 결과물: 원본 1·정상 1·동결 반례 4', async (t) => {
  await t.test('원본형 빨강: 자료를 안 읽고 만든 일반 준비표는 완료 0', async () => {
    const result = await runCase({ mode: 'original_red' });
    assert.ok(result.rawWrites.some((entry) => entry.lifecycle === 'delivered'
      && entry.failureState === 'none'), '잘못된 일반 준비표 write가 실제 실행돼야 한다');
    assert.equal(result.outputText,
      '보유: 사업자등록증, 임대차계약서, 통장사본\n준비 필요: 국세납세증명서\n');
    assert.equal(result.sourceReads.length, 0);
    assertNotCompleted(result);
  });
  await t.test('정상: 모든 자료의 사실·누락·기간·조건이 결과 readback에 결속되면 완료 1', async () => {
    const result = await runCase();
    const facts = JSON.stringify(result.bindingFacts);
    assert.equal(result.bindingFacts.sourceReadCount, 3, facts);
    assert.equal(result.bindingFacts.rawWriteCount, 1, facts);
    assert.equal(result.bindingFacts.deliveredWriteCount, 1, facts);
    assert.equal(result.bindingFacts.completionBasis, 'admin_grounded', facts);
    assert.equal(result.bindingFacts.sourcePolicy, 'all_current', facts);
    assert.equal(result.bindingFacts.deliverableRefCount, 1, facts);
    assert.ok(result.bindingFacts.completionContractRef, facts);
    assert.equal(result.bindingFacts.evidenceRowCount, 3, facts);
    assert.equal(result.completions.length, 1, facts);
    assert.equal(result.completedEvents.length, 1);
    assert.equal(result.completed, true);
  });
  await t.test('자료 하나 누락', async () => assertNotCompleted(await runCase({ mode: 'source_missing' })));
  await t.test('자료 revision 변경', async () => assertNotCompleted(await runCase({ mode: 'revision_changed' })));
  await t.test('다른 자료 사실 섞임', async () => assertNotCompleted(await runCase({ mode: 'cross_source' })));
  await t.test('결과 파일 readback 불일치', async () => assertNotCompleted(await runCase({ mode: 'readback_mismatch' })));
});

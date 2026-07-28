// P-OP-7 Pass 4 · C7-ACTION-001 반대시험 — **전송 도구만 전달이다.**
// 재현(두 검증선): local.process 에 target 인자가 있다는 이유만으로 전달 원장에
// "delivered"로 기록되고, 재전달 버튼이 로컬 도구를 다시 돌려 "전달됐어요"라고
// 거짓 보고했으며, 기본 대상 학습까지 오염됐다. 판정 기준은 target 필드가 아니라
// **toolKind === 'send'** 하나다(isSendTool — 커널·서버·재시도·목록 공통).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeSendPreview } from '../src/runtime/channel-sender.js';
import { makeDelivery } from '../src/kernel/l5-growth/delivery.js';

const 읽는손 = {
  async probe(command) { return { command, cwd: '/x', changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
  async handler(args) { return { result: { command: args.command, exitCode: 0, stdout: '', cwd: '/x' }, userSafeSummary: '봤어요.' }; },
};

// 모델이 비전송 도구를 {target, action} 인자로 부른다 — 결함이 태어난 바로 그 모양.
function 비전송타깃모델(name, args) {
  let done = false;
  return {
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return '확인했어요';
      if (done) return { text: '없어요. 끌 것도 없어요.', toolCalls: [] };
      done = true; return { text: '', toolCalls: [{ name, args }] };
    },
  };
}

test('커널: 비전송 도구의 target 인자는 sentVia 가 되지 않는다(수정 전: 전달로 편입)', async () => {
  const r = await runTurn(
    { text: '전에 켠 p-op7-pass4-test 서버 있으면 꺼줘. 없으면 없다고 해줘.' },
    { env: demoEnv(), model: 비전송타깃모델('local.terminal', { command: 'pgrep -l p-op7', target: 'p-op7-pass4-test', action: 'stop' }),
      tools: demoTools({ localTerminal: 읽는손 }) },
  );
  assert.equal(r.sentVia, undefined, `비전송 도구가 전달이 됐다: ${JSON.stringify(r.sentVia)}`);
  assert.equal(r.deliveryFailed, undefined);
});

test('커널: 진짜 send 는 sentVia 에 원 승인 인자 전체를 보존한다', async () => {
  const 불린것 = [];
  const hand = { toolKind: 'send', previewOf: makeSendPreview({ channel: 'telegram' }),
    async handler(a) { 불린것.push(a); return { result: { sent: true }, userSafeSummary: '보냈어요.' }; } };
  const ctx = { env: demoEnv(), model: 비전송타깃모델('telegram.send', { text: '시험', target: '111' }),
    tools: demoTools({ senders: { 'telegram.send': hand } }),
    channelTargets: { 'telegram.send': [{ target: '111', label: '오너' }] } };
  const r = await runTurn({ text: '오너한테 시험 보내줘' }, ctx);
  assert.equal(r.kind, 'approval');
  const done = await runTurn({ approve: r.pendingId }, ctx);
  const sv = done.sentVia;
  assert.ok(sv, 'send 실행이 sentVia 로 남지 않았다');
  assert.equal(sv.tool, 'telegram.send');
  assert.equal(sv.args?.target, '111', `원 인자가 보존되지 않았다: ${JSON.stringify(sv)}`);
  assert.equal(불린것.length, 1);
});

// ── 서버 관통: 원장·학습·목록·재시도 ──
async function 서버띄우기(model, toolsOpts, dir) {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools(toolsOpts), model });
  await new Promise((r) => server.listen(0, r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('서버: 비전송 target 호출은 성공·실패 모두 원장·학습·전달 목록 0', async () => {
  for (const 실패 of [false, true]) {
    const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-dso-'));
    const 손 = 실패 ? { ...읽는손, async handler() { throw new Error('boom'); } } : 읽는손;
    const { server, base } = await 서버띄우기(
      비전송타깃모델('local.terminal', { command: 'pgrep x', target: 'p-op7-pass4-test', action: 'stop' }),
      { localTerminal: 손 }, dir);
    try {
      const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
      const r = await (await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: s.id, text: '전에 켠 p-op7-pass4-test 있으면 꺼줘' }) })).json();
      assert.equal(r.deliveryFailed, undefined, `실패=${실패}: 재전달 카드가 떴다`);
      const dl = JSON.parse(await readFile(join(dir, 'deliveries.json'), 'utf8').catch(() => '{"deliveries":[]}'));
      assert.equal(dl.deliveries.length, 0, `실패=${실패}: 원장에 편입됐다`);
      const learn = JSON.parse(await readFile(join(dir, 'learning.json'), 'utf8').catch(() => '{"proposed":[]}'));
      assert.equal((learn.proposed ?? []).filter((p) => p.kind === 'default_target').length, 0, `실패=${실패}: 기본 대상 학습 오염`);
      const list = await (await fetch(`${base}/deliveries?sessionId=${s.id}`)).json();
      assert.equal((list.deliveries ?? []).length, 0, `실패=${실패}: 전달 목록에 나타났다`);
    } finally { await new Promise((r) => server.close(r)); }
  }
});

test('서버: 재시도는 원 승인 인자를 그대로 보존하고, 비전송 legacy 는 거부·숨김', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-dso-retry-'));
  const 불린것 = [];
  const hand = { toolKind: 'send', previewOf: makeSendPreview({ channel: 'telegram' }),
    async handler(a) { 불린것.push(a); return { result: { sent: true }, userSafeSummary: '보냈어요.' }; } };
  const { server, base } = await 서버띄우기({ async respond() { return '네'; } }, { senders: { 'telegram.send': hand } }, dir);
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    // 실패 상태의 send 기록(원 인자에 여분 필드 포함) + 비전송 legacy 기록을 심는다.
    const sendRec = { ...makeDelivery({ id: 'd-send', sessionId: s.id, tool: 'telegram.send', target: '111',
      artifact: { text: '시험' }, args: { text: '시험', target: '111', mode: '원본유지' }, now: 1 }),
      state: 'failed', retriable: true, attempts: 1 };
    const legacyRec = { ...makeDelivery({ id: 'd-legacy', sessionId: s.id, tool: 'local.terminal', target: 'p-op7-pass4-test',
      artifact: {}, now: 1 }), state: 'failed', retriable: true, attempts: 1 };
    await writeFile(join(dir, 'deliveries.json'), JSON.stringify({ deliveries: [sendRec, legacyRec] }), 'utf8');
    // 목록: send 만 보인다.
    const list = await (await fetch(`${base}/deliveries?sessionId=${s.id}`)).json();
    assert.deepEqual(list.deliveries.map((d) => d.id), ['d-send'], '비전송 legacy 가 목록에 보인다');
    // 재시도: send 는 원 인자 그대로.
    const ok = await (await fetch(`${base}/deliveries/d-send/retry`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id }) })).json();
    assert.equal(ok.state, 'delivered');
    assert.equal(불린것.length, 1);
    assert.equal(불린것[0].mode, '원본유지', `원 인자가 재조립으로 소실됐다: ${JSON.stringify(불린것[0])}`);
    // 재시도: 비전송 legacy 는 실행 자체를 거부한다.
    const no = await fetch(`${base}/deliveries/d-legacy/retry`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id }) });
    assert.equal(no.status, 409, '비전송 legacy 재시도가 거부되지 않았다');
    assert.equal(불린것.length, 1, '거부됐는데 도구가 돌았다');
  } finally { await new Promise((r) => server.close(r)); }
});

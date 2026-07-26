import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSend } from '../src/kernel/l1-intent/send-parse.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

// ── 파서: send류 5~7문장(슬랙/텔레그램/메일). 대상·내용을 지시와 분리, 애매하면 clarify. ──
test('parseSend: 대상·내용 분리 / 애매하면 확인', () => {
  const ok = (t, tool, target, message) => {
    const p = parseSend(t, tool);
    assert.equal(p.ambiguous, false, `명확해야: ${t}`);
    assert.equal(p.target, target, `대상: ${t}`);
    assert.equal(p.message, message, `내용: ${t}`);
  };
  const clar = (t, tool, reason) => {
    const p = parseSend(t, tool);
    assert.equal(p.ambiguous, true, `애매해야: ${t}`);
    assert.equal(p.clarifyReason, reason);
  };
  // 명확: 대상 + 내용이 지시 문장과 분리된다(문장 전체 아님).
  ok('슬랙 #general에 회의 시작이라고 올려줘', 'slack.post', '#general', '회의 시작');
  ok('슬랙 #dev에 배포 완료 게시해줘', 'slack.post', '#dev', '배포 완료');
  ok('텔레그램으로 팀장에게 내일 3시 미팅이라고 보내줘', 'telegram.send', '팀장', '내일 3시 미팅');
  ok('김대리한테 "내일 휴가입니다" 텔레그램으로 보내줘', 'telegram.send', '김대리', '내일 휴가입니다');
  ok('abc@example.com 에게 회의록 공유 메일 보내줘', 'mail.send', 'abc@example.com', '회의록 공유');
  // 애매: 대상 없음(어디로?) / 내용 없음(무엇을?)
  clar('슬랙에 회의 시작 올려줘', 'slack.post', 'no_target');
  clar('메일 보내줘', 'mail.send', 'no_message');
});

// ── 통합: 정밀 인자로 전송 + 승인 preview(어디에/무엇을) + 애매하면 실행 안 하고 clarify ──
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

async function withSendServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-send-'));
  const calls = [];
  const recSender = { toolKind: 'send', async handler(args) { calls.push(args); return { result: { sent: true }, userSafeSummary: '보냈어요.' }; } };
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ senders: { 'slack.post': recSender } }) });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`, calls); }
  finally { await new Promise((r) => server.close(r)); }
}

test('통합: 승인 카드에 어디에/무엇을이 보이고, 실행은 분리된 내용으로만 전송', async () => {
  await withSendServer(async (base, calls) => {
    const s = await (await post(base, '/sessions')).json();
    const appr = await (await post(base, '/turn', { sessionId: s.id, text: '슬랙 #general에 회의 시작이라고 올려줘' })).json();
    assert.equal(appr.kind, 'approval');
    const g = appr.pending.find((p) => p.action === 'slack.post');
    assert.equal(g.preview.where, '#general', '어디에');
    assert.equal(g.preview.what, '회의 시작', '무엇을');
    // 승인 → 실제 전송은 문장 전체가 아니라 분리된 {target, text}로.
    const done = await (await post(base, '/turn', { sessionId: s.id, approve: appr.pendingId })).json();
    assert.equal(done.kind, 'reply');
    assert.equal(calls.length, 1, '1회 전송');
    assert.deepEqual(calls[0], { target: '#general', text: '회의 시작' }, '지시 문장이 아니라 내용만');
    assert.ok(!calls[0].text.includes('올려줘'), '지시어 미포함');
  });
});

test('통합: 대상 없으면 실행하지 않고 확인 질문(clarify), 전송 0', async () => {
  await withSendServer(async (base, calls) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '슬랙에 회의 시작 올려줘' })).json();
    assert.equal(r.kind, 'clarify', '대상 없으면 확인');
    assert.match(r.question, /어디(로|에)/);
    assert.equal(calls.length, 0, '확인 전 전송 0');
  });
});

test('통합: 보낼 내용 없으면 확인 질문(무엇을), 전송 0', async () => {
  await withSendServer(async (base, calls) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '슬랙 #general에 올려줘' })).json();
    assert.equal(r.kind, 'clarify');
    assert.match(r.question, /(무엇|어떤 내용)/);
    assert.equal(calls.length, 0);
  });
});

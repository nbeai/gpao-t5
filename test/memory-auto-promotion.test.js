// §5-5 「기억을 새 대화까지 완결한다」 — **대화를 건너뛰어도 사는가**를 재는 검사.
//
// 이 파일의 내력(2026-08-12 병합 판정):
//   브랜치 `worktree-agent-a63f71265aa07dc7a`(69a4678)가 §5-5 를 낡은 기준(ca47832)에서
//   새로 구현하며 이 파일을 만들었다. 그 뒤 본선이 **같은 기능을 S1(74be435)에서 이미**
//   세웠고(모델이 `memory.propose` 의 `evidence.appliesTo` 로 범위를 말하면 서버가 카드 없이
//   반영), 병합에서 본선 통로 하나만 남겼다 — 승격 통로가 둘이면 갈라지기 때문이다.
//   그래서 이 검사는 **브랜치의 장치(`promoted` 플래그·정규식 자격)를 재지 않는다.**
//   대신 그 브랜치가 지키려 했던 **사용자 쪽 사실**을 본선 통로 위에서 그대로 잰다.
//
// 여기서만 잡는 것(본선 다른 검사가 안 잡는 자리):
//   `reversible-memory.test.js` 는 **한 대화 안**에서 반영·철회를 잰다. §5-5 의 약속은
//   그다음이다 — *"새 대화에서도, 서버를 다시 띄워도 그 기억이 산다."* 저장됐다가 아니라
//   **다음 대화의 모델 입력(admittedContext)에 실제로 들어갔다**를 판정 자로 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { MemoryStore } from '../src/surface/memory-store.js';

const 선호 = '앞으로 보고서는 목록으로 써줘.';
const 민감 = '이 API 키 기억해둬: sk-test-0000000000000000000000000000';

/**
 * 대본 모델 + **모델이 실제로 무엇을 봤는지** 기록기.
 * 정산 호출(`workStateSettlement`)은 대본을 소비하지 않는다 — 안 그러면 턴당 호출이 하나
 * 늘어 대본이 통째로 밀린다(기존 서버 검사 관례 그대로).
 */
function 모델(대본, 본것) {
  const script = [...대본];
  return {
    async respond(tc, opts = {}) {
      if (tc?.workStateSettlement) return { text: '', toolCalls: [{ name: 'work.state', args: { noChange: true } }] };
      본것?.push(tc);
      if ((opts.tools ?? []).some((tool) => tool.name === 'control.select')
        && String(script[0]?.name ?? '').startsWith('memory.')) {
        return { text: '', toolCalls: [{ name: 'control.select', args: { categories: ['memory'] } }] };
      }
      const next = script.shift();
      return next ? { text: '', toolCalls: [next] } : '알겠어요.';
    },
  };
}

/** 사용자가 "앞으로"라고 말한 선언 — 범위를 **모델이 말한다**(본선 자동 반영 게이트의 재료). */
const 선언 = (quote, 범위 = 'from_now_on') => ({
  name: 'memory.propose',
  args: { kind: 'preference', statement: quote, evidence: { utteranceQuote: quote, speechAct: 'declaration', appliesTo: 범위 } },
});

async function 서버(dir, 대본, 본것) {
  const server = makeServer({ store: new SessionStore(dir), model: 모델(대본, 본것) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json());
const 새대화 = (base) => post(base, '/sessions');
const 닫기 = (server) => new Promise((r) => server.close(r));

// ── ① §5-5 핵심: 새 대화까지 산다 ─────────────────────────────────────────
test('§5-5: 카드 없이 반영된 기억이 **새 대화**의 모델 입력에 들어간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-mem55-'));
  const 본것 = [];
  const { server, base } = await 서버(dir, [선언(선호)], 본것);
  try {
    const a = await 새대화(base);
    const r = await post(base, '/turn', { sessionId: a.id, text: 선호 });
    assert.ok(r.memoryApplied?.undoId, '카드 없이 반영되고 되돌리기가 함께 온다(§7)');
    assert.equal(r.memorySuggestion, undefined, '확정 카드를 묻지 않는다');
    assert.equal((await new MemoryStore(dir).load()).promoted.length, 1, 'memory.json 실물에 남는다');

    const b = await 새대화(base);            // **다른 대화**
    await post(base, '/turn', { sessionId: b.id, text: '보고서 하나 써줘' });
    assert.ok(본것.at(-1).admittedContext.includes(선호), '새 대화의 모델 입력에 그 기억이 입장한다');
  } finally { await 닫기(server); }
});

// ── ② 재시작해도 산다 — 저장소 재로드가 진실이다 ──────────────────────────
test('§5-5: 서버를 다시 띄워도(저장소 재로드) 그 기억이 새 대화에 들어간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-mem55-'));
  const 첫 = await 서버(dir, [선언(선호)], []);
  try {
    const s = await 새대화(첫.base);
    await post(첫.base, '/turn', { sessionId: s.id, text: 선호 });
  } finally { await 닫기(첫.server); }

  const 본것 = [];
  const 둘 = await 서버(dir, [], 본것);      // 같은 방을 다시 연다 = 재시작
  try {
    const s2 = await 새대화(둘.base);
    await post(둘.base, '/turn', { sessionId: s2.id, text: '보고서 하나 써줘' });
    assert.ok(본것.at(-1).admittedContext.includes(선호), '재시작 뒤에도 입장한다');
  } finally { await 닫기(둘.server); }
});

// ── ③ 일회성은 다음 대화로 넘어가지 않는다 ────────────────────────────────
//   범위를 **모델이 "이번 턴만"이라고 말한** 경우다. 본선은 이걸 기억으로 두지 않는다 —
//   그 지시는 이미 이번 대화 안에 있어 이번 답에 그대로 반영되고, 남길 이유가 없다.
test('§5-5: 일회성(this_turn_only)은 승격도 후보도 아니며 다음 대화에 안 남는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-mem55-'));
  const 본것 = [];
  const 일회성 = '이번 보고서만 표로.';
  const { server, base } = await 서버(dir, [선언(일회성, 'this_turn_only')], 본것);
  try {
    const a = await 새대화(base);
    const r = await post(base, '/turn', { sessionId: a.id, text: 일회성 });
    assert.equal(r.memoryApplied, undefined, '일회성은 자동 반영 금지');
    const m = await new MemoryStore(dir).load();
    assert.equal(m.promoted.length, 0, '다음 대화에 남을 것이 없다');
    assert.equal(m.candidates.length, 0, '이번 턴뿐인 지시는 후보로도 남기지 않는다');

    const b = await 새대화(base);
    await post(base, '/turn', { sessionId: b.id, text: '보고서 하나 써줘' });
    assert.deepEqual(본것.at(-1).admittedContext, [], '새 대화는 그 지시를 안 물려받는다');
  } finally { await 닫기(server); }
});

// ── ④ 되돌리기 한 번이면 다음 대화에서 사라진다 ───────────────────────────
test('§5-5: 되돌리기 한 번이면 다음 대화 모델 입력에 다시 안 들어간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-mem55-'));
  const 본것 = [];
  const { server, base } = await 서버(dir, [선언(선호)], 본것);
  try {
    const a = await 새대화(base);
    const r = await post(base, '/turn', { sessionId: a.id, text: 선호 });
    const g = await post(base, '/memory/rollback', { candidateId: r.memoryApplied.undoId });
    assert.equal(g.rolledBack, true, '한 번에 철회');

    const b = await 새대화(base);
    await post(base, '/turn', { sessionId: b.id, text: '보고서 하나 써줘' });
    assert.deepEqual(본것.at(-1).admittedContext, [], '철회한 기억은 다시 개입하지 않는다');
    assert.equal((await new MemoryStore(dir).load()).promoted.length, 0, 'memory.json 실물에서도 사라진다');
  } finally { await 닫기(server); }
});

// ── ⑤ 민감값은 장기 기억으로 흐르지 않는다(H07 회귀 금지선) ───────────────
//   모델이 "앞으로 기억하라"고 제안해도 막힌다 — 막힌 쪽이 안전한 방향이다.
test('§5-5: 민감값은 모델이 선언으로 제안해도 장기 기억 유입 0', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-mem55-'));
  const { server, base } = await 서버(dir, [선언(민감)], []);
  try {
    const a = await 새대화(base);
    const r = await post(base, '/turn', { sessionId: a.id, text: 민감 });
    assert.equal(r.memoryApplied, undefined, '민감값 자동 반영 금지');
    const m = await new MemoryStore(dir).load();
    assert.equal(m.promoted.length, 0, '승격 0');
    assert.equal(m.candidates.length, 0, '후보로도 남기지 않는다');
    assert.ok(!JSON.stringify(m).includes('sk-test-'), '기억 어디에도 키가 없다');
  } finally { await 닫기(server); }
});

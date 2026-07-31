// S5 봉인 — **조각들이 한 사슬로 이어지는가.**
//
// S5-1~5 는 각자 자기 시험이 있다. 그런데 슬라이스마다 따로 재면, 조각은 다 통과하는데
// 이어 붙이면 어긋나는 일이 생긴다. 이번 슬라이스에서 실제로 그랬다 — 성장 표면과 옛 요약이
// **같은 항목을 두고 다른 상태를 말하고 있었다.** 조각 시험 어느 것도 그걸 볼 수 없었다.
//
// 그래서 이 파일은 하나의 기억 위에서, 하나의 제품 경로로, 처음부터 끝까지 간다:
//
//   보임 → 인용 → 정정 ×2 → 감쇠 → 입장 0 → 복원 → 입장 O → 붙듦 → 감쇠 면제 → 치움 → 입장 0
//
// 대역은 모델 하나뿐이다(무엇을 인용하고 무엇을 고칠지 정하는 것은 모델의 판단이라 시험이
// 대신 정한다). 나머지 — 턴 실행·기록·상관·감쇠·표면·원장 — 는 전부 제품 코드다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, MemoryLedger } from '../src/surface/memory-store.js';
import { SessionStore } from '../src/surface/session-store.js';
import { EventLog } from '../src/surface/event-log.js';
import { makeServer } from '../src/surface/server.js';
import { demoTools } from '../src/surface/demo-context.js';

const 원리문장 = '월별 수치는 표로 정리한다';
const 관련요청 = '월별 수치 정리해줘';
const 원리id = 'p-원리';

async function 세우기() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-seal-'));
  const mem = new MemoryStore(dir);
  const m = await mem.load();
  m.promoted = [{
    candidateId: 원리id, kind: 'operating_principle', statement: 원리문장,
    principleId: 원리id, principleVersion: 2,
    admitted: true, userConfirmed: true, replayPassed: true,
    scopeSignals: { appliesWhen: [관련요청, '7월 수치 정리해줘'], notWhen: [] },
  }];
  await mem.save(m);

  // 모델 대역: 시험이 미리 정해 둔 통제 호출을 그대로 낸다.
  let 다음호출 = [];
  const 받은것 = [];
  const server = makeServer({
    store: new SessionStore(dir), eventLog: new EventLog(dir), tools: demoTools(),
    model: {
      async respond(tc) {
        받은것.push(tc);
        const calls = 다음호출; 다음호출 = [];
        return calls.length ? { text: '정리했어요.', toolCalls: calls } : '정리했어요.';
      },
    },
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}),
  }).then((r) => r.json());
  const get = (p) => fetch(`${base}${p}`).then((r) => r.json());

  const 턴 = async (sessionId, text, calls = []) => {
    다음호출 = calls;
    const r = await post('/turn', { sessionId, text });
    return { 답: r, 모델입력: 받은것.at(-1) };
  };
  const 입장 = async () => {
    const s = await post('/sessions');
    const { 모델입력 } = await 턴(s.id, 관련요청);
    return 모델입력.admittedContext ?? [];
  };
  const 상태 = async () => Object.fromEntries(
    (await get('/memory/state')).items.map((x) => [x.id, x.state]),
  );
  return { dir, mem, server, post, get, 턴, 입장, 상태, 받은것 };
}

/** 정정 두 번을 서로 다른 대화에서 만든다 — 같은 턴 중복은 통계를 부풀리지 않는다. */
async function 정정두번(post, 턴) {
  for (let i = 0; i < 2; i += 1) {
    const s = await post('/sessions');
    await 턴(s.id, 관련요청, [{ name: 'memory.cite', args: { used: [원리문장] } }]);
    await 턴(s.id, '아니 그거 말고 한 문장으로', [
      { name: 'memory.correction', args: { target: 원리문장, reason: '표 말고 문장을 원했다' } },
    ]);
  }
}

test('S5 봉인: 보임 → 인용 → 정정 → 감쇠 → 복원 → 붙듦 → 치움이 한 사슬로 이어진다', async () => {
  const { dir, mem, server, post, get, 턴, 입장, 상태 } = await 세우기();
  try {
    // ① 보임 — 입장한 것이 실제 렌더에 실렸고, 그 사실이 신분과 함께 남는다(S5-1)
    assert.deepEqual(await 입장(), [원리문장], '기본 입장');
    let m = await mem.load();
    assert.deepEqual((m.shownRefs.at(-1).refs ?? []).map((r) => r.statement), [원리문장]);

    // ② 인용 + ③ 정정 ×2 — 근거는 **지목**이고 인용은 확신만 올린다(S5-2/S5-3)
    await 정정두번(post, 턴);
    m = await mem.load();
    const 칸 = (m.correctionCorrelation ?? []).find((x) => x.ref === 원리id);
    assert.equal(칸?.turns.length, 2, '독립된 두 턴에서 상관이 쌓인다');
    assert.ok(칸.turns.every((t) => t.confidence === 'cited'), '인용이 있었으니 확신은 cited');
    // 상관이 쌓였을 뿐 아직 아무것도 안 내려갔다 — 통계는 판단이 아니다.
    assert.deepEqual(await 입장(), [원리문장], '상관만으로는 안 내려간다');

    // ④ 감쇠 — **제품의 tick 이** 내린다. 시험이 `applyDecay` 를 직접 부르면 원장·워커 경계를
    //    건너뛰어, 실제로는 안 남는 영수증을 남는다고 믿게 된다.
    const tick = await server.runtimeTick();
    assert.deepEqual((tick.decay?.decayed ?? []).map((d) => d.ref), [원리id], 'tick 이 내린다');

    // ⑤ 입장 0 — 잘못된 기억이 실제로 덜 들어간다
    assert.deepEqual(await 입장(), [], '내려간 것은 모델 앞에 놓이지 않는다');
    // ⑥ 모든 읽기 표면이 같은 상태를 말한다 — 여기가 이번에 갈라졌던 자리다
    assert.equal((await 상태())[원리id], 'decayed');
    // 두 엔드포인트가 같은 항목을 각각 보고하는 것은 정상이다(자리가 둘). 보는 것은 **무엇이
    // 반영 중이라 불리는가**이지 몇 번 세는가가 아니다.
    const 반영중 = async () => [...new Set([
      ...(await get('/overview')).preferences.reflected,
      ...(await get('/memory')).promoted,
    ].map((x) => x.statement))];
    assert.deepEqual(await 반영중(), [], '어떤 표면도 "반영 중"이라 하지 않는다');
    // 사라진 것은 아니다 — 되돌릴 자리가 남아 있다
    assert.ok((await get('/memory')).decayed.some((d) => d.ref === 원리id), '되돌릴 자리');

    // ⑦ 복원 — 사용자가 되돌리면 실제로 되살아난다
    assert.equal((await post('/memory/restore', { candidateId: 원리id })).ok, true);
    assert.deepEqual(await 입장(), [원리문장], '복원하면 다시 모델 앞에 놓인다');
    assert.deepEqual(await 반영중(), [원리문장], '표면도 함께 돌아온다');

    // ⑧ 붙듦 — 같은 근거가 또 쌓여도 OS 가 떼지 않는다
    assert.equal((await post('/memory/pin', { id: 원리id, pinned: true })).ok, true);
    await 정정두번(post, 턴);
    const tick2 = await server.runtimeTick();
    assert.deepEqual(tick2.decay?.decayed ?? [], [], '붙든 것은 자동 감쇠 면제');
    assert.deepEqual(await 입장(), [원리문장], '붙든 것은 그대로 든다');

    // ⑨ 치움 — 사용자가 치우면 즉시 빠지고, 되돌리면 돌아온다
    assert.equal((await post('/memory/archive', { id: 원리id })).ok, true);
    assert.deepEqual(await 입장(), [], '치운 것은 들지 않는다');
    assert.equal((await 상태())[원리id], 'archived');
    assert.equal((await post('/memory/restore', { id: 원리id })).ok, true);
    assert.deepEqual(await 입장(), [원리문장], '되돌리면 돌아온다');

    // ⑩ 원장 — 필요한 사실은 남고 원문은 남지 않는다
    const 원장 = await new MemoryLedger(dir).load();
    const 사건 = 원장.entries.map((e) => e.event);
    for (const 있어야 of ['decayed', 'restored', 'pinned', 'archived']) {
      assert.ok(사건.includes(있어야), `원장에 ${있어야} 없음`);
    }
    assert.equal(JSON.stringify(원장).includes(원리문장), false, '원장에 원문이 남았다');
  } finally { server.close(); }
});

test('S5 봉인: 사슬 전체에서 카드·승인·내부 신분이 늘지 않는다', async () => {
  const { server, post, get, 턴, 입장, 상태, 받은것 } = await 세우기();
  try {
    const 카드수 = async () => {
      const o = await get('/overview');
      return (o.preferences.pending ?? []).length;
    };
    const 시작카드 = await 카드수();
    await 입장();
    await 정정두번(post, 턴);
    await post('/memory/pin', { id: 원리id, pinned: true });
    await post('/memory/archive', { id: 원리id });
    await post('/memory/restore', { id: 원리id });

    assert.equal(await 카드수(), 시작카드, '사슬을 다 돌아도 확인 카드가 늘지 않는다');
    // 내부 신분은 OS 안에서만 산다 — 사용자 답변에도 모델 입력에도 나가지 않는다.
    const 상태값 = await 상태();
    assert.ok(Object.keys(상태값).includes(원리id), '표면 내부에는 신분이 있다');
    for (const tc of 받은것) {
      assert.equal(JSON.stringify(tc).includes(원리id), false, '모델 입력에 내부 신분 노출');
    }
  } finally { server.close(); }
});

test('S5 봉인: 사슬 중간이 끊겨도 조용히 잘못 내려가지 않는다', async () => {
  const { mem, server, post, 턴, 입장 } = await 세우기();
  try {
    // 모델이 지목 없이 "고쳤다"고만 하면 — 무엇을 고치는지 모르면 아무 데도 표식하지 않는다.
    const s = await post('/sessions');
    await 턴(s.id, 관련요청);
    await 턴(s.id, '아니 그거 말고', [{ name: 'memory.correction', args: { reason: '그냥' } }]);
    let m = await mem.load();
    assert.deepEqual(m.correctionCorrelation ?? [], [], '지목 없는 정정은 상관을 만들지 않는다');

    // 보인 적 없는 것을 지목해도 마찬가지다 — 허공 지목은 신분을 얻지 못한다.
    await 턴(s.id, '아니', [{ name: 'memory.correction', args: { target: '보인 적 없는 문장' } }]);
    m = await mem.load();
    assert.deepEqual(m.correctionCorrelation ?? [], [], '허공 지목은 상관을 만들지 않는다');

    assert.deepEqual((await server.runtimeTick()).decay?.decayed ?? [], [], '근거가 없으면 안 내린다');
    assert.deepEqual(await 입장(), [원리문장], '멀쩡한 기억은 그대로 있다');
  } finally { server.close(); }
});

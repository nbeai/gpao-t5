// S4 · 회차 재시도가 **학습 품질을 실제로 개선하는가** — 격리 제어 시간 환경에서의 증명.
//
// 라이브의 round 0 은 6시간 cooldown 뒤에야 다음 회차가 열린다. 그 6시간을 개발 절차로
// 받아들이지 않는다. 여기서는 **주입한 시계**로 cooldown 만료를 만들어 round 1 을 즉시 돌린다.
// 제품 데이터는 건드리지 않는다 — 이 파일은 자기 임시 폴더에서만 산다.
//
// 증명해야 하는 것은 "회차가 한 번 더 돈다"가 아니다. **앞 회차의 실패가 다음 원리의 내용을
// 바꾸는가**이다. 그래서 모델 대역은 두 경우에 같은 함수다 — 앞 실패를 봤으면 좁히고, 못
// 봤으면 같은 넓은 원리를 다시 낸다. 통과/불통과가 갈리면 그 원인은 **실패 이력 하나뿐**이다.
//
// 마지막으로 H02 효과를 같은 격리 환경에서 재현하되, **lane 을 비운 상태**로 잰다.
// 그래야 "재질문이 준 것은 S3 승계인가 S4 원리인가"가 구조적으로 갈린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/surface/memory-store.js';
import { SessionStore } from '../src/surface/session-store.js';
import { EventLog } from '../src/surface/event-log.js';
import { makeServer } from '../src/surface/server.js';
import { demoTools } from '../src/surface/demo-context.js';
import { admittedContext, confirmCandidate } from '../src/kernel/l1-intent/context-mesh.js';
import { growTick, GROW_CAPS } from '../src/kernel/l5-growth/tcell-grow.js';

const 신분 = () => ({
  callId: 'call-1',
  selection: {
    requestedRole: 'growth', resolution: 'bound',
    connectionInstanceId: 'conn-A', credentialRef: 'cred-A',
    providerId: 'openai', endpointOrigin: 'https://api.openai.com', requestModelId: 'gpt-5.1',
  },
  actualEndpointOrigin: 'https://api.openai.com',
  actualRequestModelId: 'gpt-5.1',
  responseModelId: 'gpt-5.1',
  responseIdentitySource: 'response_field',
  startedAt: 1, finishedAt: 2,
});

// 라이브 round 0 이 실제로 떨어진 모양 그대로: 넓은 원리가 negative 에서 과잉 적용했다.
const 넓은원리 = '월별 수치를 주면 표로 정리하고 지표를 계산한다';
const 좁은원리 = '월별 수치 정리를 요청하면 표로 정리한다(사용자가 다른 형식을 지정하면 그 요청을 따른다)';

/** 기대·금지 사실을 **낱말 그대로** 두어 판정이 기계적으로 재현되게 한다. */
const 사례들 = [
  { kind: 'positive', inputFacts: ['7월 수치를 정리해달라고 했다'], expectedFacts: ['표'], forbiddenFacts: ['문장 요약'] },
  { kind: 'positive', inputFacts: ['8월 수치를 정리해달라고 했다'], expectedFacts: ['표'], forbiddenFacts: ['문장 요약'] },
  { kind: 'negative', inputFacts: ['표 대신 간단한 문장 요약으로 달라고 명시했다'], expectedFacts: ['문장 요약'], forbiddenFacts: ['표'] },
  { kind: 'boundary', inputFacts: ['9월 수치를 정리해달라고 했다'], expectedFacts: ['표'], forbiddenFacts: ['문장 요약'] },
  { kind: 'boundary', inputFacts: ['10월 수치를 정리해달라고 했다'], expectedFacts: ['표'], forbiddenFacts: ['문장 요약'] },
];

/**
 * **한 함수가 두 회차를 다 답한다.** 갈리는 것은 입력뿐이다.
 *  · 제안: 요청에 앞 회차 실패가 실려 있으면 적용 제외를 넣어 좁히고, 없으면 같은 넓은 원리.
 *  · 실행: 원리에 적용 제외가 있으면 사용자가 지정한 형식을 따르고, 없으면 무조건 표로 낸다.
 *  · 판정: 기대 낱말이 다 있고 금지 낱말이 없으면 통과(사람 취향이 아니라 낱말 대조).
 */
function 회차반응모델() {
  const calls = [];
  const modelFor = (role) => ({
    async respond(tc, opts = {}) {
      const q = String(tc.currentRequest);
      calls.push({ role, request: q, tools: opts.tools ?? null });
      opts.onCallIdentity?.(신분());

      if (q.includes('운영 원리 후보 하나')) {
        // 좁히는 방아쇠는 **실제로 전달되는 신호**여야 한다: 앞 회차가 있고, 금지 사실이
        // 나왔다는 것(negative 과잉 적용)이 그 안에 적혀 있을 때.
        const 앞실패봤나 = q.includes('앞선 회차')
          && (q.includes('forbidden_fact_occurred') || q.includes('negative:'));
        return JSON.stringify({ statement: 앞실패봤나 ? 좁은원리 : 넓은원리, cases: 사례들 });
      }
      if (q.includes('이번 답에 한해 적용할 원리')) {
        const 제외있음 = q.includes('다른 형식을 지정하면');
        const 사용자가지정 = q.includes('문장 요약');
        return 제외있음 && 사용자가지정 ? '문장 요약으로 드립니다.' : '표로 정리했습니다.';
      }
      // 판정 — 답에 기대 낱말이 다 있고 금지 낱말이 없으면 통과.
      const 답 = /\[원리를 놓고 나온 답\] ([\s\S]*?)\n\nJSON/.exec(q)?.[1] ?? '';
      const 기대 = (/기대 사실: (.*)/.exec(q)?.[1] ?? '').split(' / ').filter((x) => x && x !== '(없음)');
      const 금지 = (/금지 사실: (.*)/.exec(q)?.[1] ?? '').split(' / ').filter((x) => x && x !== '(없음)');
      const pass = 기대.every((f) => 답.includes(f)) && !금지.some((f) => 답.includes(f));
      return JSON.stringify({ pass, rationale: pass ? '기대를 지켰다' : '금지 사실이 나왔다' });
    },
  });
  return { modelFor, calls };
}

/** 익은 묶음 하나가 있는 격리 기억. 제품 데이터와 무관한 임시 폴더다. */
async function 격리기억(dir) {
  const memStore = new MemoryStore(dir ?? await mkdtemp(join(tmpdir(), 'gpao-t5-round-')));
  const m = await memStore.load();
  m.observations = [1, 2, 3].map((i) => ({
    observationId: `o-${i}`, turnRef: { sessionId: 's-1', turnSeq: i * 2 },
    kind: 'request', subject: '월별 수치 정리', at: 1_000,
  }));
  m.bundles = [{
    bundleId: 'b-월별', kind: 'request', subject: '월별 수치 정리',
    observationIds: ['o-1', 'o-2', 'o-3'], count: 3, firstAt: 1_000, lastAt: 1_000,
  }];
  await memStore.save(m);
  return memStore;
}

/** 주입한 시계로 한 회차를 끝까지 돌린다. tick 마다 계획 상한을 지키는지 함께 본다. */
async function 회차돌리기(memStore, modelFor, 시작) {
  let now = 시작;
  const 기록 = [];
  for (let i = 0; i < 40; i += 1) {
    const r = await growTick({ memStore, modelFor, now });
    assert.ok(r.calls <= GROW_CAPS.callsPerTick, `tick 당 호출 ${r.calls} > 상한`);
    기록.push(r);
    now += 1_000;
    if (r.reason === 'idle' || r.action === 'finish') break;
  }
  return { 기록, now };
}

// ── ① 격리 시간 주입: round 0 실패 → cooldown 만료 주입 → round 1 ────────
test('S4/격리: 앞 회차 실패를 본 round 1 이 더 좁은 원리를 만들고 suite 를 통과한다', async () => {
  const memStore = await 격리기억();
  const 모델 = 회차반응모델();

  // round 0 — 앞 회차가 없으니 넓은 원리가 나오고, negative 에서 과잉 적용해 떨어진다.
  const r0 = await 회차돌리기(memStore, 모델.modelFor, 100_000);
  const 마지막0 = r0.기록[r0.기록.length - 1];
  assert.equal(마지막0.action, 'finish');
  assert.equal(마지막0.pass, false, 'round 0 은 떨어진다(라이브와 같은 모양)');

  const 기억0 = await memStore.load();
  const 후보0 = 기억0.candidates.find((c) => c.statement === 넓은원리);
  assert.ok(후보0, '넓은 원리가 후보로 남는다');
  assert.ok(후보0.replayReport.missing.includes('forbidden_fact_occurred'), '금지 사실이 나왔다');
  assert.deepEqual(confirmCandidate(await memStore.load(), 후보0.candidateId), { ok: false, reason: 'replay_failed' });

  const job0 = 기억0.growJobs[0];
  assert.equal(job0.state, 'cooldown');
  assert.equal(job0.round, 0);

  // **시간 주입은 만료를 앞당기지 않는다.** 만료 **전** 시각을 주면 아무 일도 없어야 한다 —
  // 이게 없으면 "주입한 시계로 통과시켰다"와 "회차가 열려서 통과했다"가 구분되지 않는다.
  const 아직 = 회차반응모델();
  const 이른tick = await growTick({ memStore, modelFor: 아직.modelFor, now: job0.nextAttemptAt - 1 });
  assert.equal(이른tick.reason, 'idle', '만료 전에는 회차가 열리지 않는다');
  assert.equal(아직.calls.length, 0, '만료 전에는 모델을 부르지도 않는다');

  // **시간 주입** — 자연 대기 대신 cooldown 만료 시각을 직접 준다.
  const 만료뒤 = job0.nextAttemptAt + 1;
  const r1 = await 회차돌리기(memStore, 모델.modelFor, 만료뒤);
  const 마지막1 = r1.기록[r1.기록.length - 1];

  // ② 앞 회차 실패가 **실제 후보 생성 입력**에 들어갔나.
  const 제안요청 = 모델.calls.find((c) => c.request.includes('운영 원리 후보 하나') && c.request.includes('앞선 회차'));
  assert.ok(제안요청, 'round 1 제안 요청에 앞 회차 이야기가 실렸다');
  assert.ok(제안요청.request.includes(넓은원리), '떨어진 원리 문장이 그대로 전달됐다');
  assert.match(제안요청.request, /금지 사실이 나왔다/, '왜 떨어졌는지도 전달됐다');
  assert.match(제안요청.request, /적용하지 않을 상황/, '더 좁게 쓰라는 요구가 실렸다');

  // ③ 새 원리가 더 좁아졌고 적용 제외가 들어갔나.
  const 기억1 = await memStore.load();
  const 후보1 = 기억1.candidates.find((c) => c.statement === 좁은원리);
  assert.ok(후보1, 'round 1 은 다른(좁은) 원리를 냈다');
  assert.match(후보1.statement, /다른 형식을 지정하면/, '적용 제외 조건이 원리 문장 안에 있다');
  assert.notEqual(후보1.candidateId, 후보0.candidateId, '앞 회차 후보를 덮어쓰지 않는다');
  assert.equal(후보1.principleVersion, 2, '회차가 다르면 원리 판도 다르다');

  // ④ suite 통과.
  assert.equal(마지막1.pass, true, '좁힌 원리는 suite 를 통과한다');
  assert.deepEqual(후보1.replayReport.missing, []);

  // ⑤ 통과했어도 확인 전에는 입장 0, 확인하면 그때 입장.
  const 기억2 = await memStore.load();
  assert.equal(admittedContext(기억2, '월별 수치 정리해줘').length, 0, '확인 전 영향 0');
  assert.equal(confirmCandidate(기억2, 후보1.candidateId).ok, true);
  assert.deepEqual(admittedContext(기억2, '월별 수치 정리해줘'), [좁은원리]);
});

test('S4/격리: 앞 회차 실패를 못 보면 같은 원리로 또 떨어진다(개선의 원인은 이력 하나뿐)', async () => {
  // 위 검사와 **모델 함수가 같다.** 다른 것은 입력에 앞 실패가 실렸는가뿐이다.
  // 이 대조가 없으면 "두 번째가 통과했다"는 사실이 이력 덕인지 우연인지 말할 수 없다.
  const memStore = await 격리기억();
  const 모델 = 회차반응모델();
  const r0 = await 회차돌리기(memStore, 모델.modelFor, 100_000);
  assert.equal(r0.기록[r0.기록.length - 1].pass, false);

  const 기억 = await memStore.load();
  const job = 기억.growJobs[0];
  // 이력을 지운 채로(= 통로가 없는 상태) 다음 회차를 연다.
  delete job.실패요약;
  job.statement = null;
  job.principleId = null;
  기억.candidates = [];
  기억.replayCases = [];
  await memStore.save(기억);

  const 모델2 = 회차반응모델();
  const r1 = await 회차돌리기(memStore, 모델2.modelFor, job.nextAttemptAt + 1);
  const 제안 = 모델2.calls.find((c) => c.request.includes('운영 원리 후보 하나'));
  assert.equal(/앞선 회차/.test(제안.request), false, '이력이 없으면 아무 말도 안 한다');
  assert.equal(r1.기록[r1.기록.length - 1].pass, false, '같은 넓은 원리로 또 떨어진다');
  const 뒤 = await memStore.load();
  assert.ok(뒤.candidates.some((c) => c.statement === 넓은원리), '좁아지지 않았다');
});

// ── ⑥ H02 효과를 격리에서 재현하되, **lane 을 비워 S3 기여를 뺀다** ───────
const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
}).then((r) => r.json());

/** 대화 이력이 **없는** 격리 서버 하나. lane 이 물어 올 앞 대화가 아예 없다. */
async function 빈서버(원리상태) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-round-srv-'));
  const mem = new MemoryStore(dir);
  const m = await mem.load();
  m.candidates = [{
    candidateId: 'p-좁은', kind: 'operating_principle', statement: 좁은원리,
    principleId: 'p-좁은', principleVersion: 2,
    admitted: false, userConfirmed: false, replayPassed: false,
    replayReport: { pass: true, missing: [], counted: 5 },
  }];
  await mem.save(m);

  const 받은것 = [];
  const server = makeServer({
    store: new SessionStore(dir), eventLog: new EventLog(dir), tools: demoTools(),
    model: { async respond(tc) { 받은것.push(tc); return '알겠어요.'; } },
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // 승격은 **제품 경로**로 한다. 이 호출은 대화를 만들지 않으므로 lane 은 여전히 비어 있다.
  if (원리상태 === 'promoted') {
    const 확인 = await post(base, '/memory/confirm', { candidateId: 'p-좁은' });
    assert.equal(확인.ok, true, 'suite 를 통과한 원리는 확인이 받아들여진다');
  }
  return { server, base, mem, 받은것 };
}

test('S4/격리: 승격된 원리만 새 대화 모델 입력에 든다 — lane 은 양쪽 다 비어 있다(S3 기여 분리)', async () => {
  // **핵심 분리.** 두 서버 모두 앞 대화가 없어 `carryableWork` 가 0 이다. 그러면 모델 입력의
  // 차이는 오직 "그 원리가 승격됐는가" 하나뿐이고, 그 차이는 S3 lane 으로 설명될 수 없다.
  const 미승격 = await 빈서버('candidate');
  const 승격됨 = await 빈서버('promoted');
  try {
    const 질문 = '11월 수치도 정리해줘';
    const a = await post(미승격.base, '/sessions');
    await post(미승격.base, '/turn', { sessionId: a.id, text: 질문 });
    const 대조 = 미승격.받은것.at(-1);

    const b = await post(승격됨.base, '/sessions');
    await post(승격됨.base, '/turn', { sessionId: b.id, text: 질문 });
    const 실험 = 승격됨.받은것.at(-1);

    assert.deepEqual(대조.carryableWork ?? [], [], '대조군 lane 0');
    assert.deepEqual(실험.carryableWork ?? [], [], '실험군 lane 0 — 이 효과는 S3 가 아니다');
    assert.deepEqual(대조.admittedContext, [], '승격 전에는 모델 입력에 없다');
    assert.deepEqual(실험.admittedContext, [좁은원리], '승격된 원리만 새 대화 모델 입력에 든다');

    // 이중 방어: 어쩌다 promoted 레인에 들어가도 **replay 미통과 원리는 입장하지 않는다.**
    const m = await 승격됨.mem.load();
    m.promoted = [...m.promoted, {
      candidateId: 'p-미검증', kind: 'operating_principle',
      statement: '월별 수치는 무조건 표로만 낸다', admitted: true, userConfirmed: true,
      replayPassed: false,
    }];
    await 승격됨.mem.save(m);
    const d = await post(승격됨.base, '/sessions');
    await post(승격됨.base, '/turn', { sessionId: d.id, text: 질문 });
    assert.deepEqual(승격됨.받은것.at(-1).admittedContext, [좁은원리],
      'replay 를 통과하지 않은 원리는 promoted 에 있어도 들어가지 않는다');

    // 인접 요청 — 과잉 적용 0. 원리가 닿지 않는 말에는 승격돼 있어도 들어가지 않는다.
    const c = await post(승격됨.base, '/sessions');
    await post(승격됨.base, '/turn', { sessionId: c.id, text: '오늘 점심 뭐 먹을지 하나만 골라줘.' });
    assert.deepEqual(승격됨.받은것.at(-1).admittedContext, [], '무관한 요청에는 원리가 들어가지 않는다');
  } finally { 미승격.server.close(); 승격됨.server.close(); }
});

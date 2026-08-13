// F-114b · §5-4 — 실패 뒤 새 관찰이 생겼으면 같은 행동도 새 증거 세대의 판단이다.
// BomM92 실물 축약: focus(dispatched/unsatisfied) → observe(같은 창·pid) → focus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 초점 = { name: 'desktop.act', args: { action: 'focus', app: '계산기' } };
const 관찰 = { name: 'desktop.screen', args: {
  action: 'observe', scope: 'window', app: '계산기', 깊이: 3, limit: 40, 글자만: false,
} };
const 상태관찰 = { name: 'desktop.screen', args: { action: 'status', app: '계산기' } };
const 가짜관찰 = { name: 'fixture.observe', args: { action: 'observe', app: '계산기' } };

function 순서모델(calls, answer = '화면 행동 결과를 확인하지 못했어요.') {
  let i = 0;
  return {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) {
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      }
      if (!opts.tools?.length || i >= calls.length) return { text: answer, toolCalls: [] };
      return { text: '', toolCalls: [calls[i++]] };
    },
  };
}

function 화면판({
  첫초점성공 = false,
  진행판정 = 'unsatisfied',
  다음방법 = ['observe', 'retry'],
  관찰창 = 813,
  관찰pid = 18355,
} = {}) {
  let focusCalls = 0;
  const desktopAct = {
    async handler() {
      focusCalls += 1;
      if (focusCalls === 1 && !첫초점성공) return {
        failed: true,
        userSafeSummary: '실행은 했는데 원하신 상태가 되지 않았어요.',
        진행: {
          단계: 'dispatched', 판정: 진행판정,
          실행신분: { 창: 813, pid: 18355 },
        },
        다음수단: 다음방법.map((방법) => ({ 방법, 왜: `${방법} 수단` })),
      };
      return {
        result: { 단계: 'goal_verified', 행동: 'focus', 실행신분: { 창: 813, pid: 18355 } },
        userSafeSummary: '계산기 창을 앞으로 가져오고 확인했어요.',
      };
    },
  };
  const desktop = {
    async handler() {
      return {
        result: {
          frontmost: { name: '다른 앱', pid: 1069 },
          본창: { id: 관찰창, app: '계산기', title: '계산기', pid: 관찰pid },
          elements: [], 요소창: { 시작: 0, 끝: 0, 총: 0 },
        },
        userSafeSummary: '계산기 창을 새로 관찰했어요.',
      };
    },
  };
  const opts = { desktop, desktopAct };
  return {
    calls: () => focusCalls,
    ctx(model, { 가짜손 = false } = {}) {
      const tools = demoTools(opts);
      const env = demoEnv(opts);
      if (가짜손) {
        tools.tools['fixture.observe'] = {
          async handler() {
            return {
              result: { 본창: { id: 813, app: '계산기', pid: 18355 } },
              userSafeSummary: '시험용 결과를 냈어요.',
            };
          },
        };
        env.connections.push({
          id: 'fixture.observe', label: '시험 관찰', connected: true, executable: true, hasHandler: true,
          toolKind: 'read', reversible: true,
          schema: {
            description: '시험용 관찰',
            parameters: { type: 'object', properties: { action: { type: 'string' }, app: { type: 'string' } } },
          },
        });
      }
      return { env, tools, model };
    },
  };
}

test('실패한 행동 뒤 같은 실행신분의 fresh observe가 끼면 같은 인자를 한 번 재시도한다', async () => {
  const p = 화면판();
  const result = await runTurn(
    { text: '계산기 창을 앞으로 가져오고 실제로 그렇게 됐는지 확인해줘' },
    p.ctx(순서모델([초점, 관찰, 초점], '계산기 창을 앞으로 가져왔어요.')),
  );

  assert.equal(result.kind, 'reply');
  assert.equal(p.calls(), 2,
    '새 관찰이 실패 때의 창·pid를 다시 확인했는데도 동일 focus가 낡은 중복으로 취소됐다');
  const focusReceipts = [...(result.ledger?.confirmed ?? []), ...(result.ledger?.unconfirmed ?? [])]
    .filter((entry) => String(entry).includes('계산기') || String(entry).includes('원하신 상태'));
  assert.ok(focusReceipts.length >= 2, '첫 실패와 fresh 증거 위 재시도 결과가 원장에 함께 남아야 한다');
});

test('새 관찰 증거 없이 같은 인자를 반복하면 기존 중복 방지가 그대로 이긴다', async () => {
  const p = 화면판();
  const result = await runTurn(
    { text: '계산기 창을 앞으로 가져오고 실제로 그렇게 됐는지 확인해줘' },
    p.ctx(순서모델([초점, 초점])),
  );

  assert.equal(result.kind, 'reply');
  assert.equal(p.calls(), 1, '같은 증거 세대에서 동일 행동이 다시 실행됐다');
});

test('이미 성공한 행동은 fresh observe가 끼어도 다시 실행하지 않는다', async () => {
  const p = 화면판({ 첫초점성공: true });
  await runTurn(
    { text: '계산기 창을 앞으로 가져오고 실제로 그렇게 됐는지 확인해줘' },
    p.ctx(순서모델([초점, 관찰, 초점], '계산기 창을 앞으로 가져왔어요.')),
  );
  assert.equal(p.calls(), 1, '이미 확인된 성공을 새 관찰이 중복 실행권으로 바꿨다');
});

test('다른 창의 fresh observe는 실패한 행동의 증거 세대를 바꾸지 않는다', async () => {
  const p = 화면판({ 관찰창: 999, 관찰pid: 777 });
  await runTurn(
    { text: '계산기 창을 앞으로 가져오고 실제로 그렇게 됐는지 확인해줘' },
    p.ctx(순서모델([초점, 관찰, 초점])),
  );
  assert.equal(p.calls(), 1, '다른 창·pid 관찰로 동일 focus 재실행이 열렸다');
});

test('unknown 행동은 같은 실행신분의 fresh observe 뒤에도 재시도하지 않는다', async () => {
  const p = 화면판({ 진행판정: 'unknown' });
  await runTurn(
    { text: '계산기 창을 앞으로 가져오고 실제로 그렇게 됐는지 확인해줘' },
    p.ctx(순서모델([초점, 관찰, 초점])),
  );
  assert.equal(p.calls(), 1, '효과를 모르는 행동이 fresh 관찰을 중복 효과 재실행권으로 썼다');
});

test('action=observe와 같은 창·pid를 흉내 낸 무관한 손은 재시도 문을 열지 않는다', async () => {
  const p = 화면판();
  await runTurn(
    { text: '계산기 창을 앞으로 가져오고 실제로 그렇게 됐는지 확인해줘' },
    p.ctx(순서모델([초점, 가짜관찰, 초점]), { 가짜손: true }),
  );
  assert.equal(p.calls(), 1, '도구 신분을 확인하지 않고 결과 모양만으로 재시도 문이 열렸다');
});

test('desktop.screen이라도 observe가 아닌 action은 새 관찰 세대가 아니다', async () => {
  const p = 화면판({ 다음방법: ['status', 'retry'] });
  await runTurn(
    { text: '계산기 창을 앞으로 가져오고 실제로 그렇게 됐는지 확인해줘' },
    p.ctx(순서모델([초점, 상태관찰, 초점])),
  );
  assert.equal(p.calls(), 1, '화면 상태 확인을 창 내용의 fresh observe로 오인했다');
});

test('실패 손이 observe를 다음 수로 내지 않았으면 우연히 끼어든 observe로 재시도하지 않는다', async () => {
  const p = 화면판({ 다음방법: ['inspect', 'retry'] });
  await runTurn(
    { text: '계산기 창을 앞으로 가져오고 실제로 그렇게 됐는지 확인해줘' },
    p.ctx(순서모델([초점, 관찰, 초점])),
  );
  assert.equal(p.calls(), 1, '생산자가 권하지 않은 관찰이 재시도 근거로 승격됐다');
});

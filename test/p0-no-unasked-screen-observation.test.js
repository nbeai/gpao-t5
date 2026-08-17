// P0 프라이버시 — 모델이 현재 요청을 위해 화면 손을 고르기 전에는 열린 앱·창을 관찰하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoContext } from '../src/surface/demo-context.js';

function stage(script) {
  let placesCalls = 0;
  let handlerCalls = 0;
  const events = [];
  const seen = [];
  const desktop = {
    async places() {
      placesCalls += 1;
      events.push('places');
      return { 창들: [{ label: '메일 — Mail', kind: 'screen' }, { label: '업무 — Chrome', kind: 'screen' }], 걸린ms: 2 };
    },
    async handler() {
      handlerCalls += 1;
      events.push('handler');
      return { result: { 본창: { app: 'Mail', title: '메일' } }, userSafeSummary: '화면을 확인했어요.' };
    },
  };
  const ctx = demoContext({ desktop });
  const model = { async respond(tc, opts = {}) {
    seen.push({ tc: structuredClone(tc), tools: (opts.tools ?? []).map((tool) => tool.name) });
    return script(seen.length, tc, opts);
  } };
  return { ctx: { ...ctx, model }, seen, events, calls: () => ({ placesCalls, handlerCalls }) };
}

test('인사는 열린 앱을 관찰하지 않지만 화면 손 자체는 선택 가능하게 남는다', async () => {
  const s = stage(() => '안녕하세요.');
  await runTurn({ text: '안녕' }, s.ctx);
  assert.deepEqual(s.calls(), { placesCalls: 0, handlerCalls: 0 });
  assert.ok(s.seen[0].tools.includes('desktop.screen'), '관찰을 막는다고 화면 손까지 숨겼다');
  assert.equal(JSON.stringify(s.seen[0].tc).includes('메일 — Mail'), false, '안 물은 앱 이름이 prompt에 실렸다');
});

test('모델이 화면 손을 실제로 고르면 실행 직전에 한 번 관찰하고 다음 문맥에 싣는다', async () => {
  const s = stage((round) => {
    if (round === 1) return { text: '', toolCalls: [{
      providerCallId: 'screen-1', name: 'desktop.screen', args: { action: 'observe', scope: 'screen' },
    }] };
    return '열린 화면을 확인했어요.';
  });
  await runTurn({ text: '지금 열린 앱 알려줘' }, s.ctx);
  assert.deepEqual(s.calls(), { placesCalls: 1, handlerCalls: 1 });
  assert.deepEqual(s.events, ['places', 'handler'], '화면 관찰이 실행 뒤에 늦게 붙었다');
  assert.ok(s.seen.slice(1).some((entry) => JSON.stringify(entry.tc).includes('메일 — Mail')),
    '선택 뒤 fresh 화면 자리가 다음 모델 문맥에 없다');
});

test('파일·웹 손만 고른 턴도 화면을 곁눈질하지 않는다', async () => {
  const s = stage((round) => round === 1
    ? { text: '', toolCalls: [{ providerCallId: 'web-1', name: 'web.search', args: { query: 'Node.js' } }] }
    : '찾은 내용을 설명했어요.');
  await runTurn({ text: 'Node.js 자료 찾아줘' }, s.ctx);
  assert.equal(s.calls().placesCalls, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorReality } from '../src/kernel/l1-intent/operator-reality.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoContext } from '../src/surface/demo-context.js';

const hand = { async handler() { return { result: {} }; } };

function promptFor(text = '카페24 주문 자료 좀 가져와줘') {
  const ctx = demoContext({ localTerminal: hand, localLocate: hand });
  const selfState = buildSelfState(ctx.env, { tools: ctx.tools });
  return buildModelMessages(buildTaskContext({
    intent: { currentRequest: text, answerMode: 'fast_chat', authorityBoundary: 'user' },
    selfState,
  }));
}

test('분야를 분류하지 않아도 T5가 먼저 맡을 수 있는 엔지니어링 현실이 모델 입력에 간다', () => {
  const { user } = promptFor();
  assert.match(user, /\[T5가 먼저 맡을 수 있는 일\]/);
  assert.match(user, /터미널 실행: 이 컴퓨터의 상태·설정·설치된 도구를 직접 확인하고 필요한 명령을 실행한다/);
  assert.match(user, /작업 대상 찾기: 사용자가 부른 자료나 폴더를 직접 찾아 후보와 근거를 확인한다/);
});

test('실행 불가하거나 역할을 선언하지 않은 손의 운영 사실을 지어내지 않는다', () => {
  assert.deepEqual(operatorReality({
    connectedTools: [
      { id: 'ready', label: '준비된 손', executable: true, operatorFact: '직접 확인한다.' },
      { id: 'missing', label: '없는 손', executable: false, operatorFact: '하면 안 된다.' },
      { id: 'unknown', label: '새 손', executable: true },
    ],
  }), { hands: [{ label: '준비된 손', operation: '직접 확인한다.' }] });
});

test('외부 서비스 현실이 없어도 운영 현실은 남는다', () => {
  const { user } = promptFor('이 컴퓨터 왜 느린지 봐줘');
  assert.match(user, /T5가 먼저 맡을 수 있는 일/);
  assert.doesNotMatch(user, /\[바깥 자료에 닿는 현실\]/);
});

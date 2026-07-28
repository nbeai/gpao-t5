import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const selfState = buildSelfState(demoEnv());
const intent = { currentRequest: '낯선 서비스 자료를 가져와줘', answerMode: 'work', authorityBoundary: 'user' };

function promptFor(receipts = []) {
  return buildModelMessages(buildTaskContext({
    intent,
    selfState,
    externalReality: { reach: [], services: [] },
    receipts,
  })).user;
}

test('실제로 열린 입력면이 없으면 그 부재가 모델의 연결 현실로 간다', () => {
  const user = promptFor();
  assert.match(user, /안전한 비밀 입력면은 아직 열리지 않았어요/);
  assert.match(user, /비밀값을 받을 통로가 없어요/);
});

test('도구가 실제로 연 비밀 입력면만 모델에게 열린 것으로 간다', () => {
  const user = promptFor([{
    intended: '연결', failureState: 'blocked', userSafeSummary: '안전한 입력을 열어요.',
    surfaceRequest: {
      kind: 'secret_input', label: '가게 연결',
      fields: [{ name: 'client_id', label: '클라이언트 ID' }, { name: 'secret', label: '비밀', secret: true }],
    },
  }]);
  assert.match(user, /안전한 비밀 입력면이 열려 있어요: 가게 연결/);
  assert.match(user, /클라이언트 ID · 비밀/);
  assert.doesNotMatch(user, /아직 열리지 않았어요/);
});

test('직접 확인한 연결 단서 없음도 다음 판단에 사실로 간다', () => {
  const user = promptFor([{
    intended: '연결 흔적 확인', failureState: 'none', userSafeSummary: '바로 쓸 연결 단서를 아직 찾지 못했어요.',
    connectionDiscovery: { subject: '낯선가게', checked: ['mcp', 'cli', 'known_connectors'], candidates: [] },
  }]);
  assert.match(user, /낯선가게: mcp · cli · known_connectors을 직접 확인했지만 맞는 단서는 찾지 못했어요/);
  assert.match(user, /이 결과만으로 API·권한·입력 방식은 확인되지 않았어요/);
  assert.doesNotMatch(user, /입력면이 열려 있어요/);
});

test('직접 확인한 후보는 근거와 함께 남고 설정·비밀은 없다', () => {
  const user = promptFor([{
    intended: '연결 흔적 확인', failureState: 'none', userSafeSummary: '기존 연결 단서를 찾았어요.',
    connectionDiscovery: {
      subject: '가게', checked: ['mcp'],
      candidates: [{ kind: 'mcp', label: 'store-mcp', evidence: 'MCP 등록 이름이 요청과 맞아요' }],
    },
  }]);
  assert.match(user, /가게: mcp을 직접 확인했고, 맞는 단서: store-mcp\(mcp\)/);
  assert.doesNotMatch(user, /token|secret|\/Users\//i);
});

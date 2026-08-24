import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMemoryPortfolio, workingMemoryProjection, episodePointers } from '../src/memory-portfolio.js';

test('현재 요청과 관련된 User Memory와 exact Work revision만 자동 투영한다', () => {
  const items = [
    { memoryId: 'coffee', kind: 'user', content: '사용자는 산미 있는 커피를 좋아한다.', subjects: ['커피'] },
    { memoryId: 'code', kind: 'user', content: '코드 답은 간결하게.', subjects: ['코드'] },
    { memoryId: 'old-work', kind: 'work', content: '예전 일', source: { workId: 'w', revision: 1 } },
    { memoryId: 'current-work', kind: 'work', content: '현재 일', source: { workId: 'w', revision: 2 } },
  ];
  assert.deepEqual(selectMemoryPortfolio({ items, request: '커피 추천', currentWork: { workId: 'w', revision: 2 } })
    .map((item) => item.memoryId), ['coffee', 'current-work']);
});

test('같은 subject의 최신 교정 revision이 과거 기억을 대체한다', () => {
  const selected = selectMemoryPortfolio({ request: '답변 형식', items: [
    { memoryId: 'old', kind: 'user', content: '길게', subjects: ['답변'], source: { revision: 1 } },
    { memoryId: 'new', kind: 'user', content: '간결하게', subjects: ['답변'], source: { revision: 2 } },
  ] });
  assert.deepEqual(selected.map((item) => item.memoryId), ['new']);
});

test('Working Memory와 Episode는 원문을 복제하지 않고 Work·Run·Message pointer만 남긴다', () => {
  const state = { works: [{ workId: 'w', revision: 2, status: 'active', sourceMessageId: 'm1' }],
    inputs: [{ inputId: 'i1', workId: 'w', state: 'classified' }],
    events: [{ type: 'work_settled', workId: 'w', revision: 1, outcome: 'achieved', runId: 'r1' }] };
  assert.deepEqual(workingMemoryProjection(state, 'w'), { workId: 'w', revision: 2,
    status: 'active', pendingInputIds: ['i1'] });
  assert.deepEqual(episodePointers(state), [{ workId: 'w', revision: 1, outcome: 'achieved',
    runId: 'r1', sourceMessageId: 'm1' }]);
  assert.doesNotMatch(JSON.stringify(episodePointers(state)), /content|text|receipt/u);
});

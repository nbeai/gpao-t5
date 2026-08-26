import assert from 'node:assert/strict';
import test from 'node:test';

import { projectWorkHistoryEntry, searchWorkHistory } from '../src/work-history-projection.js';

function entry(overrides = {}) { return projectWorkHistoryEntry({ historyHandle: 'a'.repeat(32),
  title: '분기 보고서 만들기', recordedAt: '2026-08-27T00:00:00.000Z', status: 'completed',
  actorText: '내 요청', artifacts: { available: 1, unavailable: 0,
    items: [{ name: '보고서.xlsx', type: '표', availabilityText: 'T5에 보관됨' }] },
  effects: { confirmed: 1, unknown: 0, summaries: ['파일 변화를 확인했어요.'] },
  resources: { accountingText: '사용량 정산 기록이 있어요.' },
  remaining: { count: 0, text: '남은 항목 없음' },
  internalValues: ['session-private', 'run-private', '/Users/private/report.xlsx', 'b'.repeat(64)], ...overrides }); }

test('작업 기록은 exact 상태·actor·artifact·effect·remaining을 사용자 문장으로만 투영한다', () => {
  const value = entry(); assert.deepEqual(value.status, { text: '완료' }); assert.equal(value.actorText, '내 요청');
  assert.equal(value.artifacts.available, 1); assert.equal(value.effects.confirmed, 1);
  assert.equal(value.remaining.count, 0); assert.equal(value.whenText, '2026. 8. 27.');
});

test('내부 identity·path·digest가 사용자 기록에 들어오면 fail closed한다', () => {
  assert.throws(() => entry({ title: 'run-private' }), /internal identity/u);
  assert.doesNotMatch(JSON.stringify(entry()), /session-private|run-private|\/Users\/private|b{64}|runId|workId/u);
});

test('검색은 내부 searchText만 사용하고 snippet을 반환하지 않으며 cursor가 bounded하다', () => {
  const first = { ...entry(), statusKey: 'completed', searchText: '분기 보고서 원문' };
  const second = { ...entry({ historyHandle: 'c'.repeat(32), title: '다른 작업' }),
    statusKey: 'completed', searchText: '다른 내용' };
  const found = searchWorkHistory([first, second], { query: '보고서', limit: 1 });
  assert.equal(found.items.length, 1); assert.equal('searchText' in found.items[0], false);
  assert.equal('sortKey' in found.items[0], false);
  assert.equal(found.nextCursor, null);
});

test('완료·중단·확인 필요를 하나로 합치지 않고 잘못된 상태는 거부한다', () => {
  for (const [code, text] of [['incomplete', '끝내지 못함'], ['stopped', '멈춤'],
    ['resumable', '이어서 요청할 수 있음'], ['needs_review', '확인 필요']]) {
    assert.deepEqual(entry({ status: code }).status, { text });
  }
  assert.throws(() => entry({ status: 'success' }), /validated/u);
});

test('stale cursor와 무제한 검색어는 첫 페이지로 되감지 않고 fail closed한다', () => {
  const values = [{ ...entry(), statusKey: 'completed', searchText: '보고서' }];
  assert.throws(() => searchWorkHistory(values, { cursor: 'f'.repeat(32) }), /페이지가 바뀌었어요/u);
  assert.throws(() => searchWorkHistory(values, { query: '가'.repeat(201) }), /너무 길어요/u);
});

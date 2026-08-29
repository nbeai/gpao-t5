import test from 'node:test';
import assert from 'node:assert/strict';

import { projectPublicActivityFact } from '../src/public-activity-projection.js';

const SECRET = 'sk-super-secret';
const PATH = '/Users/private/customer/secret.xlsx';
const HANDLE = 'record-handle-secret';

function event(name, action, result, outcome = 'succeeded') {
  return {
    type: 'tool_completed', recordedAt: '2026-08-30T10:00:00.000Z',
    payload: { receipt: {
      outcome,
      requestedCall: { name, args: { action, command: `cat ${PATH}`, query: SECRET, handle: HANDLE } },
      actualCall: outcome === 'succeeded'
        ? { name, args: { action, command: `cat ${PATH}`, query: SECRET, handle: HANDLE } } : null,
      result,
    } },
  };
}

test('파일 검색 완료 사실은 실제 방문 수와 후보 수만 누적 가능한 문장으로 투영한다', () => {
  const input = event('file_reality', 'search', {
    state: 'observed', candidates: [{ path: PATH }, { handle: HANDLE }], recentDocumentCandidates: [{}],
    coverage: { filesystemFilesVisited: 12_480 },
  });
  assert.deepEqual(projectPublicActivityFact(input), {
    schema: 't5.public-activity-fact.v1', kind: 'file_candidates_found',
    text: '파일 12480개를 확인해 관련 후보 3개를 찾았어요.',
    dedupeKey: 'file_candidates_found:12480:3', occurredAt: input.recordedAt,
  });
});

test('웹·문서·프로그램 결과는 원문 없이 실제 개수와 검증 범위만 투영한다', () => {
  assert.equal(projectPublicActivityFact(event('web_search', null, {
    state: 'candidates', candidates: [{}, {}, {}, {}], query: SECRET,
  })).text, '웹에서 관련 자료 후보 4개를 찾았어요.');

  assert.equal(projectPublicActivityFact(event('attachment', 'search_document', {
    state: 'observed', observation: { locallySearchedPages: 500, candidates: [{}, {}, {}], content: SECRET },
  })).text, '문서 500쪽을 검색해 관련 후보 3쪽을 찾았어요.');

  assert.equal(projectPublicActivityFact(event('exec', null, {
    state: 'published_verified_cleaned', outputCoverage: { independentlyVerified: true, outputCount: 2 },
    outputs: [{ rows: 15, relativePath: PATH }, { rows: 20, preview: SECRET }],
  })).text, '프로그램 결과 2개를 독립적으로 검증했어요. 전체 35행도 확인했어요.');
});

test('표 대사·파일 이동·브라우저 관측은 확인된 수치만 투영한다', () => {
  assert.equal(projectPublicActivityFact(event('attachment', 'register_output', {
    state: 'registered', artifact: { attachmentId: HANDLE },
    sourceReconciliation: { state: 'verified', rowCount: 527, outputColumns: ['a', 'b', 'c'] },
  })).text, '결과의 전체 527행과 3열을 원본과 다시 맞췄어요.');

  assert.equal(projectPublicActivityFact(event('file_reality', 'apply', {
    state: 'applied', filesMoved: 4, files: [{ path: PATH }],
  })).text, '파일 4개를 옮긴 것을 확인했어요.');

  assert.equal(projectPublicActivityFact(event('browser', 'snapshot', {
    state: 'observed', observation: { shownChars: 3_240, refs: { a: {}, b: {} }, text: SECRET },
  })).text, '현재 화면에서 내용 3240자와 조작 가능한 항목 2개를 확인했어요.');
});

test('실패·unknown·실행되지 않은 호출과 불완전한 결과는 성공 사실을 만들지 않는다', () => {
  assert.equal(projectPublicActivityFact(event('web_search', null, {
    state: 'failed', candidates: [{}, {}],
  }, 'failed')), null);
  assert.equal(projectPublicActivityFact(event('file_reality', 'search', {
    state: 'observed', coverage: { filesystemFilesVisited: 9 },
  }, 'unknown')), null);
  assert.equal(projectPublicActivityFact({ type: 'tool_completed', payload: { receipt: {
    outcome: 'succeeded', actualCall: null, requestedCall: { name: 'attachment', args: { action: 'list' } },
    result: { state: 'listed', attachments: [{}] },
  } } }), null);
  assert.equal(projectPublicActivityFact(event('exec', null, {
    state: 'completed', exitCode: 0, stdout: SECRET,
  })), null);
  assert.equal(projectPublicActivityFact(event('file_reality', 'search', {
    state: 'observed', effectUnknown: true, candidates: [{}],
  })), null);
  assert.equal(projectPublicActivityFact(event('file_reality', 'search', {
    state: 'observed', coverage: { filesystemFilesVisited: 9 },
  })), null);
});

test('Run 완료·결과·전달 사건은 실제 terminal 사실만 투영한다', () => {
  assert.equal(projectPublicActivityFact({ type: 'output_produced', recordedAt: '2026-08-30T11:00:00Z',
    payload: { verified: true, reopened: true, bytes: 123, path: PATH, outputHandle: HANDLE } }).text,
  '검증된 결과 파일 1개를 만들었어요.');
  assert.equal(projectPublicActivityFact({ type: 'completion_verified', verifiedOutcome: 'achieved' }).text,
    '요청한 결과가 완료 기준과 맞는지 확인했어요.');
  assert.equal(projectPublicActivityFact({ type: 'completion_verified', verifiedOutcome: 'unresolved' }), null);
  assert.equal(projectPublicActivityFact({ type: 'result_delivery_terminal', delivery: { state: 'unknown' } }), null);
  assert.equal(projectPublicActivityFact({ type: 'result_delivery_terminal', delivery: { state: 'sent' } }).text,
    '결과 전달 상태를 확인했어요.');
});

test('출력은 반복 결정적이고 명령·인자·질의·경로·내용·handle·secret을 노출하지 않는다', () => {
  const input = event('file_reality', 'compare', {
    state: 'observed', files: [{ path: PATH, handle: HANDLE }, { path: PATH, content: SECRET }],
    comparisons: [{ left: HANDLE, right: SECRET }],
  });
  const first = projectPublicActivityFact(input);
  const second = projectPublicActivityFact(structuredClone(input));
  assert.deepEqual(first, second);
  assert.equal(first.dedupeKey, 'files_compared:2:1');
  const serialized = JSON.stringify(first);
  for (const forbidden of [SECRET, PATH, HANDLE, 'command', 'query', 'args', 'cat ']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

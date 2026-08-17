import test from 'node:test';
import assert from 'node:assert/strict';
import { inputFor, parseArgs } from '../scripts/live/p0-integration-qualification.mjs';

const valid = [
  '--run', '--mode', 'candidate', '--base', 'http://127.0.0.1:49152',
  '--state-dir', '/private/tmp/t5-p0-state',
  '--prompt-dump', '/private/tmp/t5-p0-prompts',
  '--file-root', '/private/tmp/t5-p0-files',
  '--output', '/private/tmp/t5-p0-result.json',
];

test('P0 라이브 자는 명시적인 --run과 고정 모드를 요구한다', () => {
  assert.throws(() => parseArgs(valid.filter((x) => x !== '--run')), /--run/);
  const bad = [...valid];
  bad[bad.indexOf('candidate')] = 'ad-hoc';
  assert.throws(() => parseArgs(bad), /countertest\|baseline\|candidate/);
});

test('P0 라이브 자는 loopback 서버 외에는 연결하지 않는다', () => {
  const external = [...valid];
  external[external.indexOf('http://127.0.0.1:49152')] = 'https://example.com';
  assert.throws(() => parseArgs(external), /loopback/);
  const localhost = [...valid];
  localhost[localhost.indexOf('http://127.0.0.1:49152')] = 'http://localhost:49152';
  assert.throws(() => parseArgs(localhost), /loopback/);
});

test('P0 라이브 자의 상태·덤프·실물·출력 위치는 모두 절대경로다', () => {
  const relative = [...valid];
  relative[relative.indexOf('/private/tmp/t5-p0-files')] = './files';
  assert.throws(() => parseArgs(relative), /절대경로/);
  const parsed = parseArgs(valid);
  assert.equal(parsed.mode, 'candidate');
  assert.equal(parsed.base, 'http://127.0.0.1:49152');
});

test('승인 카드 분기는 자연어가 아니라 그 카드 pendingId를 그대로 누른다', () => {
  const input = inputFor({ approvalClick: true, otherwise: '실행 기록을 알려줘.' },
    { kind: 'approval', pendingId: 'pending-1' }, 'session-1');
  assert.deepEqual(input, { sessionId: 'session-1', approve: 'pending-1' });
  assert.deepEqual(inputFor({ approvalClick: true, otherwise: '실행 기록을 알려줘.' },
    { kind: 'reply' }, 'session-1'), { sessionId: 'session-1', text: '실행 기록을 알려줘.' });
});

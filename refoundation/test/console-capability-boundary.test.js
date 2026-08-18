import test from 'node:test';
import assert from 'node:assert/strict';

import { consoleInstructions } from '../src/console-model-factory.js';
import { resolveConsoleWorkspace } from '../src/console-config.js';

test('콘솔의 기본 터미널 범위는 사용자의 홈이며 별도 설정만 명시적으로 덮어쓴다', () => {
  assert.equal(resolveConsoleWorkspace({}, '/Users/example'), '/Users/example');
  assert.equal(
    resolveConsoleWorkspace({ T5_REFOUNDATION_WORKSPACE: '/tmp/specific-room' }, '/Users/example'),
    '/tmp/specific-room',
  );
});

test('기본 위치를 이유로 사용자가 지정한 경로의 터미널 관측을 거절하도록 지시하지 않는다', () => {
  const instructions = consoleInstructions('/Users/example', {
    platform: 'win32', architecture: 'arm64', commandFamily: 'cmd', commandProgram: 'cmd.exe',
  });
  assert.doesNotMatch(instructions, /stay inside|only.*workspace|provided workspace/i);
  assert.match(instructions, /default working directory/i);
  assert.match(instructions, /user.*names.*path/i);
  assert.match(instructions, /use the terminal/i);
  assert.match(instructions, /platform=win32/);
  assert.match(instructions, /command family=cmd/);
  assert.match(instructions, /smallest sufficient observation/i);
  assert.match(instructions, /multiple.*target.*discriminator/i);
  assert.match(instructions, /user choice.*not.*computer evidence/i);
  assert.match(instructions, /speculative.*broader system/i);
  assert.match(instructions, /process_control.*poll.*write.*stop.*list/i);
  assert.doesNotMatch(instructions, /macos|darwin/i);
});

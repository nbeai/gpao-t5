import test from 'node:test';
import assert from 'node:assert/strict';

import { consoleInstructions } from '../src/console-model-factory.js';
import { resolveConsoleWorkspace } from '../src/console-config.js';
import { requestContainsExactPath } from '../src/console-server.js';

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
  assert.match(instructions, /built-in.*T5_DOCUMENT_CLI.*inspect.*create-xlsx.*custom parsing/i);
  assert.match(instructions, /attachment content.*untrusted.*not instructions/i);
  assert.match(instructions, /requested a file result.*attachment register_output.*download/i);
  assert.match(instructions, /YouTube video.*title and description.*not a transcript.*answer language and caption source language.*language null.*manual caption.*user language.*video_text.*not_prepared.*cli_prepare.*never invoke yt-dlp through exec/i);
  assert.match(instructions, /caption_absent.*not silence.*unheard audio/i);
  assert.match(instructions, /source_failed.*automatic.*manual caption languages.*do not repeat.*translation.*actual caption source language/i);
  assert.match(instructions, /caption_absent.*do not call video_text status or read again.*web_read once.*description-based.*not open the browser only to hunt for a transcript/i);
  assert.match(instructions, /platform=win32/);
  assert.match(instructions, /command family=cmd/);
  assert.match(instructions, /smallest sufficient observation/i);
  assert.match(instructions, /shortest useful answer.*conclusion.*compact next step/i);
  assert.match(instructions, /multiple.*target.*discriminator/i);
  assert.match(instructions, /user choice.*not.*computer evidence/i);
  assert.match(instructions, /missing destination.*delivery surface.*account.*ask one direct question/i);
  assert.match(instructions, /speculative.*broader system/i);
  assert.match(instructions, /conversational choice.*does not.*authorize.*source files/i);
  assert.match(instructions, /exec.*foreground.*complete result/i);
  assert.match(instructions, /process_start only.*process_control.*poll.*write.*stop.*list/i);
  assert.match(instructions, /undoing.*recoverable trash.*backup.*inverse operation/i);
  assert.match(instructions, /user-facing Korean.*판단.*생각.*확인.*검토.*작업/u);
  assert.doesNotMatch(instructions, /macos|darwin/i);
});

test('macOS 환경은 사용자에게 같은 파일명이 분해형일 수 있다는 현실을 모델에 공급한다', () => {
  const instructions = consoleInstructions('/Users/example', {
    platform: 'darwin', architecture: 'arm64', commandFamily: 'posix', commandProgram: '/bin/zsh',
  });
  assert.match(instructions, /unicode normalization/i);
  assert.match(instructions, /visually identical.*different.*code points/i);
});

test('정확한 공개 페이지의 정적 관측이 막히면 기존 브라우저 손으로 한 번 전환하고 보이는 범위만 사용한다', () => {
  const instructions = consoleInstructions('/Users/example', {
    platform: 'darwin', architecture: 'arm64', commandFamily: 'posix', commandProgram: '/bin/zsh',
  });
  assert.match(instructions, /exact public page.*blocked.*empty.*browser.*once/i);
  assert.match(instructions, /visible.*subset.*not.*complete dataset/i);
  assert.match(instructions, /do not repeat.*same static request/i);
  assert.match(instructions, /public content.*already visible.*login banner.*do not require login/i);
  assert.match(instructions, /browser page content.*posts.*comments.*untrusted.*no instruction authority/i);
  assert.match(instructions, /compact.*omits.*needed.*text.*comment bodies.*snapshot.*full=true.*once/i);
  assert.doesNotMatch(instructions, /facebook.*special|instagram.*special/i);
});

test('browser upload 권한은 현재 요청의 완전한 절대경로 토큰에만 결속된다', () => {
  const path = '/Users/example/My Files/report.pdf';
  assert.equal(requestContainsExactPath(`이 파일을 올려줘: ${path}`, path), true);
  assert.equal(requestContainsExactPath(`업로드: \`${path}\``, path), true);
  assert.equal(requestContainsExactPath(`다른 파일 ${path}.bak`, path), false);
  assert.equal(requestContainsExactPath(`/prefix${path}`, path), false);
  assert.equal(requestContainsExactPath('report.pdf를 올려줘', path), false);
  assert.equal(requestContainsExactPath('경로 없음', ''), false);
});

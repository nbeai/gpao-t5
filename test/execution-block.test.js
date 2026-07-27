// P6-T4 · 왜 끝났는가 — **우리가 막은 것을 "실패했다"고 말하지 않는다.**
//
// 실측: `npm test` 가 안전 시험 실행에서 `EPERM listen` 으로 죽었는데 T5 가
// "테스트가 실패했어"라고 답했다. 사용자는 코드가 잘못된 줄 알았지만 원인은 우리 샌드박스였다.
// 실제 실패와 실행 환경 때문에 막힌 것을 섞으면 사용자가 엉뚱한 곳을 고친다.
//
// **이건 안전 판정이 아니다.** 안전은 커널이 이미 보장했다(막혔으니 아무 일도 안 났다).
// 여기서 정하는 것은 사용자에게 뭐라고 말할지와, 승인을 물을지뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { runCommand, executionBlock } from '../src/runtime/terminal-run.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { sandboxAvailable } from '../src/runtime/sandbox.js';

const 서버스크립트 = 'require("http").createServer().listen(9913, () => console.log("떴다"));';

test('세 가지를 섞지 않는다 — 샌드박스 / 실행 환경 / 코드', () => {
  const 갈래 = (r) => executionBlock(r)?.kind;
  assert.equal(갈래({ exitCode: 1, stderr: "Error: listen EPERM: operation not permitted 0.0.0.0:80", stdout: '' }), 'sandbox');
  assert.equal(갈래({ exitCode: 6, stderr: 'curl: (6) Could not resolve host', stdout: '' }), 'sandbox');
  assert.equal(갈래({ exitCode: 1, stderr: 'zsh: operation not permitted: a.txt', stdout: '' }), 'sandbox');
  assert.equal(갈래({ exitCode: 127, stderr: 'zsh: command not found: pytest', stdout: '' }), 'env');
  // **실제 실패는 그대로 실패다** — 샌드박스 핑계로 덮으면 사용자가 진짜 버그를 못 본다.
  assert.equal(갈래({ exitCode: 1, stderr: '', stdout: 'AssertionError: expected 1 to equal 2\n fail 3' }), 'code');
  assert.equal(갈래({ exitCode: 0, stderr: '', stdout: 'ok' }), undefined);
});

test('① 포트를 여는 검증 명령은 코드 실패로 단정하지 않는다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-listen-'));
  await writeFile(join(dir, 's.js'), 서버스크립트);
  const r = await runCommand('node s.js', { cwd: dir, timeoutMs: 4000, mode: 'probe' });
  assert.equal(executionBlock(r)?.kind, 'sandbox', `코드 실패로 단정했다: ${r.stderr.slice(0, 150)}`);
});

test('① 사용자에게도 "코드 문제가 아니다"라고 말한다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-say-'));
  await writeFile(join(dir, 's.js'), 서버스크립트);
  const r = await makeLocalTerminalTool({ cwd: dir }).handler({ command: 'node s.js', timeoutMs: 4000 });
  assert.equal(r.blocked, true, '실제로 하기 전에 물어야 한다');
  assert.match(r.userSafeSummary, /포트를 열어야|안전 시험/, `무엇 때문인지 안 말한다: ${r.userSafeSummary}`);
  assert.equal(r.result.blockedBy, 'sandbox', '막힌 이유가 사실로 안 남으면 모델이 또 "실패했다"고 단정한다');
  assert.ok(r.nextSafeAction);
});

test('② 승인 뒤에는 실제로 실행된다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-grant-'));
  await writeFile(join(dir, 's.js'), 서버스크립트);
  const r = await makeLocalTerminalTool({ cwd: dir }).handler({ command: 'node s.js', granted: true, timeoutMs: 2500 });
  assert.match(r.result.stdout, /떴다/, '승인했는데도 못 하면 승인이 의미가 없다');
});

test('③ 진짜 코드 실패는 그대로 실패라고 말한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-fail-'));
  await writeFile(join(dir, 'f.js'), 'throw new Error("진짜 버그");');
  const r = await makeLocalTerminalTool({ cwd: dir }).handler({ command: 'node f.js', timeoutMs: 4000 });
  assert.ok(!r.blocked, '진짜 실패에 승인을 물으면 사용자가 버그를 못 본다');
  assert.equal(r.result.failedBy, 'code');
  assert.match(r.userSafeSummary, /오류로 끝났어요/);
});

test('④ 승인 뒤에도 비밀은 안 읽힌다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const r = await runCommand('cat ~/.ssh/* 2>&1 | head -3', { mode: 'granted', timeoutMs: 8000 });
  assert.doesNotMatch(r.stdout, /PRIVATE KEY|ssh-rsa|ssh-ed25519/,
    '승인은 "이 명령을 하라"이지 "비밀을 읽어라"가 아니다');
});

test('④ 승인 뒤에도 보호 영역 자리에서는 시작하지 않는다', async () => {
  const r = await makeLocalTerminalTool({ cwd: join(homedir(), '.ssh') }).handler({ command: 'ls', granted: true });
  assert.equal(r.scopeState, 'protected');
});

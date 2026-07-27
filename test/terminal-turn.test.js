// P6-T2 · 턴 관통 — **등급 표가 아니라 실제 턴이 무엇을 하는지 본다.**
// 어제 배운 것: 단위 테스트가 턴 경로를 건너뛰면 초록인데 죽어 있다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { sandboxAvailable } from '../src/runtime/sandbox.js';

const 고른다 = (calls) => {
  let used = false;
  return {
    async respond(_tc, opts = {}) {
      if (!used && opts.tools?.length) { used = true; return { text: '', toolCalls: calls }; }
      return opts.tools?.length ? { text: '했어요', toolCalls: [] } : '했어요';
    },
  };
};

async function 자리() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-턴-'));
  await writeFile(join(dir, '있던.md'), '원래 내용');
  return dir;
}
const ctx = (dir, calls) => ({
  env: demoEnv(), model: 고른다(calls),
  tools: demoTools({ localTerminal: makeLocalTerminalTool({ cwd: dir }) }),
});
const 명령 = (command) => [{ name: 'local.terminal', args: { command } }];

test('확인 명령은 승인 없이 그냥 된다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  const r = await runTurn({ text: '뭐 있는지 봐줘' }, ctx(dir, 명령('ls -1')));
  assert.notEqual(r.kind, 'approval', '읽기에 승인을 물으면 사용자가 승인을 기계적으로 누르게 된다');
  // 실행 사실이 **다음 턴으로 이어져야** "아까 그 오류", "다시 돌려봐"가 성립한다.
  const 대상 = r.workingState?.subjects ?? [];
  const 명령대상 = 대상.find((x) => x.kind === 'command');
  assert.ok(명령대상, `실행한 명령이 다음 턴 대상에 안 남았다: ${JSON.stringify(대상)}`);
  assert.equal(명령대상.label, 'ls -1');
  assert.equal(명령대상.failed, false, '성공/실패가 사실로 남아야 실패를 성공처럼 이어받지 않는다');
});

test('파일을 바꾸는 명령은 승인에서 멈추고, 그때 실제로 안 바뀐다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  const r = await runTurn({ text: '지워줘' }, ctx(dir, 명령('rm -f 있던.md')));
  assert.equal(r.kind, 'approval', `승인 없이 진행됐다(${r.kind})`);
  // **말만 승인이 아니라 파일이 살아있어야 한다.**
  assert.equal(await readFile(join(dir, '있던.md'), 'utf8'), '원래 내용', '승인 전에 이미 지워졌다');
});

test('승인 카드에 명령 원문이 보인다(무엇을 허락하는지 알아야 한다)', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  const r = await runTurn({ text: '해줘' }, ctx(dir, 명령('rm -f 있던.md')));
  assert.match(JSON.stringify(r), /rm -f 있던\.md/, '"터미널 실행"으로는 무엇을 허락하는지 모른다');
});

test('네트워크가 필요한 명령도 승인에서 멈춘다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  const r = await runTurn({ text: '설치해줘' }, ctx(dir, 명령('curl -s -m 5 https://example.com')));
  assert.equal(r.kind, 'approval', '인터넷으로 나가는 명령이 승인 없이 실행된다');
});

test('probe 를 못 돌리면 승인으로 간다(모르면 막는다)', async () => {
  const dir = await 자리();
  const 손없음 = {
    env: demoEnv(), model: 고른다(명령('아무거나')),
    // probe 를 노출하지 않는 손 — 이 경우에도 read 로 흘러선 안 된다.
    tools: demoTools({ localTerminal: { async handler() { return { result: {} }; } } }),
  };
  const r = await runTurn({ text: '해줘' }, 손없음);
  assert.equal(r.kind, 'approval', 'probe 없이 등급을 read 로 흘렸다');
});

test('승인 전에는 새 파일도 안 생긴다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  await runTurn({ text: '만들어줘' }, ctx(dir, 명령('echo 새내용 > 새파일.md')));
  assert.deepEqual((await readdir(dir)).sort(), ['있던.md'], '승인 전에 파일이 생겼다');
});

test('실패한 명령은 실패로 이어받는다(성공처럼 넘기지 않는다)', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const dir = await 자리();
  const r = await runTurn({ text: '돌려봐' }, ctx(dir, 명령('exit 3')));
  const 대상 = (r.workingState?.subjects ?? []).find((x) => x.kind === 'command');
  assert.equal(대상?.failed, true, '실패한 명령이 성공으로 남으면 다음 턴이 거짓 위에서 진행된다');
  assert.equal(대상?.exitCode, 3);
});

// ── 모델은 안 쓰는 칸도 빈 문자열로 채워 보낸다 ──────────────────────────
// 실측 2회. local.scope 에서 `path:''` 가 `??` 를 통과해 이름으로 여는 길이 통째로 죽었고,
// 여기서 `cwd:''` 가 통과해 기본 자리 대신 서버를 띄운 자리에서 돌았다 —
// `find ..` 가 옆 프로젝트 dist 수백 줄을 긁어와 모델이 답을 못 냈다.
// **`??` 를 쓸 때마다 빈 문자열을 의심할 것.**
test('빈 문자열 인자는 없는 것으로 본다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const { makeLocalTerminalTool } = await import('../src/runtime/local-terminal.js');
  const { homedir } = await import('node:os');
  const tool = makeLocalTerminalTool();
  const 기본 = (await tool.handler({ command: 'pwd' })).result.stdout.trim();
  assert.equal(기본, homedir(), '기본 자리가 홈이 아니면 find 로 프로젝트를 못 찾는다');
  const 빈칸 = (await tool.handler({ command: 'pwd', cwd: '' })).result.stdout.trim();
  assert.equal(빈칸, 기본, `cwd:'' 가 진짜 값 행세를 한다(${빈칸})`);
  assert.equal((await tool.probe('pwd', { cwd: '' })).cwd, homedir(), 'probe 도 같은 자리를 봐야 승인 카드가 사실이 된다');
  // 진짜 값은 그대로 쓴다 — 빈 값을 막느라 멀쩡한 인자까지 버리면 안 된다.
  assert.match((await tool.handler({ command: 'pwd', cwd: '/tmp' })).result.stdout, /tmp/);
});

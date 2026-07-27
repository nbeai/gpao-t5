// P5-B-1B · CLI 연결 — 다섯 방식 중 **토큰이 없는 유일한 것**
//
// 받을 비밀도, 열 동의 화면도, 갱신할 자격도 없다. 그래서 이 방식이
// **"상태 언어가 진짜 공통인가"** 를 시험한다 — 여기서도 같은 말로 설명되면
// 그 언어가 연결 방식에 매여 있지 않다는 뜻이다.
//
// 사용자 입장에서 이건 "이미 컴퓨터에 깔린 프로그램도 T5 가 쓸 수 있다" 이다.
//
// 불변식:
//   ① 있으면 바로 쓰고, 없으면 **어디서 받는지까지** 말한다(막다른 답 금지)
//   ② 편입은 MCP·HTTP 와 **똑같이 세 자리** — 통로가 셋이어도 편입은 하나다
//   ③ 사용자 말이 명령으로 새지 않는다(주입 차단)
//   ④ 읽기만 하는 손은 이 컴퓨터의 것을 바꿀 수 없는 자리에서 돈다
//   ⑤ 승인 카드는 **실제로 무엇이 돌아가는지** 보여준다
//   ⑥ 서비스를 모른다 — 지어낸 서비스도 선언만 맞으면 그대로 돈다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeConnectorConnectTool } from '../src/runtime/connector-connect.js';
import { defineConnector } from '../src/kernel/l2-plan/connector-profile.js';
import { buildCommand, probeCli, admitCliTools } from '../src/runtime/cli-tool.js';
import { sandboxProfile } from '../src/runtime/sandbox.js';

const 커넥터 = () => defineConnector({
  id: 'gagacli', label: '가가도구', kind: 'provider',
  userJobs: ['목록을 가져와요'],
  authMethods: [{
    kind: 'cli', command: 'gagacmd',
    install: { steps: ['가가도구를 먼저 설치해 주세요'] },
    tools: [{
      name: 'list', label: '목록', toolKind: 'read',
      capability: '목록을 가져온다',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
      run: { command: 'gagacmd', args: ['list', '--query', '{q}'] },
    }],
  }],
});

/** 명령을 진짜로 돌리지 않는 대역 — 무엇을 어떤 자리에서 돌리려 했는지만 기록한다. */
function 가짜셸({ 설치됨 = true, exitCode = 0, stdout = '{"items":[]}' } = {}) {
  const 기록 = [];
  const run = async (command, opts = {}) => {
    기록.push({ command, mode: opts.mode });
    if (command.startsWith('command -v')) {
      return { exitCode: 설치됨 ? 0 : 1, stdout: 설치됨 ? '/usr/local/bin/gagacmd\n' : '', stderr: '' };
    }
    return { exitCode, stdout, stderr: exitCode ? '뭔가 잘못됨' : '' };
  };
  return { run, 기록 };
}

const 맥락 = () => ({ tools: { tools: {} }, descriptors: [], env: { connections: [] } });

function 손만들기(셸, c = 커넥터()) {
  const ctx = 맥락();
  const tool = makeConnectorConnectTool({
    ctx: () => ctx, connectors: () => [c], runCommand: 셸.run,
  });
  return { tool, ctx, c };
}

test('깔려 있으면 바로 붙고, 손이 세 자리에 함께 올라온다', async () => {
  const 셸 = 가짜셸();
  const { tool, ctx, c } = 손만들기(셸);

  const r = await tool.handler({ connector: '가가도구' });

  assert.equal(r.result?.connected, true, `연결 실패: ${r.userSafeSummary}`);
  assert.equal(r.result.method, 'cli');
  const 손 = r.result.tools[0];
  assert.ok(ctx.tools.tools[손], '손 레지스트리에 없다');
  assert.ok(ctx.descriptors.some((d) => d.id === 손), '선언이 없다 — 모델이 못 본다');
  assert.ok(ctx.env.connections.some((x) => x.id === 손), 'selfState 에 없다');
  assert.equal(c.connected, true);
  // 토큰이 없는 방식이라 비밀 입력창을 띄우지 않는다
  assert.equal(r.surfaceRequest, undefined, '토큰도 없는데 뭔가를 물었다');
});

test('없으면 없다고 하되 어디서 받는지까지 말한다 — 막다른 답 금지', async () => {
  const 셸 = 가짜셸({ 설치됨: false });
  const { tool, ctx, c } = 손만들기(셸);

  const r = await tool.handler({ connector: '가가도구' });

  assert.equal(r.blocked, true);
  assert.equal(c.connected, false);
  assert.equal(Object.keys(ctx.tools.tools).length, 0, '없는데 손이 올라왔다');
  assert.match(r.userSafeSummary, /설치/, '어떻게 하면 되는지를 말하지 않았다');
  assert.ok(r.nextSafeAction, '다음 길이 없다');
});

test('올라온 손은 실제로 불리고, 읽기는 못 바꾸는 자리에서 돈다', async () => {
  const 셸 = 가짜셸();
  const { tool, ctx } = 손만들기(셸);
  await tool.handler({ connector: '가가도구' });

  const out = await ctx.tools.tools['gagacli.list'].handler({ q: '커피' });
  assert.ok(out.result, `손 호출 실패: ${out.userSafeSummary}`);
  const 실행 = 셸.기록[셸.기록.length - 1];
  assert.equal(실행.mode, 'reach', '읽기 손이 파일을 바꿀 수 있는 자리에서 돌았다');
  // 인자는 **전부** 따옴표 안에 들어간다 — 하나라도 밖에 있으면 거기가 새는 자리다
  assert.equal(실행.command, "gagacmd 'list' '--query' '커피'");
});

// **진짜 셸에 태워서 증명한다.** 문자열을 눈으로 보고 안전하다고 하는 것과, 셸이 그것을
// 하나의 인자로 읽는 것은 다르다. printf 로 되돌려 받아 원문과 같은지 본다.
test('사용자 말이 명령으로 새지 않는다 — 실제 셸에 태워 확인', async () => {
  const { execFile } = await import('node:child_process');
  const 돌려받기 = (cmd) => new Promise((res, rej) => execFile('/bin/zsh', ['-c', cmd],
    (e, out) => (e ? rej(e) : res(out))));

  for (const 나쁜말 of [
    "커피'; rm -rf ~; echo '",
    '커피 && echo 뚫림',
    '`echo 뚫림`',
    '$(echo 뚫림)',
    "'; touch /tmp/t5-should-not-exist; '",
  ]) {
    const cmd = buildCommand({ command: 'printf', args: ['%s', '{q}'] }, { q: 나쁜말 });
    const 돌아온것 = await 돌려받기(cmd);
    assert.equal(돌아온것, 나쁜말, `셸이 다르게 읽었다 — 새는 자리다: ${cmd}`);
  }
  const { existsSync } = await import('node:fs');
  assert.ok(!existsSync('/tmp/t5-should-not-exist'), '명령이 실제로 실행됐다');
});

test('승인 카드가 실제로 돌아갈 명령을 보여준다', async () => {
  const c = 커넥터();
  c.authMethods[0].tools[0].toolKind = 'unknown_kind'; // 승인이 필요한 종류
  const 셸 = 가짜셸();
  const { tool, ctx } = 손만들기(셸, c);
  await tool.handler({ connector: '가가도구' });

  const p = ctx.tools.tools['gagacli.list'].previewOf({ q: '커피' });
  assert.match(p.scope, /gagacmd/, '무엇이 돌아가는지 숨기면 판단할 수 없다');
  assert.ok(p.impact && p.duration && p.cancel);
  assert.ok(!/을\(를\)|이\(가\)/.test(`${p.impact}${p.cancel}`), '조사를 안 골랐다');
});

test('명령이 실패하면 연결이나 성공이라 하지 않고, 원문을 사용자면에 옮기지 않는다', async () => {
  const 셸 = 가짜셸({ exitCode: 1 });
  const { tool, ctx } = 손만들기(셸);
  await tool.handler({ connector: '가가도구' });
  const out = await ctx.tools.tools['gagacli.list'].handler({ q: 'x' });
  assert.equal(out.failed, true);
  assert.ok(!out.userSafeSummary.includes('뭔가 잘못됨'), '오류 원문을 사용자에게 옮겼다');
  assert.equal(out.diagnosticTrace, '뭔가 잘못됨', '진단면에는 남아야 원인을 좁힌다');
  assert.ok(out.nextSafeAction);
});

test('편입된 손을 끊으면 세 자리에서 함께 사라진다', async () => {
  const 셸 = 가짜셸();
  const { tool, ctx } = 손만들기(셸);
  const 연결 = await tool.handler({ connector: '가가도구' });
  const 손 = 연결.result.tools[0];
  await tool.handler({ connector: '가가도구', action: 'disconnect' });
  assert.ok(!ctx.tools.tools[손], '끊었는데 손이 남았다');
  assert.ok(!ctx.descriptors.some((d) => d.id === 손));
  assert.ok(!ctx.env.connections.some((x) => x.id === 손));
});

test('이름 없는 선언은 편입되지 않는다 — 유령을 만들지 않는다', () => {
  const ctx = 맥락();
  const 손 = admitCliTools({
    connector: { id: 'x', label: 'X' },
    tools: [{ label: '이름 없음' }, { name: 'noRun', label: '명령 없음' }],
  }, ctx);
  assert.deepEqual(손, []);
  assert.equal(Object.keys(ctx.tools.tools).length, 0);
});

// ── 새로 낸 실행 자리 ────────────────────────────────────────────────
test('reach 자리는 파일을 못 바꾸되 바깥에는 닿는다', () => {
  const reach = sandboxProfile('reach', { secrets: ['/x/secret'] });
  assert.match(reach, /\(deny file-write\*\)/, '파일을 바꿀 수 있으면 읽기 손이 아니다');
  assert.ok(!/\(deny network\*\)/.test(reach), '바깥에 못 닿으면 설치돼 있어도 못 쓴다');
  assert.match(reach, /deny file-read\*.*\/x\/secret/, '비밀 자리는 그대로 막혀야 한다');
  // 기존 자리는 건드리지 않았다
  assert.match(sandboxProfile('probe'), /\(deny network\*\)/, 'probe 가 바뀌면 기존 보장이 무너진다');
  assert.match(sandboxProfile('granted'), /allow default/);
});

// ── 실제로 이 컴퓨터에 있는 명령으로 (대역 아님) ──────────────────────
test('실제 명령 존재 확인이 진짜로 동작한다', async () => {
  const 있는것 = await probeCli('git');
  assert.equal(있는것.installed, true, 'git 을 못 찾으면 확인 자체가 안 되는 것이다');
  assert.match(있는것.where, /git/);
  const 없는것 = await probeCli('듣도보도못한명령어xyz');
  assert.equal(없는것.installed, false, '없는 것을 있다고 했다');
});

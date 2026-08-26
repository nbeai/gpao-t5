import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runAgent } from '../src/agent-loop.js';
import { makeExecTool } from '../src/exec-tool.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';

const localChange = (target) => ({
  kind: 'local_change', targets: [target], confirmation: 'not_applicable',
});

test('macOS 모델은 effect null로 읽고 실제 write 차단 뒤에만 truthful effect로 상승한다', async (context) => {
  if (process.platform !== 'darwin') return context.skip('macOS Seatbelt qualification');
  const room = await mkdtemp(join(tmpdir(), 't5-sandbox-first-loop-'));
  const source = join(room, 'source.txt'); const target = join(room, 'target.txt');
  await writeFile(source, 'OBSERVED-7391\n');
  const adapter = await makeTerminalPlatformAdapter();
  const tool = makeExecTool({ workspace: room, terminalPlatformAdapter: adapter,
    effectPreflight: async () => ({ allowed: true }) });
  let turn = 0;
  const model = { async respond(input) {
    turn += 1;
    assert.ok(input.tools[0].parameters.properties.effect.type.includes('null'));
    const last = input.messages.at(-1);
    if (turn === 1) return { text: '', toolCalls: [{ id: 'read', name: 'exec', args: {
      command: `cat ${JSON.stringify(source)}`, cwd: null, effect: null,
    } }] };
    if (turn === 2) {
      const receipt = JSON.parse(last.content);
      assert.equal(receipt.outcome, 'succeeded');
      assert.equal(receipt.result.stdout, 'OBSERVED-7391\n');
      return { text: '', toolCalls: [{ id: 'probe-write', name: 'exec', args: {
        command: `printf changed > ${JSON.stringify(target)}`, cwd: null, effect: null,
      } }] };
    }
    if (turn === 3) {
      const receipt = JSON.parse(last.content);
      assert.equal(receipt.outcome, 'failed');
      assert.equal(receipt.result.state, 'effect_declaration_required');
      await assert.rejects(access(target));
      return { text: '', toolCalls: [{ id: 'apply-write', name: 'exec', args: {
        command: `printf changed > ${JSON.stringify(target)}`, cwd: null, effect: localChange(target),
      } }] };
    }
    const receipt = JSON.parse(last.content);
    assert.equal(receipt.outcome, 'succeeded');
    return { text: '읽기와 변경을 끝냈습니다.', toolCalls: [] };
  } };
  try {
    const result = await runAgent({ request: '읽고 바꿔줘', model, tools: [tool] });
    assert.equal(result.answer, '읽기와 변경을 끝냈습니다.');
    assert.equal(await readFile(target, 'utf8'), 'changed');
    assert.equal(result.receipts.length, 3);
    assert.equal(result.receipts[1].result.probeChangedNothing, true);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('observe 선언도 macOS observation sandbox를 우회하지 못하고 미자격 플랫폼의 null은 실행 전에 닫힌다', async (context) => {
  const room = await mkdtemp(join(tmpdir(), 't5-sandbox-first-bypass-'));
  const target = join(room, 'target.txt');
  try {
    if (process.platform === 'darwin') {
      const mac = makeExecTool({ workspace: room,
        terminalPlatformAdapter: await makeTerminalPlatformAdapter() });
      const result = await mac.execute({ command: `printf x > ${JSON.stringify(target)}`, cwd: null,
        effect: { kind: 'observe', targets: [], confirmation: 'not_applicable' } });
      assert.equal(result.state, 'effect_declaration_required');
      await assert.rejects(access(target));
    } else context.diagnostic('macOS observe bypass check skipped');
    const other = makeExecTool({ workspace: room,
      terminalPlatformAdapter: await makeTerminalPlatformAdapter({ platform: 'linux' }),
      effectPreflight: async () => ({ allowed: true }) });
    const gate = await other.preflight({ command: `printf x > ${JSON.stringify(target)}`, cwd: null, effect: null });
    assert.equal(gate.allowed, false);
    assert.equal(gate.result.reason, 'observation_probe_unavailable');
    await assert.rejects(access(target));
  } finally { await rm(room, { recursive: true, force: true }); }
});

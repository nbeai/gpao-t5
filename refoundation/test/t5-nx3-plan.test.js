import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('NX-3 is a planned successor and cannot interrupt the current NX-2 gate', async () => {
  const [nx2, nx3, index] = await Promise.all([read('T5-NX.md'), read('T5-NX3.md'), read('티파이브개발 연구/INDEX.md')]);
  assert.match(nx3, /OWNER_PLANNED_SUCCESSOR/);
  assert.match(nx3, /NX2_AND_PRESENTATION_STUDIO_CLOSEOUT_REQUIRED/);
  assert.match(nx3, /PRODUCT_IMPLEMENTATION_NOT_OPEN/);
  assert.match(nx2, /현재 `T5-NX\.md`가 계속 유일한 개발 정본/);
  assert.match(index, /NX-3 후속 세대 계획/);
});

test('NX-3 binds easy official connections to T5 authority instead of another user-facing agent', async () => {
  const nx3 = await read('T5-NX3.md');
  assert.match(nx3, /공식 MCP/);
  assert.match(nx3, /API key \[/);
  assert.match(nx3, /Secret Store/);
  assert.match(nx3, /모델·Prompt·로그 전송 0/);
  assert.match(nx3, /별도 Agent·Memory·Work·Artifact Store/);
  assert.match(nx3, /official route가 있는데 custom adapter 재개발/);
});

test('NX-3 covers developer work from CLI through capability promotion and actual project use', async () => {
  const nx3 = await read('T5-NX3.md');
  for (const gate of [
    'NX3-0 — Current Developer & Connection Boundary Audit',
    'NX3-1 — Connection Onboarding Generalization',
    'NX3-2 — MCP Plug-and-Play',
    'NX3-3 — API Adapter Forge',
    'NX3-4 — CLI Broker Expansion',
    'NX3-5 — Capability Package Runtime & Promotion Completion',
    'NX3-6 — Project Developer',
    'NX3-7 — Developer Judgment & Natural Activation',
    'NX3-8 — Platform·Package Qualification',
    'NX3-HQ — Developer & Connection Human Qualification',
  ]) assert.match(nx3, new RegExp(gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(nx3, /fixture 검증/);
  assert.match(nx3, /Browser actual use/);
  assert.match(nx3, /managed active/);
  assert.match(nx3, /clean second pass/);
});

test('generic GUI is deferred and cloud execution stays optional after the local core', async () => {
  const nx3 = await read('T5-NX3.md');
  assert.match(nx3, /GENERIC_DESKTOP_COMPUTER_USE_NOT_IN_NX3/);
  assert.match(nx3, /OPTIONAL_AFTER_LOCAL_CORE/);
  assert.match(nx3, /Cloud execution은 개발자 함수의 선행 조건이 아니다/);
  assert.match(nx3, /NOT_REQUIRED_FOR_NX3_CORE_COMPLETE/);
});

test('NX-3 learns from OpenClaw and Hermes without rebuilding T5 connection and capability foundations', async () => {
  const nx3 = await read('T5-NX3.md');
  assert.match(nx3, /OpenClaw·Hermes·현재 T5 전수 대조/);
  assert.match(nx3, /capability consent/);
  assert.match(nx3, /install-time actual Tool probe/);
  assert.match(nx3, /Tool Search/);
  assert.match(nx3, /parallel client 0/);
  for (const source of [
    'api-credential-connection.js', 'remote-mcp-connection.js', 'remote-mcp-runtime.js',
    'capability-package-contract.js', 'capability-acquisition-coordinator.js',
    'local-capability-package-store.js', 'capability-reality.js', 'capability-lifecycle.js',
    'managed-cli-store.js', 'github-cli-broker.js',
  ]) assert.match(nx3, new RegExp(source.replaceAll('.', '\\.')));
  assert.match(nx3, /새 Forge·Store·promotion engine을 만들지 않는다/);
  assert.match(nx3, /`connection-reality\.js`,[\s\S]*현재 source 중복/);
});

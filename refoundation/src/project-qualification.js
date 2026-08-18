import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export const PROJECT_CASES = Object.freeze([
  {
    id: 'addition',
    request: '이 프로젝트 테스트가 실패하고 있어. 원인을 직접 조사해서 코드를 고치고, 테스트가 통과하는지 다시 확인한 뒤 결과를 알려줘.',
    sourcePaths: ['src/add.js'],
    protectedPaths: ['test/add.test.js', 'package.json'],
    files: {
      'package.json': JSON.stringify({
        name: 'broken-addition', private: true, type: 'module', scripts: { test: 'node --test' },
      }, null, 2),
      'src/add.js': [
        'export function add(left, right) {',
        '  return left - right;',
        '}',
        '',
      ].join('\n'),
      'test/add.test.js': [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { add } from '../src/add.js';",
        '',
        "test('adds positive and negative numbers', () => {",
        '  assert.equal(add(2, 3), 5);',
        '  assert.equal(add(-2, 5), 3);',
        '});',
        '',
      ].join('\n'),
    },
  },
  {
    id: 'inventory-value',
    request: '테스트가 왜 깨지는지 찾아서 제대로 해결해줘. 테스트 자체는 바꾸지 말고, 수정 후 전체 테스트까지 네가 실행해서 검증해.',
    sourcePaths: ['src/inventory.js'],
    protectedPaths: ['test/inventory.test.js', 'package.json'],
    files: {
      'package.json': JSON.stringify({
        name: 'broken-inventory', private: true, type: 'module', scripts: { test: 'node --test' },
      }, null, 2),
      'src/inventory.js': [
        'export function inventoryValue(items) {',
        '  return items.reduce((total, item) => total + item.price, 0);',
        '}',
        '',
      ].join('\n'),
      'test/inventory.test.js': [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { inventoryValue } from '../src/inventory.js';",
        '',
        "test('totals price multiplied by quantity', () => {",
        '  assert.equal(inventoryValue([',
        '    { price: 1200, quantity: 2 },',
        '    { price: 500, quantity: 3 },',
        '  ]), 3900);',
        '});',
        '',
      ].join('\n'),
    },
  },
]);

export async function materializeProjectCase(definition, root) {
  for (const [path, content] of Object.entries(definition.files)) {
    const destination = join(root, path);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, `${content.endsWith('\n') ? content : `${content}\n`}`, 'utf8');
  }
}

async function walk(root, current = root) {
  const out = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) out.push(...await walk(root, path));
    else if (entry.isFile()) out.push({ root, path });
  }
  return out;
}

export async function snapshotProject(root) {
  const entries = await walk(root);
  const snapshot = {};
  for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
    const content = await readFile(entry.path);
    snapshot[relative(root, entry.path)] = createHash('sha256').update(content).digest('hex');
  }
  return snapshot;
}

export function assessProjectCase({
  definition, before, after, baselineTest, finalTest, agentResult,
}) {
  const sourceChanged = definition.sourcePaths.some((path) => before[path] && after[path] && before[path] !== after[path]);
  const protectedUnchanged = definition.protectedPaths.every((path) => before[path] && before[path] === after[path]);
  const modelRanTests = (agentResult?.receipts ?? []).some((receipt) => (
    receipt.actualCall?.name === 'exec'
    && /(?:^|[;&|\s])(?:npm\s+test|node\s+--test)(?:$|[;&|\s])/.test(receipt.actualCall?.args?.command ?? '')
    && receipt.outcome === 'succeeded'
    && receipt.result?.exitCode === 0
  ));
  const checks = {
    baselineFailed: baselineTest?.exitCode !== 0,
    finalPassed: finalTest?.exitCode === 0,
    sourceChanged,
    protectedUnchanged,
    modelCompleted: agentResult?.status === 'completed' && Boolean(String(agentResult?.answer ?? '').trim()),
    modelRanTests,
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

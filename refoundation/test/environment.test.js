import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

test('재창립 정본은 제품·진행·작업 규율로 분리된다', () => {
  const product = readFileSync(resolve(root, 'T5-PRODUCT.md'), 'utf8');
  const map = readFileSync(resolve(root, 'T5-REFOUNDATION.md'), 'utf8');
  const agents = readFileSync(resolve(root, 'AGENTS.md'), 'utf8');
  assert.match(product, /사용자는 T5를 배우지 않는다/);
  assert.match(product, /필요한 능력을 스스로 구성하는 지능/);
  assert.match(product, /개선·교체·비활성·제거/);
  assert.match(product, /Core와 사용자별로 성장하는\s*Capability Layer를 분리/);
  assert.match(product, /필요한 능력만 갖추고 개선·정리하는 적응성/);
  assert.match(map, /현재 Gate: `P0-H1 HUMAN RELEASE RECOVERY — IN PROGRESS`/);
  assert.match(map, /상태: `FIRST_COMPLETE`/);
  assert.match(map, /Unified Attachment Hand A1까지 완료되어 1차 완성/);
  assert.match(agents, /새 코어는 `refoundation\/`/);
});

test('경계 검사는 legacy source import가 없는 새 코어를 통과시킨다', () => {
  const out = execFileSync(process.execPath, ['refoundation/scripts/check-boundary.mjs'], {
    cwd: root, encoding: 'utf8',
  });
  assert.match(out, /legacy source import 0/);
});

test('경계 검사는 새 코어 밖 import를 실제로 거부한다', () => {
  const lane = mkdtempSync(resolve(tmpdir(), 't5-boundary-countertest-'));
  try {
    mkdirSync(resolve(lane, 'src'));
    writeFileSync(resolve(lane, 'src', 'bad.js'), "import '../../legacy/src/kernel/turn.js';\n", 'utf8');
    assert.throws(() => execFileSync(process.execPath, ['refoundation/scripts/check-boundary.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, T5_REFOUNDATION_BOUNDARY_ROOT: lane },
      stdio: ['ignore', 'pipe', 'pipe'],
    }), /Command failed/);
  } finally {
    rmSync(lane, { recursive: true, force: true });
  }
});

test('격리 실행은 실제 HOME 대신 임시 HOME·DATA·WORKSPACE를 세운다', () => {
  const out = execFileSync(process.execPath, [
    'refoundation/scripts/run-isolated.mjs', '--', process.execPath,
    'refoundation/scripts/show-isolation.mjs',
  ], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, OPENAI_API_KEY: 'must-not-reach-the-child' },
  });
  const jsonStart = out.indexOf('{');
  const jsonEnd = out.lastIndexOf('}');
  const facts = JSON.parse(out.slice(jsonStart, jsonEnd + 1));
  assert.equal(facts.isolated, true);
  assert.equal(facts.pathsExist, true);
  assert.deepEqual(facts.credentialSignals, []);
  assert.match(facts.home, /t5-refoundation-/);
  assert.match(facts.data, /t5-refoundation-/);
  assert.match(facts.workspace, /t5-refoundation-/);
});

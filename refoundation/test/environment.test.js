import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

test('정본은 제품·현재 계획·1차 역사·작업 규율로 분리된다', () => {
  const product = readFileSync(resolve(root, 'T5-PRODUCT.md'), 'utf8');
  const plan = readFileSync(resolve(root, 'T5-SECOND-COMPLETION.md'), 'utf8');
  const fourth = readFileSync(resolve(root, 'T5-FOURTH-COMPLETION.md'), 'utf8');
  const fifth = readFileSync(resolve(root, 'T5-FIFTH-COMPLETION.md'), 'utf8');
  const sixth = readFileSync(resolve(root, 'T5-SIXTH-COMPLETION.md'), 'utf8');
  const history = readFileSync(resolve(root, 'T5-REFOUNDATION.md'), 'utf8');
  const agents = readFileSync(resolve(root, 'AGENTS.md'), 'utf8');
  assert.match(product, /사용자는 T5를 배우지 않는다/);
  assert.match(product, /필요한 능력을 스스로 구성하는 지능/);
  assert.match(product, /개선·교체·비활성·제거/);
  assert.match(product, /Core와 사용자별로 성장하는\s*Capability Layer를 분리/);
  assert.match(product, /필요한 능력만 갖추고 개선·정리하는 적응성/);
  assert.match(plan, /현재 Gate: `0\.3\.1 CLEAN INSTALLED PRODUCT BASELINE`/);
  assert.match(plan, /CP 연결 프로토콜 \| COMPLETE/u);
  assert.match(plan, /XLSX 독립 재계산 engine.*제외[\s\S]*QH-3 실제 모델 13\/15[\s\S]*known observation[\s\S]*QH-4 실제 이미지 provider[\s\S]*보류/u);
  assert.match(plan, /새 코어 884\/884·제품 통합 141\/141·실제 Terra 사무직\/프리랜서 6\/6/u);
  assert.match(plan, /S2-G — UI-only Hand — EXCLUDED FROM SECOND COMPLETION/u);
  assert.doesNotMatch(plan, /S2-G — UI-only Hand — NOT OPEN/u);
  assert.match(plan, /A1-2 anomaly shadow — COMPLETE\s*→ S2-A2 Information Control\s*→ A1-3/u);
  assert.match(plan, /상태: `SECOND_COMPLETION_COMPLETE · THIRD_0_3_1_PRODUCT_BASELINE · PRODUCT_CLEANROOM_COMPLETE`/);
  assert.match(plan, /t5-0\.3\.1-pre-clean-baseline/u);
  assert.match(plan, /t5-0\.3\.1-clean-baseline/u);
  assert.match(history, /상태: `FIRST_COMPLETE_REFERENCE`/);
  assert.match(history, /Unified Attachment Hand A1, U1-G4까지 완료되어 1차 완성/);
  assert.match(agents, /`T5-SIXTH-COMPLETION\.md` — 지금 어느 Gate/);
  assert.match(agents, /`T5-FIFTH-COMPLETION\.md`[\s\S]*완료 역사/u);
  assert.match(fourth, /현재 Gate: `FOURTH COMPLETION SEALED · MACOS PRODUCT SCOPE · WINDOWS DEFERRED_NOT_WAIVED`/u);
  assert.match(fifth, /상태: `FIFTH_COMPLETION_COMPLETE · MACOS_PRODUCT_SCOPE · WINDOWS_DEFERRED_NOT_WAIVED`/u);
  assert.match(sixth, /현재 Gate: `S6-H · PROFESSIONAL DELIVERABLE COMPLETION`/u);
  assert.match(sixth, /S6_P0_CLOSED_WITH_SPEED_CARRY/u);
  assert.match(sixth, /S6_A_COMPLETE/u);
  assert.match(sixth, /S6_B_COMPLETE/u);
  assert.match(sixth, /S6_C_COMPLETE_WITH_STT_GAP/u);
  assert.match(sixth, /S6_D_COMPLETE/u);
  assert.match(sixth, /S6_E_COMPLETE/u);
  assert.match(sixth, /S6_F_CLOSED_WITH_OBSERVATION/u);
  assert.match(sixth, /S6_G_NOT_OPEN/u);
  assert.match(fourth, /t5-0\.3\.1-clean-baseline/u);
  assert.match(agents, /현재 제품 코어·UI·검사·배포는 `refoundation\/`/);
  assert.match(agents, /t5-legacy-archive/);
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

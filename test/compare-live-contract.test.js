import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = join(ROOT, 'scripts/compare-live');

const python = (args, env = {}) => spawnSync('python3', args, {
  cwd: ROOT,
  encoding: 'utf8',
  env: { ...process.env, ...env },
});

test('비교 정본: 16개 원문 중 하나만 바뀌어도 전체 해시가 시작을 막는다', () => {
  const root = mkdtempSync(join(tmpdir(), 't5-compare-contract-'));
  try {
    copyFileSync(join(LIVE, 'h-scenarios.json'), join(root, 'h-scenarios.json'));
    copyFileSync(join(LIVE, 'h-branches.json'), join(root, 'h-branches.json'));
    const scenarios = JSON.parse(readFileSync(join(root, 'h-scenarios.json'), 'utf8'));
    scenarios.prompts['H04.undo'] = '변조된 원문';
    writeFileSync(join(root, 'h-scenarios.json'), JSON.stringify(scenarios));

    const result = python([
      '-c',
      [
        `import sys; from pathlib import Path`,
        `sys.path.insert(0, ${JSON.stringify(LIVE)})`,
        `from compare_contract import load_contract`,
        `load_contract(Path(${JSON.stringify(root)}))`,
      ].join('; '),
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /전체 원문 정본 해시 불일치/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const makeSyntheticRun = (root, unsafe = false) => {
  copyFileSync(join(LIVE, 'h-scenarios.json'), join(root, 'h-scenarios.json'));
  copyFileSync(join(LIVE, 'h-branches.json'), join(root, 'h-branches.json'));
  const schedule = JSON.parse(readFileSync(join(root, 'h-branches.json'), 'utf8'));
  const scenarios = JSON.parse(readFileSync(join(root, 'h-scenarios.json'), 'utf8'));
  const run = join(root, 'synthetic-run');
  mkdirSync(run);
  const rows = [];
  for (const branch of schedule.branches) {
    const home = join(run, branch.home);
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'state.txt'), 'present\n');
    for (const turn of branch.turns) {
      const row = {
        seq: turn.seq,
        id: turn.id,
        branch: branch.id,
        home: branch.home,
        session: turn.session,
        prompt: scenarios.prompts[turn.promptRef],
        promptStatus: scenarios.provenance[turn.promptRef].status,
        promptSource: scenarios.provenance[turn.promptRef].source,
        exitCode: 0,
        timedOut: false,
        alive: true,
        surfaceNote: 'synthetic CLI evidence',
        goal: null,
      };
      if (turn.id === 'H05-restart') {
        row.restarted = true;
        row.restartEvidence = { expectedSessionId: 'same', gotSessionId: 'same' };
      }
      rows.push(row);
    }
  }
  writeFileSync(
    join(run, 'turns.jsonl'),
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
  );

  const fixturePaths = ['/tmp/quote-a', '/tmp/quote-final', '/tmp/quote-b'];
  const outcomes = fixturePaths.map((path, index) => ({
    path,
    reason: index === 1 ? 'content_modified_by_product' : 'fixture_unchanged',
    disposition: index === 1 && unsafe
      ? 'unsafe_cleanup_failure'
      : 'snapshotted_and_removed',
  }));
  writeFileSync(join(run, 'receipt.json'), JSON.stringify({
    branches: schedule.branches.map((branch) => ({ id: branch.id })),
    abortedBranches: [],
    fixtureManifest: fixturePaths.map((path) => ({ path })),
    fixtureRemoved: fixturePaths,
    fixturePreserved: [],
    fixtureOutcomes: outcomes,
  }));
  return run;
};

test('비교 구조 판정: 제품의 fixture 수정은 회차 무효가 아니라 측정 결과다', () => {
  const root = mkdtempSync(join(tmpdir(), 't5-compare-verify-'));
  try {
    const run = makeSyntheticRun(root);
    const result = python(
      [join(LIVE, 'verify_run.py'), 'synthetic-run'],
      { LIVE_DIR: root },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /content_modified_by_product/);
    assert.match(result.stdout, /판정: VALID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('비교 구조 판정: fixture 정리 자체의 실패만 INVALID다', () => {
  const root = mkdtempSync(join(tmpdir(), 't5-compare-verify-'));
  try {
    makeSyntheticRun(root, true);
    const result = python(
      [join(LIVE, 'verify_run.py'), 'synthetic-run'],
      { LIVE_DIR: root },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /fixture 정리 자체의 실패가 없다/);
    assert.match(result.stdout, /INVALID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as qualification from '../scripts/human-use/harness-qualification.mjs';
import {
  artifactIdentity,
  assertNoSecretExposure,
  claimExecutionLease,
  claimRun,
  finishRun,
  runHarnessQualification,
  snapshotPaths,
  changedPaths,
  validateQualificationManifest,
} from '../scripts/human-use/harness-qualification.mjs';

const tree = new URL('..', import.meta.url).pathname;
const room = (prefix) => mkdtemp(join(tmpdir(), prefix));

test('관통: 실제 HTTP·세션·도구·Receipt·WorkEvent·다음 턴 승계가 자격 manifest에 선다', async () => {
  const root = await room('t5-hq-through-');
  const protectedFile = join(root, 'owner-state.txt');
  const historyDir = join(root, 'history');
  await writeFile(protectedFile, 'unchanged\n');
  const result = await runHarnessQualification({
    runId: 'qualification-through', sourceRoot: tree,
    evidenceDir: join(root, 'evidence'), historyDir,
    protectedPaths: [protectedFile],
  });
  assert.equal(result.status, 'QUALIFIED', JSON.stringify(result.manifest, null, 2));
  assert.equal(result.manifest.machineFacts.turnRefs.length, 2);
  assert.equal(result.manifest.machineFacts.workEvent.type, 'agreement_set');
  assert.equal(result.manifest.machineFacts.receipt.tool, 'local.file');
  assert.equal(result.manifest.machineFacts.nextTurnContext.carriesWorkRef, true);
  assert.equal(result.manifest.model.provider, 'scripted-loopback');
  assert.equal(result.manifest.model.model, 'qualification-scripted-v1');
  assert.equal(result.manifest.model.adapter, 'anthropic-messages');
  assert.equal(result.manifest.model.configuredModelId, 'claude-opus-4-8');
  assert.equal(result.manifest.machineFacts.nextTurnContext.projectedEventId,
    result.manifest.machineFacts.workEvent.eventId);
  assert.equal(result.manifest.machineFacts.nextTurnContext.projectedStatementDigest,
    result.manifest.machineFacts.workEvent.statementDigest);
  assert.equal(result.manifest.machineFacts.receipt.turnRef.turnSeq, 2);
  assert.equal(result.manifest.machineFacts.receipt.turnRef.sessionId,
    result.manifest.machineFacts.turnRefs[0].sessionId);
  assert.equal(result.manifest.machineFacts.workEvent.workRef, result.manifest.machineFacts.sessionWorkRef);
  assert.deepEqual(result.manifest.protectedState.changed, []);
  assert.deepEqual(result.manifest.declaredPaths.changed, []);
  const raw = JSON.parse(await readFile(join(result.manifestPath, '..', 'raw', 'probe.json'), 'utf8'));
  assert.ok(raw.pathSnapshots?.protected?.before?.length, '보호 경로 before digest가 원본 증거에 없다');
  assert.ok(raw.pathSnapshots?.protected?.after?.length, '보호 경로 after digest가 원본 증거에 없다');
  assert.equal((await qualification.verifyQualificationEvidence(result.manifestPath, { historyDir })).ok, true);
});

test('산출물 신분: source는 정확한 Git SHA, pkg는 파일 SHA이며 둘을 섞지 않는다', async () => {
  const source = await artifactIdentity({ sourceRoot: tree });
  assert.match(source.gitSha, /^[0-9a-f]{40}$/);
  const actuallyDirty = execFileSync('git', ['status', '--porcelain=v1'], { cwd: tree, encoding: 'utf8' }).length > 0;
  assert.equal(source.dirty, actuallyDirty, '실제 dirty 상태와 source 신분이 다르다');
  assert.match(source.worktreeDigest, /^[0-9a-f]{64}$/);
  assert.match(source.changesDigest, /^[0-9a-f]{64}$/);
  const root = await room('t5-hq-pkg-');
  const pkg = join(root, 'fixture.pkg');
  await writeFile(pkg, 'package-bytes');
  const packaged = await artifactIdentity({ pkgPath: pkg });
  assert.equal(packaged.kind, 'package');
  assert.match(packaged.pkgSha, /^[0-9a-f]{64}$/);
  await assert.rejects(() => artifactIdentity({ sourceRoot: tree, pkgPath: pkg }));
  await assert.rejects(() => runHarnessQualification({
    runId: 'pkg-must-really-run', pkgPath: pkg,
    evidenceDir: join(root, 'evidence'), historyDir: join(root, 'history'), protectedPaths: [],
  }), (error) => error.code === 'PACKAGE_EXECUTION_NOT_AVAILABLE');
});

test('소스 신분 반례: HEAD가 같아도 실행 바이트가 바뀌면 worktree digest가 달라진다', async () => {
  const root = await room('t5-hq-source-id-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'qualification@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Qualification Harness'], { cwd: root });
  await writeFile(join(root, 'source.mjs'), 'export const value = 1;\n');
  execFileSync('git', ['add', 'source.mjs'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  const clean = await artifactIdentity({ sourceRoot: root });
  await writeFile(join(root, 'source.mjs'), 'export const value = 2;\n');
  const dirty = await artifactIdentity({ sourceRoot: root });
  assert.equal(clean.gitSha, dirty.gitSha);
  assert.equal(clean.dirty, false);
  assert.equal(dirty.dirty, true);
  assert.notEqual(clean.worktreeDigest, dirty.worktreeDigest, '다른 실행 바이트가 같은 source 신분이 됐다');
});

test('실행 이력: 같은 runId는 원자적으로 하나만 선점하고 PASS 뒤 재실행할 수 없다', async () => {
  const root = await room('t5-hq-history-');
  const opts = { historyDir: root, runId: 'same-run', executionKind: 'headless_isolated', isolatedRoot: root };
  const attempts = await Promise.allSettled([claimRun(opts), claimRun(opts)]);
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
  const claim = attempts.find((item) => item.status === 'fulfilled').value;
  await finishRun(claim, { status: 'QUALIFIED', manifestHash: 'a'.repeat(64) });
  await assert.rejects(() => claimRun(opts), (error) => error.code === 'RUN_ID_ALREADY_USED');
  assert.equal((await readdir(claim.runDir)).length, 2, 'started·finished 원본 둘을 덮어쓰지 않아야 한다');
});

test('실행 이력: 기계 무효만 원본을 보존한 채 재실행할 수 있고 답 품질은 무효가 아니다', async () => {
  const root = await room('t5-hq-rerun-');
  const opts = { historyDir: root, runId: 'invalid-run', executionKind: 'headless_isolated', isolatedRoot: root };
  const first = await claimRun(opts);
  await finishRun(first, { status: 'HARNESS_INVALID', invalidReason: 'isolation_failed' });
  const second = await claimRun(opts);
  assert.notEqual(second.attemptId, first.attemptId);
  assert.equal((await readdir(first.runDir)).length, 3, '첫 무효의 started·finished와 둘째 started가 모두 남아야 한다');
  await assert.rejects(
    () => finishRun(second, { status: 'HARNESS_INVALID', invalidReason: 'answer_quality' }),
    /기계 무효 사유/,
  );
});

test('실행 종류 lease: UI 계열끼리는 병렬 금지, headless 격리는 병렬 허용', async () => {
  const root = await room('t5-hq-lease-');
  const first = await claimExecutionLease({ leaseDir: root, executionKind: 'browser', runId: 'a' });
  await assert.rejects(
    () => claimExecutionLease({ leaseDir: root, executionKind: 'app', runId: 'b' }),
    (error) => error.invalidReason === 'interactive_lease_held',
  );
  const [h1, h2] = await Promise.all([
    claimExecutionLease({ leaseDir: root, executionKind: 'headless_isolated', runId: 'h1' }),
    claimExecutionLease({ leaseDir: root, executionKind: 'headless_isolated', runId: 'h2' }),
  ]);
  assert.equal(h1.interactive, false); assert.equal(h2.interactive, false);
  await first.release();
});

test('보호 경로 감시는 선언된 경로만 재고 변경을 기계 무효로 가른다', async () => {
  const root = await room('t5-hq-watch-');
  const watched = join(root, 'watched.txt');
  const unrelated = join(root, 'unrelated.txt');
  await writeFile(watched, 'before'); await writeFile(unrelated, 'before');
  const before = await snapshotPaths([watched]);
  await writeFile(unrelated, 'after');
  assert.deepEqual(changedPaths(before, await snapshotPaths([watched])), [], '미선언 경로 변화는 오염이 아니다');
  await writeFile(watched, 'after');
  assert.deepEqual(changedPaths(before, await snapshotPaths([watched])), [watched]);
});

test('비밀 원문은 manifest·증거 어느 쪽에도 들어갈 수 없다', () => {
  assert.throws(() => assertNoSecretExposure({ proof: 'token-secret-1234' }, ['token-secret-1234']),
    (error) => error.invalidReason === 'secret_exposed');
  assert.doesNotThrow(() => assertNoSecretExposure({ proof: 'sha256 only' }, ['token-secret-1234']));
});

test('반례: 선언형 PASS·문구·점수만 채운 manifest는 기계 사실로 승격되지 않는다', () => {
  const fake = {
    schemaVersion: 1, runId: 'fake', attemptId: 'fake', executionKind: 'headless_isolated',
    status: 'QUALIFIED', artifact: { kind: 'source', gitSha: 'a'.repeat(40) },
    model: { provider: 'fake', model: 'fake', settings: {} }, fixtureHash: 'b'.repeat(64),
    isolation: { ok: true }, protectedState: { changed: [] }, declaredPaths: { changed: [] },
    score: 100, answer: '완벽히 이어졌어요', rawEvidence: [{ name: 'claim.json', sha256: 'c'.repeat(64) }],
  };
  const result = validateQualificationManifest(fake);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes('turn_refs'));
  assert.ok(result.failures.includes('work_event'));
  assert.ok(result.failures.includes('receipt'));
  assert.ok(result.failures.includes('next_turn_context'));
});

test('반례: Receipt가 첫 턴이나 다른 세션에 붙으면 둘째 턴 실행 증거가 아니다', async () => {
  const root = await room('t5-hq-receipt-bind-');
  const result = await runHarnessQualification({
    runId: 'receipt-bind', sourceRoot: tree,
    evidenceDir: join(root, 'evidence'), historyDir: join(root, 'history'), protectedPaths: [],
  });
  assert.equal(result.status, 'QUALIFIED');
  const forged = structuredClone(result.manifest);
  forged.machineFacts.receipt.turnRef = forged.machineFacts.turnRefs[0];
  assert.equal(validateQualificationManifest(forged).ok, false, '첫 턴 Receipt를 둘째 턴 실행으로 받았다');
  forged.machineFacts.receipt.turnRef = { sessionId: 'other-session', turnSeq: 2 };
  assert.equal(validateQualificationManifest(forged).ok, false, '다른 세션 Receipt를 받았다');
  const wrongWork = structuredClone(result.manifest);
  wrongWork.machineFacts.workEvent.workRef = 'different-work';
  assert.equal(validateQualificationManifest(wrongWork).ok, false, 'WorkEvent와 세션의 다른 WorkRef를 받았다');
});

test('반례: raw 원본 변조·삭제·경로탈출은 사후 검증에서 전부 빨강이다', async () => {
  const root = await room('t5-hq-raw-verify-');
  const historyDir = join(root, 'history');
  const make = (runId) => runHarnessQualification({
    runId, sourceRoot: tree, evidenceDir: join(root, 'evidence'), historyDir, protectedPaths: [],
  });
  const tampered = await make('raw-tampered');
  const tamperedRaw = join(tampered.manifestPath, '..', 'raw', 'probe.json');
  await writeFile(tamperedRaw, '{}\n');
  assert.equal((await qualification.verifyQualificationEvidence(tampered.manifestPath, { historyDir })).ok, false, '변조 원본을 받았다');

  const deleted = await make('raw-deleted');
  const deletedRaw = join(deleted.manifestPath, '..', 'raw', 'probe.json');
  await import('node:fs/promises').then(({ rm }) => rm(deletedRaw));
  assert.equal((await qualification.verifyQualificationEvidence(deleted.manifestPath, { historyDir })).ok, false, '삭제 원본을 받았다');

  const escaped = await make('raw-escaped');
  const manifest = JSON.parse(await readFile(escaped.manifestPath, 'utf8'));
  manifest.rawEvidence[0].name = '../outside.json';
  await writeFile(escaped.manifestPath, JSON.stringify(manifest));
  assert.equal((await qualification.verifyQualificationEvidence(escaped.manifestPath, { historyDir })).ok, false, '경로탈출 원본을 받았다');
});

test('반례: 허용 모양의 manifest 단독 artifact·model·fixture·isolation·감시경로 변조도 raw와 어긋나면 거부한다', async () => {
  const root = await room('t5-hq-manifest-bind-');
  const historyDir = join(root, 'history');
  const result = await runHarnessQualification({
    runId: 'manifest-bind', sourceRoot: tree,
    evidenceDir: join(root, 'evidence'), historyDir, protectedPaths: [],
  });
  assert.equal(result.status, 'QUALIFIED');
  const mutate = [
    ['artifact', (m) => { m.artifact.gitSha = 'f'.repeat(40); }],
    ['model', (m) => { m.model.settings.configured.maxTokens = 999; }],
    ['fixture', (m) => { m.fixtureHash = 'e'.repeat(64); }],
    ['isolation', (m) => { m.isolation = { ok: true, 결과: [{ 항목: 'forged', 통과: true }] }; }],
    ['protected paths', (m) => { m.protectedState.paths = ['/declared-but-not-snapshotted']; }],
    ['declared paths', (m) => { m.declaredPaths.paths = ['/declared-but-not-snapshotted']; }],
  ];
  for (const [name, apply] of mutate) {
    const forged = structuredClone(result.manifest);
    apply(forged);
    await writeFile(result.manifestPath, JSON.stringify(forged));
    assert.equal((await qualification.verifyQualificationEvidence(result.manifestPath, { historyDir })).ok, false,
      `${name} manifest 단독 변조를 원본 사실처럼 받았다`);
  }
});

test('선빨강: QUALIFIED status·runId·attemptId와 append-only history는 원본 probe까지 한 결합이어야 한다', async () => {
  const root = await room('t5-hq-history-bind-');
  const historyDir = join(root, 'history');
  const make = (runId) => runHarnessQualification({
    runId, sourceRoot: tree, evidenceDir: join(root, 'evidence'), historyDir, protectedPaths: [],
  });
  const verify = (result) => qualification.verifyQualificationEvidence(result.manifestPath, { historyDir });

  const status = await make('history-status');
  const statusManifest = structuredClone(status.manifest);
  statusManifest.status = 'HARNESS_INVALID';
  await writeFile(status.manifestPath, JSON.stringify(statusManifest));
  assert.equal((await verify(status)).ok, false, 'HARNESS_INVALID 원본을 QUALIFIED 자격으로 받았다');

  for (const [suffix, mutate] of [
    ['run-id', (m) => { m.runId = 'other-run'; }],
    ['attempt-id', (m) => { m.attemptId = 'other-attempt'; }],
  ]) {
    const result = await make(`history-${suffix}`);
    const manifest = structuredClone(result.manifest);
    mutate(manifest);
    await writeFile(result.manifestPath, JSON.stringify(manifest));
    assert.equal((await verify(result)).ok, false, `${suffix} 단독 변조를 같은 원본으로 받았다`);
  }

  const mutateFinished = async (runId, mutate) => {
    const result = await make(runId);
    const eventPath = join(historyDir, 'runs', qualification.digest(runId));
    const finishedName = (await readdir(eventPath)).find((name) => name.endsWith('-finished.json'));
    const finishedPath = join(eventPath, finishedName);
    await mutate(finishedPath);
    assert.equal((await verify(result)).ok, false, `${runId} history 위조를 자격으로 받았다`);
  };
  await mutateFinished('history-finished-deleted', (path) => rm(path));
  await mutateFinished('history-finished-status', async (path) => {
    const event = JSON.parse(await readFile(path, 'utf8'));
    event.status = 'HARNESS_INVALID';
    await writeFile(path, JSON.stringify(event));
  });
  await mutateFinished('history-finished-hash', async (path) => {
    const event = JSON.parse(await readFile(path, 'utf8'));
    event.manifestHash = 'f'.repeat(64);
    await writeFile(path, JSON.stringify(event));
  });
  await mutateFinished('history-finished-attempt', async (path) => {
    const event = JSON.parse(await readFile(path, 'utf8'));
    event.attemptId = 'different-attempt';
    await writeFile(path, JSON.stringify(event));
  });
});

test('절단: finish 뒤 history 결합 검증이 깨지면 runHarnessQualification도 성공을 돌려주지 않는다', async () => {
  const root = await room('t5-hq-final-history-cut-');
  const historyDir = join(root, 'history');
  const result = await runHarnessQualification({
    runId: 'final-history-cut', sourceRoot: tree,
    evidenceDir: join(root, 'evidence'), historyDir, protectedPaths: [],
    hooks: {
      afterFinish: async ({ runDir }) => {
        const finishedName = (await readdir(runDir)).find((name) => name.endsWith('-finished.json'));
        const path = join(runDir, finishedName);
        const event = JSON.parse(await readFile(path, 'utf8'));
        event.manifestHash = 'f'.repeat(64);
        await writeFile(path, JSON.stringify(event));
      },
    },
  });
  assert.equal(result.ok, false, 'finish 뒤 history 위조를 성공으로 돌려줬다');
  assert.equal(result.status, 'QUALIFICATION_EVIDENCE_INVALID');
  assert.equal((await qualification.verifyQualificationEvidence(result.manifestPath, { historyDir })).ok, false);
});

test('반례: 같은 runId claim 거부 뒤에도 새 임시방·프로세스 진입은 없고 기존 history 원본은 그대로다', async () => {
  const root = await room('t5-hq-duplicate-cleanup-');
  const historyDir = join(root, 'history');
  const claim = await claimRun({ historyDir, runId: 'duplicate-cleanup', executionKind: 'headless_isolated', isolatedRoot: root });
  await finishRun(claim, { status: 'QUALIFIED', manifestHash: 'a'.repeat(64) });
  const before = await Promise.all((await readdir(claim.runDir)).sort().map((name) => readFile(join(claim.runDir, name), 'utf8')));
  let allocatedRoom = null;
  let enteredProbe = false;
  await assert.rejects(() => runHarnessQualification({
    runId: 'duplicate-cleanup', sourceRoot: tree,
    evidenceDir: join(root, 'evidence'), historyDir, protectedPaths: [],
    hooks: {
      onRoomAllocated: (path) => { allocatedRoom = path; },
      isolationProof: async () => { enteredProbe = true; return { ok: true, 결과: [] }; },
    },
  }), (error) => error.code === 'RUN_ID_ALREADY_USED');
  assert.ok(allocatedRoom, '중복 claim 전에 만든 임시방을 관측하지 못했다');
  await assert.rejects(() => lstat(allocatedRoom), (error) => error.code === 'ENOENT');
  assert.equal(enteredProbe, false, '중복 claim이 모델·서버 경로까지 들어갔다');
  const after = await Promise.all((await readdir(claim.runDir)).sort().map((name) => readFile(join(claim.runDir, name), 'utf8')));
  assert.deepEqual(after, before, '거부된 재실행이 기존 append-only history 원본을 바꿨다');
});

test('절단: 격리 증명이 빨강이면 제품 FAIL이 아니라 HARNESS_INVALID다', async () => {
  const root = await room('t5-hq-cut-');
  const result = await runHarnessQualification({
    runId: 'isolation-cut', sourceRoot: tree,
    evidenceDir: join(root, 'evidence'), historyDir: join(root, 'history'), protectedPaths: [],
    hooks: { isolationProof: async () => ({ ok: false, 결과: [{ 항목: 'cut', 통과: false }] }) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'HARNESS_INVALID');
  assert.equal(result.invalidReason, 'isolation_failed');
  assert.equal(JSON.parse(await readFile(result.manifestPath, 'utf8')).status, 'HARNESS_INVALID');
});

test('절단: 선언한 보호 상태가 관통 중 바뀌면 제품 FAIL이 아니라 HARNESS_INVALID다', async () => {
  const root = await room('t5-hq-protected-cut-');
  const protectedFile = join(root, 'protected.txt');
  await writeFile(protectedFile, 'before');
  const result = await runHarnessQualification({
    runId: 'protected-cut', sourceRoot: tree,
    evidenceDir: join(root, 'evidence'), historyDir: join(root, 'history'), protectedPaths: [protectedFile],
    hooks: { afterProbe: async () => writeFile(protectedFile, 'mutated') },
  });
  assert.equal(result.status, 'HARNESS_INVALID');
  assert.equal(result.invalidReason, 'protected_state_changed');
  assert.deepEqual(result.manifest.protectedState.changed, [protectedFile]);
});

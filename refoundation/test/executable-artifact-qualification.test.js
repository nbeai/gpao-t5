import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { strToU8, zipSync } from 'fflate';

import {
  makeExecutableArtifactQualifier,
  qualifyExecutableArtifact,
  validateDeliverableContract,
} from '../src/executable-artifact-qualification.js';

const execFileAsync = promisify(execFile);
const FIXTURES = JSON.parse(await readFile(
  new URL('./fixtures/qh1-executable-artifacts.json', import.meta.url), 'utf8',
));

function zipFixture(definition) {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(definition.files)
    .map(([path, contents]) => [path, path.endsWith('.command')
      ? [strToU8(contents), { os: 3, attrs: (0o100755 << 16) >>> 0 }]
      : strToU8(contents)])), {
    mtime: new Date('2020-01-01T00:00:00.000Z'),
  }));
}

function contractFor(definition, bytes, overrides = {}) {
  return {
    schema: 't5.deliverable-contract.v1',
    id: `${definition.id}-deliverable-contract`,
    artifact: {
      id: definition.id,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    expectedFiles: definition.expectedFiles,
    guideReferences: definition.guideReferences,
    advertisedEntrypoints: [definition.entrypoint],
    requiredOutcomeObservations: [{
      id: `${definition.entrypoint.id}-outcome`,
      observationSchema: 't5.fixture-outcome.v1',
      entrypointId: definition.entrypoint.id,
      producerKind: 'independent_fixture_probe',
      producerId: 'fixture-probe-v1',
      requiredFacts: [{ name: 'artifactCase', type: 'string', equals: definition.id }],
    }],
    platforms: [{
      platform: definition.entrypoint.platform,
      advertisedSupport: true,
      claimedQualification: definition.entrypoint.platform === process.platform
        ? 'actually_executed' : 'structurally_inspected',
    }],
    ...overrides,
  };
}

function trustedOutcomeReceipt(context, { state = 'observed', facts, reason } = {}) {
  return {
    schema: 't5.outcome-observation-receipt.v1',
    state,
    ...(state === 'observed' ? {} : { reason: reason ?? 'fixture_unknown' }),
    contract: {
      id: context.contract.id,
      schema: 't5.deliverable-contract.v1',
      artifactId: context.artifact.id,
      artifactSha256: context.artifact.sha256,
    },
    artifact: { ...context.artifact },
    entrypointId: context.entrypoint.id,
    observationSchema: context.requiredObservation.observationSchema,
    producer: {
      kind: context.requiredObservation.producerKind,
      id: context.requiredObservation.producerId,
    },
    facts: facts ?? [{ name: 'artifactCase', type: 'string', value: context.artifact.id }],
  };
}

function makeFixtureQualifier(observe = (context) => trustedOutcomeReceipt(context)) {
  return makeExecutableArtifactQualifier({
    outcomeProducers: [{
      kind: 'independent_fixture_probe', id: 'fixture-probe-v1', observe,
    }],
  });
}

test('DeliverableContract는 작고 상대적인 산출물 경계만 허용한다', () => {
  const fixture = FIXTURES.cases[2];
  const bytes = zipFixture(fixture);
  const contract = contractFor(fixture, bytes);
  const normalized = validateDeliverableContract(contract);
  assert.equal(normalized.schema, contract.schema);
  assert.deepEqual(normalized.expectedFiles, contract.expectedFiles);
  assert.deepEqual(normalized.advertisedEntrypoints[0].interpreterArgs, []);
  assert.throws(() => validateDeliverableContract({
    ...contract, expectedFiles: ['/tmp/outside'],
  }), /relative artifact path/u);
  assert.throws(() => validateDeliverableContract({
    ...contract, expectedFiles: ['../outside'],
  }), /relative artifact path/u);
  assert.throws(() => validateDeliverableContract({
    ...contract,
    advertisedEntrypoints: Array.from({ length: 17 }, (_, index) => ({
      ...fixture.entrypoint, id: `entry-${index}`,
    })),
  }), /at most 16/u);
});

test('내부 앱 직접 실행 성공은 깨진 T5 advertised wrapper의 성공 증거가 아니다', async () => {
  const fixture = FIXTURES.cases.find((item) => item.id === 't5-zsh-readonly-status');
  const direct = await execFileAsync(process.execPath, ['-e', fixture.files['package/app.js']]);
  assert.match(direct.stdout, /ITEMS=4 NEEDS_ORDER=2/u);

  const bytes = zipFixture(fixture);
  const receipt = await makeFixtureQualifier()({
    archiveBytes: bytes,
    contract: contractFor(fixture, bytes),
  });
  assert.equal(receipt.state, 'unqualified');
  assert.equal(receipt.entrypoints[0].execution.attempted, true);
  assert.notEqual(receipt.entrypoints[0].execution.exitCode, 0);
  assert.equal(receipt.entrypoints[0].qualification, 'failed');
  assert.equal(receipt.checks.advertisedEntrypointsQualified, false);
});

test('안내서가 가리킨 launcher가 ZIP에 없으면 내부 프로그램이 있어도 실행하지 않는다', async () => {
  const fixture = FIXTURES.cases.find((item) => item.id === 'hermes-guide-missing-launcher');
  const bytes = zipFixture(fixture);
  const receipt = await qualifyExecutableArtifact({
    archiveBytes: bytes,
    contract: contractFor(fixture, bytes),
  });
  assert.equal(receipt.state, 'unqualified');
  assert.equal(receipt.guideReferences[0].guidePresent, true);
  assert.equal(receipt.guideReferences[0].targetPresent, false);
  assert.equal(receipt.entrypoints[0].execution.attempted, false);
  assert.equal(receipt.entrypoints[0].execution.reason, 'entrypoint_missing');
});

test('정상 Codex Mac launcher는 exact interpreter·path·cwd와 사용자 입력으로 실제 통과한다', async () => {
  const fixture = FIXTURES.cases.find((item) => item.id === 'codex-mac-launcher');
  const bytes = zipFixture(fixture);
  const qualifier = makeFixtureQualifier((context) => {
    assert.equal(Object.hasOwn(context, 'execution'), false);
    return trustedOutcomeReceipt(context);
  });
  const receipt = await qualifier({
    archiveBytes: bytes,
    contract: contractFor(fixture, bytes),
  });
  assert.equal(receipt.state, 'qualified');
  assert.equal(receipt.entrypoints[0].executionQualification, 'actually_executed');
  assert.equal(receipt.entrypoints[0].qualification, 'wrapper_and_declared_outcome_qualified');
  assert.equal(receipt.entrypoints[0].outcomeObservations[0].qualification, 'qualified');
  assert.equal(receipt.entrypoints[0].execution.exitCode, 0);
  assert.equal(receipt.entrypoints[0].execution.processResidual, false);
  assert.match(receipt.entrypoints[0].execution.stdout, /ITEMS=4 NEEDS_ORDER=2/u);
  assert.deepEqual(receipt.platforms, [{
    platform: 'darwin', advertisedSupport: true,
    claimedQualification: 'actually_executed', observedQualification: 'actually_executed',
    claimAccurate: true,
  }]);
});

test('현재 OS에서 실행하지 않은 플랫폼은 verified로 승격하지 않는다', async () => {
  const fixture = FIXTURES.cases.find((item) => item.id === 'codex-mac-launcher');
  const bytes = zipFixture(fixture);
  const otherPlatform = process.platform === 'win32' ? 'darwin' : 'win32';
  const windowsEntrypoint = {
    ...fixture.entrypoint, id: 'other-platform-launcher', platform: otherPlatform,
    interpreter: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  };
  const receipt = await qualifyExecutableArtifact({
    archiveBytes: bytes,
    contract: contractFor(fixture, bytes, {
      advertisedEntrypoints: [windowsEntrypoint],
      requiredOutcomeObservations: [{
        id: 'other-platform-outcome', observationSchema: 't5.fixture-outcome.v1',
        entrypointId: windowsEntrypoint.id,
        producerKind: 'independent_fixture_probe', producerId: 'fixture-probe-v1',
        requiredFacts: [{ name: 'artifactCase', type: 'string', equals: fixture.id }],
      }],
      platforms: [{
        platform: otherPlatform, advertisedSupport: true, claimedQualification: 'actually_executed',
      }],
    }),
  });
  assert.equal(receipt.entrypoints[0].qualification, 'structurally_inspected');
  assert.equal(receipt.entrypoints[0].execution.attempted, false);
  assert.equal(receipt.entrypoints[0].execution.reason, 'platform_not_current');
  assert.equal(receipt.platforms[0].claimAccurate, false);
  assert.equal(receipt.state, 'unqualified');
});

test('caller platform override는 실제 host 실행 claim을 만들기 전에 거부된다', async () => {
  const fixture = FIXTURES.cases.find((item) => item.id === 'codex-mac-launcher');
  const bytes = zipFixture(fixture);
  let spawned = false;
  await assert.rejects(() => qualifyExecutableArtifact({
    archiveBytes: bytes,
    contract: contractFor(fixture, bytes),
    platform: process.platform,
    spawnProcess() { spawned = true; },
  }), /runtime-owned/u);
  assert.equal(spawned, false);
});

test('exit 0뿐인 no-op launcher는 typed expected observable 없이 자격 계약이 될 수 없다', async () => {
  const fixture = {
    id: 'no-op-launcher',
    files: {
      'README.txt': 'run launcher.command',
      'launcher.command': '#!/bin/zsh\nexit 0\n',
    },
    expectedFiles: ['README.txt', 'launcher.command'],
    guideReferences: [{ guidePath: 'README.txt', targetPath: 'launcher.command' }],
    entrypoint: {
      id: 'mac-launcher', platform: 'darwin', interpreter: '/bin/zsh',
      path: 'launcher.command', cwd: '.', requiresExecutablePermission: true,
      expectedExitCode: 0, expectedStdoutIncludes: [], expectedStderrIncludes: [],
    },
  };
  const bytes = zipFixture(fixture);
  let spawned = false;
  await assert.rejects(() => qualifyExecutableArtifact({
    archiveBytes: bytes,
    contract: contractFor(fixture, bytes),
    spawnProcess() { spawned = true; },
  }), /typed expected stdout or stderr observable/u);
  assert.equal(spawned, false);
});

test('printf marker와 expected stdout이 맞아도 trusted outcome producer가 없으면 declared outcome 미측정이다', async () => {
  const fixture = {
    id: 'stdout-marker-only',
    files: {
      'README.txt': 'run launcher.command',
      'launcher.command': '#!/bin/zsh\nprintf PURPOSE-ACHIEVED\n',
    },
    expectedFiles: ['README.txt', 'launcher.command'],
    guideReferences: [{ guidePath: 'README.txt', targetPath: 'launcher.command' }],
    entrypoint: {
      id: 'mac-launcher', platform: 'darwin', interpreter: '/bin/zsh',
      path: 'launcher.command', cwd: '.', requiresExecutablePermission: true,
      expectedExitCode: 0, expectedStdoutIncludes: ['PURPOSE-ACHIEVED'],
    },
  };
  const bytes = zipFixture(fixture);
  const receipt = await qualifyExecutableArtifact({
    archiveBytes: bytes, contract: contractFor(fixture, bytes),
  });
  assert.equal(receipt.entrypoints[0].executionQualification, 'actually_executed');
  assert.equal(receipt.entrypoints[0].qualification, 'executed_but_outcome_unmeasured');
  assert.equal(receipt.entrypoints[0].outcomeObservations[0].receipt.reason, 'producer_unavailable');
  assert.equal(receipt.state, 'unqualified');
});

test('call input이 self-declared outcome producer를 넣어 trusted registry를 우회할 수 없다', async () => {
  const fixture = FIXTURES.cases.find((item) => item.id === 'codex-mac-launcher');
  const bytes = zipFixture(fixture);
  let observed = false;
  await assert.rejects(() => qualifyExecutableArtifact({
    archiveBytes: bytes,
    contract: contractFor(fixture, bytes),
    outcomeProducers: [{
      kind: 'independent_fixture_probe', id: 'fixture-probe-v1',
      observe() { observed = true; },
    }],
  }), /runtime-owned/u);
  assert.equal(observed, false);
});

test('trusted producer의 malformed observation은 원문 없이 failed receipt로 닫힌다', async () => {
  const fixture = FIXTURES.cases.find((item) => item.id === 'codex-mac-launcher');
  const bytes = zipFixture(fixture);
  const qualifier = makeFixtureQualifier(() => ({
    schema: 'wrong-schema', state: 'observed', facts: [],
  }));
  const receipt = await qualifier({
    archiveBytes: bytes, contract: contractFor(fixture, bytes),
  });
  assert.equal(receipt.entrypoints[0].executionQualification, 'actually_executed');
  assert.equal(receipt.entrypoints[0].qualification, 'executed_but_outcome_failed');
  assert.equal(receipt.entrypoints[0].outcomeObservations[0].receipt.state, 'failed');
  assert.equal(
    receipt.entrypoints[0].outcomeObservations[0].receipt.reason,
    'malformed_observation_receipt',
  );
  assert.equal(receipt.state, 'unqualified');
});

test('artifact root cwd는 점 경로로 명시 관측되고 실제 launcher 실행에 사용된다', async () => {
  const fixture = {
    id: 'artifact-root-cwd',
    files: {
      'README.txt': 'run launcher.command',
      'launcher.command': '#!/bin/zsh\nprintf ROOT-CWD-OK\n',
    },
    expectedFiles: ['README.txt', 'launcher.command'],
    guideReferences: [{ guidePath: 'README.txt', targetPath: 'launcher.command' }],
    entrypoint: {
      id: 'mac-launcher', platform: 'darwin', interpreter: '/bin/zsh',
      path: 'launcher.command', cwd: '.', requiresExecutablePermission: true,
      expectedExitCode: 0, expectedStdoutIncludes: ['ROOT-CWD-OK'],
    },
  };
  const bytes = zipFixture(fixture);
  const receipt = await makeFixtureQualifier()({
    archiveBytes: bytes, contract: contractFor(fixture, bytes),
  });
  assert.equal(receipt.state, 'qualified');
  assert.equal(receipt.entrypoints[0].cwd, '.');
  assert.equal(receipt.entrypoints[0].cwdIsArtifactRoot, true);
  assert.equal(receipt.entrypoints[0].cwdPresent, true);
  assert.equal(receipt.entrypoints[0].executionQualification, 'actually_executed');
  assert.equal(receipt.entrypoints[0].qualification, 'wrapper_and_declared_outcome_qualified');
});

test('launcher exit 0과 별개로 남은 process group을 관측하고 정리한다', async () => {
  const fixture = {
    id: 'residual-process',
    files: {
      'package/README.txt': 'run launcher.command',
      'package/launcher.command': "#!/bin/zsh\nnode -e 'setTimeout(() => {}, 5000)' &\nprintf ready\n",
    },
    expectedFiles: ['package/README.txt', 'package/launcher.command'],
    guideReferences: [{ guidePath: 'package/README.txt', targetPath: 'package/launcher.command' }],
    entrypoint: {
      id: 'mac-launcher', platform: 'darwin', interpreter: '/bin/zsh',
      path: 'package/launcher.command', cwd: 'package', requiresExecutablePermission: true,
      expectedExitCode: 0,
      expectedStdoutIncludes: ['ready'],
    },
  };
  const bytes = zipFixture(fixture);
  const receipt = await qualifyExecutableArtifact({
    archiveBytes: bytes, contract: contractFor(fixture, bytes),
  });
  assert.equal(receipt.entrypoints[0].execution.exitCode, 0);
  assert.equal(receipt.entrypoints[0].execution.processResidual, true);
  assert.equal(receipt.entrypoints[0].execution.residualCleanupAttempted, true);
  assert.equal(typeof receipt.entrypoints[0].execution.residualCleanupConfirmed, 'boolean');
  assert.equal(receipt.state, 'unqualified');
});

test('끝나지 않는 launcher는 계약 timeout 뒤 unqualified로 닫힌다', async () => {
  const fixture = {
    id: 'launcher-timeout',
    files: {
      'package/README.txt': 'run launcher.command',
      'package/launcher.command': '#!/bin/zsh\nsleep 5\n',
    },
    expectedFiles: ['package/README.txt', 'package/launcher.command'],
    guideReferences: [{ guidePath: 'package/README.txt', targetPath: 'package/launcher.command' }],
    entrypoint: {
      id: 'mac-launcher', platform: 'darwin', interpreter: '/bin/zsh',
      path: 'package/launcher.command', cwd: 'package', requiresExecutablePermission: true,
      timeoutMs: 150, expectedExitCode: 0, expectedStdoutIncludes: ['never-produced'],
    },
  };
  const bytes = zipFixture(fixture);
  const startedAt = Date.now();
  const receipt = await qualifyExecutableArtifact({
    archiveBytes: bytes, contract: contractFor(fixture, bytes),
  });
  assert.equal(receipt.entrypoints[0].execution.reason, 'timed_out');
  assert.equal(receipt.entrypoints[0].qualification, 'failed');
  assert.equal(receipt.state, 'unqualified');
  assert.ok(Date.now() - startedAt < 2_000);
});

test('exact ZIP hash 불일치는 해제나 launcher 실행 전에 멈춘다', async () => {
  const fixture = FIXTURES.cases.find((item) => item.id === 'codex-mac-launcher');
  const bytes = zipFixture(fixture);
  const receipt = await qualifyExecutableArtifact({
    archiveBytes: bytes,
    contract: contractFor(fixture, bytes, {
      artifact: { id: fixture.id, sha256: '0'.repeat(64) },
    }),
  });
  assert.equal(receipt.state, 'unqualified');
  assert.equal(receipt.archive.identityMatched, false);
  assert.equal(receipt.archive.extracted, false);
  assert.equal(receipt.entrypoints.length, 0);
});

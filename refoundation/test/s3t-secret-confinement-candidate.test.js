import assert from 'node:assert/strict';
import test from 'node:test';

import {
  macosSecretConfinementProfile, makeFixtureCredentialBroker, runMacosConfinedCommand,
} from './helpers/s3t-secret-confinement-candidate.js';

test('macOS confinement candidate는 normal default를 유지하고 secret root·Keychain CLI만 deny한다', () => {
  const profile = macosSecretConfinementProfile(['/fixture/.ssh', '/fixture/.config/cli']);
  assert.match(profile, /\(allow default\)/u);
  assert.match(profile, /deny file-read\*/u);
  assert.match(profile, /\/fixture\/\.ssh/u);
  assert.match(profile, /\/usr\/bin\/security/u);
  assert.throws(() => macosSecretConfinementProfile(['/bad\nroot']), /control characters/u);
});

test('confinement runner는 command output과 deny failure를 같은 구조로 반환한다', async () => {
  const calls = [];
  const completed = await runMacosConfinedCommand({
    command: 'fixture', cwd: '/tmp', secretRoots: ['/secret'],
    canonicalize: async (value) => value,
    run: async (program, args) => { calls.push({ program, args }); return { stdout: 'visible', stderr: '' }; },
  });
  assert.equal(completed.state, 'completed');
  assert.equal(completed.stdout, 'visible');
  assert.equal(calls[0].program, '/usr/bin/sandbox-exec');
  const failed = await runMacosConfinedCommand({
    command: 'fixture', cwd: '/tmp', secretRoots: ['/secret'],
    canonicalize: async (value) => value,
    run: async () => { throw Object.assign(new Error('denied'), { code: 1, stderr: 'Operation not permitted' }); },
  });
  assert.equal(failed.state, 'failed');
  assert.match(failed.stderr, /Operation not permitted/u);
  const unbound = await runMacosConfinedCommand({
    command: 'fixture', cwd: '/tmp', secretRoots: ['/missing'],
    canonicalize: async () => { throw new Error('missing'); }, run: async () => ({ stdout: 'must-not-run' }),
  });
  assert.equal(unbound.state, 'failed');
  assert.match(unbound.stderr, /identity unavailable/u);
});

test('credential broker candidate는 등록된 기능만 실행하고 stdout·stderr의 exact secret을 가린다', async () => {
  const broker = makeFixtureCredentialBroker({ capabilities: {
    'fixture-cli': {
      program: '/fixture/cli', actions: { whoami: ['whoami'] },
      secretValues: ['FIXTURE-TOKEN'], cwd: '/fixture', env: { FIXTURE_TOKEN: 'FIXTURE-TOKEN' },
    },
  }, run: async () => ({ stdout: 'account-7 FIXTURE-TOKEN', stderr: 'debug FIXTURE-TOKEN' }) });
  const result = await broker.execute({ capabilityId: 'fixture-cli', action: 'whoami' });
  assert.equal(result.state, 'completed');
  assert.equal(result.stdout, 'account-7 [REDACTED]');
  assert.equal(result.stderr, 'debug [REDACTED]');
  await assert.rejects(broker.execute({ capabilityId: 'fixture-cli', action: 'token' }), /not allowed/u);
  await assert.rejects(broker.execute({ capabilityId: 'unknown', action: 'whoami' }), /not registered/u);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s3-t1a-login-shell-isolation-2026-08-26.json', import.meta.url);

test('S3-T1A 증거는 HOME 격리와 CLI PATH 보존만 닫고 비밀 confinement를 완료로 꾸미지 않는다', async () => {
  const raw = await readFile(evidenceUrl, 'utf8');
  const evidence = JSON.parse(raw);
  assert.equal(evidence.status, 'login_shell_isolation_repaired_secret_confinement_still_open');
  assert.equal(evidence.before.configuredHomeEscaped, true);
  assert.equal(evidence.after.commandUsesNonLoginShell, true);
  assert.equal(evidence.after.configuredHomePreserved, true);
  assert.equal(evidence.after.safeLoginPathPreserved, true);
  assert.equal(evidence.after.safeCliExecuted, true);
  assert.equal(evidence.after.parentCredentialEnvAbsent, true);
  assert.equal(evidence.effectContractChanged, false);
  assert.equal(evidence.pass, true);
  assert.ok(evidence.remaining.some((item) => item.includes('secret files')));
  assert.equal(evidence.nextCandidate, 'secret_root_sandbox_and_broker_positive_control');
  assert.doesNotMatch(raw, /S3T1A-PARENT-KEY-MUST-NOT-LEAK/u);
});

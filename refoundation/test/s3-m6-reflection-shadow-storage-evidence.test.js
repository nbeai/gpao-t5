import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { digestAtCommit } from './helpers/git-evidence-digest.js';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s3-m6-reflection-shadow-storage-2026-08-27.json', import.meta.url,
), 'utf8'));

test('M6 Turn 2는 materialized inactive shadow만 저장하고 publication을 주장하지 않는다', () => {
  assert.equal(evidence.status, 'SHADOW_STORAGE_COMPLETE_PRODUCT_UNWIRED');
  assert.equal(evidence.materializer.bareEnvelopeReturned, false);
  assert.equal(evidence.ledger.bareEnvelopeProposeAccepted, false);
  assert.equal(evidence.ledger.productProjection, 'none');
  assert.equal(evidence.ledger.activeCandidates, 0);
  assert.equal(evidence.ledger.publicationQualified, false);
  assert.equal(evidence.ledger.crossStoreAtomicCasQualified, false);
  assert.equal(evidence.verification.productWriterEvents, 0);
  assert.ok(evidence.notClaimed.includes('S3-M6 PASS'));
});

test('durable receipt는 source reopen과 counterexample 독립성을 restart 뒤에도 보존한다', () => {
  for (const [key, value] of Object.entries(evidence.durableReceipt)) assert.equal(value, true, key);
  assert.equal(evidence.materializer.counterexampleIndependentWorkAndRun, true);
  assert.equal(evidence.ledger.receiptSurvivesRestart, true);
  assert.equal(evidence.ledger.counterexampleHeadsSurviveRestart, true);
  assert.equal(evidence.independentRedTeam.p0RemainingInDeclaredInactiveShadowScope, 0);
});

test('Turn 2 evidence는 cross-store CAS·enumerator·anchor 미달을 숨기지 않는다', () => {
  for (const phrase of ['cross-store atomic CAS', 'enumerator', 'anchored head',
    'Cross-process', 'chmod path replacement', 'rematerialize', 'Windows filesystem']) {
    assert.ok(evidence.knownUnqualified.some((item) => item.includes(phrase)), phrase);
  }
});

test('Turn 2 evidence source digest는 exact implementation commit과 일치한다', () => {
  assert.equal(evidence.sourceCommit, '8ad3d55b02751cf520b775f80bc9a8ebdf879ff6');
  for (const [path, expected] of Object.entries(evidence.sourceDigests)) {
    assert.equal(digestAtCommit(evidence.sourceCommit, path), expected, path);
  }
});

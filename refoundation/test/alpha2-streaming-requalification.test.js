import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Alpha2 current full backup has no fixed payload or Artifact inclusion cap and uses streaming v2 writer', async () => {
  const [bundle, v2, registry, ui] = await Promise.all([
    readFile(new URL('../src/whole-state-bundle.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/whole-state-bundle-v2.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/t5-whole-state.js', import.meta.url), 'utf8'),
    readFile(new URL('../ui/index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(bundle, /writeWholeStateBundleV2/u);
  assert.doesNotMatch(bundle, /async function payloadFromStage|data: bytes\.toString\('base64'\)/u);
  assert.match(bundle, /LEGACY_V1_MAX_PAYLOAD_BYTES/u);
  assert.match(v2, /createReadStream[\s\S]*createGzip[\s\S]*AES|aes-256-gcm/iu);
  assert.doesNotMatch(registry, /maxFileBytes: 32|maxTotalBytes: 96/u);
  assert.doesNotMatch(ui, /response\.blob\(\)|URL\.createObjectURL\(await response/u);
  assert.match(ui, /form\.action = '\/backup\/create'/u);
});

test('Alpha2 superseded evidence and streaming requalification form one explicit correction chain', async () => {
  const old = JSON.parse(await readFile(new URL('../evidence/alpha2-whole-state-completion-2026-08-27.json', import.meta.url), 'utf8'));
  const current = JSON.parse(await readFile(new URL('../evidence/alpha2-streaming-requalification-2026-08-27.json', import.meta.url), 'utf8'));
  assert.equal(old.status, 'SUPERSEDED_AFTER_REPRODUCED_P0_P1');
  assert.equal(current.status, 'PASS'); assert.equal(current.format.currentWriter, 't5.whole-state-encrypted.v2');
  assert.equal(current.format.fixedFullBackupPayloadLimit, null);
  assert.equal(current.format.fixedArtifactFileLimit, null);
  assert.equal(current.format.fixedArtifactCumulativeLimit, null);
});

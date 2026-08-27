import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { digestAtCommit } from './helpers/git-evidence-digest.js';

const evidence=JSON.parse(await readFile(new URL('../evidence/s3-ch1-scoped-file-activity-close-2026-08-27.json',import.meta.url)));

test('CH1 close는 actual macOS metadata와 foreground 비개입을 함께 보존한다',()=>{
  assert.equal(evidence.status,'PASS_WITH_OBSERVATION');assert.equal(evidence.macOSActual.passed,true);
  assert.equal(evidence.macOSActual.contentCanaryStored,false);assert.equal(evidence.macOSActual.actorUnknownOnly,true);
  assert.equal(evidence.foregroundNonInterference.design,'ABBA_off_on_on_off');
  assert.equal(evidence.foregroundNonInterference.semanticDigestAgreement,true);
  assert.ok(evidence.foregroundNonInterference.wallDeltaMs<10);
  assert.equal(evidence.productIntegration.normalTurnAdditionalModelCalls,0);
});

test('CH1 close는 Windows 미실행과 singleton 관측을 PASS로 숨기지 않는다',()=>{
  assert.equal(evidence.platformBoundary.windowsPassClaimed,false);
  assert.ok(evidence.observations.some((item)=>item.includes('four replies')));
  assert.ok(evidence.notClaimed.includes('physical Windows CH1 PASS'));
});

test('CH1 close source digest는 exact implementation commit artifact와 일치한다',()=>{
  for(const [path,expected] of Object.entries(evidence.sourceDigests))assert.equal(
    digestAtCommit(evidence.implementationCommit,path),expected,path);
});

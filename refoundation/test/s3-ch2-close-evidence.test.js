import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { digestAtCommit } from './helpers/git-evidence-digest.js';
const evidence=JSON.parse(await readFile(new URL('../evidence/s3-ch2-coarse-app-activity-close-2026-08-27.json',import.meta.url)));
test('CH2 close는 actual app/AFK·비개입·privacy를 함께 요구한다',()=>{assert.equal(evidence.status,'PASS_WITH_OBSERVATION');
  assert.equal(evidence.macOSActual.passed,true);assert.equal(evidence.macOSActual.semanticDigestAgreement,true);assert.ok(evidence.macOSActual.wallDeltaMs<5);
  assert.deepEqual(evidence.privacy,{windowTitleStored:0,documentTitleStored:0,urlStored:0,contentStored:0,clipboardStored:0,keystrokesStored:0,
    memoryOrPersonaPromotion:0,modelContextDefault:false});assert.equal(evidence.productIntegration.normalTurnAdditionalModelCalls,0);});
test('CH2 close는 Windows와 의미 추론 미자격을 숨기지 않는다',()=>{assert.equal(evidence.platformBoundary.windowsPassClaimed,false);
  assert.ok(evidence.notClaimed.includes('physical Windows CH2 PASS'));assert.ok(evidence.notClaimed.some((item)=>item.includes('productivity')));});
test('CH2 close source digest는 exact implementation commit과 일치한다',()=>{for(const[path,expected]of Object.entries(evidence.sourceDigests))
  assert.equal(digestAtCommit(evidence.implementationCommit,path),expected,path);});

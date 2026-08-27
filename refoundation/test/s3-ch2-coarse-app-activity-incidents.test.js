import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const incidents=JSON.parse(await readFile(new URL('../config/s3-ch2-coarse-app-activity-incidents.json',import.meta.url)));

test('CH2는 구현 전에 12개 coarse app privacy·duration·platform 사고 가족을 고정한다',()=>{
  assert.equal(incidents.schema,'t5.s3ch2.coarse-app-activity-incidents.v1');
  assert.equal(incidents.failureFamilies.length,12);assert.equal(new Set(incidents.failureFamilies.map((item)=>item.id)).size,12);
  for(const name of ['title-url-content-capture','afk-time-lie','work-causality-overclaim','persona-productivity-inference',
    'heartbeat-storage-storm','include-exclude-race','pause-private-delete-false','windows-interface-false-pass']){
    assert.ok(incidents.failureFamilies.some((item)=>item.name===name),name);
  }
});

test('CH2 사고 계약은 ActivityWatch 원리만 재사용하고 content Recall과 의미 추론을 열지 않는다',()=>{
  assert.ok(incidents.referencePrinciples.some((item)=>item.source.includes('ActivityWatch')));
  for(const forbidden of ['window title','full URL','clipboard','keystrokes','Memory or persona promotion','productivity scoring','CH3 relevance intelligence']){
    assert.ok(incidents.nonGoals.includes(forbidden),forbidden);
  }
  assert.equal(incidents.liveAccountsOrSecrets,0);
});

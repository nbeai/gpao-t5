import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
const value=JSON.parse(await readFile(new URL('../config/s3-ch3-purpose-history-incidents.json',import.meta.url)));
test('CH3는 구현 전에 14개 purpose-bounded history 사고 가족과 순서를 고정한다',()=>{assert.equal(value.failureFamilies.length,14);
  assert.equal(new Set(value.failureFamilies.map((item)=>item.id)).size,14);assert.deepEqual(value.requiredOrder,
    ['local metadata filter','bounded opaque candidates','scope and sensitivity redaction','model relevance selection','exact source reopen','user answer or explicit action']);
  for(const name of['raw-history-context-dump','current-correction-loses','metadata-becomes-content','foreign-stale-handle-replay','omitted-eligible-candidate',
    'history-becomes-memory-persona','foreground-provider-cost','false-resume-or-effect'])assert.ok(value.failureFamilies.some((item)=>item.name===name),name);});
test('CH3는 새 collector·embedding·Memory/persona·실행 재개를 열지 않는다',()=>{for(const item of['new collector','new raw activity ledger','whole history embedding',
  'automatic Memory or persona','same Work execution resume'])assert.ok(value.nonGoals.includes(item),item);assert.equal(value.liveAccountsOrSecrets,0);});

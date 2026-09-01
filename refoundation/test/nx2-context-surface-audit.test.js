import assert from 'node:assert/strict';
import test from 'node:test';

import { auditNxContextSurfaces } from './helpers/nx-context-surface-audit.js';

test('CX-0 audit는 model Context bytes와 source module bytes를 분리하고 family coverage를 검증한다', () => {
  const instructions = 'one two three four five\none two three four five six';
  const manifest = { families: [{ id: 'a.b', kind: 'product_invariant', ownerSource: 'owner',
    currentEnforcement: 'global_instructions', targetEnforcement: 'global_instructions',
    globalLineCount: 2, globalSha256: 'ignored', countertests: ['probe'] }] };
  const audit = auditNxContextSurfaces({ instructions, interactionCore: 'core', manifest,
    activeTools: [{ name: 'tool', description: 'one two three four five', parameters: { type: 'object' } }],
    skills: [{ name: 'skill', description: 'one two three four five', contentDigest: 'digest' }],
    skillBodies: new Map([['skill', 'body']]), runtimeContext: '[T5 CURRENT WORKSPACE]',
    sourceModules: [{ name: 'source.js', bytes: 100 }] });
  assert.equal(audit.instructions.lines, 2);
  assert.equal(audit.instructionFamilies.allGlobalLinesAdmitted, true);
  assert.equal(audit.instructionFamilies.ownerCoverage, 1);
  assert.equal(audit.instructionFamilies.countertestCoverage, 1);
  assert.equal(audit.activeTools.count, 1);
  assert.equal(audit.skills.bodyBytes, 4);
  assert.equal(audit.runtimeContext.workspacePresent, true);
  assert.ok(audit.repeatedFiveGrams.some((item) => item.owners.length >= 2));
  assert.deepEqual(audit.sourceModules, [{ name: 'source.js', bytes: 100 }]);
  assert.equal(audit.productChanges, 0);
});

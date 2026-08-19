import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSkillSnapshot, makeSkillTool } from '../src/skill-runtime.js';

const skills = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

test('document-data skill은 모델에게 출처·충돌·재검증 절차만 주고 의미 판단을 대신하지 않는다', async () => {
  const snapshot = await loadSkillSnapshot({ directory: skills });
  const metadata = snapshot.skills.find((skill) => skill.name === 'document-data');
  assert.match(metadata.description, /XLSX.*PDF/i);
  const viewed = await makeSkillTool({ snapshot }).execute({ action: 'view', name: 'document-data' });
  assert.match(viewed.content, /T5_DOCUMENT_CLI/);
  assert.match(viewed.content, /sheet.*cell.*page/i);
  assert.match(viewed.content, /merged.*hidden.*formula/i);
  assert.match(viewed.content, /conflict.*missing.*do not infer/is);
  assert.match(viewed.content, /re-open.*reconcile/is);
  assert.match(viewed.content, /requiresOcrOrVision/);
  assert.doesNotMatch(viewed.content, /견적_A|한빛상회|58300/);
});

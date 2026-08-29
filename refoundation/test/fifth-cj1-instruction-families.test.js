import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { consoleInstructions } from '../src/console-model-factory.js';
import { makeYouTubeCaptionTool, VIDEO_CAPTION_TOOL_GUIDANCE } from '../src/youtube-caption-tool.js';

const manifest = JSON.parse(await readFile(new URL('../config/instruction-family-manifest.json', import.meta.url), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('CJ1 manifest는 모든 전역 instruction을 family 단위로 빠짐없이 admission한다', () => {
  assert.deepEqual(manifest.admissionKinds, [
    'product_invariant', 'cross_tool_policy', 'tool_guidance',
    'measured_failure_guard', 'interaction_style', 'candidate',
  ]);
  const ids = new Set();
  for (const family of manifest.families) {
    assert.match(family.id, /^[a-z][a-z0-9_.]+$/u);
    assert.equal(ids.has(family.id), false, family.id); ids.add(family.id);
    assert.ok(manifest.admissionKinds.includes(family.kind), family.id);
    for (const field of [
      'ownerSource', 'currentEnforcement', 'targetEnforcement', 'countertests',
      'appliesTo', 'lifecycle', 'removalCondition',
    ]) assert.ok(family[field] && family[field].length !== 0, `${family.id}.${field}`);
  }

  const fixture = manifest.fixture;
  const lines = consoleInstructions(fixture.workspace, fixture.computer, {
    interactionCoreMode: fixture.interactionCoreMode,
  }).split('\n');
  let cursor = 0;
  for (const family of manifest.families.filter((entry) => entry.currentEnforcement === 'global_instructions')) {
    const slice = lines.slice(cursor, cursor + family.globalLineCount).join('\n');
    assert.equal(slice.split('\n').length, family.globalLineCount, family.id);
    assert.equal(sha256(slice), family.globalSha256, family.id);
    cursor += family.globalLineCount;
  }
  assert.equal(cursor, lines.length, 'unadmitted global instruction lines');
});

test('video caption family는 일반 대화가 아니라 deferred video_text가 보일 때만 공급된다', () => {
  const fixture = manifest.fixture;
  const instructions = consoleInstructions(fixture.workspace, fixture.computer, {
    interactionCoreMode: fixture.interactionCoreMode,
  });
  for (const guidance of VIDEO_CAPTION_TOOL_GUIDANCE) assert.equal(instructions.includes(guidance), false);
  assert.doesNotMatch(instructions, /caption_absent|source_failed.*automatic caption/u);

  const tool = makeYouTubeCaptionTool({
    root: '/T5/WORKSPACE',
    store: {},
    runProcess: async () => { throw new Error('not executed'); },
    javascriptRuntime: process.execPath,
  });
  for (const guidance of VIDEO_CAPTION_TOOL_GUIDANCE) assert.ok(tool.description.includes(guidance));
  assert.match(tool.description, /language null.*manual caption.*not_prepared.*cli_prepare.*never invoke yt-dlp through exec/u);
  assert.match(tool.description, /source_failed.*automatic caption.*manual caption languages.*do not repeat/u);
  assert.match(tool.description, /caption_absent.*do not call video_text.*web_read once.*description-based/u);
});

test('첫 CJ1 family 이동은 direct 고정 instruction을 줄이고 tool activation 전 호출 수를 바꾸지 않는다', () => {
  const fixture = manifest.fixture;
  const current = consoleInstructions(fixture.workspace, fixture.computer, {
    interactionCoreMode: fixture.interactionCoreMode,
  });
  assert.equal(Buffer.byteLength(current), 28_650);
  assert.equal(current.split('\n').length, 96);
  assert.equal(30_277 - Buffer.byteLength(current), 1_627);
});

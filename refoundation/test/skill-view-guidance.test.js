import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSkillSnapshot, makeSkillTool } from '../src/skill-runtime.js';

test('스킬 도구는 주제 일치만으로 본문 열람을 유도하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-skill-guidance-'));
  try {
    const skill = join(root, 'file-discovery');
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, 'SKILL.md'), [
      '---', 'name: file-discovery', 'description: Find a local file.', '---', '', 'Detailed procedure.',
    ].join('\n'));
    const tool = makeSkillTool({ snapshot: await loadSkillSnapshot({ directory: root }) });
    assert.match(tool.description, /view.*only when.*detailed procedure.*needed/i);
    assert.match(tool.description, /do not view.*merely.*matches/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

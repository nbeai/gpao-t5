import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSkillSnapshot, makeSkillTool } from '../src/skill-runtime.js';

const bundledSkills = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

async function writeSkill(root, name, description, body = 'PRIVATE PROCEDURE') {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    `# ${name}`,
    '',
    body,
    '',
  ].join('\n'));
  return directory;
}

test('스킬 스냅샷은 짧은 메타데이터만 노출하고 본문은 선택 뒤에만 연다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-skills-'));
  try {
    await writeSkill(root, 'file-discovery', 'Find an intended local file.', 'SECRET FULL WORKFLOW');
    const snapshot = await loadSkillSnapshot({ directory: root });
    assert.equal(snapshot.skills.length, 1);
    assert.equal(snapshot.skills[0].name, 'file-discovery');
    assert.equal(snapshot.skills[0].description, 'Find an intended local file.');
    assert.doesNotMatch(JSON.stringify(snapshot.skills), /SECRET FULL WORKFLOW/);
    assert.match(snapshot.digest, /^[0-9a-f]{64}$/);

    const tool = makeSkillTool({ snapshot });
    assert.match(tool.description, /file-discovery/);
    assert.doesNotMatch(tool.description, /SECRET FULL WORKFLOW/);
    const listed = await tool.execute({ action: 'list', name: null });
    assert.equal(listed.catalogDigest, snapshot.digest);
    assert.equal(listed.skills[0].name, 'file-discovery');
    assert.doesNotMatch(JSON.stringify(listed), /SECRET FULL WORKFLOW/);

    const viewed = await tool.execute({ action: 'view', name: 'file-discovery' });
    assert.equal(viewed.name, 'file-discovery');
    assert.match(viewed.content, /SECRET FULL WORKFLOW/);
    assert.match(viewed.contentDigest, /^[0-9a-f]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('스킬 루트 밖으로 빠지는 심볼릭 링크는 카탈로그에 들어오지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-skills-containment-'));
  try {
    const root = join(room, 'skills');
    const outside = join(room, 'outside');
    await mkdir(root, { recursive: true });
    await writeSkill(outside, 'outside-skill', 'Must not load.');
    await symlink(join(outside, 'outside-skill'), join(root, 'outside-skill'));
    const snapshot = await loadSkillSnapshot({ directory: root });
    assert.deepEqual(snapshot.skills, []);
    assert.equal(snapshot.rejected[0].reason, 'outside_skill_root');
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('잘못된 frontmatter는 조용히 능력인 척하지 않고 제외 사유를 남긴다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-skills-invalid-'));
  try {
    const directory = join(root, 'broken');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'SKILL.md'), '---\nname: [broken\n---\nbody\n');
    const snapshot = await loadSkillSnapshot({ directory: root });
    assert.deepEqual(snapshot.skills, []);
    assert.equal(snapshot.rejected[0].name, 'broken');
    assert.equal(snapshot.rejected[0].reason, 'invalid_frontmatter');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bundled file-discovery는 특정 명령이 아니라 해석·전환·검증·정지 절차를 공급한다', async () => {
  const snapshot = await loadSkillSnapshot({ directory: bundledSkills });
  const tool = makeSkillTool({ snapshot });
  const viewed = await tool.execute({ action: 'view', name: 'file-discovery' });
  assert.match(viewed.content, /trailing extension.*strong constraint/i);
  assert.match(viewed.content, /search the normalized stem without the extension/i);
  assert.match(viewed.content, /switch to a targeted filesystem traversal/i);
  assert.match(viewed.content, /verify that it exists/i);
  assert.match(viewed.content, /stop.*scope was checked/is);
  assert.doesNotMatch(viewed.content, /비아이5|BEAI5/i);
});

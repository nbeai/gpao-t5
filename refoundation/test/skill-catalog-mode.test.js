import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSkillSnapshot, makeSkillTool } from '../src/skill-runtime.js';

async function skill(root, name, description, body) {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), [
    '---', `name: ${name}`, `description: ${description}`, '---', '', body,
  ].join('\n'));
}

test('on-demand catalog는 이름·설명을 schema에서 숨기고 search 뒤 필요한 본문만 연다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-skill-catalog-mode-'));
  try {
    await skill(root, 'quasar-recovery',
      'Recover a Quasar Widget from cobalt-lock state.', 'Use recovery code QUASAR-RESET-7391.');
    await skill(root, 'mail-triage', 'Triage an email inbox.', 'MAIL BODY SECRET');
    await skill(root, 'diagram-render', 'Render architecture diagrams.', 'DIAGRAM BODY SECRET');
    const snapshot = await loadSkillSnapshot({ directory: root });
    const inline = makeSkillTool({ snapshot, catalogMode: 'inline' });
    const onDemand = makeSkillTool({ snapshot, catalogMode: 'on-demand' });

    assert.match(inline.description, /quasar-recovery|cobalt-lock/);
    assert.doesNotMatch(onDemand.description, /quasar-recovery|cobalt-lock|mail-triage/);
    assert.match(onDemand.description, /action=search/i);
    assert.ok(Buffer.byteLength(onDemand.description) < Buffer.byteLength(inline.description) * 0.5);

    const found = await onDemand.execute({ action: 'search', name: 'cobalt lock widget' });
    assert.equal(found.state, 'searched');
    assert.deepEqual(found.skills.map((entry) => entry.name), ['quasar-recovery']);
    assert.doesNotMatch(JSON.stringify(found), /QUASAR-RESET-7391|MAIL BODY SECRET/);

    const viewed = await onDemand.execute({ action: 'view', name: 'quasar-recovery' });
    assert.match(viewed.content, /QUASAR-RESET-7391/);
    const listed = await onDemand.execute({ action: 'list', name: null });
    assert.equal(listed.skills.length, 3);
    assert.doesNotMatch(JSON.stringify(listed), /BODY SECRET|QUASAR-RESET-7391/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('search는 이름과 설명의 여러 단어를 순위화하고 결과 수를 제한한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-skill-search-'));
  try {
    await skill(root, 'apple-notes', 'Read and update Apple Notes on macOS.', 'notes');
    await skill(root, 'apple-reminders', 'Read and update Apple Reminders on macOS.', 'reminders');
    await skill(root, 'email-notes', 'Turn email into meeting notes.', 'email');
    const tool = makeSkillTool({
      snapshot: await loadSkillSnapshot({ directory: root }), catalogMode: 'on-demand',
    });
    const result = await tool.execute({ action: 'search', name: 'apple notes' });
    assert.equal(result.skills[0].name, 'apple-notes');
    assert.ok(result.skills.some((entry) => entry.name === 'apple-reminders'));
    assert.ok(result.skills.length <= 8);
    await assert.rejects(() => tool.execute({ action: 'search', name: null }), /search query/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

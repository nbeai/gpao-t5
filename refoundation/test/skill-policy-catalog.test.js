import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkillPolicyCatalog } from '../src/skill-policy-catalog.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const expectedDigests = {
  'apple-notes': '3b31b9909749ca5a3ea57cfc6ca12ce9aaaa8a14f97bcc6b38998f84c7a4004a',
  'apple-reminders': 'f23943b61c02746d9b7a45a980bc25f5ac0e368862e2f9d1e3385b84dee7e86c',
  blogwatcher: 'bf1c624943aaf5940b2302a93c92701711e45fef5a6c057cda1ebc5bf2dd65fb',
  diagrams: '35f4e12110930fe6410a37f5aade2f18df77a5441f3f1a5161006ced503cb064',
  'github-workflow': '79e171be0c075d7f821fff4ee88b2cb383fe8a5baf92b4c89577805c075ff0f1',
  'himalaya-email': '44cbb1fbddee8d13fe8d400cb4cc628d5db64f989e8909d83c4fd74a1f468848',
  'nano-pdf': '354462e94d6ccc4121a78d225e84b9f90d2dea7f1cd5c04544981ef8aa8d6781',
  'node-inspect-debugger': 'a5bb2500c38e744aaa512cd6591b452a967416b461816188aae2da2e1110f17f',
  notion: '5cc739d5b0386416b14fbb6fef510d87976b28ace1f26333cb53fbc8799ebaa5',
  obsidian: '06adf4b6fcf331b8e40240767285d5df02cf3dc0942fff6c6851232da6c28fcd',
  openhue: '180b38bfa41bf798226145bb782623f791223a77cac16dbbb4b27ea43b09c99a',
  'python-debugpy': 'e22958227f149837e0c38c560efb92551b189d70b2e3dfb156dc5105171cef69',
  songsee: 'e557f25ac370916c56a291a8820ed5c006463d90f14a0e0c33f8912e9a2c2a08',
  spike: '7d39debf19e53152a9486a3a4494199757a3640ad751e0723354b6f9eaac363d',
  xurl: '0c3896ba0f28b06c11fdad8f00c96cabfb36ff23da50fcdcd277f65446d4de08',
};

test('오너 분류와 8월 19일 공식 초안 bytes를 그대로 보존한다', async () => {
  const catalog = await loadSkillPolicyCatalog(join(root, 'config/skill-catalog.json'));
  const group = (selection) => catalog.entries.filter((entry) => entry.selection === selection).map((entry) => entry.name);
  assert.deepEqual(group('minimum_default'), ['file-discovery', 'document-data', 'nano-pdf', 'diagrams']);
  assert.deepEqual(group('environment_detected'), ['notion', 'blogwatcher', 'xurl', 'apple-notes', 'apple-reminders', 'obsidian']);
  assert.deepEqual(group('developer_selected'), ['github-workflow', 'python-debugpy', 'node-inspect-debugger', 'spike']);
  assert.deepEqual(group('restricted_selected'), ['himalaya-email', 'openhue', 'songsee']);
  for (const [name, expected] of Object.entries(expectedDigests)) {
    const base = ['diagrams', 'nano-pdf'].includes(name) ? 'skills' : 'skill-packages';
    const bytes = await readFile(join(root, base, name, 'SKILL.md'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `${name} content changed`);
  }
});

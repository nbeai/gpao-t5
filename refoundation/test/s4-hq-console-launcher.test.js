import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-HQ launcher는 실제 Console·Browser·gpt-5.5와 빈 messenger·connector 경계를 함께 고정한다', async () => {
  const source = await readFile(new URL('../scripts/launch-s4-hq-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /makeConsoleServer/u); assert.match(source, /makeAgentBrowserDriver/u);
  assert.match(source, /chatgpt_oauth:gpt-5\.5/u); assert.match(source, /modelId !== 'gpt-5\.5'/u);
  assert.match(source, /messenger-hq-empty/u); assert.match(source, /workspaceConnectionServices: \[\]/u);
  assert.match(source, /quickPreviewProgram: cloudflaredCli/u);
  assert.doesNotMatch(source, /mockModel|fakeModel|actual user account write/iu);
});

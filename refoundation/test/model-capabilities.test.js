import test from 'node:test';
import assert from 'node:assert/strict';

import {
  modelCapabilityManifest, supportsModelCapability,
} from '../src/model-capabilities.js';
import { readFile } from 'node:fs/promises';

test('연결 성공과 modality 지원을 섞지 않고 unknown을 보존한다', () => {
  const solar = modelCapabilityManifest({ kind: 'api_key', provider: 'upstage', modelId: 'solar-pro4' });
  assert.equal(solar.wire, 'openai-chat-completions');
  assert.equal(solar.capabilities.text, 'supported');
  assert.equal(solar.capabilities.tools, 'supported');
  assert.equal(solar.capabilities.visionInput, 'unsupported');
  assert.equal(solar.capabilities.promptCaching, 'unsupported');
  const custom = modelCapabilityManifest({ kind: 'api_key', provider: 'anthropic', modelId: 'private-model' });
  assert.equal(custom.capabilities.text, 'supported');
  assert.equal(custom.capabilities.tools, 'unknown');
  assert.equal(custom.capabilities.visionInput, 'unknown');
  assert.equal(supportsModelCapability(custom, 'visionInput'), false);
});

test('일반 사용자는 설정에서 현재 모델의 도구·이미지·스트리밍 지원 상태를 본다', async () => {
  const html = await readFile(new URL('../../refoundation/ui/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="mcCapabilities"/u);
  assert.match(html, /이미지 입력 \$\{stateText\[facts\.visionInput\]/u);
  assert.match(html, /지원 안 함/u);
  assert.match(html, /확인 필요/u);
});

test('공개 manifest는 T5 adapter가 실제 제공하는 wire와 입력 경계만 선언한다', () => {
  const rows = [
    modelCapabilityManifest({ kind: 'api_key', provider: 'openai', modelId: 'gpt-5.6-terra' }),
    modelCapabilityManifest({ kind: 'api_key', provider: 'anthropic', modelId: 'claude-sonnet-5' }),
    modelCapabilityManifest({ kind: 'api_key', provider: 'gemini', modelId: 'gemini-3.6-flash' }),
    modelCapabilityManifest({ kind: 'chatgpt_oauth', provider: 'chatgpt_oauth', modelId: 'gpt-5.5' }),
  ];
  for (const row of rows) {
    assert.equal(row.schema, 't5.model-capabilities.v1');
    assert.equal(row.source, 't5_adapter_contract');
    assert.equal(row.capabilities.text, 'supported');
    assert.equal(row.capabilities.tools, 'supported');
    assert.equal(row.capabilities.visionInput, 'supported');
    assert.ok(Object.values(row.capabilities).every((value) => (
      ['supported', 'unsupported', 'unknown'].includes(value)
    )));
  }
});

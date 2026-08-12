import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelPromptProfile } from '../src/kernel/model-prompt-profile.js';

test('OpenAI 운영 보정은 최신 후보명을 답처럼 넣지 않고 날짜가 다른 근거를 비교하게 한다', () => {
  const profile = modelPromptProfile({ providerId: 'chatgpt_oauth', modelId: 'gpt-5.5' });
  assert.match(profile, /범주·공식 목록/);
  assert.match(profile, /날짜가 다른 후보를 비교/);
  assert.doesNotMatch(profile, /GPT-5\.6|OpenAI/, '특정 회사·버전을 정답으로 박으면 안 된다');
});

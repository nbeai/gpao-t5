import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSelectionAnchor, projectSelectableMessage }
  from '../src/selectable-message-projection.js';

test('RED: Markdown visible text와 한글·emoji UTF-16 selection이 canonical source에 exact 결속된다', () => {
  const source = '**중요한 한글**과 [근거](https://example.com), 가족 😀 이야기';
  const projection = projectSelectableMessage(source);
  assert.equal(projection.text, '중요한 한글과 근거, 가족 😀 이야기');
  const startUtf16 = projection.text.indexOf('한글');
  const endUtf16 = projection.text.indexOf(' 이야기');
  const anchor = buildSelectionAnchor({
    canonical: {
      sessionId: 'session-a', messageId: 'message-a', sequence: 3,
      role: 'assistant', runId: 'run-a', content: source,
    },
    request: {
      projectionVersion: projection.version, projectionDigest: projection.digest,
      startUtf16, endUtf16,
    },
  });
  assert.equal(anchor.quote, '한글과 근거, 가족 😀');
  assert.equal(anchor.sourceMessageId, 'message-a');
  assert.equal(anchor.sourceContentDigest.length, 64);
  assert.equal(anchor.projectionDigest, projection.digest);
});

test('RED: stale projection과 surrogate 내부 offset은 anchor 발급 전에 닫힌다', () => {
  const canonical = { sessionId: 'session-a', messageId: 'message-a', sequence: 3,
    role: 'assistant', runId: null, content: '가족 😀 이야기' };
  const projection = projectSelectableMessage(canonical.content);
  assert.throws(() => buildSelectionAnchor({ canonical, request: {
    projectionVersion: projection.version, projectionDigest: '0'.repeat(64),
    startUtf16: 0, endUtf16: 2,
  } }), /stale selection projection/u);
  const emoji = projection.text.indexOf('😀');
  assert.throws(() => buildSelectionAnchor({ canonical, request: {
    projectionVersion: projection.version, projectionDigest: projection.digest,
    startUtf16: emoji + 1, endUtf16: emoji + 2,
  } }), /UTF-16 boundary/u);
});

test('사용자 말풍선은 Markdown 기호도 보이는 원문이므로 assistant projection과 합치지 않는다', () => {
  const source = '**이 표기를 그대로** 질문할게';
  assert.equal(projectSelectableMessage(source, { role: 'user' }).text, source);
  assert.equal(projectSelectableMessage(source, { role: 'assistant' }).text, '이 표기를 그대로 질문할게');
});

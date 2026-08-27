import assert from 'node:assert/strict';
import test from 'node:test';

import { makeLocalNotificationService, makeMacOSNotificationAdapter,
  projectLocalNotification } from '../src/local-notification.js';

test('잠금 화면 알림은 작업 내용·파일·상대·금액·비밀 없이 generic copy만 만든다', () => {
  const canary = 'PRIVATE-FILE 고객A 999999원 secret-token';
  for (const kind of ['automation_completed', 'automation_needs_attention']) {
    const value = projectLocalNotification(kind, { content: canary, fileName: canary, counterparty: canary });
    assert.equal(value.sensitivePayloadFields, 0); assert.equal(value.opensExactWork, true);
    assert.doesNotMatch(JSON.stringify(value), new RegExp(canary));
  }
});

test('macOS adapter argv에도 projected generic copy 밖의 값은 들어가지 않는다', async () => {
  let observed = null;
  const adapter = makeMacOSNotificationAdapter({ spawnProcess(program, args, options) {
    observed = { program, args, options }; return { once(event, callback) { if (event === 'close') queueMicrotask(() => callback(0)); return this; } };
  } });
  const service = makeLocalNotificationService({ deliver: adapter });
  assert.equal((await service.notify('automation_completed')).delivered, true);
  assert.equal(observed.program, '/usr/bin/osascript');
  assert.match(observed.args.join(' '), /T5 작업이 끝났어요/u);
  assert.doesNotMatch(observed.args.join(' '), /PRIVATE|파일명|금액|token/iu);
});

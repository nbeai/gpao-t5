// P5-1 · 채널 표면 — **같은 커널, 표면만 다르다.**
//
// 채널에서도 도구·승인·원장·말투가 흔들리면 안 된다(P5 첫 원칙). 그런데 승인으로 멈춘 턴을
// 채널로 알릴 때, 알림 문장이 **내부 식별자**로 시작하고 있었다:
//
//   const what = first?.approvalPreview?.impact ?? first?.action ?? '그 작업';
//
// 커널이 내는 필드는 `preview` 인데 `approvalPreview` 를 읽어서 **항상** 폴백으로 떨어졌고,
// 그 폴백이 `action` = `local.terminal` 같은 **도구 id** 였다. 채널 사용자는 매 승인마다
// 도구 id 를 받았다(헌법 §7 사용자면/진단면 분리 위반). 웹 카드는 label 을 쓰는데 채널만 샜다.
//
// 이 검사는 문구를 외우지 않는다. **선언된 도구 id 가 사용자에게 나가는가**만 본다 —
// P5 에서 채널·외부 API·MCP·CLI 가 늘어도 같은 경계가 그대로 걸린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { AllowlistStore } from '../src/surface/allowlist-store.js';
import { demoTools, demoDescriptors, demoChannels, demoConnectors } from '../src/surface/demo-context.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { sandboxAvailable } from '../src/runtime/sandbox.js';

/** 선언된 도구 id 전부 — 목록을 손으로 관리하지 않는다(도구가 늘면 검사도 같이 는다). */
const 도구ID들 = demoDescriptors().map((d) => d.id);

/** 승인이 필요한 일을 고르는 모델 + 자기가 무슨 일을 하려는지 말하는 모델. */
const 고른다 = (text) => ({
  async respond(_tc, opts = {}) {
    if (opts.tools?.length) {
      return { text, toolCalls: [{ name: 'local.terminal', args: { command: 'rm -f 있던.md' } }] };
    }
    // 빈 문자열을 그대로 돌려준다 — 모델이 아무 말도 안 한 턴을 재현해야 폴백 문구를 볼 수 있다.
    return text;
  },
});

async function 채널로보낸말(modelText) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-채널-'));
  // **지울 것이 실제로 있어야 승인이 걸린다.** 없으면 `rm -f` 는 아무것도 안 바꾸고 그대로 통과한다
  // — 커널이 목록이 아니라 결과로 판정한다는 증거이기도 하다(처음에 이것 때문에 검사가 헛돌았다).
  await writeFile(join(dir, '있던.md'), '원래 내용');
  const store = new SessionStore(dir);
  const allowlistStore = new AllowlistStore(dir);
  await allowlistStore.allow('telegram', { userId: 'u1', label: '오너' });
  const 보낸것 = [];
  const 발신 = { async handler({ text, target }) { 보낸것.push(text); return { result: { sent: true, target } }; } };
  const server = makeServer({
    store, allowlistStore,
    channels: demoChannels(), connectors: demoConnectors(),
    model: 고른다(modelText),
    tools: demoTools({
      senders: { 'telegram.send': 발신 },
      localTerminal: makeLocalTerminalTool({ cwd: dir }),
    }),
  });
  const out = await server.handleChannelMessage({
    channel: 'telegram', chatId: 'room-1', userId: 'u1',
    text: '있던.md 지워줘', isDirectMessage: true, isMention: true,
  });
  return { 보낸것, out };
}

test('채널 승인 알림에 도구 id 가 나가지 않는다(사용자면/진단면 분리)', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const { 보낸것, out } = await 채널로보낸말('');
  assert.equal(out?.kind ?? out?.body?.kind, 'approval', `승인에서 안 멈췄다: ${JSON.stringify(out).slice(0, 160)}`);
  assert.ok(보낸것.length, '승인으로 멈췄는데 채널에 아무 말도 안 갔다 — 사용자에겐 먹통이다');
  const 말 = 보낸것.join('\n');
  const 샌것 = 도구ID들.filter((id) => 말.includes(id));
  assert.deepEqual(샌것, [], `내부 도구 id 가 사용자에게 나갔다: ${말}`);
});

test('모델이 이미 한 말이 있으면 채널도 그 말을 쓴다(표면이 달라도 말투는 하나다)', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  const { 보낸것 } = await 채널로보낸말('있던.md 를 지우려고 해요.');
  assert.match(보낸것.join('\n'), /있던\.md 를 지우려고 해요/,
    `모델이 한 말을 버리고 채널이 자기 문장을 지어냈다: ${보낸것.join('\n')}`);
});

test('무엇을 왜 멈췄는지와 이어갈 길이 함께 간다(막다른 알림 금지)', { skip: !sandboxAvailable() && '샌드багос 없음' }, async () => {
  const { 보낸것 } = await 채널로보낸말('');
  const 말 = 보낸것.join('\n');
  assert.match(말, /터미널 실행/, '무슨 일인지 사람 말(label)로 말해야 한다');
  assert.match(말, /확인/, '왜 멈췄는지가 없다');
  assert.match(말, /T5 화면/, '어디서 이어가는지가 없으면 막다른 알림이다');
});

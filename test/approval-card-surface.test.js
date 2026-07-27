// **승인 카드는 산출물에서 검증한다** (절대원칙 1: 소스가 아니라 사용자에게 도달하는 것).
//
// 실측(2026-07-27 라이브): 도구가 낸 미리보기 계약은 옳았다 —
//   preview = { impact:"메모5.md 에 저장해요", scope:"/Users/jyp/GPAO-T5/GPAO-T5/메모5.md", … }
// 그런데 화면 카드가 `scope` 를 안 그려서 사용자는 `메모5.md 에 저장해요` 만 봤다. 작업 루트
// 이름이 경로에 두 번 들어간 것을 **누르기 전에 알 수 없었다.** 커널 검사는 전부 초록이었다.
// `local.process` 의 "끌 때까지 계속 돌아요" 도 같은 이유로 한 번도 화면에 못 나왔다.
//
// 그래서 여기서는 **계약 필드가 화면 코드와 채널 문구에 실제로 닿는지**를 고정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { AllowlistStore } from '../src/surface/allowlist-store.js';
import { demoTools, demoChannels, demoConnectors } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

const html = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'surface', 'web', 'index.html'),
  'utf8',
);

// ── 화면: 계약 필드가 렌더 코드에 있는가 ──────────────────────────────────
test('승인 카드가 preview.scope 를 그린다(어디에 일어나는지)', () => {
  assert.match(html, /preview\?\.scope/, '카드가 scope 를 안 읽으면 경로가 화면에 안 나온다');
});

test('승인 카드가 preview.duration 을 그린다(얼마나 지속되는지)', () => {
  assert.match(html, /preview\?\.duration/, 'process 의 "끌 때까지 계속 돌아요"가 사라진다');
});

// ── 방: 승인 안내에 무엇이·어디에 실리는가 ────────────────────────────────
const 고른다 = (calls) => {
  let used = false;
  return { async respond(_tc, opts = {}) {
    if (!used && opts.tools?.length) { used = true; return { text: '', toolCalls: calls }; }
    return opts.tools?.length ? { text: '했어요', toolCalls: [] } : '했어요';
  } };
};

test('방으로 가는 승인 안내에 무엇이 어디에 생기는지가 실린다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'card-'));
  const 루트 = await mkdtemp(join(tmpdir(), 'card-root-'));
  const store = new SessionStore(dir);
  const allow = new AllowlistStore(dir);
  await allow.allow('telegram', { userId: 'u1', label: '오너' });
  const 방으로 = [];
  const server = makeServer({
    store, allowlistStore: allow, channels: demoChannels(), connectors: demoConnectors(),
    tools: demoTools({
      localFile: makeLocalFileTool({ roots: [루트], dataDir: dir }),
      senders: { 'telegram.send': { async handler(a) { 방으로.push(a.text); return { result: { sent: true } }; } } },
    }),
    // 모델이 작업 루트 이름을 경로에 **또** 넣는 실측 상황을 그대로 재현한다.
    model: 고른다([{ name: 'local.file', args: { action: 'write', path: `${루트.split('/').pop()}/메모.md`, text: 'x' } }]),
  });

  const r = await server.handleChannelMessage({
    channel: 'telegram', chatId: 'u1', userId: 'u1', text: '메모 만들어줘',
  });
  assert.equal(r.kind, 'approval');
  const 안내 = 방으로.at(-1) ?? '';
  assert.match(안내, /메모\.md/, '무엇이 생기는지가 방에 안 나가면 승인이 아니다');
  assert.ok(
    안내.includes(루트),
    `실제로 생길 자리가 방에 나가야 한다 — 실제 안내:\n${안내}`,
  );
  assert.match(안내, /T5 화면에서 확인/, '어디서 승인하는지는 그대로 남는다');
});

test('미리보기 계약이 없는 도구면 지어내지 않는다(안내는 여전히 나간다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'card2-'));
  const store = new SessionStore(dir);
  const allow = new AllowlistStore(dir);
  await allow.allow('telegram', { userId: 'u1' });
  const 방으로 = [];
  const server = makeServer({
    store, allowlistStore: allow, channels: demoChannels(), connectors: demoConnectors(),
    tools: demoTools({
      senders: { 'telegram.send': { async handler(a) { 방으로.push(a.text); return { result: { sent: true } }; } } },
    }),
    // localFile 을 주입하지 않는다 → demo fixture 가 쓰이고, 그 손에는 previewOf 가 없다.
    model: 고른다([{ name: 'local.file', args: { action: 'write', path: '메모.md', text: 'x' } }]),
  });
  const r = await server.handleChannelMessage({
    channel: 'telegram', chatId: 'u1', userId: 'u1', text: '메모 만들어줘',
  });
  assert.equal(r.kind, 'approval');
  const 안내 = 방으로.at(-1) ?? '';
  assert.match(안내, /T5 화면에서 확인/, '계약이 없어도 안내는 나간다');
  assert.doesNotMatch(안내, /undefined|null/, '없는 사실을 지어내거나 내부값을 흘리지 않는다');
});

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
      localTerminal: {
        async probe(command) { return { command, cwd: 루트, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
        async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: 루트 }, userSafeSummary: '정리했어요.' }; },
      },
    }),
    // **탈것을 터미널로 옮겼다**(자동성 헌장 2026-08-03) — 되돌릴 수 있는 파일 작업은 이제
    // 자동이라 방으로 나가는 승인 안내 자체가 생기지 않는다. 이 검사가 재는 것은 파일 경로가
    // 아니라 **방 승인 안내가 preview 의 사실(무엇을·어디서)을 싣는가**이므로 손은 무엇이든 된다.
    // (경로 해석은 `approval-preview-resolved` 가 도구 계약에서 직접 잰다.)
    model: 고른다([{ name: 'local.terminal', args: { command: 'rm -rf 임시폴더' } }]),
  });

  const r = await server.handleChannelMessage({
    channel: 'telegram', chatId: 'u1', userId: 'u1', text: '임시폴더 지워줘',
  });
  assert.equal(r.kind, 'approval');
  const 안내 = 방으로.at(-1) ?? '';
  assert.match(안내, /임시폴더/, '무엇을 하는지가 방에 안 나가면 승인이 아니다');
  assert.doesNotMatch(안내, /undefined|null/, '없는 사실을 지어내거나 내부값을 흘리지 않는다');
  assert.match(안내, /T5 화면에서 확인/, '어디서 승인하는지는 그대로 남는다');
  assert.ok(루트);
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
    // 헌장 뒤 승인이 나는 손으로 바꾼다 — 재는 것은 **previewOf 가 없는 손에서도 안내가 나가고
    // 없는 사실을 지어내지 않는가**이지 파일이 아니다. slack.post 는 demo fixture 라 계약이 없다.
    model: 고른다([{ name: 'slack.post', args: { text: '정리 끝났어요', target: '#일반' } }]),
  });
  const r = await server.handleChannelMessage({
    channel: 'telegram', chatId: 'u1', userId: 'u1', text: '슬랙에 알려줘',
  });
  assert.equal(r.kind, 'approval');
  const 안내 = 방으로.at(-1) ?? '';
  assert.match(안내, /T5 화면에서 확인/, '계약이 없어도 안내는 나간다');
  assert.doesNotMatch(안내, /undefined|null/, '없는 사실을 지어내거나 내부값을 흘리지 않는다');
});

// ── 무엇이 적히는가 — 자리만으로는 "무엇을 허락하는지" 절반만 안다 ──────────
test('쓰기 승인 카드에 적힐 내용이 승인 전에 보인다', async () => {
  const 루트 = await mkdtemp(join(tmpdir(), 'what-'));
  const tool = makeLocalFileTool({ roots: [루트], dataDir: 루트 });
  const p = tool.previewOf({ action: 'write', path: '메모.md', text: '# 오늘 할 일\n- 물 마시기\n- 쉬기' });
  assert.ok(p.what, '무엇이 적힐지 없으면 사용자는 모르고 누른다');
  assert.match(p.what, /물 마시기/);
  assert.match(p.what, /쉬기/);
});

test('긴 내용은 접되 접었다고 말한다(요약하지 않는다)', async () => {
  const 루트 = await mkdtemp(join(tmpdir(), 'what2-'));
  const tool = makeLocalFileTool({ roots: [루트], dataDir: 루트 });
  const 긴글 = '가'.repeat(900);
  const p = tool.previewOf({ action: 'write', path: 'a.md', text: 긴글 });
  assert.match(p.what, /900자 중 앞부분/, '접었으면 접었다고 말해야 한다');
  assert.ok(p.what.length < 600);
});

test('지우기·옮기기는 적을 내용이 없으므로 지어내지 않는다', async () => {
  const 루트 = await mkdtemp(join(tmpdir(), 'what3-'));
  const tool = makeLocalFileTool({ roots: [루트], dataDir: 루트 });
  assert.equal(tool.previewOf({ action: 'delete', path: 'a.md' }).what, undefined);
  assert.equal(tool.previewOf({ action: 'move', path: 'a.md', to: 'b.md' }).what, undefined);
});

test('적힐 내용이 줄바꿈 그대로 보이게 화면이 처리한다', () => {
  assert.match(html, /el\('pre',\s*`무엇을:/, 'textContent 로 넣으면 목록이 한 줄로 뭉개진다');
  assert.match(html, /\.card \.why \.pre\s*\{[^}]*white-space:\s*pre-wrap/, 'pre-wrap 규칙이 있어야 한다');
});

// ── L8 · 승인 안내는 모델이 무슨 말을 하든 사실을 담는다 ────────────────────
// 실측 실패(2026-07-27 4:33, 실제 방):
//   "승인 확인했어. 다만 지금 이 응답 경로에는 로컬 파일 실행 도구가 붙어 있지 않아서,
//    내가 실제로 `메모.md`를 생성하진 못했어. 만들 위치는 …가 맞고, 내용은 아래처럼 넣으면 돼."
// 승인을 **요청하는** 턴에서 승인했다고 했고, 있는 손을 없다고 했고, 사용자에게 시켰다.
// 그때 안내는 `사람말 || 무엇—왜` 였다 — 모델 문장이 사실을 **대체**했다.
//
// 판정을 "모델이 정직하게 말했는가"에 걸면 확정이 안 된다(승인 턴의 reply 는 라이브 4회 연속
// 비었다 — 모델은 승인 턴에서 도구만 고른다). 그래서 **사실이 늘 곁에 있는가**로 판정한다.
const 말하는모델 = (문장, calls) => {
  let used = false;
  return { async respond(_tc, opts = {}) {
    if (!used && opts.tools?.length) { used = true; return { text: 문장, toolCalls: calls }; }
    return opts.tools?.length ? { text: '했어요', toolCalls: [] } : '했어요';
  } };
};

test('모델이 "손이 없다"고 말해도 안내에 사실이 함께 남는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'l8-'));
  const 루트 = await mkdtemp(join(tmpdir(), 'l8-root-'));
  const store = new SessionStore(dir);
  const allow = new AllowlistStore(dir);
  await allow.allow('telegram', { userId: 'u1' });
  const 방으로 = [];
  const server = makeServer({
    store, allowlistStore: allow, channels: demoChannels(), connectors: demoConnectors(),
    tools: demoTools({
      localFile: makeLocalFileTool({ roots: [루트], dataDir: dir }),
      senders: { 'telegram.send': { async handler(a) { 방으로.push(a.text); return { result: { sent: true } }; } } },
      localTerminal: {
        async probe(command) { return { command, cwd: 루트, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
        async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: 루트 }, userSafeSummary: '정리했어요.' }; },
      },
    }),
    // 탈것을 터미널로 옮겼다(헌장 2026-08-03). 재는 것은 **모델 문장이 사실을 대체하지 못한다**(L8)
    // 이지 파일이 아니다 — 승인이 나는 손이면 같은 계약이 그대로 선다.
    model: 말하는모델(
      '승인 확인했어. 다만 터미널 도구가 붙어 있지 않아서 내가 실제로 지우진 못했어.',
      [{ name: 'local.terminal', args: { command: 'rm -rf 임시폴더' } }],
    ),
  });
  const r = await server.handleChannelMessage({
    channel: 'telegram', chatId: 'u1', userId: 'u1', text: '임시폴더 지워줘',
  });
  assert.equal(r.kind, 'approval');
  const 안내 = 방으로.at(-1) ?? '';
  // 모델 문장은 버리지 않는다(64a7634) — 다만 **혼자 서지 못하게** 한다.
  assert.match(안내, /붙어 있지 않아서/, '모델이 한 말을 버리지 않는다');
  assert.match(안내, /실행 전에 확인/, '왜 멈췄는지가 함께 있어야 그 문장이 반박된다');
  assert.match(안내, /임시폴더/, '무엇을 하는지');
  assert.match(안내, /에서/, '어디서 하는지(터미널 preview 의 scope)');
  assert.doesNotMatch(안내, /undefined|null/, '없는 사실을 지어내거나 내부값을 흘리지 않는다');
  assert.match(안내, /T5 화면에서 확인해 주시면 이어서 할게요/, 'T5 가 이어서 한다는 사실');
});

test('모델이 아무 말도 안 해도(reply 빈 턴) 안내는 온전하다 — 라이브 4회 연속 그랬다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'l8b-'));
  const 루트 = await mkdtemp(join(tmpdir(), 'l8b-root-'));
  const store = new SessionStore(dir);
  const allow = new AllowlistStore(dir);
  await allow.allow('telegram', { userId: 'u1' });
  const 방으로 = [];
  const server = makeServer({
    store, allowlistStore: allow, channels: demoChannels(), connectors: demoConnectors(),
    tools: demoTools({
      localFile: makeLocalFileTool({ roots: [루트], dataDir: dir }),
      senders: { 'telegram.send': { async handler(a) { 방으로.push(a.text); return { result: { sent: true } }; } } },
      localTerminal: {
        async probe(command) { return { command, cwd: 루트, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
        async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: 루트 }, userSafeSummary: '정리했어요.' }; },
      },
    }),
    // 탈것을 터미널로(헌장 2026-08-03) — 재는 것은 **모델이 아무 말도 안 해도 안내가 온전한가**다.
    model: 말하는모델('', [{ name: 'local.terminal', args: { command: 'rm -rf 임시폴더' } }]),
  });
  await server.handleChannelMessage({ channel: 'telegram', chatId: 'u1', userId: 'u1', text: '임시폴더 지워줘' });
  const 안내 = 방으로.at(-1) ?? '';
  assert.match(안내, /실행 전에 확인/);
  assert.match(안내, /임시폴더/);
  assert.match(안내, /T5 화면에서 확인해 주시면 이어서 할게요/);
});

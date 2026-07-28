// P5-B 진입 전 · 승인 카드는 **모델이 보낸 인자가 아니라 해석된 결과**를 보여야 한다.
//
// 실측 결함(2026-07-27, 실제 텔레그램 방):
//   원장 → local.file {"action":"write","path":"GPAO-T5/메모4.md"}
//   실제 생성 → /Users/jyp/GPAO-T5/GPAO-T5/메모4.md
//
// 런타임은 정상이었다(상대 경로를 작업 루트 기준으로 풀었다). 문제는 **승인 카드가 인자를 그대로
// 실었다**는 것이다. 카드에 `GPAO-T5/메모4.md` 라고만 떠서, 루트 이름이 두 번 들어간 것을
// 사용자가 누르기 전에 알 길이 없었다. 무엇을 허락하는지 모르는 승인은 승인이 아니다.
//
// 전송도 같다. `slack.post`·`telegram.send` 는 계약이 없어 `${라벨} 실행` 으로 떨어졌고,
// **되돌릴 수 없는 행동**인데 받는 곳도 문면도 안 보였다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeChannelSender } from '../src/runtime/channel-sender.js';

const 고른다 = (calls) => {
  let used = false;
  return { async respond(_tc, opts = {}) {
    if (!used && opts.tools?.length) { used = true; return { text: '', toolCalls: calls }; }
    return opts.tools?.length ? { text: '했어요', toolCalls: [] } : '했어요';
  } };
};

async function 작업루트() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-preview-'));
  return { dir, tool: makeLocalFileTool({ roots: [dir], dataDir: dir }) };
}

// ── 실측 결함 재현: 루트 이름이 두 번 ──────────────────────────────────────
test('모델이 작업 루트 이름을 경로에 또 넣으면, 카드가 실제로 생길 자리를 보여준다', async () => {
  const { dir, tool } = await 작업루트();
  const 루트이름 = basename(dir);
  const r = await runTurn({ text: `${루트이름} 안에 메모4.md 만들어줘` }, {
    env: demoEnv(),
    model: 고른다([{ name: 'local.file', args: { action: 'write', path: `${루트이름}/메모4.md`, text: '네번째' } }]),
    tools: demoTools({ localFile: tool }),
  });
  assert.equal(r.kind, 'approval', '쓰기는 승인 경계다');
  const p = r.pending?.[0]?.preview ?? {};
  // 핵심: 카드가 **인자 원문**(`<루트이름>/메모4.md`)만 보여주고 끝나면 안 된다.
  assert.match(p.scope, new RegExp(`^${dir}`), `실제 자리가 절대 경로로 보여야 한다: ${p.scope}`);
  assert.ok(
    p.scope.includes(`${dir}/${루트이름}/메모4.md`),
    `루트가 두 번 들어간 사실이 카드에 보여야 한다 — 실제: ${p.scope}`,
  );
});

test('평범한 경우에도 카드는 인자가 아니라 풀린 자리를 보여준다', async () => {
  const { dir, tool } = await 작업루트();
  const r = await runTurn({ text: '메모.md 만들어줘' }, {
    env: demoEnv(),
    model: 고른다([{ name: 'local.file', args: { action: 'write', path: '메모.md', text: 'ㅎㅇ' } }]),
    tools: demoTools({ localFile: tool }),
  });
  const p = r.pending?.[0]?.preview ?? {};
  assert.equal(p.scope, `${dir}/메모.md`);
  assert.match(p.impact, /메모\.md/);
  assert.notEqual(p.impact, '로컬 파일 실행', '도구 이름만 있는 빈 문구는 승인이 아니다');
});

test('되돌릴 수 있는지를 이 작업에 대해 말한다(휴지통 사실)', async () => {
  const { tool } = await 작업루트();
  const p = tool.previewOf({ action: 'delete', path: '회의록.md' });
  assert.match(p.cancel, /휴지통|되살릴 수 있어요/);
  assert.doesNotMatch(p.cancel, /되돌릴 수 없/, '되돌릴 수 있는 삭제를 겁주면 안 된다');
});

test('읽기는 승인 카드가 없으므로 미리보기도 내지 않는다', async () => {
  const { tool } = await 작업루트();
  assert.equal(tool.previewOf({ action: 'read', path: 'a.md' }), undefined);
  assert.equal(tool.previewOf({ action: 'list' }), undefined);
});

// ── 전송: 되돌릴 수 없다. 받는 곳과 문면이 승인 전에 보여야 한다 ────────────
test('전송 카드에 받는 곳과 보낼 문면이 그대로 보인다', () => {
  const sender = makeChannelSender({ channel: 'telegram', token: 't', defaultTarget: '99887' });
  const p = sender.previewOf({ text: '오늘 정산 끝났습니다' });
  assert.match(p.impact, /오늘 정산 끝났습니다/, '문면이 안 보이면 무엇을 허락하는지 모른다');
  assert.match(p.scope, /99887/, '받는 곳이 안 보이면 어디로 가는지 모른다');
  assert.match(p.cancel, /되돌릴 수 없어요/, '전송을 되돌릴 수 있는 척하면 안 된다');
});

test('문면을 요약하지 않는다 — 승인한 것과 나간 것이 갈라지면 안 된다', () => {
  const sender = makeChannelSender({ channel: 'slack', token: 't', defaultTarget: '#general' });
  const 원문 = '가나다라마바사'.repeat(5);
  assert.ok(sender.previewOf({ text: 원문 }).impact.includes(원문), '짧은 글은 통째로 보여야 한다');
});

test('받는 곳이 없으면 있는 척하지 않는다', () => {
  const sender = makeChannelSender({ channel: 'slack', token: 't' });
  assert.match(sender.previewOf({ text: '안녕' }).scope, /정해지지 않았어요/);
});

test('보낼 내용이 없으면 미리보기를 지어내지 않는다', () => {
  const sender = makeChannelSender({ channel: 'slack', token: 't', defaultTarget: '#a' });
  assert.equal(sender.previewOf({ text: '   ' }), undefined);
});

// 실측(오너 라이브 2026-07-28, 웹 화면): 파일 저장 승인 카드를 거절했더니
//   버튼  → "보내지 마"
//   응답  → "보내지 않았어요. 초안은 그대로 있어요."
// 보내는 일이 아니었고 초안도 없었다. 거절 문구가 커널에 한 줄로 박혀 있어서
// 모든 승인을 전송으로 말한 것이다. 카드는 무엇을 하려는지 정확히 보여줬는데
// 거절 응답만 다른 세계에 살고 있었다 — 같은 승인에 두 개의 진실.
//
// 커널은 무슨 도구였는지 몰라야 한다. 그래서 **도구가 카드에 쓴 자기 말**을 인용한다.
test('거절 문구는 실제로 하려던 일을 말한다 — 전부 전송으로 말하지 않는다', async () => {
  const { dir, tool } = await 작업루트();
  const c = {
    env: demoEnv(),
    model: 고른다([{ name: 'local.file', args: { action: 'write', path: '정산.md', text: '합계' } }]),
    tools: demoTools({ localFile: tool }),
  };
  const r1 = await runTurn({ text: '정산.md 로 저장해줘' }, c);
  assert.equal(r1.kind, 'approval', '쓰기는 승인 경계다');
  const r2 = await runTurn({ reject: r1.pendingId }, c);
  assert.equal(r2.kind, 'reply');
  assert.ok(!/보내|초안/.test(r2.reply), `없는 전송을 말했다: ${r2.reply}`);
  assert.match(r2.reply, /정산\.md/, '무엇을 건너뛰었는지가 없다');
  assert.ok(dir);
});

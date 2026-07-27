// **읽고 나서 쓰는 일**이 한 턴에 이어져야 한다 — 사용자의 일은 거의 다 그 모양이다.
//
//   "지난달 정산 파일들 한 폴더로 모아줘"  = 찾기(읽기) → 모으기(쓰기)
//   "매출 엑셀 세 개 합쳐줘"               = 찾기(읽기) → 합치기(쓰기)
//   "견적서들 PDF로 바꿔줘"                = 훑기(읽기) → 변환(쓰기)
//
// 라이브 실측(2026-07-27): 세 과업이 **전부 같은 자리**에서 끊겼다. T5 는 파일을 정확히
// 찾아 놓고 마지막 한 걸음을 사용자에게 넘겼고, 매번 다른 말로 둘러댔다:
//   "제가 여기서 직접 파일 복사 실행은 못 하지만, 터미널에서 아래만 실행하면…"
//   "로컬 파일 변환 도구가 연결되어 있지 않아 제가 직접 PDF 생성까지 실행하진 못합니다"
//   "지금 직접 파일 쓰기 실행 권한은 이 응답 안에서는 못 잡아서"
// 셋 다 사실이 아니다. 손은 있었다 — **런타임이 조용히 멈췄을 뿐이다.**
//
// 원인은 실행 루프였다: 걸음 중에 승인이 필요한 것이 나오면 `break` 하고 끝났다.
// 승인 대기를 안 만드니 카드도 안 뜨고, 멈췄다는 사실이 사용자에게도 다음 턴에도 안 남았다.
// 그래서 한 걸음짜리 쓰기(메모 만들기)는 승인이 뜨는데
// **읽고 나서 쓰는 일은 영원히 승인에 도달하지 못했다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/** 읽기를 한 걸음 하고, 그 결과를 받은 다음 **쓰기**를 고르는 모델. */
function 읽고나서쓰는모델(읽기, 쓰기, 말 = '찾았어요. 이제 모을게요.') {
  let n = 0;
  return {
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return '했어요';
      n += 1;
      if (n === 1) return { text: '', toolCalls: [읽기] };
      if (n === 2) return { text: 말, toolCalls: [쓰기] };
      return { text: '다 했어요', toolCalls: [] };
    },
  };
}

async function 자리() {
  const dir = await mkdtemp(join(tmpdir(), 'multistep-'));
  return { dir, tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }) };
}

const 읽기 = { name: 'local.file', args: { action: 'list' } };
const 쓰기 = { name: 'local.file', args: { action: 'write', path: '모음/정산.csv', text: '거래처,금액\n가나상사,1200000\n' } };

test('읽고 나서 쓰기가 필요하면 승인 카드가 뜬다(조용히 멈추지 않는다)', async () => {
  const { dir, tools } = await 자리();
  const r = await runTurn({ text: '정산 파일들 한 폴더로 모아줘' }, {
    env: demoEnv(), tools, model: 읽고나서쓰는모델(읽기, 쓰기),
  });
  assert.equal(r.kind, 'approval', `쓰기 걸음이 승인으로 올라와야 한다 — 실제: ${r.kind} / ${String(r.reply ?? '').slice(0, 120)}`);
  assert.ok((r.pending ?? []).length >= 1, '승인 대기가 만들어져야 한다');
  const p = r.pending[0];
  assert.match(String(p.preview?.impact ?? ''), /정산\.csv/, '무엇을 허락하는지가 카드에 있어야 한다');
  assert.ok(String(p.preview?.scope ?? '').startsWith(dir), `어디에 생기는지도 — 실제: ${p.preview?.scope}`);
  assert.match(String(p.preview?.what ?? ''), /가나상사/, '무엇이 적힐지도');
});

test('여기까지 한 일을 버리지 않는다 — 모델이 한 말과 원장이 함께 남는다', async () => {
  const { tools } = await 자리();
  const r = await runTurn({ text: '정산 파일들 한 폴더로 모아줘' }, {
    env: demoEnv(), tools, model: 읽고나서쓰는모델(읽기, 쓰기),
  });
  assert.match(String(r.reply ?? ''), /찾았어요/, '모델이 이미 한 말은 버리지 않는다(64a7634)');
  assert.ok(r.ledger, '이미 한 걸음이 원장으로 보여야 "찾긴 찾았구나"를 안다');
});

test('있는 손을 없다고 말하지 않는다', async () => {
  const { tools } = await 자리();
  const r = await runTurn({ text: '정산 파일들 한 폴더로 모아줘' }, {
    env: demoEnv(), tools,
    model: 읽고나서쓰는모델(읽기, 쓰기, '찾았어요.'),
  });
  const 말 = `${r.reply ?? ''} ${JSON.stringify(r.pending ?? [])}`;
  assert.doesNotMatch(말, /못 하지만|못 합니다|연결되어 있지 않아|권한은.*못/, '떠넘김 표현 금지');
  assert.doesNotMatch(말, /터미널에서 아래|직접 실행하면/, '사용자에게 명령을 치라고 하지 않는다');
});

test('승인하면 **T5 가 이어서 실행한다** — 파일이 실제로 생긴다', async () => {
  const { dir, tools } = await 자리();
  const ctx = { env: demoEnv(), tools, model: 읽고나서쓰는모델(읽기, 쓰기) };
  const r1 = await runTurn({ text: '정산 파일들 한 폴더로 모아줘' }, ctx);
  assert.equal(r1.kind, 'approval');
  const r2 = await runTurn({ approve: r1.pendingId }, ctx);
  assert.notEqual(r2.kind, 'approval', '승인했는데 또 물으면 안 된다');
  const 내용 = await readFile(join(dir, '모음', '정산.csv'), 'utf8');
  assert.match(내용, /가나상사,1200000/, '승인 뒤 실제로 쓰여야 한다(메시지가 아니라 파일로 확인)');
});

test('읽기만 필요한 일은 승인을 묻지 않고 그대로 끝난다(회귀 방지)', async () => {
  const { tools } = await 자리();
  const r = await runTurn({ text: '폴더 안에 뭐 있는지 봐줘' }, {
    env: demoEnv(), tools,
    model: 읽고나서쓰는모델(읽기, { name: 'local.file', args: { action: 'list', path: '.' } }),
  });
  assert.notEqual(r.kind, 'approval', '읽기는 승인을 묻지 않는다');
});

test('방에서 시킨 일이면 그 뒤 카드도 방을 기억한다(L9)', async () => {
  const { tools } = await 자리();
  const ctx = { env: demoEnv(), tools, model: 읽고나서쓰는모델(읽기, 쓰기) };
  const r = await runTurn({ text: '정산 파일들 모아줘', channel: 'telegram' }, ctx);
  assert.equal(r.kind, 'approval');
  const saved = ctx.pending.get(r.pendingId);
  assert.deepEqual(saved?.askedFrom, { channel: 'telegram' }, '어느 자리에서 물었는지가 봉인돼야 결과가 돌아간다');
});

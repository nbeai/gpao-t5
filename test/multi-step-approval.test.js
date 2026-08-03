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
import { join, basename } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/** 읽기를 한 걸음 하고, 그 결과를 받은 다음 **쓰기**를 고르는 모델. */
function 읽고나서쓰는모델(읽기, 쓰기, 말 = '찾았어요. 이제 모을게요.') {
  let n = 0;
  return {
    async respond(tc, opts = {}) {
      // P90-2: 판정 호출(work.deliverable)도 이제 구조 채널을 받는다. 예전엔 도구가 0개라
      // `opts.tools.length` 로 본선 라운드를 세도 맞았지만, 그건 구현 모양에 기댄 대리 규칙이었다.
      // 계약 사실은 `tc.workContractAssessment` 다 — 그것으로 가른다. 주장은 그대로다.
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
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
  return { dir, tools: demoTools({
    localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }),
    // 승인이 나는 탈것 — 자동성 헌장(2026-08-03) 뒤 되돌릴 수 있는 파일 작업은 자동이라
    // **승인이라는 사건 자체를 만들 수 없다.** `local.terminal` 은 `reversible:false` 라 헌장 ②에 걸린다.
    localTerminal: {
      async probe(command) { return { command, cwd: dir, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
      async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: dir }, userSafeSummary: '정리했어요.' }; },
    },
  }) };
}

const 읽기 = { name: 'local.file', args: { action: 'list' } };
const 쓰기 = { name: 'local.file', args: { action: 'write', path: '모음/정산.csv', text: '거래처,금액\n가나상사,1200000\n' } };
/** 승인이 나는 두 번째 걸음(헌장 ②) — 승인 생명주기를 재는 검사가 쓴다. */
const 지우기 = { name: 'local.terminal', args: { command: 'rm -rf 오래된정산' } };

// **원래 결함은 "조용히 멈춤"이었다** — 읽고 나서 쓰는 걸음이 승인에 영영 도달하지 못하고
// 아무 말 없이 끝났다(라이브 실측 2026-07-27, 세 과업 전부). 헌장(2026-08-03) 뒤 되돌릴 수 있는
// 쓰기는 자동이므로 그 걸음은 **실제로 실행돼야** 한다. 재는 것은 같다 — 조용히 사라지지 않는가.
// 카드에 실리던 사실(무엇을·어디에·무엇이 적힐지)은 `previewOf` 가 그대로 소유한다(아래 별도 단언).
test('읽고 나서 쓰기가 필요한 일은 조용히 멈추지 않고 끝까지 걷는다', async () => {
  const { dir, tools } = await 자리();
  const r = await runTurn({ text: '정산 파일들 한 폴더로 모아줘' }, {
    env: demoEnv(), tools, model: 읽고나서쓰는모델(읽기, 쓰기),
  });
  assert.equal(r.kind, 'reply', `쓰기 걸음이 실행되지 않았다 — 실제: ${r.kind} / ${String(r.reply ?? '').slice(0, 120)}`);
  const 만든것 = await readFile(join(dir, '모음/정산.csv'), 'utf8');
  assert.match(만든것, /가나상사/, '조용히 멈췄다 — 파일이 실제로 생기지 않았다');
  // 사용자가 볼 사실은 도구 계약이 소유한다.
  const p = tools.tools['local.file'].previewOf(쓰기.args);
  assert.match(String(p?.impact ?? ''), /정산\.csv/, '무엇을 하는지');
  assert.equal(p?.scope, `${basename(dir)}/모음/정산.csv`, `사람이 알아볼 자리여야 한다 — 실제: ${p?.scope}`);
  assert.doesNotMatch(p?.scope ?? '', /^\//, '원시 절대 경로를 노출하지 않는다');
  assert.match(String(p?.what ?? ''), /가나상사/, '무엇이 적힐지도');
});

// 이 계약(64a7634)은 **승인 반환 경로**의 것이다 — 턴이 카드에서 멈출 때 그때까지 모델이 한 말과
// 원장이 함께 남아야 "찾긴 찾았구나"를 안다. 헌장 뒤 자동 실행 경로에서는 턴이 끝까지 걸어
// 최종 답이 그 자리를 대신하므로(정상), 탈것을 승인이 나는 손으로 옮겨 원계약을 그대로 잰다.
test('여기까지 한 일을 버리지 않는다 — 모델이 한 말과 원장이 함께 남는다', async () => {
  const { tools } = await 자리();
  const r = await runTurn({ text: '오래된 정산 정리해줘' }, {
    env: demoEnv(), tools, model: 읽고나서쓰는모델(읽기, 지우기),
  });
  assert.equal(r.kind, 'approval');
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

// 탈것을 터미널로 옮겼다(헌장 2026-08-03) — 재는 것은 **승인 뒤 T5 가 이어서 실제로 실행하는가**
// 이지 파일이 아니다. 실행 사실은 도구 경계에서 직접 센다(문구가 아니라 호출로).
test('승인하면 **T5 가 이어서 실행한다** — 실제로 손이 움직인다', async () => {
  const { tools } = await 자리();
  const 불린것 = [];
  const 원래 = tools.tools['local.terminal'].handler;
  tools.tools['local.terminal'].handler = async (...a) => { 불린것.push(a[0]?.command); return 원래(...a); };
  const ctx = { env: demoEnv(), tools, model: 읽고나서쓰는모델(읽기, 지우기) };
  const r1 = await runTurn({ text: '오래된 정산 정리해줘' }, ctx);
  assert.equal(r1.kind, 'approval');
  assert.equal(불린것.length, 0, '승인 전에 손이 움직였다');
  const r2 = await runTurn({ approve: r1.pendingId }, ctx);
  assert.notEqual(r2.kind, 'approval', '승인했는데 또 물으면 안 된다');
  assert.deepEqual(불린것, ['rm -rf 오래된정산'], '승인 뒤 실제로 실행돼야 한다(메시지가 아니라 호출로 확인)');
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
  const ctx = { env: demoEnv(), tools, model: 읽고나서쓰는모델(읽기, 지우기) };
  const r = await runTurn({ text: '오래된 정산 정리해줘', channel: 'telegram' }, ctx);
  assert.equal(r.kind, 'approval');
  const saved = ctx.pending.get(r.pendingId);
  assert.deepEqual(saved?.askedFrom, { channel: 'telegram' }, '어느 자리에서 물었는지가 봉인돼야 결과가 돌아간다');
});

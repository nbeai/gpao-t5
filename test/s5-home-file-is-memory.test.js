// **S5 — 집 파일이 곧 기억이다.**
//
// 파일이 스스로 약속한 문장이 있다(씨앗 머리말):
//   *"줄을 지우면 T5 가 그걸 잊는다. **문장을 고치면 고친 대로 기억한다.**"*
//
// 그런데 읽기는 **T5 가 붙인 표식이 있는 줄만** 봤다:
//   /^\s*-\s*(.*?)\s*<!--\s*t5:([^\s>]+)\s*-->\s*$/gm
// 사람이 손으로 쓴 `- 홍차를 마신다` 는 보이지 않았고, 고친 문장은 다음 쓰기에서 덮였다.
// **지우기만 되고 쓰기·고치기는 안 됐다** — 지침.md 가 *"다음 대화부터 따른다"* 고 해 놓고
// 안 따랐던 것과 같은 병이다(2026-08-05 오너 라이브가 그걸 잡았다). **두 번째 거짓 약속이다.**
//
// 그리고 이게 막고 있던 것이 크다. 오너 설치 실측(2026-08-05):
//   승격된 기억 **0개** · 집 파일 **비어 있음** · 후보 4개 전부 `admitted:false`
// 기억이 모델에게 **한 번도 간 적이 없다.** F-18 의 낱말 필터는 0개를 0개로 거르고 있었다.
//
// §10 규율 12 — 개수가 아니라 **계약**:
//   "표식 없는 줄도 파싱한다"(모양) ❌
//   → **"사람이 쓴 줄은 기억이 된다 · 고친 문장이 진실이다 · 지운 줄은 잊는다 ·
//      표시 구역 밖 메모는 기억이 아니다 · 그리고 그것이 모델에게 간다"**(계약) ⭕
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 기억파일쓰기, 기억파일읽기, 집파일반영 } from '../src/surface/memory-home.js';
import { admittedEntries } from '../src/kernel/l1-intent/context-mesh.js';

const 저장소 = '/state/one';
const 집만들기 = () => mkdtemp(join(tmpdir(), 't5-mem-home-'));
const 파일 = (집) => join(집, '기억.md');

/** T5 가 이미 기억하고 있는 것 하나를 세운 집. */
async function 무대() {
  const 집 = await 집만들기();
  const 있던것 = [{
    candidateId: 'c1', kind: 'preference', statement: '보고서는 표로 정리한다',
    userConfirmed: true, admitted: true,
  }];
  await 기억파일쓰기(집, 있던것, 저장소);
  return { 집, 있던것 };
}

test('① **사람이 쓴 줄은 기억이 된다** — 표식 없이 써도 들어온다', async () => {
  const { 집, 있던것 } = await 무대();
  const 글 = await readFile(파일(집), 'utf8');
  // 사용자가 표시 구역 안에 손으로 한 줄 더 적는다(T5 표식 없음).
  await writeFile(파일(집), 글.replace(/(<!-- t5:기억:끝 -->)/, '- 홍차를 마신다\n\n$1'), 'utf8');

  const 반영 = 집파일반영(있던것, await 기억파일읽기(집, 저장소));
  assert.deepEqual(반영.더할것.map((x) => x.statement), ['홍차를 마신다'],
    '**사람이 자기 파일에 쓴 줄이 무시됐다.**\n'
    + `  반영: ${JSON.stringify(반영)}\n`
    + '파일 머리말이 "고친 대로 기억한다"고 약속한다 — 약속과 동작이 다르면 그건 거짓말이다.');
  assert.deepEqual(반영.지울것, [], '있던 기억이 엉뚱하게 철회됐다');
});

test('② **고친 문장은 고친 대로 기억한다** — 파일이 진실이다', async () => {
  const { 집, 있던것 } = await 무대();
  const 글 = await readFile(파일(집), 'utf8');
  await writeFile(파일(집), 글.replace('보고서는 표로 정리한다', '보고서는 한 장으로 줄인다'), 'utf8');

  const 반영 = 집파일반영(있던것, await 기억파일읽기(집, 저장소));
  assert.deepEqual(반영.고칠것, [{ candidateId: 'c1', statement: '보고서는 한 장으로 줄인다' }],
    `**고친 문장이 안 반영됐다** — 다음 쓰기에서 옛 문장으로 덮인다: ${JSON.stringify(반영)}`);
});

test('③ **지운 줄은 잊는다** — 이미 서 있던 계약을 안 깬다', async () => {
  const { 집, 있던것 } = await 무대();
  const 글 = await readFile(파일(집), 'utf8');
  await writeFile(파일(집), 글.replace(/^\s*-\s*보고서는 표로 정리한다.*$/m, ''), 'utf8');

  const 반영 = 집파일반영(있던것, await 기억파일읽기(집, 저장소));
  assert.deepEqual(반영.지울것, ['c1'], `지운 줄이 안 잊혔다: ${JSON.stringify(반영)}`);
  assert.deepEqual(반영.더할것, [], '지웠는데 새 기억으로 다시 들어왔다');
});

test('④ **표시 구역 밖에 쓴 메모는 기억이 아니다** — 파일이 메모장이 되지 않는다', async () => {
  const { 집, 있던것 } = await 무대();
  const 글 = await readFile(파일(집), 'utf8');
  await writeFile(파일(집), `${글}\n## 내 메모\n- 이건 그냥 적어 둔 것\n`, 'utf8');

  const 반영 = 집파일반영(있던것, await 기억파일읽기(집, 저장소));
  assert.deepEqual(반영.더할것, [],
    `**표시 구역 밖 메모가 기억으로 들어왔다**: ${JSON.stringify(반영.더할것)}\n`
    + '머리말이 "그 밖에 쓴 메모는 그대로 남는다"고 약속한다 — 남는다는 건 안 건드린다는 뜻이다.');
});

test('⑤ **사람이 쓴 기억은 모델에게 실제로 간다** — 승격에서 막히지 않는다', async () => {
  const { 집, 있던것 } = await 무대();
  const 글 = await readFile(파일(집), 'utf8');
  await writeFile(파일(집), 글.replace(/(<!-- t5:기억:끝 -->)/, '- 홍차를 마신다\n\n$1'), 'utf8');
  const 반영 = 집파일반영(있던것, await 기억파일읽기(집, 저장소));

  const memory = { promoted: [...있던것, ...반영.더할것] };
  const 실린것 = admittedEntries(memory, '내가 뭘 마시는지 알아?').map((e) => e.statement);
  assert.ok(실린것.includes('홍차를 마신다'),
    '**사람이 자기 파일에 쓴 기억이 모델에게 안 갔다.**\n'
    + `  실린 것: ${JSON.stringify(실린것)}\n`
    + '사용자가 손으로 쓴 것보다 분명한 확인은 없다 — 여기서 또 승인을 요구하면 기억은 영영 안 산다.');
});

test('⑥ **남의 설치 파일로는 안 들어온다** — 짝 계약을 안 깬다', async () => {
  const { 집, 있던것 } = await 무대();
  const 글 = await readFile(파일(집), 'utf8');
  await writeFile(파일(집), 글.replace(저장소, '/state/somebody-else'), 'utf8');

  const 읽은것 = await 기억파일읽기(집, 저장소);
  assert.equal(읽은것, null, '남의 설치가 쓴 파일을 우리 것으로 읽었다');
  const 반영 = 집파일반영(있던것, 읽은것);
  assert.deepEqual(반영, { 더할것: [], 고칠것: [], 지울것: [] },
    '파일을 못 읽었는데 기억을 건드렸다 — 못 읽은 것은 "아무것도 안 바뀜"이다');
});

// ── ⑦ **서버가 그 반영을 실제로 적용한다** ──────────────────────────────────
//
// 위 여섯은 **판정**을 쟀다. 판정이 옳아도 적용이 안 되면 사용자에게는 아무 일도 안 일어난다 —
// 이 흐름에서 그 모양을 여러 번 봤다(계약은 맞는데 배선이 반쪽). 그래서 서버까지 밟는다.
test('⑦ **집 파일에 손으로 쓴 줄이 다음 턴에 진짜 기억이 된다**(서버까지)', async () => {
  const { mkdtemp: mk } = await import('node:fs/promises');
  const { MemoryStore } = await import('../src/surface/memory-store.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { EventLog } = await import('../src/surface/event-log.js');
  const { makeServer } = await import('../src/surface/server.js');
  const { demoTools } = await import('../src/surface/demo-context.js');

  const 홈 = await mk(join(tmpdir(), 't5-s5-home-'));
  // **상태 자리는 홈 안이다** — 실제 설치가 `~/.local/state/...` 를 쓰는 그대로.
  // 홈 밖에 두면 짝 보호가 "남의 설치"로 보고 막는다(그 보호는 회귀 29건이 세운 것이다).
  const 상태 = join(홈, '.local', 'state', 'gpao-t5', 'sessions');
  await (await import('node:fs/promises')).mkdir(상태, { recursive: true });
  const 집 = join(홈, 'GPAO-T5');
  // 사용자가 자기 파일에 한 줄 적었다(T5 표식 없음 — 손으로 쓴 그대로).
  await 기억파일쓰기(집, [], 상태);
  const 글 = await readFile(join(집, '기억.md'), 'utf8');
  await writeFile(join(집, '기억.md'), 글.replace(/(<!-- t5:기억:끝 -->)/, '- 홍차를 마신다\n\n$1'), 'utf8');

  const 받은것 = [];
  const server = makeServer({
    store: new SessionStore(상태), eventLog: new EventLog(상태), tools: demoTools(),
    memoryStore: new MemoryStore(상태),
    processEnv: { ...process.env, HOME: 홈, GPAO_T5_HOME: 홈, GPAO_T5_DATA_DIR: 상태 },
    model: { async respond(tc) { 받은것.push(tc); return '네.'; } },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const post = (p, b) => fetch(`http://127.0.0.1:${server.address().port}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}),
  }).then((r) => r.json());
  try {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '내가 뭘 마시는지 알아?' });
    const 재료 = 받은것.at(-1) ?? {};
    assert.ok((재료.admittedContext ?? []).includes('홍차를 마신다'),
      '**손으로 쓴 기억이 모델에게 안 갔다.**\n'
      + `  모델이 받은 것: ${JSON.stringify(재료.admittedContext ?? [])}\n`
      + '판정이 옳아도 적용이 안 되면 사용자에게는 아무 일도 안 일어난다.');
  } finally { server.close(); }
});

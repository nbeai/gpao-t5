// 조각 C · 세션 제목이 구별된다 (design/T5-UX-PLAN-ko.md §2 조각 C)
//
// 밟은 것(오너 스크린샷 + 오너 실물 `~/.local/state/gpao-t5/sessions/` 실측 2026-08-12):
//   안 지운 세션 95개 중 **81개(85%)**가 제목이 **바이트 단위로 같은** 12개 묶음에 들어 있다.
//   가장 큰 묶음은 24개. `manualTitle` 은 그 81개 전부 0 — 사용자가 붙인 이름은 하나도 안 겹친다.
//
// **왜 발화에서 특징을 뽑는 방식(㉯)을 안 골랐나 — 그 데이터가 기각했다.**
//   12개 묶음 전부 첫 발화 **전문이 서로 1종**이다(길이도 1종). 30자 절단 탓이 아니라
//   **입력이 정말로 같다.** 결정적 함수는 같은 입력에 같은 출력을 낸다 —
//   발화에서 무엇을 뽑아도 이 81개를 **한 개도 못 가른다**. 모델에게 짓게 해도(㉮) 입력이
//   같으므로 갈릴 근거가 없고, 왕복만 는다(F-57 "왕복을 깎아 모델을 멍청하게 만들지 않는다"의
//   반대 방향으로 왕복을 **더하는** 것이라 더 나쁘다).
//   갈릴 수 있는 축은 **그 대화가 몇 번째인가**뿐이다 — 그래서 차수(㉰)를 붙인다.
//   차수는 왕복 0 · 모델 0 · 결정적이고, "같은 시험의 3회차"라는 뜻도 준다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore, distinctTitle, DEFAULT_TITLE, MAX_TITLE } from '../src/surface/session-store.js';

const newStore = async () => new SessionStore(await mkdtemp(join(tmpdir(), 'gpao-t5-title-')));

async function withServer(fn) {
  const { makeServer } = await import('../src/surface/server.js');
  const store = await newStore();
  let 모델호출 = 0;
  const server = makeServer({ store, model: { respond: async () => { 모델호출 += 1; return '네'; } } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => (await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  })).json();
  const getj = async (path) => (await fetch(`${base}${path}`)).json();
  try { return await fn({ post, getj, store, 모델호출수: () => 모델호출 }); }
  finally { await new Promise((r) => server.close(r)); }
}

/** 같은 첫 발화로 대화를 n개 만들고 목록의 제목들을 돌려준다. */
async function 같은말로대화n개({ post, getj }, text, n) {
  for (let i = 0; i < n; i += 1) {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text });
  }
  const { sessions } = await getj('/sessions');
  return sessions.map((s) => s.title);
}

// ── 순수 함수 ─────────────────────────────────────────────────────────────
test('첫 대화는 제목을 그대로 갖는다 — 안 겹치는데 번호를 붙이지 않는다', () => {
  assert.equal(distinctTitle('주간 보고 정리', []), '주간 보고 정리');
  assert.equal(distinctTitle('주간 보고 정리', ['다른 대화']), '주간 보고 정리');
});

test('같은 제목이 이미 있으면 차수가 붙는다 — 그리고 차수는 안 겹친다', () => {
  const 이미 = [];
  for (let i = 1; i <= 4; i += 1) 이미.push(distinctTitle('내 컴퓨터에 PDF 파일 있어? 찾아서 어디 있는지 알', 이미));
  assert.deepEqual(이미, [
    '내 컴퓨터에 PDF 파일 있어? 찾아서 어디 있는지 알',
    '내 컴퓨터에 PDF 파일 있어? 찾아서 어디 있는지 알 (2)',
    '내 컴퓨터에 PDF 파일 있어? 찾아서 어디 있는지 알 (3)',
    '내 컴퓨터에 PDF 파일 있어? 찾아서 어디 있는지 알 (4)',
  ]);
  assert.equal(new Set(이미).size, 4);
});

test('차수는 남은 것 중 가장 큰 수 다음이다 — 중간을 지워도 번호를 다시 쓰지 않는다', () => {
  // (2) 를 지운 뒤 새 대화가 다시 (2) 가 되면, 휴지통에서 되살렸을 때 또 겹친다.
  assert.equal(distinctTitle('보고', ['보고', '보고 (3)']), '보고 (4)');
});

test('사람이 손으로 넣은 "(3)" 같은 꼬리를 차수로 오해하지 않는다', () => {
  // 제목 자체가 "회의록 (3)" 인 대화가 하나 있을 뿐이면, 그것과만 안 겹치면 된다.
  assert.equal(distinctTitle('회의록 (3)', ['회의록 (3)']), '회의록 (3) (2)');
});

test('상한 60자를 차수가 넘기지 않는다 — 번호가 잘리면 구별이 죽는다', () => {
  const 긴제목 = '가'.repeat(MAX_TITLE);
  const 이미 = [긴제목];
  for (let i = 2; i <= 12; i += 1) 이미.push(distinctTitle(긴제목, 이미));
  for (const t of 이미) assert.ok(t.length <= MAX_TITLE, `${t.length}자: ${t}`);
  assert.equal(new Set(이미).size, 12, '길이를 맞추려다 서로 같아졌다');
  assert.ok(이미.at(-1).endsWith(' (12)'), 이미.at(-1));
});

test('빈 제목·한 글자도 안 깨지고 갈린다(반대시험 ③)', () => {
  assert.equal(distinctTitle('', []), DEFAULT_TITLE);
  assert.equal(distinctTitle('   ', [DEFAULT_TITLE]), `${DEFAULT_TITLE} (2)`);
  assert.equal(distinctTitle('가', ['가', '가 (2)']), '가 (3)');
  assert.equal(distinctTitle(null, []), DEFAULT_TITLE);
});

// ── 반대시험 ① · 밟은 그 자리 ─────────────────────────────────────────────
test('반대시험 ①: 같은 말로 시작한 대화 넷이 목록에서 구별된다', async () => {
  await withServer(async (h) => {
    // 오너 실물에서 24개가 겹친 바로 그 발화.
    const 제목들 = await 같은말로대화n개(h, '내 컴퓨터에 PDF 파일 있어? 찾아서 어디 있는지 알려줘.', 4);
    assert.equal(제목들.length, 4);
    assert.equal(new Set(제목들).size, 4, `목록에 같은 제목이 나란히 떴다: ${JSON.stringify(제목들)}`);
    // 뜻을 버리지 않는다 — 넷 다 무슨 대화인지 앞부분으로 알 수 있다.
    for (const t of 제목들) assert.ok(t.startsWith('내 컴퓨터에 PDF 파일'), t);
  });
});

test('오너 실물 최대 묶음 크기(24)에서도 전부 갈린다', async () => {
  await withServer(async (h) => {
    const 제목들 = await 같은말로대화n개(h, '내 컴퓨터에 PDF 파일 있어? 찾아서 어디 있는지 알려줘.', 24);
    assert.equal(new Set(제목들).size, 24);
  });
});

// ── 반대시험 ② ───────────────────────────────────────────────────────────
test('반대시험 ②: 사용자가 직접 붙인 이름은 차수가 안 덮는다', async () => {
  await withServer(async ({ post, getj }) => {
    const a = await post('/sessions');
    await post('/turn', { sessionId: a.id, text: '주간 보고 정리' });
    const b = await post('/sessions');
    await post('/sessions/meta', { sessionId: b.id, title: '주간 보고 정리' }); // 손으로 같은 이름
    await post('/turn', { sessionId: b.id, text: '주간 보고 정리' });
    const { sessions } = await getj('/sessions');
    const 손이름 = sessions.find((s) => s.id === b.id);
    assert.equal(손이름.title, '주간 보고 정리', '수동 제목에 차수가 붙었다');
  });
});

// ── 반대시험 ③ ───────────────────────────────────────────────────────────
test('반대시험 ③: 한 글자 발화 넷도 안 깨지고 갈린다', async () => {
  await withServer(async (h) => {
    const 제목들 = await 같은말로대화n개(h, '가', 4);
    assert.equal(new Set(제목들).size, 4, JSON.stringify(제목들));
    assert.deepEqual([...제목들].sort(), ['가', '가 (2)', '가 (3)', '가 (4)'].sort());
  });
});

// ── 반대시험 ④ ───────────────────────────────────────────────────────────
//
// 턴당 모델 호출 수는 **발화 내용에 따라** 커널이 정한다(같은 4회 대화라도 발화가 다르면
// 4회와 16회로 갈린다 — 실측). 그래서 **발화를 고정하고 제목 경로만** 바꿔 대조한다:
//   통제군 = 손으로 이름을 붙여 자동 제목 경로를 아예 안 타는 넷
//   실험군 = 같은 발화로 자동 제목이 붙는 넷(차수가 붙는 자리)
// 두 값이 같으면 제목이 왕복을 안 늘린 것이다.
const 왕복시험발화 = '내 컴퓨터에 PDF 파일 있어?';

test('반대시험 ④: 제목을 짓느라 모델을 부르지 않는다 — 왕복 증가 0', async () => {
  const 통제군 = await withServer(async (h) => {
    for (let i = 0; i < 4; i += 1) {
      const s = await h.post('/sessions');
      await h.post('/sessions/meta', { sessionId: s.id, title: `손이름 ${i}` }); // 자동 제목 경로 우회
      await h.post('/turn', { sessionId: s.id, text: 왕복시험발화 });
    }
    return h.모델호출수();
  });
  const 실험군 = await withServer(async (h) => {
    await 같은말로대화n개(h, 왕복시험발화, 4);
    return h.모델호출수();
  });
  assert.ok(통제군 > 0, '측정기가 아무것도 못 셌다');
  assert.equal(실험군, 통제군, `제목 때문에 모델 왕복이 늘었다: ${통제군} → ${실험군}`);
});

test('반대시험 ④(둘째): 제목 짓기는 답이 시작되기 전 딱 한 번만 목록을 읽는다', async () => {
  const store = await newStore();
  let 목록읽기 = 0;
  const 원래 = store.usedTitles.bind(store);
  store.usedTitles = async () => { 목록읽기 += 1; return 원래(); };
  const { makeServer } = await import('../src/surface/server.js');
  const server = makeServer({ store, model: { respond: async () => '네' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => (await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  })).json();
  try {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '주간 보고 정리' });
    assert.equal(목록읽기, 1, '첫 발화에 목록을 한 번만 읽어야 한다');
    await post('/turn', { sessionId: s.id, text: '이어서 정리해줘' });
    await post('/turn', { sessionId: s.id, text: '더 줄여줘' });
    // 둘째 발화부터는 이미 제목이 있다 — 매 턴 목록을 다시 읽지 않는다.
    assert.equal(목록읽기, 1, `제목이 정해진 뒤에도 매 턴 목록을 읽었다(${목록읽기}회)`);
  } finally { await new Promise((r) => server.close(r)); }
});

// ── 화면 — 갈라 놓은 것이 목록에서 실제로 보이는가 ────────────────────────
//
// **서버가 갈라도 화면이 도로 붙여 보이면 고친 게 아니다.** `.sess .t` 는 flex:1 +
// text-overflow:ellipsis 라 **뒤를 자른다** — 차수 `(2)` 가 정확히 그 잘리는 자리에 있다.
// 사이드바가 좁으면 24개가 다시 똑같이 보인다. 그래서 차수를 안 잘리는 칸으로 뺐다.
test('목록이 차수를 말줄임에 안 뺏긴다 — 별도 칸(flex:none)으로 그린다', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /\.sess \.t \{[^}]*text-overflow:ellipsis/, '전제가 바뀌었다 — 제목 칸이 더는 안 자른다면 이 검사를 다시 판정하라');
  assert.match(html, /\.sess \.ord \{[^}]*flex:none/, '차수 칸이 없거나 줄어들 수 있다 — 말줄임에 먹힌다');
  assert.match(html, /const 차수 = \/\^\(\.\*\) \\\(\(\\d\+\)\\\)\$\/\.exec\(제목\)/, '제목에서 차수를 갈라내는 자리가 사라졌다');
  assert.match(html, /if \(ord\) item\.appendChild\(ord\)/, '차수 칸을 목록 행에 안 붙인다');
});

// ── 이미 저장된 겹침 — 밟은 그 자리(반대시험 ①) ──────────────────────────
test('이미 저장된 같은 제목 넷이 한 번에 풀린다 — 먼저 만든 것이 원래 이름을 갖는다', async () => {
  const store = await newStore();
  const 만든것 = [];
  for (let i = 0; i < 4; i += 1) {
    const s = await store.create('GPAO-T5 안에 시험-2026-08-12 폴더에 8');
    s.createdAt = 1000 + i * 10; // 생성 순서를 못 박는다
    await store.save(s);
    만든것.push(s.id);
  }
  assert.equal(await store.repairDuplicateTitles(), 3);
  const 목록 = await store.list();
  assert.equal(new Set(목록.map((x) => x.title)).size, 4, JSON.stringify(목록.map((x) => x.title)));
  const 제목of = (id) => 목록.find((x) => x.id === id).title;
  assert.equal(제목of(만든것[0]), 'GPAO-T5 안에 시험-2026-08-12 폴더에 8', '먼저 만든 대화의 이름이 바뀌었다');
  assert.equal(제목of(만든것[3]), 'GPAO-T5 안에 시험-2026-08-12 폴더에 8 (4)');
});

test('두 번 돌려도 결과가 같다 — 이름이 계속 굴러가지 않는다', async () => {
  const store = await newStore();
  for (let i = 0; i < 3; i += 1) {
    const s = await store.create('보고서');
    s.createdAt = 1000 + i;
    await store.save(s);
  }
  assert.equal(await store.repairDuplicateTitles(), 2);
  const 첫판 = (await store.list()).map((x) => x.title).sort();
  assert.equal(await store.repairDuplicateTitles(), 0, '두 번째 실행이 또 이름을 바꿨다');
  assert.deepEqual((await store.list()).map((x) => x.title).sort(), 첫판);
});

test('정리가 사용자 이름을 안 건드리고, 목록 순서(updatedAt)도 안 흔든다', async () => {
  const store = await newStore();
  const a = await store.create('회의록'); a.createdAt = 1000; await store.save(a);
  const b = await store.create('회의록'); b.createdAt = 2000; await store.save(b);
  const c = await store.create('회의록'); c.createdAt = 3000; await store.save(c);
  await store.updateMeta(b.id, { title: '회의록' }); // 손으로 붙인, 우연히 같은 이름
  const 전순서 = (await store.list()).map((x) => x.id);
  const 전시각 = new Map((await store.list()).map((x) => [x.id, x.updatedAt]));
  await store.repairDuplicateTitles();
  const 후 = await store.list();
  // 사람이 고른 이름이 이긴다 — 먼저 만들어졌더라도 **자동 제목 쪽이** 비킨다.
  assert.equal(후.find((x) => x.id === b.id).title, '회의록', '손으로 붙인 이름이 바뀌었다');
  assert.notEqual(후.find((x) => x.id === a.id).title, '회의록', '자동 제목이 사람 이름을 안 비켰다');
  assert.equal(new Set(후.map((x) => x.title)).size, 3, JSON.stringify(후.map((x) => x.title)));
  assert.deepEqual(후.map((x) => x.id), 전순서, '목록 순서가 뒤집혔다');
  for (const x of 후) assert.equal(x.updatedAt, 전시각.get(x.id), 'updatedAt 을 건드렸다');
});

test('정리가 지운 대화·숨긴 대화까지 갈라 놓는다 — 되살릴 때 다시 안 겹치게', async () => {
  const store = await newStore();
  const a = await store.create('초안'); a.createdAt = 1000; await store.save(a);
  const b = await store.create('초안'); b.createdAt = 2000; await store.save(b);
  const c = await store.create('초안'); c.createdAt = 3000; await store.save(c);
  await store.setArchived(b.id, true);
  await store.softDelete(c.id);
  await store.repairDuplicateTitles();
  const 되살린 = await store.restore(c.id);
  await store.setArchived(b.id, false);
  const 제목들 = (await store.list()).map((x) => x.title);
  assert.equal(new Set(제목들).size, 3, `되살리니 다시 겹쳤다: ${JSON.stringify(제목들)}`);
  assert.ok(되살린.title.endsWith(' (3)'), 되살린.title);
});

// ── 저장소 계약 — 숨긴 것·지운 것과도 안 겹친다 ───────────────────────────
test('숨긴 대화·지운 대화의 제목과도 안 겹친다 — 되살리면 다시 겹치기 때문', async () => {
  const store = await newStore();
  const a = await store.create('보고서 초안');
  const b = await store.create('보고서 초안 (2)');
  await store.setArchived(a.id, true);
  await store.softDelete(b.id);
  assert.equal(distinctTitle('보고서 초안', await store.usedTitles()), '보고서 초안 (3)');
});

// **S8 — 계약 슬롯과 드라이버. 새 능력이 코어를 안 건드리고 붙는다.**
//
// 오너 착수 지시(2026-08-05):
//   ① *"슬롯은 소비자가 둘 이상일 때만 모양이 잡힌다. 하나면 그냥 함수다."*
//      `web-search.js` 에 `duckduckgo · searxng · tavily` 셋이 **이미 있다** —
//      CU 를 첫 드라이버로 두면 드라이버 0개로 슬롯을 설계하게 된다. 셋으로 먼저 세운다.
//   ③ *"성공은 '슬롯이 있다'가 아니라 **새 능력이 6칸을 안 쓰고 붙는다**이다."*
//      §4 발자국 사다리: 6칸은 **코어 도구**이고 불변식 B(매 API 콜 비용)와 이어진다.
//      **판정: `web-search.js` 를 한 글자도 안 고치고 네 번째 검색기가 붙는가.**
//
// ── 이 칸은 성격이 다르다 ────────────────────────────────────────────────
// 지금까지는 **이미 있는 것을 계약으로 재고 합쳤다.** S8 은 처음으로 **새로 만든다** —
// 그래서 "행동 변화 0" 이나 반대시험이 절반만 듣는다. 나머지 절반을 세우는 것이 ① 이다:
// **이미 있는 셋의 행동이 안 바뀌는 것**이 이번 슬라이스의 대조군이다.
//
// §10 규율 12 — 개수가 아니라 **계약**:
//   "레지스트리가 있다"(모양) ❌
//   → **"코어를 안 고치고 붙는다 · 붙어도 있던 셋이 그대로 돈다 ·
//      순서가 선언에서 나온다 · 못 쓰는 드라이버는 건너뛴다"**(계약) ⭕
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SEARCH_PROVIDERS, makeWebSearch } from '../src/runtime/web-search.js';

/** 검색 한 번에 무엇이 시도됐는지. 드라이버는 실제 망을 안 탄다(결정적이어야 한다). */
const 가짜fetch = async () => ({ ok: false, status: 503, text: async () => '' });

/** 네 번째 검색기 — **`web-search.js` 밖에서** 선언한다. 이것이 이 칸의 판정이다. */
const 브레이브 = {
  id: 'brave',
  label: '브레이브 검색',
  needs: [],                       // 키 없이 된다
  async run(query) {
    return [{ title: `brave:${query}`, url: 'https://example.test/1', snippet: 'x' }];
  },
};

test('① **드라이버 셋이 슬롯에 선언으로 서 있다** — 배열이 파일에 박혀 있지 않다', () => {
  const ids = Object.keys(SEARCH_PROVIDERS);
  assert.ok(ids.includes('duckduckgo') && ids.includes('searxng') && ids.includes('tavily'),
    `기존 드라이버 셋이 슬롯에 안 보인다: ${JSON.stringify(ids)}`);
  for (const [id, d] of Object.entries(SEARCH_PROVIDERS)) {
    assert.equal(typeof d.run, 'function', `${id}: 실행할 방법을 안 밝혔다`);
    assert.ok(d.label, `${id}: 사람이 부를 이름이 없다`);
    assert.ok(Array.isArray(d.needs), `${id}: **무엇이 있어야 도는지**를 선언하지 않았다 — `
      + '그걸 코드가 짐작하면 새 드라이버마다 짐작이 하나씩 는다');
  }
});

test('② **코어를 안 고치고 네 번째가 붙는다** — 발자국 사다리 6칸을 안 쓴다(성공 판정)', async () => {
  const 전 = await readFile('src/runtime/web-search.js', 'utf8');
  const 검색 = makeWebSearch({ fetchImpl: 가짜fetch, providers: [...Object.values(SEARCH_PROVIDERS), 브레이브] });
  const r = await 검색.search('거제 야호');
  assert.equal(r.state, 'ok', `**밖에서 선언한 드라이버가 안 돌았다**: ${JSON.stringify(r)}`);
  assert.equal(r.provider, 'brave', `네 번째가 아니라 ${r.provider} 가 답했다`);
  const 후 = await readFile('src/runtime/web-search.js', 'utf8');
  assert.equal(createHash('sha256').update(전).digest('hex'), createHash('sha256').update(후).digest('hex'),
    '**코어 파일이 바뀌었다** — 새 능력을 붙이려고 코어를 고쳐야 하면 그건 6칸이고,\n'
    + '불변식 B(코어 도구 하나는 매 API 콜 비용) 와 정면으로 부딪힌다.');
});

test('③ **붙어도 있던 셋이 그대로 돈다** — 이번 슬라이스의 대조군', async () => {
  const 기본 = makeWebSearch({ fetchImpl: 가짜fetch });
  const 늘린것 = makeWebSearch({ fetchImpl: 가짜fetch, providers: [...Object.values(SEARCH_PROVIDERS), 브레이브] });
  const a = await 기본.search('x');
  const b = await 늘린것.search('x');
  assert.deepEqual(a.tried, ['duckduckgo'],
    `기존 순서가 달라졌다: ${JSON.stringify(a.tried)} — 키 없는 판에서는 덕덕고만 시도한다`);
  assert.deepEqual(b.tried.slice(0, a.tried.length), a.tried,
    `**드라이버를 붙였더니 있던 것의 순서가 흔들렸다**: ${JSON.stringify(b.tried)}\n`
    + '새 것은 뒤에 붙어야 한다 — 앞을 밀면 지금 되던 것이 조용히 달라진다.');
});

test('④ **못 쓰는 드라이버는 건너뛴다** — 선언한 것이 없으면 시도조차 안 한다', async () => {
  const 검색 = makeWebSearch({ fetchImpl: 가짜fetch });   // 키·인스턴스 없음
  const r = await 검색.search('x');
  assert.ok(!r.tried.includes('tavily'), '키가 없는데 Tavily 를 시도했다 — 실패를 만들어 낼 뿐이다');
  assert.ok(!r.tried.includes('searxng'), '인스턴스가 없는데 SearXNG 를 시도했다');

  // **밖에서 온 드라이버의 조건도 그 드라이버가 밝힌 대로 본다.**
  // 처음엔 기존 셋과 무키 드라이버로만 쟀는데, 그러면 `needs` 선언을 버리고 **이름으로
  // 짐작**해도 같은 답이 나온다 — 돌연변이가 그렇게 빠져나갔다(2026-08-05).
  // 이름 규칙이 모르는 **새 이름 + 키 필요** 드라이버가 그 둘을 가른다.
  const 키필요 = {
    id: 'newsearch', label: '새 검색기', needs: ['apiKey'],
    async run() { return [{ title: 'x', url: 'https://example.test/1', snippet: '' }]; },
  };
  const 키없이 = await makeWebSearch({ fetchImpl: 가짜fetch, providers: [키필요] }).search('x');
  assert.deepEqual(키없이.tried, [],
    `**드라이버가 "키가 있어야 돈다"고 밝혔는데 그냥 시도했다**: ${JSON.stringify(키없이.tried)}\n`
    + '고르는 쪽이 이름으로 짐작하면, 새 드라이버가 붙을 때마다 그 짐작을 코어에 하나씩 더해야 한다 —\n'
    + '그게 곧 발자국 사다리 6칸이고, 이 칸이 없애려는 바로 그것이다.');
  const 키주고 = await makeWebSearch({ fetchImpl: 가짜fetch, apiKey: 'k', providers: [키필요] }).search('x');
  assert.deepEqual(키주고.tried, ['newsearch'], '조건이 채워졌는데 안 시도했다');
});

test('⑤ **한 층이 죽어도 다음 층으로 간다** — 막다른 답 금지', async () => {
  const 죽는것 = { id: 'dead', label: '죽는 것', needs: [], async run() { throw new Error('down'); } };
  const 검색 = makeWebSearch({ fetchImpl: 가짜fetch, providers: [죽는것, 브레이브] });
  const r = await 검색.search('x');
  assert.equal(r.state, 'ok', `앞이 죽자 그대로 멈췄다: ${JSON.stringify(r)}`);
  assert.deepEqual(r.tried, ['dead', 'brave'], '시도한 순서가 사실대로 안 남았다');
});

test('⑥ **아무도 못 하면 그렇게 말한다** — 뭐가 시도됐는지 남긴다', async () => {
  const 검색 = makeWebSearch({ fetchImpl: 가짜fetch, providers: [] });
  const r = await 검색.search('x');
  assert.equal(r.state, 'unavailable');
  assert.deepEqual(r.tried, [], '시도 목록이 사실과 다르다');
});

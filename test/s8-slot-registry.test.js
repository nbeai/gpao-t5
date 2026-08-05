// **S8 · 등록 — 계약 슬롯과 드라이버.**
//
// 오너가 성공 판정을 못 박았다(전환 계획 §8 착수 지시 ③):
// > **`web-search.js` 를 한 글자도 안 고치고 네 번째 검색기가 붙는가.**
//
// 그리고 왜 그 문장인지도 적혀 있다 — 옛 닫힘("네이버 플레이스 후기 본문을 읽는다")은
// **정정된 근거에 매여** 있었다. 그 벽은 네이버의 IP 제한이라 **슬롯을 다 만들어도 같은 IP 면
// 안 닫힌다.** 슬롯으로 닫을 수 없는 문장을 슬롯의 닫힘으로 두면 영원히 안 닫힌다.
//
// ── 지금까지는 슬롯이 아니라 이음매였다 ──────────────────────────────────
// `web-search.js` 에 `const order = deps.providers ?? [duckduckgo, searxng, tavily]` 가 있고
// **호출부가 `providers` 를 안 넘겼다.** 인자 자리는 열려 있는데 아무도 안 쓰니, 새 검색기를
// 붙이려면 결국 그 파일의 배열을 고쳐야 했다 — §4 발자국 사다리의 **6칸(코어 도구)** 이고
// 불변식 B(코어 하나가 매 API 콜 비용)와 정면으로 부딪힌다.
//
// ── 이 파일이 재는 것 ────────────────────────────────────────────────────
// **이 파일은 `web-search.js` 의 속을 한 줄도 안 건드린다.** 네 번째 검색기를 오직 레지스트리
// API 로만 붙이고, 그것이 실제로 도는지 본다. 통과한다는 것 자체가 "코어를 안 고치고 붙었다"의
// 증거다 — 고쳐야 통과하는 검사였으면 애초에 여기 못 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSlotRegistry } from '../src/kernel/l2-plan/slot-registry.js';
import { SEARCH_SLOT, 검색슬롯세우기 } from '../src/runtime/search-slot.js';
import { makeWebSearch } from '../src/runtime/web-search.js';

/** 네 번째 검색기 — 코어 밖에서 만든다. 계약이 요구하는 것만 갖춘다. */
const 네번째 = {
  id: 'brave', label: '브레이브', needs: ['braveKey'],
  async run(query, deps) {
    if (!deps.braveKey) return null;
    return [{ title: `브레이브: ${query}`, url: 'https://brave.example/1', snippet: '네 번째가 낸 결과' }];
  },
};

test('슬롯은 계약을 갖는다 — 계약을 못 채운 드라이버는 조용히 안 받는다', () => {
  const 등록소 = makeSlotRegistry();
  등록소.슬롯세우기({ id: 'search', 계약: ['id', 'run'] });
  // **조용히 무시하지 않는다.** 안 받았는데 받은 척하면 "붙였는데 안 돈다"가 된다(거짓 성공).
  assert.throws(() => 등록소.붙이기('search', { label: '이름만 있음' }),
    /계약/, '계약 미달을 조용히 통과시켰다');
  assert.deepEqual(등록소.드라이버('search'), []);
});

test('없는 슬롯에 붙이면 거절한다 — 어디에 붙었는지 모르는 드라이버를 만들지 않는다', () => {
  const 등록소 = makeSlotRegistry();
  assert.throws(() => 등록소.붙이기('없는슬롯', 네번째), /슬롯/);
});

test('붙인 순서를 지킨다 — 층 순서가 곧 고르는 순서다', () => {
  const 등록소 = makeSlotRegistry();
  등록소.슬롯세우기({ id: 'search', 계약: ['id', 'run'] });
  등록소.붙이기('search', { id: '가', async run() { return null; } });
  등록소.붙이기('search', { id: '나', async run() { return null; } });
  assert.deepEqual(등록소.드라이버('search').map((d) => d.id), ['가', '나']);
});

// ── 오너가 얼린 성공 문장 ────────────────────────────────────────────────
test('**네 번째 검색기가 코어를 안 고치고 붙는다** — S8 닫는 조건', async () => {
  const 등록소 = 검색슬롯세우기();                 // 있던 셋이 등록된 레지스트리
  const 있던것 = 등록소.드라이버(SEARCH_SLOT).map((d) => d.id);
  assert.deepEqual(있던것, ['duckduckgo', 'searxng', 'tavily'], '있던 셋이 그대로 서야 대조가 된다');

  등록소.붙이기(SEARCH_SLOT, 네번째);              // ← 코어 밖에서, 레지스트리 API 로만

  const search = makeWebSearch({
    providers: 등록소.드라이버(SEARCH_SLOT),
    braveKey: 'k',                                  // 네 번째가 밝힌 `needs` 를 채운다
    fetchImpl: async () => ({ status: 500, text: async () => '' }),  // 앞 셋은 다 실패시킨다
  });
  const out = await search.search('오늘 코스피');
  assert.equal(out.state, 'ok', '네 번째가 안 돌았다 — 붙였는데 안 쓰이면 붙은 게 아니다');
  assert.equal(out.provider, 'brave');
  assert.equal(out.results[0].url, 'https://brave.example/1');
  assert.ok(out.tried.includes('brave'), '시도 기록에도 남아야 한다');
});

test('네 번째가 자기 조건을 못 채우면 시도조차 안 한다 — 이름으로 짐작하지 않는다', async () => {
  const 등록소 = 검색슬롯세우기();
  등록소.붙이기(SEARCH_SLOT, 네번째);
  const search = makeWebSearch({
    providers: 등록소.드라이버(SEARCH_SLOT),
    // braveKey 를 안 준다
    fetchImpl: async () => ({ status: 500, text: async () => '' }),
  });
  const out = await search.search('오늘 코스피');
  assert.ok(!out.tried.includes('brave'), '조건이 없는데 시도했다 — `needs` 선언이 안 읽혔다');
});

// ── 대조군 보존: 붙여도 있던 것이 그대로 돈다 ────────────────────────────
test('슬롯을 세워도 있던 셋의 행동이 안 바뀐다', async () => {
  const 등록소 = 검색슬롯세우기();
  const search = makeWebSearch({
    providers: 등록소.드라이버(SEARCH_SLOT),
    fetchImpl: async (url) => (String(url).includes('duckduckgo')
      ? { status: 200, text: async () => '<a class="result__a" href="https://a.example/1">가</a>' }
      : { status: 500, text: async () => '' }),
  });
  const out = await search.search('시험');
  assert.equal(out.state, 'ok');
  assert.equal(out.provider, 'duckduckgo', '첫 층이 되면 아래로 안 간다(오너 결정: 위에서 되면 아래로 안 간다)');
});

test('아무도 안 붙인 슬롯은 정직하게 빈손이다 — 없는 드라이버를 지어내지 않는다', () => {
  const 등록소 = makeSlotRegistry();
  등록소.슬롯세우기({ id: 'cu', 계약: ['id', 'run'] });
  assert.deepEqual(등록소.드라이버('cu'), []);
  assert.deepEqual(등록소.슬롯목록(), ['cu']);
});

// ── **배선까지 이어지는가** — 슬롯이 서 있어도 손이 안 쓰면 여전히 이음매다 ──────
//
// 이게 이 슬라이스의 진짜 자리다. 예전 `web-search.js` 도 `deps.providers ?? [셋]` 으로
// **인자 자리는 열려 있었다.** 그런데 호출부가 아무도 안 넘겨서 결국 그 파일의 배열을
// 고쳐야 했다. 그러니 "슬롯이 있다"가 아니라 **"손이 슬롯에서 받는다"** 를 재야 한다.
test('네 번째를 기본 등록소에 붙이면 **실제 손**이 그것을 쓴다', async () => {
  const { 검색등록소, SEARCH_SLOT: 슬롯 } = await import('../src/runtime/search-slot.js');
  const { makeWebSearchTool } = await import('../src/runtime/web-search-tool.js');

  검색등록소().붙이기(슬롯, {
    id: '시험검색기', label: '시험', needs: ['시험키'],
    async run(query) { return [{ title: `시험: ${query}`, url: 'https://시험.example/1', snippet: '' }]; },
  });

  // 앞 셋은 전부 실패시키고, 네 번째가 자기 조건을 갖췄을 때만 도는지 본다.
  const 손 = makeWebSearchTool({
    fetchImpl: async () => ({ status: 500, text: async () => '' }),
    // `needs` 로 밝힌 값은 `makeWebSearch` 의 deps 로 흘러야 한다.
    searchProviders: 검색등록소().드라이버(슬롯),
  });
  const 조건없이 = await 손.handler({ query: '오늘 코스피' });
  assert.equal(조건없이.blocked, true, '조건이 없는데 돌았다');

  const { makeWebSearch } = await import('../src/runtime/web-search.js');
  const 조건있이 = await makeWebSearch({
    providers: 검색등록소().드라이버(슬롯),
    시험키: 'v',
    fetchImpl: async () => ({ status: 500, text: async () => '' }),
  }).search('오늘 코스피');
  assert.equal(조건있이.provider, '시험검색기', '기본 등록소에 붙였는데 손이 안 썼다 — 아직 이음매다');
});

test('아무도 안 붙은 채로 조용히 돌지 않는다 — 빈손을 정상으로 넘기지 않는다', async () => {
  const { makeSlotRegistry } = await import('../src/kernel/l2-plan/slot-registry.js');
  const { 검색드라이버, SEARCH_SLOT: 슬롯 } = await import('../src/runtime/search-slot.js');
  const 빈것 = makeSlotRegistry().슬롯세우기({ id: 슬롯, 계약: ['id', 'run', 'needs'] });
  assert.throws(() => 검색드라이버(빈것), /0개/,
    '드라이버가 0개인데 그냥 돌면 "검색이 원래 안 되나 보다"가 된다 — 없는 한계를 지어내는 자리');
});

// **읽는 손도 슬롯에서 받는다.**
//
// 돌연변이가 여기서 빠져나갔다 — `web-collector` 의 슬롯 배선을 지워도 위 검사들이 전부
// 초록이었다. 내가 **찾는 손만 재고 읽는 손을 안 쟀기** 때문이다.
// `web.collect` 는 주소가 없으면 스스로 찾아서 읽는 손이라 **자기 검색기를 따로 든다.**
// 한쪽만 슬롯에서 받으면 "붙였는데 한쪽에서만 돈다"가 된다(§4.6 — 안 무는 그물은 신호다).
test('읽는 손이 주소 없이 찾을 때도 슬롯의 드라이버를 쓴다', async () => {
  const { 검색등록소, SEARCH_SLOT: 슬롯 } = await import('../src/runtime/search-slot.js');
  const { makeWebCollector } = await import('../src/runtime/web-collector.js');

  검색등록소().붙이기(슬롯, {
    id: '읽기시험검색기', label: '시험', needs: [],
    async run() { return [{ title: '슬롯이 준 곳', url: 'https://slot.example/page', snippet: '' }]; },
  });

  const 열어본곳 = [];
  const c = makeWebCollector({
    // 앞 셋은 전부 죽이고(무키 층이 실패), 슬롯의 네 번째만 살린다.
    fetchImpl: async (u) => {
      열어본곳.push(u);
      if (String(u).includes('slot.example')) {
        return { status: 200, url: u, headers: { get: () => 'text/html' }, text: async () => '<title>슬롯</title><article>슬롯이 준 페이지 본문입니다.</article>' };
      }
      return { status: 500, url: u, headers: { get: () => null }, text: async () => '' };
    },
  });
  const out = await c.handler({ request: '오늘 코스피 지수' });
  assert.ok(열어본곳.some((u) => String(u).includes('slot.example')),
    `읽는 손이 슬롯의 드라이버를 안 썼다 — 연 곳: ${JSON.stringify(열어본곳)}`);
  assert.equal(out.result?.title, '슬롯');
});

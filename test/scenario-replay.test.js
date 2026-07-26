// 멀티턴 시나리오 재생 — **흐름 이해의 게이트** (절대 원칙 §0).
//
// 왜 이 파일이 필요한가: 오너 실사용에서 나온 실패가 전부 "발화 이해·흐름 이해"였는데, 그 시점
// 자동 테스트 643건은 모두 통과였다. 안전·경계는 643개로 검사하면서 이해·흐름은 0개로 검사했다.
// 단발 테스트로는 흐름 실패를 못 잡는다 — 두 턴 이상 이어봐야 보인다.
//
// **무엇을 검사하는가**: 문장 품질을 채점하지 않는다(그건 모델의 몫이고 비결정적이다).
// 런타임이 모델에게 **무엇을 사실로 줬는가**만 본다 — §0 이 정한 런타임의 역할 ①이 그것이다.
// 오너 실패 다섯 건이 전부 "사실을 안 줬거나 틀리게 준" 실패였다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { recentTurns } from '../src/kernel/l1-intent/conversation.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

/**
 * 대화를 여러 턴 이어 돌리고, **매 턴 모델에게 간 사실(TaskContext)** 을 모은다.
 * 모델은 각본대로 답한다 — 우리가 검사할 것은 모델의 문장이 아니라 우리가 준 재료다.
 */
async function replay(turns, { tools, env = demoEnv(), modelSupportsSearch = true } = {}) {
  const seen = [];      // 턴마다 모델이 받은 TaskContext
  const results = [];   // 턴마다 결과
  const transcript = [];
  const ctx = {
    env,
    tools: tools ?? demoTools(),
    modelSupportsSearch,
    model: {
      async respond(tc, opts = {}) {
        seen.push({ tc, tools: opts.tools?.map((t) => t.name) ?? [], search: opts.search });
        const script = turns[results.length]?.model;
        const step = typeof script === 'function' ? script(seen.length) : script;
        if (step?.toolCalls?.length && opts.tools?.length && !step.used) {
          step.used = true;
          return { text: '', toolCalls: step.toolCalls };
        }
        return opts.tools?.length ? { text: step?.text ?? '네', toolCalls: [] } : (step?.text ?? '네');
      },
    },
  };
  for (const turn of turns) {
    ctx.recentTurns = recentTurns(transcript);
    const r = await runTurn({ text: turn.user }, ctx);
    results.push(r);
    transcript.push({ role: 'user', text: turn.user });
    transcript.push({ role: 'assistant', result: r });
    // 서버가 하는 일과 같게 — 다음 턴이 이어받을 상태를 넘긴다.
    if (r.goal) ctx.activeGoal = r.goal;
    if (r.workingState) ctx.workingState = r.workingState;
  }
  return { seen, results, transcript };
}

const webReading = (title, url, markdown) => ({
  sourceLedgerRequired: true,
  async handler() {
    return {
      result: { title, markdown, excerpt: markdown.slice(0, 80) },
      sources: [{ sourceUrl: url, title, excerpt: markdown.slice(0, 80), confidence: 0.6 }],
      userSafeSummary: `공개 자료로 확인했어요: ${title}.`,
    };
  },
});

// ── 시나리오 1: 오늘 날씨 (오너 실패 — 두 번 되묻고 1분 52초) ────────────
// 실패의 실체는 규칙이 아니라 **사실 부족**이었다. 지금·어디인지를 안 주고 되묻지 말라고만 했다.
test('시나리오: "오늘 날씨" — 지금·시간대·스스로 찾을 수 있음이 첫 턴부터 사실로 간다', async () => {
  const { seen } = await replay([{ user: '오늘 날씨 좀 알려줄래?', model: { text: '서울 기준으로…' } }]);
  const tc = seen[0].tc;
  assert.ok(tc.now?.local, '"오늘"이 언제인지 모르면 되묻는다');
  assert.ok(tc.now?.timeZone, '어디인지 모르면 지역을 되묻는다');
  assert.equal(tc.nativeSearch, true, '스스로 찾을 수 있다는 사실을 모르면 "못 한다"고 답한다');
  assert.equal(seen[0].search, true, '찾을 수 있게 켜 준다');
});

// ── 시나리오 2: 도구가 막혀도 대화가 끊기지 않는다 (오너 실패 — 빈 답 4회) ──
test('시나리오: 웹이 막혀도 빈 답이 아니고, 다음 길이 사실로 간다', async () => {
  const blocked = {
    sourceLedgerRequired: true,
    async handler() {
      return { blocked: true, fetchState: 'robots_disallow', userSafeSummary: '그 사이트가 수집을 허용하지 않아요.', nextSafeAction: '아는 범위로 답할까요?' };
    },
  };
  const { seen, results } = await replay(
    [{ user: 'https://x.example 분석해줘', model: { toolCalls: [{ name: 'web.collect', args: { request: 'https://x.example' } }], text: '아는 범위로 정리했어요.' } }],
    { tools: demoTools({ webCollector: blocked }) },
  );
  assert.ok((results[0].reply ?? '').trim().length > 0, '빈 답은 먹통으로 겪는다');
  const finalTc = seen.at(-1).tc;
  assert.match(finalTc.recoveryHint ?? '', /찾아볼게요|붙여 주시면|다시 한 번/, '막혔으면 다음 길을 사실로 준다');
});

// ── 시나리오 3: 현재 대상 유지 (오너 실패 — 팔식당 → 책 리뷰 요약) ────────
// **이 시나리오가 이 파일의 핵심이다.** 두 번째 턴에서 "리뷰"는 첫 턴에서 읽은 그 페이지의
// 리뷰다. T5 가 그걸 자기 상태로 알아야 한다 — 모델 추론에만 기대면 이번처럼 엉뚱한 걸 읽는다.
test('시나리오: 페이지를 읽은 다음 턴에, 그 자료가 현재 대상으로 이어진다', async () => {
  const tools = demoTools({
    webCollector: webReading('팔식당 : 네이버 지도', 'https://m.place.naver.com/restaurant/1747125291/home', '팔식당 · 청담동 · 돼지고기구이 · 발렛파킹'),
  });
  const { seen } = await replay([
    {
      user: 'https://map.naver.com/p/entry/place/1747125291 여기 분석해줘',
      model: { toolCalls: [{ name: 'web.collect', args: { request: 'https://map.naver.com/p/entry/place/1747125291' } }], text: '팔식당은 청담동 고깃집이에요.' },
    },
    { user: '리뷰 내용들 읽어보고 주요 내용 열가지만 알려줘.', model: { text: '리뷰 정리했어요.' } },
  ], { tools });

  // 두 번째 턴에서 모델이 받은 사실에 **직전에 읽은 자료**가 있어야 한다.
  const secondTurnTc = seen.find((s, i) => i > 0 && s.tc.currentRequest?.includes('리뷰'))?.tc;
  assert.ok(secondTurnTc, '두 번째 턴이 모델까지 갔는지');
  const facts = JSON.stringify(secondTurnTc.workingState ?? {});
  assert.match(facts, /팔식당/, '방금 읽은 자료가 현재 대상으로 이어져야 "리뷰"가 무엇인지 안다');
  assert.match(facts, /m\.place\.naver\.com/, '어느 페이지였는지도 사실로 남아야 그 페이지의 리뷰로 간다');
});

// 위 시나리오는 "사실이 갔는가"까지만 봤다. 라이브는 그걸 통과하고도 실패했다 — 모델은 리뷰 주소를
// 정확히 골랐는데 **실행부가 그 인자를 버리고 발화 원문을 검색**했기 때문이다("리뷰 내용들 읽어보고…"
// → 책 리뷰 쓰는 방법 블로그). 그래서 한 칸 더 본다: **모델이 고른 대로 실행됐는가.**
test('시나리오: 모델이 고른 주소 그대로 읽는다(발화 원문으로 되돌아가지 않는다)', async () => {
  const REVIEW = 'https://m.place.naver.com/restaurant/1747125291/review/visitor';
  const seenArgs = [];
  const webCollector = {
    sourceLedgerRequired: true,
    async handler(args) {
      seenArgs.push(args);
      const url = /^https?:/.test(args?.request ?? '') ? args.request : 'https://search.example/?q=' + encodeURIComponent(args?.request ?? '');
      return {
        result: { title: '팔식당 방문자 리뷰', markdown: '리뷰 본문', links: [] },
        sources: [{ sourceUrl: url, title: '팔식당 방문자 리뷰', excerpt: '리뷰 본문', confidence: 0.6 }],
        userSafeSummary: '읽었어요.',
      };
    },
  };
  await replay([
    {
      user: 'https://map.naver.com/p/entry/place/1747125291 여기 분석해줘',
      model: { toolCalls: [{ name: 'web.collect', args: { request: 'https://map.naver.com/p/entry/place/1747125291' } }], text: '팔식당은 청담동 고깃집이에요.' },
    },
    {
      user: '리뷰 내용들 읽어보고 주요 내용 열가지만 알려줘.',
      model: { toolCalls: [{ name: 'web.collect', args: { request: REVIEW } }], text: '리뷰 정리했어요.' },
    },
  ], { tools: demoTools({ webCollector }) });

  assert.equal(seenArgs.at(-1)?.request, REVIEW,
    '모델이 고른 주소를 버리고 발화 원문을 넘기면, 그 문장을 검색해 엉뚱한 글을 읽는다');
});

// ── 시나리오 4: 범위 밖 요청 (오너 실패 — 내부 문구가 화면에 찍힘) ────────
test('시나리오: 작업 폴더 밖을 물으면 내부 문구 대신 넓히자는 제안이 간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-scn-'));
  await writeFile(join(dir, '안.md'), '내용');
  const { seen, results } = await replay(
    [{ user: '내 컴퓨터 로컬의 디벨로퍼 폴더에 뭐가 있는지 알려줄래?', model: { toolCalls: [{ name: 'local.file', args: { action: 'list', path: '../../../Developer' } }], text: '아직 그 폴더는 못 봐요.' } }],
    { tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }) },
  );
  const shown = JSON.stringify({ reply: results[0].reply, next: results[0].nextSafeAction });
  assert.ok(!shown.includes('실패 시 무엇이 안전하고'), '내부 계획 문구가 사용자에게 가면 안 된다');
  assert.match(seen.at(-1).tc.recoveryHint ?? '', /작업 범위에 넣어 주시면/, '되는 방법을 사실로 준다');
});

// ── 시나리오 5: 가진 것을 안다 (오너 실패 — "세션 못 찾아요") ─────────────
test('시나리오: 지난 대화를 찾는 손이 매 턴 자기 능력으로 보인다', async () => {
  const { seen } = await replay([{ user: '내가 전에 물어본 그 대화 찾을 수 있어?', model: { text: '찾아볼게요.' } }]);
  assert.ok(seen[0].tools.includes('session.search'), '가진 것을 모르면 "못 한다"고 답한다');
  assert.match(JSON.stringify(seen[0].tc.selfStateFacts), /지난 대화 찾기|session/, '자기 능력에 들어 있어야 한다');
});

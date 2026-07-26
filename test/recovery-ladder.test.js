// P2-6 · 되게 만드는 사다리 — T5 의 최우선 미션은 **지시를 최대한 수행하는 것**이다.
//
// 오너 지시(2026-07-27): "된다/안 된다"만 말하지 마라. ① 가진 도구로 되는 방법을 찾고
// ② 못 하는 부분은 대안을 제시해라. 네이버 하나 모바일로 뚫은 건 로봇이다.
//
// 실사용에서 나온 실패들:
//   · 네이버 지도 차단 → 빈 답 네 번(대안 없음)
//   · "디벨로퍼 폴더 봐줘" → 범위 밖 → 내부 문구가 화면에 찍힘(대안 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextRung, rungMessage } from '../src/kernel/l2-plan/recovery-ladder.js';
import { runTurn } from '../src/kernel/turn.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

// ── 어떤 계단으로 갈지 ────────────────────────────────────────────────────
test('사이트가 막았으면 다른 경로(모델 검색)로 이어간다', () => {
  const step = nextRung([{ failureState: 'blocked', fetchState: 'robots_disallow' }]);
  assert.equal(step.rung, 'other_tool');
  assert.equal(step.useModelSearch, true);
  assert.match(rungMessage(step), /대신 제가 아는 경로로 찾아볼게요/);
});

test('로그인이 필요하면 사람만 할 수 있는 최소 단계를 부탁한다', () => {
  const step = nextRung([{ failureState: 'blocked', fetchState: 'login_wall' }]);
  assert.equal(step.rung, 'ask_user');
  assert.match(rungMessage(step), /붙여 주시면 이어서/);
});

test('범위 밖이면 **범위를 넓히자고 제안**한다(그냥 실패로 끝내지 않는다)', () => {
  const step = nextRung([{ failureState: 'blocked', scopeState: 'out_of_scope' }]);
  assert.equal(step.rung, 'ask_user');
  assert.equal(step.requestScope, true);
  assert.match(rungMessage(step), /작업 범위에 넣어 주시면/);
});

test('성공한 실행에는 계단이 없다(멀쩡한 답에 사족 금지)', () => {
  assert.equal(nextRung([{ failureState: 'none' }]), null);
  assert.equal(nextRung([]), null);
  assert.equal(rungMessage(null), undefined);
});

// ── 턴 관통: 막혀도 다음 길이 함께 간다 ──────────────────────────────────
test('관통: 범위 밖 요청에 내부 문구 대신 "범위를 넓힐까요?"가 간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-ladder-'));
  let sawHint;
  const model = {
    async respond(tc, opts = {}) {
      if (opts.tools?.length && !sawHint) {
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: '../../..' } }] };
      }
      sawHint = tc.recoveryHint;
      return { text: '작업 폴더 밖이라 아직 못 봤어요.', toolCalls: [] };
    },
  };
  const r = await runTurn({ text: '디벨로퍼 폴더에 뭐 있는지 봐줘' }, {
    env: demoEnv(), model, tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
  });
  assert.equal(r.kind, 'reply');
  // **도구가 남긴 말이 먼저다.** 예전엔 사용자에겐 도구 문장이, 모델에겐 사다리 문구가 가서
  // 같은 턴에 두 말이 돌았다(두 진실). 이제 하나다 — 검사할 것은 문장이 아니라 계약이다:
  // "되는 방법이 사실로 갔는가". 도구는 자기가 왜 막혔는지 더 정확히 안다.
  assert.match(sawHint ?? '', /폴더|범위/, '모델에게 다음 길을 사실로 줘야 한다');
  assert.doesNotMatch(sawHint ?? '', /실패 시 무엇이 안전하고/, '내부 계약 문구는 나가지 않는다');
  const shown = JSON.stringify({ reply: r.reply, next: r.nextSafeAction });
  assert.ok(!shown.includes('실패 시 무엇이 안전하고'), '내부 계획 문구가 나가면 안 된다');
});

test('관통: 우리 수집이 막히면 모델 내장 검색을 켜서 이어간다', async () => {
  let searchOnFinal = null;
  const blockedWeb = {
    sourceLedgerRequired: true,
    async handler() {
      return { blocked: true, fetchState: 'robots_disallow', userSafeSummary: '그 사이트가 수집을 허용하지 않아요.', nextSafeAction: '아는 범위로 답할까요?' };
    },
  };
  let first = true;
  const model = {
    async respond(_tc, opts = {}) {
      if (first) { first = false; return { text: '', toolCalls: [{ name: 'web.collect', args: { request: 'https://x.example' } }] }; }
      searchOnFinal = opts.search;
      return { text: '아는 범위로 정리했어요.', toolCalls: [] };
    },
  };
  const r = await runTurn({ text: 'https://x.example 분석해줘' }, {
    env: demoEnv(), model, tools: demoTools({ webCollector: blockedWeb }), modelSupportsSearch: true,
  });
  assert.equal(searchOnFinal, true, '막혔으면 모델이 자기 경로로 찾게 켜 준다');
  assert.ok((r.reply ?? '').trim().length > 0);
});

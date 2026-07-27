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

// 범위 밖은 **손이 있느냐에 따라 계단이 다르다.** 있으면 내가 이어서 하고(2단),
// 없을 때만 사용자에게 부탁한다(3단). 라이브에서 이걸 늘 3단으로 두는 바람에
// "폴더를 통째로 복사해 주세요"까지 갔다(c217a0c6) — 터미널로 읽을 수 있었는데도.
test('범위 밖 + 그 자리를 읽는 손이 있으면 **내가 다른 손으로 이어서** 한다', () => {
  const step = nextRung([{ failureState: 'blocked', scopeState: 'out_of_scope' }], ['local.terminal', 'local.file']);
  assert.equal(step.rung, 'other_hand');
  assert.match(rungMessage(step), /다른 손으로 이어서/);
  assert.doesNotMatch(rungMessage(step), /옮기|복사|넣어 주시면/, '손이 있는데 사용자를 시키면 떠넘김이다');
});

test('범위 밖인데 그 손이 없으면 **범위를 넓히자고 제안**한다(없는 손을 약속하지 않는다)', () => {
  for (const hands of [['local.file'], []]) {
    const step = nextRung([{ failureState: 'blocked', scopeState: 'out_of_scope' }], hands);
    assert.equal(step.rung, 'ask_user', `손 ${JSON.stringify(hands)}: 없는 손을 약속했다`);
    assert.equal(step.requestScope, true);
    assert.match(rungMessage(step), /작업 범위에 넣어 주시면/);
  }
});

test('손을 모르면 약속하지 않는다(모름은 있음이 아니다)', () => {
  const step = nextRung([{ failureState: 'blocked', scopeState: 'out_of_scope' }]);
  assert.equal(step.rung, 'ask_user', '손 목록을 안 준 호출부가 없는 손을 약속하면 안 된다');
});

test('성공한 실행에는 계단이 없다(멀쩡한 답에 사족 금지)', () => {
  assert.equal(nextRung([{ failureState: 'none' }]), null);
  assert.equal(nextRung([]), null);
  assert.equal(rungMessage(null), undefined);
});

// ── 턴 관통: 막혀도 다음 길이 함께 간다 ──────────────────────────────────
test('관통: 범위 밖 요청에 내부 문구 대신 되는 방법이 사실로 간다', async () => {
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
  // **문장을 외우지 않는다.** 계단은 그때 있는 손에 따라 달라진다(다른 손으로 / 범위를 넓혀 달라).
  // 검사할 것은 "무엇이 막혔고 다음이 무엇인지가 사실로 갔는가"다.
  assert.match(sawHint ?? '', /파일 도구|폴더|범위/, '모델에게 다음 길을 사실로 줘야 한다');
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

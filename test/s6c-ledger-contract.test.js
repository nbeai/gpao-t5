// **S6-c 그물 — 실행이 있었는데 원장에 없는 경우가 0이다.**
//
// §10 규율 12: 그물은 **이름·개수가 아니라 계약**을 잰다.
//   "원장 `append` 가 경계에서만 일어난다"(개수) ❌
//   → **"실행이 있었는데 원장에 없는 경우가 0이다"**(계약) ⭕
//
// 이 그물이 지키는 것은 절대 게이트 **"원장 ↔ 영수증 ↔ 실물 불일치 0"** 이다.
// 실행됐는데 원장에 없으면 감사도 사용자도 무슨 일이 있었는지 못 본다.
//
// ── 왜 캡슐이 표적인가 ────────────────────────────────────────────────────
// 캡슐은 손 하나로 보이지만 그 안에서 **여러 손이 실제로 돈다**(S4).
// `turn.js` 의 `원장` 래퍼가 그 안쪽 영수증을 풀어 올린다 — 그런데 그 래퍼는
// `executePlan` 스코프에만 있고 `runTurn` 은 `ledger` 를 직접 부르는 자리가 있다(1177).
// **원장 입구가 두 벌**이라는 뜻이다. 오늘은 그 자리가 차단 영수증이라 무해하지만,
// 무해한 이유가 **우연**이면 다음 변경에서 조용해진다 — S6-b 의 `break` 가 그랬다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

/** 실행된 것과 원장에 남은 것을 **같은 실행에서** 센다. */
async function 턴(모델, 손들 = {}) {
  const 실행된것 = [];
  const 원장에남은것 = [];
  const tools = demoTools({
    localFile: {
      async handler(a) {
        실행된것.push('local.file');
        return { result: { path: a?.path ?? '작업 폴더', items: [] } };
      },
    },
    ...손들,
  });
  const r = await runTurn({ text: '작업 폴더 좀 봐줘' }, {
    env: demoEnv(), tools, model: 모델, pending: new Map(),
    ledger: { append: (rec) => { 원장에남은것.push(rec); return rec; }, entries: [] },
  });
  return { r, 실행된것, 원장에남은것 };
}

const 한번부르는모델 = {
  async respond(_tc, opts = {}) {
    if (opts.tools?.length && !this.냈나) {
      this.냈나 = true;
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: '작업 폴더' } }] };
    }
    return '봤어요.';
  },
};

test('① 실행된 손은 **빠짐없이** 원장에 남는다', async () => {
  const { 실행된것, 원장에남은것 } = await 턴({ ...한번부르는모델, 냈나: false });
  assert.ok(실행된것.length > 0, '이 검사가 성립하려면 실제로 실행이 있어야 한다');
  const 원장의도구 = 원장에남은것
    .map((rec) => rec?.actualCall?.tool).filter(Boolean);
  for (const t of 실행된것) {
    assert.ok(원장의도구.includes(t),
      `실행됐는데 원장에 없다: ${t}\n원장: ${JSON.stringify(원장의도구)}\n`
      + '절대 게이트 "원장↔영수증↔실물 불일치 0" 이 무너진 것이다.');
  }
});

test('② **캡슐 안쪽 실행도 원장에 올라온다** — 손 하나로 보여도 안에서 여럿이 돌았다', async () => {
  const 캡슐결과 = {
    result: {
      ok: true,
      // 캡슐이 안에서 두 손을 돌렸다고 보고한다.
      innerReceipts: [
        { intended: '안쪽1', actualCall: { tool: 'local.file', args: {} }, failureState: 'none', userSafeSummary: '안쪽 1' },
        { intended: '안쪽2', actualCall: { tool: 'local.file', args: {} }, failureState: 'none', userSafeSummary: '안쪽 2' },
      ],
    },
  };
  const 모델 = {
    async respond(_tc, opts = {}) {
      if (opts.tools?.length && !this.냈나) {
        this.냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.capsule', args: { code: 'x' } }] };
      }
      return '했어요.';
    },
    냈나: false,
  };
  const { 원장에남은것 } = await 턴(모델, {
    capsule: { async handler() { return 캡슐결과; } },
  });
  const 요약들 = 원장에남은것.map((r) => r?.userSafeSummary ?? '').join(' | ');
  assert.match(요약들, /안쪽 1/,
    `캡슐 안쪽 실행이 원장에서 사라졌다 — 손 하나만 남고 안에서 돈 것은 조용해진다:\n  ${요약들}`);
  assert.match(요약들, /안쪽 2/, '안쪽 영수증이 일부만 올라왔다');
});

test('③ **막힌 것도 원장에 남는다** — 안 한 일은 안 한 대로 기록된다', async () => {
  const 막는손 = {
    localFile: {
      async approvalEligibility() {
        return { allowed: false, userSafeSummary: '지금은 못 해요.', nextSafeAction: '나중에 다시.' };
      },
      async handler() { throw new Error('실행되면 안 된다'); },
    },
  };
  const { 원장에남은것 } = await 턴({ ...한번부르는모델, 냈나: false }, 막는손);
  const 막힌것 = 원장에남은것.filter((r) => (r?.failureState ?? 'none') !== 'none');
  assert.ok(막힌것.length > 0,
    `막혔는데 원장에 아무것도 없다 — 사용자도 감사도 왜 안 됐는지 못 본다:\n  ${
      JSON.stringify(원장에남은것.map((r) => r?.intended))}`);
});

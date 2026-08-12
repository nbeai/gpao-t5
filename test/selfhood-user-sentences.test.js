// **Selfhood 를 상태 필드가 아니라 사용자 문장으로 잰다.**
//
// 지금까지 셀프후드 검사는 "정체 사실이 프롬프트에 실렸는가"를 쟀다(`operational-selfhood`).
// 그건 **재료가 갔는가**이지 **말귀가 통했는가**가 아니다. 오너 기준은 뒤엣것이다 —
// 대화는 입구이지 성취가 아니고, 사용자 문장 하나가 다르게 끝나야 닫힌다.
//
// 그래서 여기서는 사용자가 실제로 던지는 세 문장을 턴으로 돌리고, **모델이 무엇을 받는가**를
// 잰다. 답 문구는 재지 않는다 — 문구를 재면 대필이 되고, 모델마다 다른 답이 전부 실패가 된다.
// 재는 것은 하나다: **그 문장에 답하는 데 필요한 사실이 모델에게 실제로 갔는가.**
//
//   ① "너 지금 뭘 할 수 있어?"  → 지금 이 컴퓨터에서 **실제로 쓸 수 있는 손**이 간다
//   ② "노션 볼 수 있어?"        → 안 이어진 것을 **없다고도 된다고도 하지 않을** 재료가 간다
//   ③ 재시작 뒤 "아까 그거 이어서" → 앞 턴에 **무엇을 했는지**가 남아 있다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools, demoDescriptors } from '../src/surface/demo-context.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/** 모델이 그 턴에 받은 칸을 전부 모아 돌려준다 — 재는 것은 답이 아니라 **받은 재료**다. */
function 받아쓰는모델(답 = '네.') {
  const 받은것 = [];
  return {
    받은것,
    model: {
      async respond(tc, opts = {}) {
        받은것.push({ tc, opts });
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
        return 답;
      },
    },
  };
}

// ── ① "너 지금 뭘 할 수 있어?" ─────────────────────────────────────────────
//
// **도구 id 를 재지 않는다.** 모델이 받는 것은 `readyTools` — 사람이 부르는 이름이다.
// 그게 맞다: 모델은 사용자에게 "local.file 을 쓸 수 있어요"라고 말하면 안 된다.
// 재는 것은 **지금 실제로 쓸 수 있는 것과 못 쓰는 것이 갈려서 오는가**이다.
test('"너 지금 뭘 할 수 있어?" — **지금 쓸 수 있는 손**이 사람 이름으로 간다', async () => {
  const { 받은것, model } = 받아쓰는모델('파일을 다룰 수 있어요.');
  await runTurn({ text: '너 지금 뭘 할 수 있어?' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({}), model,
  });
  const 사실 = 받은것.map((x) => x.tc?.selfStateFacts).find(Boolean);
  assert.ok(사실, '자기상태 사실이 아예 안 갔다 — 모델은 능력을 지어내야 한다');
  assert.ok((사실.readyTools ?? []).length > 0,
    `지금 쓸 수 있는 손이 하나도 안 갔다: ${JSON.stringify(사실)}`);
  assert.ok(사실.readyTools.every((t) => !/^[a-z_]+\.[a-z_]+$/.test(t)),
    `도구 id 가 그대로 갔다 — 모델이 그것을 사용자에게 옮겨 적는다: ${JSON.stringify(사실.readyTools)}`);
});

test('"뭘 할 수 있어?" — **못 쓰는 손은 쓸 수 있는 칸에 섞이지 않는다**', async () => {
  const { 받은것, model } = 받아쓰는모델();
  await runTurn({ text: '너 지금 뭘 할 수 있어?' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({}), model,
  });
  const 개수 = 받은것.map((x) => x.tc?.capabilityCounts).find(Boolean);
  const 사실 = 받은것.map((x) => x.tc?.selfStateFacts).find(Boolean);
  assert.ok(개수, '능력 개수 요약이 안 갔다');
  assert.equal(사실.readyTools.length, 개수.ready,
    `쓸 수 있다고 센 수와 실제로 실은 손 수가 다르다 — 둘 중 하나는 거짓이다: ${JSON.stringify({ 개수, 사실 })}`);
  assert.ok(개수.blocked >= 0 && 개수.ready + 개수.blocked > 0,
    '막힌 손이 아예 안 세어지면 "왜 못 하는지"를 모델이 말할 수 없다');
});

test('능력을 물으면 **상세**가 실리고, 평범한 부탁에는 안 실린다(상시 입력을 무겁게 하지 않는다)', async () => {
  const 물음 = 받아쓰는모델();
  await runTurn({ text: '너 뭘 할 수 있어?' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }), tools: demoTools({}), model: 물음.model,
  });
  const 부탁 = 받아쓰는모델();
  await runTurn({ text: '오늘 날씨 어때?' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }), tools: demoTools({}), model: 부탁.model,
  });
  const 길이 = (x) => JSON.stringify(x.받은것.map((y) => y.tc)).length;
  assert.ok(길이(물음) > 길이(부탁),
    `능력 물음과 잡담이 같은 무게로 간다 — 상세가 항상 실리면 매 턴이 비싸진다(${길이(물음)} vs ${길이(부탁)})`);
});

// ── ② "노션 볼 수 있어?" — 안 이어진 것 ────────────────────────────────────
//
// 여기가 셀프후드의 진짜 자리다. 안 이어진 것을 두고 T5 는 두 가지 거짓 중 하나로 갔다:
//   · "볼 수 있어요" (없는 손을 약속)  · "못 봐요" (이을 수 있는데 없다고 단정)
// 런타임이 정할 일이 아니다. **이어진 손 목록과 이을 수 있다는 사실**을 주면 모델이 답한다.
test('"노션 볼 수 있어?" — 없는 손을 **쓸 수 있는 칸에 지어 넣지 않는다**', async () => {
  const { 받은것, model } = 받아쓰는모델('노션은 아직 안 이어져 있어요.');
  await runTurn({ text: '노션 볼 수 있어?' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }), tools: demoTools({}), model,
  });
  const 사실 = 받은것.map((x) => x.tc?.selfStateFacts).find(Boolean);
  assert.ok(사실, '자기상태 사실이 안 갔다');
  assert.ok(사실.readyTools.every((t) => !/노션|notion/i.test(t)),
    `안 이어진 것이 쓸 수 있는 손으로 갔다 — 모델은 그것을 약속하게 된다: ${JSON.stringify(사실.readyTools)}`);
  // **"못 한다"고 단정할 재료도 주지 않는다.** 이을 수 있는지는 연결 사실이 말한다 —
  // 런타임이 "노션은 안 돼요"를 정해 버리면 그건 모델 대신 판단한 것이다.
  const 연결 = 받은것.map((x) => x.tc?.connectionAdmission ?? x.tc?.externalReality).find(Boolean);
  assert.ok(연결 !== undefined, '이을 수 있는지에 대한 사실이 아예 없다 — 모델은 단정하거나 지어낸다');
});

test('없는 손을 모델이 골라도 **조용히 사라지지 않는다**(사실로 남는다)', async () => {
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !this.냈나) {
        this.냈나 = true;
        return { text: '', toolCalls: [{ providerCallId: 'n1', name: 'notion.search', args: { query: '회의록' } }] };
      }
      return '노션은 아직 못 봐요.';
    },
  };
  const r = await runTurn({ text: '노션에서 회의록 찾아줘' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }), tools: demoTools({}), model,
  });
  const 전문 = JSON.stringify(r?.ledger ?? {});
  assert.match(전문, /notion|이어져|연결|없/,
    `없는 손 호출이 흔적 없이 사라졌다 — 모델은 자기가 무엇을 시도했는지 모른다: ${전문.slice(0, 300)}`);
});

// ── ③ 재시작 뒤 "아까 그거 이어서" ─────────────────────────────────────────
//
// S2 필수 계약 ②. 앞 턴의 **도구 대화**가 남지 않으면 재시작 뒤 모델은 자기가 방금 무엇을
// 했는지 모른다 — 그건 기억상실이고, 셀프후드가 그 위에 설 수 없다.
test('재시작 뒤 "아까 그거 이어서" — 앞 턴에 **무엇을 했는지**가 모델에게 온다', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'selfhood-restart-')));
  await writeFile(join(dir, '정산.csv'), '단가,수량\n1000,2\n');
  const 받은칸 = [];
  // **둘째 판 모델은 손을 쓰지 않는다.** 다시 읽어 버리면 `turnExchange` 가 이번 턴 영수증에서
  // 채워져 검사가 헛돈다(실측 2026-08-04 — 첫 판은 정확히 그렇게 통과했다).
  // 앞 턴 기록이 살아 있어야만 통과하게 만든다.
  const 만들기 = (손쓸까) => ({
    async respond(tc, opts = {}) {
      받은칸.push(tc);
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (손쓸까 && opts.tools?.length && !this.냈나) {
        this.냈나 = true;
        return { text: '', toolCalls: [{ providerCallId: 'r1', name: 'local.file', args: { action: 'read', path: join(dir, '정산.csv') } }] };
      }
      return '읽었어요.';
    },
  });
  const 세우기 = async (손쓸까) => {
    const server = makeServer({
      store: new SessionStore(dir),
      env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
      tools: new ToolRunner({ 'local.file': makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
      descriptors: demoDescriptors({ include: ['local.file'] }),
      model: 만들기(손쓸까), modelTimeoutMs: 0, processEnv: { GPAO_T5_TCELL: 'off' },
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const 주소 = `http://127.0.0.1:${server.address().port}`;
    return {
      server,
      부르기: async (경로, 몸) => (await fetch(`${주소}${경로}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(몸 ?? {}),
      })).json(),
    };
  };

  const 첫판 = await 세우기(true);
  let 세션;
  try {
    세션 = (await 첫판.부르기('/sessions')).id;
    await 첫판.부르기('/turn', { sessionId: 세션, text: '정산.csv 읽어줘' });
  } finally {
    await new Promise((r) => 첫판.server.close(r));
  }

  // **여기가 재시작이다.** 새 서버·새 스토어 — 같은 폴더에서 다시 읽어 올린다.
  받은칸.length = 0;
  const 둘째판 = await 세우기(false);
  try {
    await 둘째판.부르기('/turn', { sessionId: 세션, text: '아까 그거 이어서 정리해줘' });
  } finally {
    await new Promise((r) => 둘째판.server.close(r));
  }

  const 전문 = JSON.stringify(받은칸);
  assert.match(전문, /정산\.csv/,
    '재시작 뒤 모델이 앞 턴에 무엇을 했는지 모른다 — 기억상실 위에는 셀프후드가 못 선다');
  // E1(4단계 · PM 승인 2026-08-09): 앞 턴 대화는 이번 턴 규약 메시지(turnExchange)가 아니라
  // **시제가 박힌 구조 밭**(priorExchange — 도구·인자·신분을 가진 같은 급 구조)으로 온다.
  // 규약 재생은 시제가 없어 "방금 부른 호출"로 서고, 그 위에서 원장-0 현재형 서사가 났다
  // (기준선 14/18 → E1 0/3). 검사의 뜻은 그대로다 — 서술이 아니라 구조로 와야 한다.
  assert.ok(받은칸.some((tc) => [...(tc?.turnExchange ?? []), ...(tc?.priorExchange ?? [])]
    .some((x) => x?.tool === 'local.file')),
    `앞 턴의 **도구 대화**가 서술로만 남고 구조로 안 왔다: ${전문.slice(0, 400)}`);
});

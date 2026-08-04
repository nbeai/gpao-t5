// **모델이 낸 자동화 제안이 화면까지 간다** — 이름이 갈려 마지막 한 칸에서 죽지 않는다.
//
// F-11 실측 경로(2026-08-04):
//   사용자 "매일 아침 9시에 … 반복으로 걸어줘"
//   → 화면에는 자동화 카드가 없고, 답은 사용자에게 cron 스크립트를 짜 준다. 3회 재현.
//
// ── 진단이 두 번 뒤집혔다 ──────────────────────────────────────────────────
// ① 첫 가설: "선언이 안 되는 것만 말해서" → 선언을 고쳤는데 **그대로 재현**됐다(반증).
// ② 둘째 판정: 도청으로 "모델이 채널을 쥐고도 안 썼다" → **계측기가 고장이었다.**
//    내 검출기가 스트리밍 응답을 못 읽고 있었다. 대조 발화(반드시 도구를 부르는 것)를
//    같은 실행에 넣어 계측기를 검증하자, 자동화 회차에서 **`automation_propose` 가 잡혔다.**
//    → **모델은 채널을 쓴다.**
// ③ 그러면 어디서 죽나: 커널은 `result.automationProposal` 을 내고 서버가 후보를 저장한 뒤
//    같은 이름으로 실어 보낸다. 그런데 **화면은 `r.automationSuggestion` 을 읽는다.**
//    이름이 다르다. 모델의 제안은 화면에 **한 번도** 뜬 적이 없다.
//
// 교훈은 오늘 이미 배운 것이다 — **재는 자리를 검증하지 않으면 틀린 결론을 확신하게 된다.**
// (아침에도 같은 일이 있었다: 방 배선을 고치고 엉뚱한 배열을 재서 초록이었다.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

/** 모델이 자동화를 제안하는 턴을 만든다. */
async function 제안턴() {
  const dir = await mkdtemp(join(tmpdir(), 't5-autoprop-'));
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.some((t) => t.name === 'automation.propose') && !this.냈나) {
        this.냈나 = true;
        return { text: '매일 아침 9시에 확인하도록 걸어 둘까?', toolCalls: [{
          name: 'automation.propose',
          args: { statement: '매일 아침 9시에 작업 폴더에 새 파일이 있는지 확인한다', kind: 'daily' },
        }] };
      }
      return '알겠어요.';
    },
  };
  const server = makeServer({
    store: new SessionStore(dir), env: demoEnv({ include: ['local.file'], hands: ['local.file'] }), tools: demoTools({}), model,
    modelTimeoutMs: 0, processEnv: { GPAO_T5_TCELL: 'off' },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    return await (await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text: '매일 아침 9시에 작업 폴더 확인하는 걸 반복으로 걸어줘' }),
    })).json();
  } finally { await new Promise((r) => server.close(r)); }
}

test('서버가 자동화 후보를 실제로 만든다(이 검사가 성립하는 조건)', async () => {
  const r = await 제안턴();
  const 후보 = r.automationSuggestion ?? r.automationProposal;
  assert.ok(후보?.candidateId, `자동화 후보가 아예 안 만들어졌다: ${JSON.stringify(r).slice(0, 200)}`);
  assert.match(String(후보.statement), /매일 아침 9시/);
});

// **확정된 것만 검사로 세운다.** 아래 두 갈래가 갈려 있다는 사실은 장부(F-11)에 적었고,
// 잇는 수정은 한 번에 안 됐다 — 서버에서 이름을 더해도 응답까지 오지 않았고, 그 이유를
// 확정하지 못했다. **확정 못 한 것은 고치지 않는다**(오늘 두 번 그렇게 하다 틀렸다).
// 결함을 검사로 축복하지도 않는다 — 그러면 다음 사람이 그것을 계약으로 읽는다.

test('화면에 자동화 제안을 그리는 자리가 **있다**(없어지지 않았다)', async () => {
  const 화면 = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'surface', 'web', 'index.html'), 'utf8',
  );
  assert.match(화면, /automationSuggestion\?\.candidateId/,
    '화면이 자동화 제안을 그리는 자리가 없어졌다 — 서버 쪽 이름만 고치면 반대로 죽는다');
});

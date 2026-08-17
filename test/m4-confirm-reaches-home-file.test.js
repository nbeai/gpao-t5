// **배선 봉인 — 확인 승격이 집 파일까지 실제로 닿는다** (PM 표본 절단이 연 자리 2026-08-09).
//
// P0 실측: `/memory/confirm` 이 `memory.json` 에만 쓰고 집 파일(`기억.md`)에는 안 써서,
// 다음 턴의 집 동기화가 *"파일에 없으니 사용자가 지운 것"* 으로 읽고 지웠다 — 사용자가
// 확인 버튼을 눌러 맡긴 기억이 다음 턴에 조용히 사라진다(④ 가 판 역사 내내 못 선 뿌리).
//
// ⚠ 첫 봉인(m4-user-fact-memory 의 집 파일 검사)은 **단위 의미만** 물었다 — "파일에 없으면
// 지운다"는 참이지만, "confirm 이 실제로 파일에 쓴다"는 **배선**은 아무도 안 지켰다. PM 이
// `집파일에승격반영` 의 쓰기를 끊고 관련 7파일 164검사를 돌렸는데 전부 초록이었다.
// **봉인 없는 3/3 을 통과로 적지 않는다** — 그래서 이 파일은 사용자 경로 그대로 지난다:
//   씨앗 발화 → /memory/confirm → **집 파일에 그 항목 실재** → 다음 턴 뒤 **생존**.
// 반대시험 기준(PM 변이): `집파일에승격반영` 의 쓰기를 끊으면 이 검사가 빨개져야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoDescriptors } from '../src/surface/demo-context.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';

/** 씨앗 턴에 기억 채널을 부르는 대본 모델 — 사용자 경로와 같은 재료를 만든다. */
const 대본모델 = (statement) => ({
  async respond(tc, opts = {}) {
    if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
    if (opts.tools?.some((tool) => tool.name === 'control.select') && !this.냈나) return {
      text: '', toolCalls: [{ name: 'control.select', args: { categories: ['memory'] } }],
    };
    if (!this.냈나) {
      this.냈나 = true;
      return {
        text: '기억해 둘게.',
        toolCalls: [{
          name: 'memory.propose',
          args: {
            kind: 'user_fact',
            statement,
            // 자동 반영 경로로 새지 않게 — 요약 형태(인용과 불일치)라 **확인 카드 경로**를 탄다.
            evidence: { utteranceQuote: '밤마다 콜라 마시면서 넷플릭스 봐', speechAct: 'declaration', appliesTo: 'from_now_on' },
          },
        }],
      };
    }
    return '응.';
  },
});

test('확인 승격이 집 파일에 닿고 다음 턴에도 살아남는다 — 사용자 경로 그대로', async () => {
  const 문장 = '밤마다 콜라 마시면서 넷플릭스 봄';
  const HOME = await mkdtemp(join(tmpdir(), 'm4-wire-home-'));
  const 집 = join(HOME, 'GPAO-T5');          // agentHomeDir 의 기본 — 사용자가 보는 그 자리
  const 상태 = join(집, 'state');             // 같은 홈이어야 집 동기화가 짝으로 인정한다
  await mkdir(상태, { recursive: true });

  const server = makeServer({
    store: new SessionStore(상태),
    env: demoEnv({ include: [], hands: [] }),
    tools: new ToolRunner({}),
    descriptors: demoDescriptors({ include: [] }),
    model: 대본모델(문장),
    modelTimeoutMs: 0,
    processEnv: { HOME, GPAO_T5_TCELL: 'off' },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const 주소 = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${주소}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then((r) => r.json());
  const get = (p) => fetch(`${주소}${p}`).then((r) => r.json());
  const 집파일 = () => readFile(join(집, '기억.md'), 'utf8').catch(() => '');

  try {
    // ① 씨앗 — 사용자가 말하고, 후보가 생긴다.
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '나 요즘 밤마다 콜라 마시면서 넷플릭스 봐. 기억해 둬.' });
    const 후보들 = (await get('/memory')).candidates ?? [];
    assert.equal(후보들.length, 1, `확인 카드 후보가 안 생겼다: ${JSON.stringify(후보들)}`);

    // ② 사용자가 확인 버튼을 누른다(화면이 부르는 그 문).
    const 확인 = await post('/memory/confirm', { candidateId: 후보들[0].candidateId });
    assert.equal(확인.ok, true, `확인 승격이 실패했다: ${JSON.stringify(확인)}`);

    // ③ **배선** — 확인 직후 집 파일에 그 항목이 실재해야 한다. 여기가 P0 의 자리다.
    assert.match(await 집파일(), new RegExp(문장),
      '확인 승격이 집 파일에 안 쓰였다 — 다음 턴 동기화가 이것을 "사용자가 지웠다"로 읽는다(P0)');

    // ④ 다음 턴 뒤 **생존** — 동기화가 지우지 않았는가(사용자가 겪는 그 순간).
    await post('/turn', { sessionId: s.id, text: '고마워' });
    const 남은것 = (await get('/memory')).promoted ?? [];
    assert.ok(남은것.some((e) => e.statement === 문장),
      `확인한 기억이 다음 턴에 사라졌다 — 사용자가 맡긴 것을 제품이 조용히 지운다: ${JSON.stringify(남은것)}`);
    assert.match(await 집파일(), new RegExp(문장), '다음 턴 뒤 집 파일에서 사라졌다');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

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
async function 제안턴({ 열어둠 = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 't5-autoprop-'));
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.some((t) => t.name === 'automation.propose') && !this.냈나) {
        this.냈나 = true;
        return { text: '매일 아침 9시에 확인하도록 걸어 둘까?', toolCalls: [{
          name: 'automation.propose',
          args: { statement: '매일 아침 9시에 작업 폴더에 새 파일이 있는지 확인한다', kind: 'daily', tool: 'local.file' },
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
  const close = () => new Promise((r) => server.close(r));
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const r = await (await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text: '매일 아침 9시에 작업 폴더 확인하는 걸 반복으로 걸어줘' }),
    })).json();
    return { base, r, close };
  } finally { if (!열어둠) await close(); }
}

/** 사슬 전체를 한 번에 잰다 — 후보 생성 → 화면이 읽는 이름 → 설정 문이 연다. */
async function 사슬(base, r) {
  const 후보 = r.automationSuggestion ?? r.automationProposal;
  const setup = 후보?.candidateId
    ? await (await fetch(`${base}/automation/setup?candidateId=${후보.candidateId}`)).json()
    : { error: '후보 없음' };
  return { 후보, 화면이름: r.automationSuggestion, setup };
}

test('① 서버가 자동화 후보를 만든다', async () => {
  const { r } = await 제안턴();
  const 후보 = r.automationSuggestion ?? r.automationProposal;
  assert.ok(후보?.candidateId, `후보가 안 만들어졌다: ${JSON.stringify(r).slice(0, 200)}`);
  assert.match(String(후보.statement), /매일 아침 9시/);
});

// 이름을 서버에서 통일하려 했으나 응답까지 오지 않았고 이유를 확정 못 했다.
// **화면이 두 출처를 다 받게** 했다 — 어느 키가 오든 사용자에겐 같은 카드다.
test('② 화면이 **받는 형태로** 온다(카드가 뜬다)', async () => {
  const { r } = await 제안턴();
  const 화면이받는것 = r.automationSuggestion ?? r.automationProposal;
  assert.ok(화면이받는것?.candidateId, '어느 이름으로도 후보가 안 왔다 — 카드가 안 뜬다');
});

test('③ **설정 문이 열린다** — 카드를 눌렀을 때 막다른 길이 아니다', async () => {
  const { base, r, close } = await 제안턴({ 열어둠: true });
  try {
    const { setup } = await 사슬(base, r);
    assert.equal(setup.ok, true,
      `카드를 눌러도 설정이 안 열린다(죽은 버튼): ${setup.error ?? JSON.stringify(setup).slice(0, 120)}`);
    // **스킬·역할이 없는 것은 결함이 아니다** — T5 의 자동화는 "이미 배운 스킬을 정해진
    // 시각에 반복"하는 것이고, 새 설치엔 배운 것이 없다. 결함은 그때 **막다른 답**이 되는 것이다.
    // 여기서는 문이 열리는 것까지만 잰다(404 가 아니어야 한다).
  } finally { await close(); }
});

test('④ 켤 스킬이 없을 때 **막다른 답이 아니다**(다음 길이 있다)', async () => {
  const 화면 = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'surface', 'web', 'index.html'), 'utf8',
  );
  const i = 화면.indexOf('자동으로 맡길 준비가 아직 안 됐어요');
  assert.ok(i > 0, '스킬 없음 안내가 사라졌다');
  assert.match(화면.slice(i, i + 400), /먼저|보면|알려|해 두면|배워|말해/,
    '스킬이 없다는 말만 하고 끝난다 — 사용자는 무엇을 해야 하는지 모른다(막다른 답 금지)');
});

test('화면에 자동화 제안을 그리는 자리가 **있다**(없어지지 않았다)', async () => {
  const 화면 = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'surface', 'web', 'index.html'), 'utf8',
  );
  assert.match(화면, /automationSuggestion \?\? r\.automationProposal/,
    '화면이 두 출처를 다 받는 자리가 없어졌다 — 한쪽 이름만 보면 다른 쪽이 조용히 죽는다');
});

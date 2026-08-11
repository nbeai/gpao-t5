// ═══════════════════════════════════════════════════════════════════════════
// 칸 1 · 성질 1 — **모델이 자기 손을 모른다**
//
// 닫는 문장(사용자 문장 · PM 이 유료 실모델로 잰다):
//   *"웹 검색창에 글자 칠 수 있어?"* 에 10회 전부 「된다」고 답하고, 이어진 과업에서 실제로 친다.
//
// **이 파일은 그 문장을 재지 않는다.** 이 파일이 무는 것은 **구조 불변식**이다 —
// 문장이 달라지려면 먼저 프롬프트의 구조가 달라져야 하고, 그 구조는 되돌아갈 수 없어야 한다.
//
// ── 왜 「부정문을 지웠나」로 안 무는가 ──────────────────────────────────────
// 감사가 착수 전에 못 박았다: *"선빨강이 가설을 검증하는 시험이 되면 안 된다.
// 부정문 제거는 수단이지 목표가 아니다. 수단을 닫는 문장에 넣으면 부정문만 지우고 초록이 뜬다."*
// 그래서 무는 것은 **「부정이 자기 손 안에 갇혀 있나」**이고, 지우기로는 통과할 수 없게
// **S4(능력 대칭)** 를 함께 세운다 — 부정을 지워도 긍정이 없으면 여전히 빨갛다.
//
// ── 무엇을 재나 (C4 · 실경로 관통) ─────────────────────────────────────────
// 프롬프트를 손으로 짜 맞추지 않는다. **서버를 띄우고 대본 모델로 능력 질문 턴을 실제로 돌려**,
// 제품이 조립한 `buildModelMessages(tc)` 결과를 그대로 뜬다. 유료 0 · 실기기 0.
//
// **하드코딩 0**: 기대값(손·동사·그 동사의 사용자 말)은 전부 등록부에서 파생한다.
// 이 파일에 적힌 유일한 상수는 **닫는 문장 자체**(사용자 발화)와
// PM 이 반드시 물기로 지정한 **한 쌍(`desktop.act:type`)** 이다.
// ═══════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { 부정정의역위반, 손밖에서부정된동사, 동사정의역 } from '../src/kernel/l2-plan/tool-descriptor.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { demoDescriptors, demoEnv, demoTools } from '../src/surface/demo-context.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { MemoryStore } from '../src/surface/memory-store.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { SkillDefinitionStore } from '../src/surface/skill-store.js';

/** 사용자 문장 — **바꾸지 않는다**(닫는 문장은 PM·오너 몫이다). */
const 능력질문 = '웹 검색창에 글자 칠 수 있어?';

/** 화면 손 스텁 — 손이 **배선돼 있어야** 선언이 모델에게 간다(선언 ⊆ 손). 실기기 접촉 0. */
const 화면손 = () => ({ handler: async () => ({ result: {} }) });

/**
 * **관통 한 번.** 서버·저장소·권한 판정·프롬프트 조립은 전부 진짜이고 **모델 판단만 대본**이다.
 * 칸 0 계측기(`scripts/state-probe.mjs` 확정계열)와 같은 방식이다.
 */
async function 능력질문턴() {
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 't5-kan1-')));
  const 상태 = join(방, '.state');
  const opts = { desktop: 화면손(), desktopAct: 화면손() };

  const 판 = [];
  const 모델 = {
    async respond(tc, o = {}) {
      try { 판.push({ ...buildModelMessages(tc), tools: o.tools ?? [] }); } catch { /* 조립 실패는 안 센다 */ }
      return { text: '네, 됩니다.', toolCalls: [] };
    },
  };

  const server = makeServer({
    store: new SessionStore(상태),
    automationStore: new AutomationJobStore(상태),
    skillStore: new SkillDefinitionStore(상태),
    agentProfileStore: new AgentProfileStore(상태),
    memoryStore: new MemoryStore(상태),
    clock: () => 1_786_287_600_000,
    model: 모델,
    env: demoEnv(opts),
    tools: demoTools(opts),
    processEnv: { HOME: 방, GPAO_T5_HOME: 방, GPAO_T5_DATA_DIR: 상태, GPAO_T5_FILE_ROOTS: 방 },
  });

  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((r) => r.json());
    await fetch(`${base}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: 능력질문 }),
    }).then((r) => r.json());
  } finally {
    await new Promise((r) => server.close(r));
  }

  // 능력 진술이 가장 많이 실린 판을 본다 — 한 턴에 여러 호출이 있으면 그중 최대치가 정의역이다.
  판.sort((a, b) => String(b.system).length - String(a.system).length);
  return { 판: 판[0], 판수: 판.length, descriptors: demoDescriptors(opts) };
}

const 보기 = (v) => v.map((x) => `\n  · [${x.조항}] ${x.손} ${x.자리}${x.동사 ? ` (${x.동사})` : ''}\n      ${x.절 ?? x.말 ?? ''}\n      → ${x.사유}`).join('');

test('관통이 실제로 섰다 — 제품이 조립한 프롬프트를 떴다(손으로 짜 맞춘 것이 아니다)', async () => {
  const { 판, 판수 } = await 능력질문턴();
  assert.ok(판수 > 0, '대본 모델이 한 번도 안 불렸다 — 관통이 아니라 부품 검사가 된다');
  assert.ok(String(판.system).length > 500, `시스템 프롬프트가 너무 짧다(${String(판.system).length}자) — 조립이 안 섰다`);
  assert.ok(String(판.system).includes('네가 지금 바로 쓰는 손'),
    '능력 사실이 실린 자리가 프롬프트에 없다 — 이 턴은 능력 정의역을 재는 판이 아니다');
});

test('S1·S3 — 모델에게 가는 모든 부정 진술은 어느 손의 어느 동사에 걸리는지 구조로 표식된다', async () => {
  const { 판, descriptors } = await 능력질문턴();
  const 위반 = 부정정의역위반({ descriptors, systemPrompt: 판.system, tools: 판.tools })
    // **S0 를 함께 문다.** 동사의 사용자 말이 없으면 S1·S3 는 판정이 아니라 침묵이다 —
    // 침묵을 초록으로 읽는 것이 우리가 지금까지 당한 그것이다.
    .filter((v) => v.조항.startsWith('S0') || v.조항.startsWith('S1') || v.조항.startsWith('S3'));
  assert.deepEqual(위반, [],
    `**경계 없는 부정이 모델에게 실린다.** 부정을 지워서 통과하지 말고 \`limits\` 레코드(동사 표식·coveredBy)로 옮겨라:${보기(위반)}`);
});

test('S2 — 표식이 가리키는 동사가 그 손의 enum 에 실재한다 (거짓 한계 0)', async () => {
  const { 판, descriptors } = await 능력질문턴();
  const 위반 = 부정정의역위반({ descriptors, systemPrompt: 판.system, tools: 판.tools })
    .filter((v) => v.조항.startsWith('S0') || v.조항.startsWith('S2'));
  assert.deepEqual(위반, [], `**한계가 자기 정의역을 안 밝히거나, 없는 동사에 걸려 있다:**${보기(위반)}`);
});

test('S4 — 등록된 동사는 전부 그 손 이름과 함께 모델에게 간다 (지우고 초록 띄우기 차단)', async () => {
  const { 판, descriptors } = await 능력질문턴();
  const 위반 = 부정정의역위반({ descriptors, systemPrompt: 판.system, tools: 판.tools })
    .filter((v) => v.조항.startsWith('S0') || v.조항.startsWith('S4'));
  assert.deepEqual(위반, [],
    `**모델이 모르는 손이 있다.** enum 에 있는데 프롬프트에 그 손 이름과 함께 안 실렸다 — 부정을 지우는 것으로는 이 줄이 안 초록이 된다:${보기(위반)}`);
});

// **절단 시험이 찾은 구멍**(2026-08-11): 한계 렌더링을 통째로 걷어도 S1~S4 가 전부 초록이었다.
// 부정을 **아무 데도 안 실으면** S1·S3 는 볼 것이 없어 조용히 통과한다 — 그건 부정이 갇힌 게
// 아니라 한계가 사라진 것이고, 모델은 없는 사실을 짐작으로 채운다(브라우저 로그인 거짓 약속 2회).
test('S5 — 구조로 옮긴 한계는 실제로 그 손 이름과 함께 모델에게 간다', async () => {
  const { 판, descriptors } = await 능력질문턴();
  const 위반 = 부정정의역위반({ descriptors, systemPrompt: 판.system, tools: 판.tools })
    .filter((v) => v.조항.startsWith('S5'));
  assert.deepEqual(위반, [], `**선언은 있는데 모델이 못 받는다:**${보기(위반)}`);
});

// ── PM 이 반드시 함께 물기로 지정한 한 쌍 ────────────────────────────────────
test('등록된 `desktop.act:type` 을 그 손 밖의 어떤 진술도 부정하지 않는다', async () => {
  const { 판, descriptors } = await 능력질문턴();
  const 화면행동 = descriptors.find((d) => d.id === 'desktop.act');
  assert.ok(동사정의역(화면행동)?.includes('type'),
    '`desktop.act` 에 `type` 이 등록돼 있지 않다 — 이 조항의 전제가 깨졌다(등록부부터 본다)');
  const 위반 = 부정정의역위반({ descriptors, systemPrompt: 판.system, tools: 판.tools });
  assert.deepEqual(위반.filter((v) => v.조항.startsWith('S0') && v.손 === 'desktop.act'), [],
    '`desktop.act` 의 동사 말이 없으면 이 조항은 **판정이 아니라 침묵**이다');
  const 밖에서부정 = 손밖에서부정된동사(위반, 'desktop.act', 'type');
  assert.deepEqual(밖에서부정, [],
    `**"칸에 글자를 넣는다"와 "글을 쓰지 않는다"가 한 프롬프트에 함께 실린다:**${보기(밖에서부정)}`);
});

test('`desktop.act` 의 「칸에 글자 넣기」가 그 손 이름과 같은 줄로 모델에게 간다', async () => {
  const { 판, descriptors } = await 능력질문턴();
  const 화면행동 = descriptors.find((d) => d.id === 'desktop.act');
  const 말 = 화면행동?.행위?.type?.말;
  assert.ok(말, '`desktop.act` 가 `type` 을 사용자 말로 선언하지 않았다 — 모델이 그 동사를 알 길이 없다');
  const 그손줄 = String(판.system).split('\n').filter((l) => l.includes(화면행동.label));
  assert.ok(그손줄.some((l) => l.includes(말)),
    `"${말}" 이 "${화면행동.label}" 과 같은 줄에 없다. 그 손 줄:\n${그손줄.join('\n')}`);
});

// **F-109 · 예약된 일이 사용자의 집을 못 찾았다** (선빨강)
//
// ── 사용자 자리에서 무슨 일이 났나 ─────────────────────────────────────────
// *"매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘"* — 예약은 섰다.
// 지시문도 섰다. 그런데 **그 시각이 되자 조용히 실패했고 사용자는 아무것도 못 받았다.**
// ```
// run.status  : failed
// run.error   : "path out of scope: /Users/jyp/Downloads"
// 배달 원장    : 0건        대화 도착 : 0건
// ```
// 저장된 것은 옳았다 — 인자는 `~/Downloads`, 봉투의 `workspaceRoots` 는 그 사용자의 집.
// **틀어진 것은 `~` 를 펼치는 자리 하나다.**
//
// ── 밟은 한 줄 ─────────────────────────────────────────────────────────────
// ```js
// // canonical-automation-runtime.js:156  (assertInvocationScope 안)
// await resolveInScope(path, { roots: scope.workspaceRoots });   // ← home 을 안 넘긴다
// ```
// `resolveInScope` 는 `opts.home ?? homedir()` 다(`file-scope.js:102`). 집을 안 주면
// **OS 의 진짜 홈**으로 `~` 를 편다. 봉투에 그 사용자의 집이 적혀 있는데도 안 본다.
//
// `local-file.js` 의 여덟 자리는 **전부** `home` 을 넘긴다(`:473`·`:482`·`:487`·`:628`…).
// **이 한 줄만 빠졌다.** 그래서 대화로 부르면 되는 일이 예약으로 돌면 실패한다.
//
// ── 왜 이것이 나비효과 자리인가 ────────────────────────────────────────────
// 이 한 줄이 서면 살아나는 것: 집이 표준 자리가 아닌 **모든** 환경의 예약 —
// 다른 사용자 계정 · 시험 격리 · 마운트가 다른 자리 · `GPAO_T5_HOME` 을 쓰는 모든 구성.
// 그리고 사용자가 `~` 로 말한 **모든 폴더**(다운로드·바탕화면·문서)가 같이 산다.
//
// ── 뿌리는 둘로 갈린 집 해석이다 ───────────────────────────────────────────
// `file-scope.js` 가 같은 식을 두 곳에서 따로 쓴다(`:31` `defaultFileRoots` ·
// `:292`). **이미 두 벌이고, 자동화가 세 번째로 갈라졌다.** 그래서 이 검사는 한 줄만
// 물지 않고 **집을 읽는 자리가 한 벌인지**까지 문다 — 안 그러면 네 번째가 난다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scopedAgentTools } from '../src/runtime/canonical-automation-runtime.js';

/** 예약이 도는 판을 만든다 — 사용자의 집이 **표준 자리가 아닌** 경우다. */
async function 판깔기() {
  const 집 = await mkdtemp(join(tmpdir(), 'f109-home-'));
  const 받은것 = join(집, 'Downloads');
  await mkdir(받은것, { recursive: true });
  await writeFile(join(받은것, '영수증.pdf'), '%PDF-1.4\n%%EOF\n');
  return { 집, 받은것 };
}

// **실제 호출 모양 그대로 만든다.** 런타임은 `{ ...request.scope, env: this.env }` 로 넘긴다
// (`canonical-automation-runtime.js:477`). 검사가 그 모양을 안 쓰면 무엇을 재는지 알 수 없다.
const 봉투 = (집) => ({
  env: { ...process.env, GPAO_T5_HOME: 집 },
  workspaceRoots: [집],
  toolAllowlist: ['local.file'],
  authorityEnvelope: {
    ceiling: 'A0',
    allowedKinds: ['read'],
    allowedTools: ['local.file'],
    allowedTargets: [],
    workspaceRoots: [집],
  },
});

const 예산 = { consumeStep: () => {} };
const 현실 = { connectedTools: [{ id: 'local.file', toolKind: 'read' }] };

// ── ① 밟은 그 자리 ──────────────────────────────────────────────────────────
test('F109 ①: 예약이 **`~` 를 그 사용자의 집으로** 편다 — 봉투에 적힌 집이다', async () => {
  const { 집 } = await 판깔기();
  let 불린인자 = null;
  const 손 = {
    tools: { 'local.file': { estimatedCost: 0 } },
    run: async (id, args) => { 불린인자 = args; return { ok: true }; },
  };
  const 감싼 = scopedAgentTools(손, 봉투(집), 예산, { aborted: false }, async () => {}, 현실);

  await 감싼.run('local.file', { action: 'list', path: '~/Downloads', limit: 100 }, {});

  assert.ok(불린인자,
    '**예약이 `~/Downloads` 에서 막혔다** — 봉투에는 그 사용자의 집이 적혀 있는데 '
    + '`~` 를 OS 진짜 홈으로 펴서 「path out of scope」가 났다. 사용자 자리에서는 '
    + '예약이 조용히 실패하고 아무것도 안 온다(배달 0 · 도착 0)');
});

// ── ② 반대편 — 범위 밖은 그대로 막는다 ──────────────────────────────────────
//
// 집을 넘긴다고 문이 열리면 그건 수리가 아니라 구멍이다.
test('F109 ②: **봉투 밖 절대경로**는 그대로 막는다 — 문을 열어 버린 게 아니다', async () => {
  const { 집 } = await 판깔기();
  const 손 = { tools: { 'local.file': {} }, run: async () => ({ ok: true }) };
  const 감싼 = scopedAgentTools(손, 봉투(집), 예산, { aborted: false }, async () => {}, 현실);

  await assert.rejects(
    () => 감싼.run('local.file', { action: 'list', path: '/etc' }, {}),
    /scope/,
    '**봉투 밖 경로가 통과했다** — 집을 넘기면서 범위 검사까지 무르게 만들었다');
});

// ── ③ 뿌리 — 집을 읽는 자리가 **한 벌**이다 ─────────────────────────────────
//
// 한 줄만 고치면 네 번째가 난다. 같은 식이 여러 곳에 흩어져 있으면 언젠가 또 갈린다 —
// 이 저장소가 「두 벌」로 반복해서 데인 자리다(F-91·F-93·F-95).
test('F109 ③: 집을 읽는 식이 **한 곳에서 나온다** — 흩어지면 또 갈린다', async () => {
  const { readFile } = await import('node:fs/promises');
  const { dirname, join: J } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const 뿌리 = dirname(dirname(fileURLToPath(import.meta.url)));
  const 본문 = await readFile(J(뿌리, 'src/runtime/file-scope.js'), 'utf8');
  const 흩어진식 = [...본문.matchAll(/env\.GPAO_T5_HOME\s*\?\?\s*env\.HOME\s*\?\?\s*homedir\(\)/g)].length;
  assert.ok(흩어진식 <= 1,
    `**집을 읽는 식이 ${흩어진식}곳에 흩어져 있다** — 한 곳이 바뀌면 나머지가 조용히 갈린다. `
    + '자동화가 세 번째로 갈라져서 예약이 통째로 죽었다. 하나로 모으고 그것을 부르게 하라');
});

// ── ④ 배선 — 런타임이 집을 **실제로 실어 넘긴다** ───────────────────────────
//
// ①②③ 이 다 초록이어도 런타임이 안 넘기면 사용자 자리에서는 그대로 죽는다.
// 「만든 것과 닿은 것은 다르다」(2026-08-07) — 그 자리를 여기서 문다.
test('F109 ④: 런타임이 `scopedAgentTools` 에 **집을 실어** 넘긴다', async () => {
  const { readFile } = await import('node:fs/promises');
  const { dirname, join: J } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const 뿌리 = dirname(dirname(fileURLToPath(import.meta.url)));
  const 본문 = await readFile(J(뿌리, 'src/runtime/canonical-automation-runtime.js'), 'utf8');
  assert.match(본문, /scopedAgentTools\(\s*\n?\s*this\.tools,\s*\{[^}]*env:\s*this\.processEnv/,
    '**런타임이 집을 안 넘긴다** — 봉투에는 작업 뿌리만 있고 「집이 어디냐」가 없다. '
    + '그러면 `~` 가 OS 진짜 홈으로 펴져서 예약이 죽는다');
});

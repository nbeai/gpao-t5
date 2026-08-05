#!/usr/bin/env node
// **S6 판정 대조표** — 경계가 내리는 **결정 전수**를 표로 찍는다.
//
// 왜 필요한가(오너 지시 2026-08-05):
//   *"S6-c 는 절대 게이트를 옮기는 칸이라 '행동 변화 0' 이 S6-a 보다 더 엄격해야 한다.
//     게이트가 한 건이라도 다르게 판정하면 그건 이사가 아니라 개조다."*
//
// S6-a 의 증거(회귀 2,4xx 불변 · 돌연변이 불변)는 **덮인 것**만 말한다. 검사가 안 밟은
// 조합에서 판정이 달라져도 초록이다. 그래서 **결정 공간 자체**를 찍어 얼린다.
//
// 규율 12 그대로 — 이름이나 개수를 세지 않는다. **결정을 잰다.**
//   "경계에서 몇 번 부르나" ❌   →   "같은 상황에 같은 결정이 나오나" ⭕
//
//   node scripts/s6/judgment-table.mjs           # 표를 찍는다
//   node scripts/s6/judgment-table.mjs --write   # 동결본을 갱신한다(이유를 커밋에 적을 것)
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 실행전판정, 승인면제 } from '../../src/kernel/l2-plan/tool-boundary.js';
import { decideAutoGrant } from '../../src/kernel/l2-plan/authority.js';
import { rememberCounterpart } from '../../src/kernel/l2-plan/known-counterpart.js';
import { 발화밖파괴 } from '../../src/kernel/l2-plan/carryover.js';
import { callsToIntentParts } from '../../src/kernel/l2-plan/tool-schema.js';

export const 동결본 = join(dirname(fileURLToPath(import.meta.url)), 'judgment-frozen.json');

// ── **표의 축을 S7 앞에서 고쳤다**(오너 지시 2026-08-05, 착수 조건 ④) ────────────
//
//   *"표의 축이 '손 9종'인데 **S7 은 손 집합 자체를 바꾸는 칸이다.**
//     표를 '가능한 손 전부'로 고정하고 '그중 몇 개를 주느냐'를 별도 축으로 세우는 게 맞아 보인다.
//     안 정하고 들어가면 표가 무용지물이 되거나 매번 다시 얼리게 된다."*
//
// 그래서 `손들` 은 이제 **가능한 손 전부**(이번 런에 무엇이 제시되든 고정)이고,
// **제시됨**이 별도 축이 된다. 안 준 손을 모델이 이름으로 부르면 어떻게 되는가 —
// 그 판정도 결정 공간의 일부다. 판정은 여기서 새로 만들지 않고 제품의 그 함수를 그대로 쓴다
// (`callsToIntentParts` — 우리가 실제로 보여준 손만 받아들인다).

/** 결정 공간의 축. 조합 폭발을 피하되 **게이트가 갈리는 축**은 다 넣는다. */
const 손들 = [
  { id: 'local.file', args: { action: 'read', path: 'a.md' }, reversible: true, needsApproval: false },
  { id: 'local.file', args: { action: 'delete', path: 'a.md' }, reversible: true, needsApproval: false },
  { id: 'local.file', args: { action: 'write', path: 'a.md' }, reversible: true, needsApproval: false },
  { id: 'local.terminal', args: { command: 'ls -al' }, reversible: false, needsApproval: false },
  { id: 'local.terminal', args: { command: 'rm -rf ./x' }, reversible: false, needsApproval: false },
  { id: 'telegram.send', args: { target: '111', text: 'x' }, reversible: false, needsApproval: true },
  { id: 'telegram.send', args: { target: '999', text: 'x' }, reversible: false, needsApproval: true },
  { id: 'web.collect', args: { request: 'https://a.example' }, reversible: true, needsApproval: false },
  { id: 'browser.act', args: { action: 'click', ref: 'b1' }, reversible: false, needsApproval: true },
];

const 발화들 = [
  { 이름: '없음', 값: undefined },
  { 이름: '읽기요청', 값: { action: 'read', path: 'a.md' } },
  { 이름: '지우기요청', 값: { action: 'delete', path: 'a.md' } },
];

/** probe 를 흉내 낸다 — 실제 셸을 안 돌린다(표는 결정적이어야 한다). */
const tools = { tools: { 'local.terminal': {
  async probe(cmd) { return { changes: /rm|mv|>|install/.test(cmd), probe: cmd.split(' ')[0] }; },
} } };

const 아는상대 = (() => { const s = new Set(); rememberCounterpart(s, 'telegram.send', '111'); return s; })();

/** 경계가 내리는 **최종 결정** — 이것이 표의 값이다. */
async function 결정(손, 발화, { 이월, 허락됨, 상대앎, 제시됨 }) {
  // **이번 런에 제시된 손만 실행 후보가 된다**(S7 의 축). 안 준 손을 모델이 이름으로 불러도
  // 커널은 받지 않는다 — 그 판정을 여기서 다시 만들지 않고 제품의 그 함수를 그대로 쓴다.
  const 제시된손 = 손들.filter((h) => 제시됨 || h.id !== 손.id);
  const selfState = { connectedTools: 제시된손.map((h) => ({
    id: h.id, executable: true, reversible: h.reversible, needsApproval: h.needsApproval,
    schema: { description: h.id, parameters: { type: 'object', properties: {} } },
  })) };
  // 안 준 손은 경계에 **도달하지 못한다.** 실행도 승인도 아니고 "없는 손"이다.
  const 받아들인것 = callsToIntentParts([{ name: 손.id, args: 손.args }], selfState);
  if (!받아들인것.neededTools.length) return '없는손';
  const { 판정행동, kind } = await 실행전판정({
    toolId: 손.id, args: 손.args, selfState, tools, 이번이월: 이월, 이번발화: 발화.값,
  });
  // **turn.js 가 부르는 그대로 부른다.** 인자 하나를 빠뜨리면 표는 실제와 다른 것을 잰다 —
  // 처음 만들 때 `이번이월` 을 안 넘겨서 이월 칸이 전부 거짓 초록이었다(2026-08-05).
  const 면제 = 승인면제({
    toolId: 손.id, 판정인자: 손.args,
    허락한손: 허락됨 ? new Set([손.id]) : new Set(),
    knownCounterparts: 상대앎 ? 아는상대 : new Set(),
    전송인가: 손.id.endsWith('.send'),
    이번이월: 이월,
    발화밖: 발화밖파괴({ kind, 대상: 손.args?.path ?? 손.args?.target }, 발화.값),
    // 되돌릴 수 없는 것은 손 면제가 덮지 않는다(헌장 ②) — turn.js 가 넘기는 그대로.
    되돌릴수있나: 판정행동.revocable,
  });
  if (면제.면제) return `자동(면제:${면제.이유})`;
  return decideAutoGrant(판정행동) ? '자동' : '승인';
}

export async function 표만들기() {
  const rows = [];
  for (const 손 of 손들) {
    for (const 발화 of 발화들) {
      for (const 이월 of [false, true]) {
        for (const 허락됨 of [false, true]) {
          for (const 상대앎 of [false, true]) {
            // **S7 의 축** — 이번 런에 이 손을 줬는가. 손 집합이 상황에서 계산되면
            // 이 축이 움직인다. 표는 "가능한 손 전부"로 고정돼 있으므로 그대로 잰다.
            for (const 제시됨 of [true, false]) {
              const key = [손.id, JSON.stringify(손.args), 발화.이름,
                `이월=${이월}`, `허락=${허락됨}`, `앎=${상대앎}`, `제시=${제시됨}`].join(' | ');
              rows.push(`${key}  →  ${await 결정(손, 발화, { 이월, 허락됨, 상대앎, 제시됨 })}`);
            }
          }
        }
      }
    }
  }
  return rows;
}

const 직접실행 = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (직접실행) {
  const rows = await 표만들기();
  if (process.argv.includes('--write')) {
    await writeFile(동결본, `${JSON.stringify(rows, null, 1)}\n`, 'utf8');
    console.log(`동결본 갱신: ${rows.length}칸 → ${동결본}`);
    console.log('**왜 바뀌었는지 커밋에 적어라.** 스스로 갱신되는 기준선은 기준선이 아니다.');
  } else {
    for (const r of rows) console.log(r);
    console.log(`\n총 ${rows.length}칸`);
  }
}

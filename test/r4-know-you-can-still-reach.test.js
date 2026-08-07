// **지금 손을 몇 번 더 쓸 수 있는지 모르면, 모델은 "다음에 하겠다"고 말한다.**
//
// PM 이 밟아서 보냈다(2026-08-07 · 추측 아님):
// ```
// task-context.js:661   ...(Number.isInteger(p.toolStepsLeft) && p.toolStepsLeft > 0 ? {…} : {})
// model-provider.js:124 "이번 턴에 손을 아직 N번 더 이어 쓸 수 있다"
// src/ 전체에서 toolStepsLeft 를 **넣어 주는 자리: 0곳**
// ```
// **받는 쪽만 있고 주는 쪽이 없다.** 그 주석에 H08 실측이 이미 적혀 있다 —
// *"손이 3걸음 남았는데 모델이 「지금 손은 다 써서」라며 미뤘다. 남았다는 사실이 어디에도
// 없으니 빈칸을 소진으로 메운 것이다."* **진단은 맞았는데 배선이 안 됐다.**
//
// 그래서 모델이 턴 시작에 받는 사실은 이렇다:
// ```
// "네가 지금 바로 쓰는 손: …"       능력은 안다
// (이번 턴에 몇 번 쓸 수 있는지)     없다
// ```
// 능력은 아는데 **지금 써도 되는지**를 모른다. ⑤가 *"읽어서 계산해 드려야 해요"* 라고
// 미래형으로 말하는 것이 그 모양이다 — 다음 턴에 하겠다는 뜻이다.
//
// **이건 문구 추가가 아니다.** 세 번 막힌 것과 종류가 다르다 — 이미 있는 사실을
// 안 넣고 있던 것이다(⛔ "손을 강제로 부르게 만들지 마라"도 안 어긴다. 사실을 줄 뿐이다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const 태우기 = (p) => String(buildModelMessages({
  currentRequest: '이번 달 얼마 벌었지?',
  ...buildTaskContext({
    processEnv: {},
    selfState: { currentModel: { id: 't' }, connectedTools: [], riskyActions: [], limits: {} },
    intent: { answerMode: 'work', goal: 'x', currentRequest: '이번 달 얼마 벌었지?' },
    plan: { autoAllowed: [], needsApproval: [], forbidden: [] }, receipts: [], ...p,
  }),
}).system ?? '');

test('남은 걸음이 모델까지 간다 — 받는 쪽만 있고 주는 쪽이 없으면 늘 침묵이다', () => {
  assert.match(태우기({ toolStepsLeft: 6 }), /아직 6번 더 이어 쓸 수 있다/,
    '커널이 남은 걸음을 안 나른다');
});

test('다 썼으면 그 말을 안 만든다 — 없는 여유를 있다고 하지 않는다', () => {
  assert.doesNotMatch(태우기({ toolStepsLeft: 0 }), /더 이어 쓸 수 있다/, '0 인데 남았다고 한다');
});

// ── 주는 쪽이 실제로 있다 ───────────────────────────────────────────────
// **이 검사가 핵심이다.** 위 둘은 `buildTaskContext` 를 직접 부르는 것이라
// `turn.js` 가 안 넣어 주면 초록인 채로 제품은 그대로다 — 오늘 여섯 번 밟은 그 병이다.
test('턴 실행부가 남은 걸음을 실제로 채운다 — 넣는 자리가 0곳이면 이 사실은 영영 안 간다', () => {
  const 뿌리 = fileURLToPath(new URL('../src/kernel', import.meta.url));
  const 판 = [];
  const 훑기 = (d) => {
    for (const 이름 of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, 이름.name);
      if (이름.isDirectory()) { 훑기(p); continue; }
      if (!이름.name.endsWith('.js')) continue;
      const 글 = readFileSync(p, 'utf8');
      // `p.toolStepsLeft`(받는 쪽) 말고 **넣는 쪽**을 센다.
      // `\s*` 를 쓰면 0글자 매치가 lookahead 를 빠져나가 받는 쪽까지 통과한다(밟음).
      if (/toolStepsLeft:\s+(?!p\.)/.test(글)) 판.push(`${이름.name}`);
    }
  };
  훑기(뿌리);
  assert.ok(판.length > 0,
    '**남은 걸음을 넣어 주는 자리가 0곳이다** — 받는 쪽 코드는 영영 안 돈다(H08 진단이 배선 없이 남았다)');
  // **첫 판단 자리에도 있어야 한다.** 실행 중에만 주면 ⑤·⑬ 처럼 **첫 턴에 손을 쓸지 정하는
  // 자리**는 여전히 빈다 — 거기가 정확히 안 뻗는 자리다(밟음 2026-08-07).
  const 턴 = readFileSync(join(뿌리, 'turn.js'), 'utf8');
  const 자리수 = (턴.match(/toolStepsLeft:\s+(?!p\.)/g) ?? []).length;
  assert.ok(자리수 >= 2,
    `**계획 전 자리가 비어 있다** — 모델은 능력만 알고 지금 써도 되는지를 모른다: ${자리수}곳`);
});

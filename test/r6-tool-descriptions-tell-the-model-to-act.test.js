// **손 설명서가 "사용자에게 물어라"라고 시키고 있었다.**
//
// PM 이 밟아서 보냈다(2026-08-07). ⑤가 후보 5개를 찾아 놓고 멈추는 이유가 여기 있다 —
// 모델이 잘못한 게 아니라 **시킨 대로 한 것**이다:
// ```
// demo-context.js:774  "후보가 하나면 그대로 쓰고, 여럿이면 짧게 보여주고 고르게 한다"
// demo-context.js:779  "…경로를 복사해 오라고 하지 말고 이 이름들 중에서 고르게 한다"
// ```
//
// **오늘 세 번째 같은 병이다.** 앞의 둘은 실패 메시지였고 이번엔 `schema.description` 이다:
// ```
// "창제목으로 짚어 주세요"           CU 라인이 고침 (userSafeSummary)
// "그 폴더를 열어 주시면 바로 볼게요"  R① 에서 고침 (nextSafeAction)
// "여럿이면 짧게 보여주고 고르게 한다"  ← 손 설명서.  기존 반대시험이 여기를 안 훑는다
// ```
//
// 되묻기 금지가 아니다(⛔ · 물어야 할 때는 있다). 계획서 「동반」 2계단 —
// **가정을 밝히고 진행한다** — 이고, T5 가 이미 할 줄 아는 행동이다
// (말귀 회차 Q2·Q3·Q7 의 *"제가 일단 이렇게 가정하고 말할게요"*).
// **정보가 없을 때는 가정하고 가면서 손이 필요할 때만 묻는 비대칭**이 결함이었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const 손선언 = async () => {
  const m = await import('../src/surface/demo-context.js');
  return m.demoDescriptors();
};

test('찾는 손이 "골라 진행하라"고 말한다 — "고르게 한다"는 사용자에게 떠넘기는 말이다', async () => {
  const d = (await 손선언()).find((x) => x.id === 'local.locate');
  const 글 = String(d?.schema?.description ?? '');
  assert.ok(글, 'local.locate 선언이 없다');
  assert.doesNotMatch(글, /고르게 한다/,
    `**손 설명서가 사용자에게 물으라고 시킨다** — ⑤가 후보 5개에서 멈추는 이유다: ${글}`);
  assert.match(글, /골라|고른 뒤|하나를 고/,
    `**여럿일 때 어떻게 하라는 말이 없다**: ${글}`);
  assert.match(글, /왜 골랐|이유를 함께|무엇을 왜/,
    `**고른 이유를 말하라고 안 한다** — 말없이 고르면 사장님이 틀린 것을 못 잡는다: ${글}`);
});

// ── 같은 병이 손 설명서 어디에도 없게 ───────────────────────────────────
// 기존 `다음수단` 반대시험은 `src/runtime` 의 `왜:` 만 훑는다. 손 설명서(`schema.description`)는
// **검사 대상이 아니었다** — 그래서 이 문장이 세 번째로 살아남았다. 자리를 넓힌다.
test('어느 손 설명서에도 사용자에게 시키는 말이 없다 — 설명서를 읽는 것은 모델이다', async () => {
  const 시키는말 = /고르게 한다|짚어 주세요|알려 주세요|골라 주세요|물어본다|여쭤|확인받는다/;
  const 걸린것 = (await 손선언())
    .map((d) => [d.id, String(d?.schema?.description ?? '')])
    .filter(([, 글]) => 시키는말.test(글))
    .map(([id, 글]) => `${id}: ${글.match(시키는말)?.[0]}`);
  assert.deepEqual(걸린것, [],
    `**손 설명서가 되묻으라고 시킨다** — 모델은 시킨 대로 한다:\n${걸린것.join('\n')}`);
});

// ── 약속으로 턴을 끝내지 않는다 ─────────────────────────────────────────
// ⑤⑬③ 의 공통 뿌리다. ⑤가 *"읽어서 계산해 드려야 해요"* 라고 **미래형**으로 말하고 끝냈고,
// ③이 *"방금 확인했어요"* 라고 **과거형**으로 말하고 안 했다. 둘 다 손 없이 턴이 끝났다.
//
// **⛔ 를 쪼갠다**(PM 정정 2026-08-07): *말을 문구 목록으로 **검사**한다* 는 그대로 금지다
// (`F-12` 가 증명). *행동을 프롬프트로 **지시**한다* 는 우리가 해 본 적이 없다.
// 비교군(Hermes)은 기본 프롬프트 두 번째 절 이름이 `# Tool-use enforcement` 이고 정면으로
// 문장이다 — *"Never end your turn with a promise of future action — execute it now."*
//
// **이번엔 실리는지 밟고 넣는다**(`도구쓰는순서` 가 죽은 필드였던 그 일 뒤라).
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';

test('약속으로 턴을 끝내지 말라는 말이 모델 프롬프트에 실린다', () => {
  const tc = buildTaskContext({
    processEnv: {},
    selfState: { currentModel: { id: 't' }, connectedTools: [], riskyActions: [], limits: {} },
    intent: { answerMode: 'work', goal: 'x', currentRequest: '이번 달 얼마 벌었지?' },
    plan: { autoAllowed: [], needsApproval: [], forbidden: [] }, receipts: [],
  });
  const 글 = String(buildModelMessages({ currentRequest: '이번 달 얼마 벌었지?', ...tc }).system ?? '');
  assert.match(글, /하겠다고 말하고 끝내지 않는다|약속으로 턴을 끝내지/,
    `**뿌리 문장이 안 실린다** — 실렸는지 밟지 않으면 또 죽은 필드가 된다: ${글.slice(-400)}`);
});

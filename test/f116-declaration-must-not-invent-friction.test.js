// **F-116 · 선언이 실물보다 무섭게 적혀 있으면 모델은 안전해 보이는 손을 고른다**
//
// ── 밟은 사실 (오너 비교군 대조 2026-08-14) ───────────────────────────────
// 같은 질문 *"작업 폴더에서 제일 긴 문서가 뭐야?"* 를 두 곳에 넣었다.
//   비교군(더 **약한** 모델)  셸 명령 2개로 전부 재고 1·2·3위까지 답했다
//   T5(더 **강한** 모델)      `local.file` 9회 · 두 개만 재고 멈췄다 —
//                             *"시작문서 폴더 안은 아직 안 쟀는데 겉보기로는 짧을 가능성이 큽니다"*
// **모델이 문제가 아니다. 차이는 터미널을 썼느냐 하나다.** `wc -l` 한 줄이면 끝날 일이다.
//
// ── 원인 ────────────────────────────────────────────────────────────────
// 모델이 받는 두 손 설명을 나란히 놓으면(`self-state.js:readyCapabilities` → 시스템 프롬프트):
//   터미널  *"…명령은 그냥 실행하면 된다 — 실행 직전에 **확인 카드**가 한 번 뜨고…"*
//   파일손  *"지우거나 덮어쓴 것은 **되돌릴 수 있다**."*
// 읽기 명령(`ls`·`wc`·`grep`)에는 카드가 없는데 **터미널 줄에 그 사실이 없었다.** 라이브 9회차
// 실측: 터미널 승인 카드 0~1장 · 읽기 명령에는 한 번도 안 떴다. 그리고 「인터넷에 연결하는
// 명령은 카드」는 아예 **틀린 말**이었다 — 읽기성 네트워크는 오너 결정(2026-08-06)으로 이미
// 카드에서 빠져 있다(`terminal-read-network-is-automatic.test.js`). 선언만 안 따라갔다.
//
// 이 저장소가 이미 이름 붙인 병이다(F-46 · `docs/00-START-HERE/README.md`):
// *"선언과 강제가 다르면 사람이 선언을 믿는다."* 여기서는 **사람이 아니라 모델이 믿는다.**
//
// ── 여기서 무는 계약 ─────────────────────────────────────────────────────
//   ① 모델이 받는 선언은 **기계 판정과 같은 말**을 한다 — 없는 마찰을 지어내지 않는다
//   ② 그렇다고 게이트가 헐거워지지 않는다 — 바꾸는 명령은 그대로 카드다(안전 바닥)
//   ③ 문구 수리는 `reversible` 을 건드려서 하지 않는다 — 그 값은 권한·예산이 물고 있다
//   ④ 고친 문장은 **사실 진술**이지 「터미널을 먼저 써라」는 강제가 아니다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv, demoDescriptors } from '../src/surface/demo-context.js';
import { selfStateSummary } from '../src/kernel/l0-evidence/self-state.js';
import { 실행전판정 } from '../src/kernel/l2-plan/tool-boundary.js';
import { decideAutoGrant } from '../src/kernel/l2-plan/authority.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

const 손목록 = ['local.terminal', 'local.file', 'web.search', 'web.collect', 'local.locate'];
const selfState = buildSelfState(demoEnv({ hands: 손목록 }));
const 터미널선언 = selfState.connectedTools.find((t) => t.id === 'local.terminal');
const 능력줄 = (selfStateSummary(selfState).readyCapabilities ?? [])
  .find((l) => l.startsWith(터미널선언.label));
const 스키마글 = 터미널선언.schema.description;

/** 모드별로 정해진 답을 내는 가짜 실행기 — 실제 셸·네트워크를 안 탄다. */
function 실행기(대본) {
  return async (command, opts) => ({
    command, cwd: opts.cwd, mode: opts.mode, durationMs: 1,
    ...(대본[opts.mode] ?? { exitCode: 0, stdout: '', stderr: '' }),
  });
}
const 아무것도안막힘 = {};
const 쓰기막힘 = { probe: { exitCode: 1, stdout: '', stderr: 'zsh:1: operation not permitted: out.txt' },
  reach: { exitCode: 1, stdout: '', stderr: 'zsh:1: operation not permitted: out.txt' } };
const 네트워크만막힘 = { probe: { exitCode: 6, stdout: '', stderr: 'curl: (6) Could not resolve host: example.com' },
  reach: { exitCode: 0, stdout: '200', stderr: '' } };

/** 기계가 이 명령을 카드로 보내는가 — 계획·걸음이 함께 쓰는 그 판정 한 자리. */
async function 카드로가나(command, 대본) {
  const tools = { tools: { 'local.terminal': makeLocalTerminalTool({ run: 실행기(대본), cwd: '/tmp' }) } };
  const { kind, 판정행동 } = await 실행전판정({
    toolId: 'local.terminal', args: { command }, selfState, tools,
  });
  return { 카드: !decideAutoGrant(판정행동), kind };
}

// ── ① 기계 사실: 바꾸지 않는 명령은 카드 없이 돈다 ────────────────────────
test('① 읽기 명령은 승인 카드 없이 자동이다 — 선언이 말하는 그 사실', async () => {
  for (const cmd of ['ls -la', 'wc -l *.md', 'grep -rn 취소 .', 'find . -name "*.md" | xargs wc -l']) {
    const r = await 카드로가나(cmd, 아무것도안막힘);
    assert.equal(r.kind, 'read', `${cmd}: 아무것도 안 바꾸는데 읽기로 안 잡혔다`);
    assert.equal(r.카드, false, `${cmd}: 없는 마찰이 실물에 생겼다`);
  }
  // 밖에서 읽어 오기만 하는 것도 같다(오너 결정 2026-08-06 · reach 재시도).
  const 네트워크 = await 카드로가나('curl -s -o /dev/null https://example.com', 네트워크만막힘);
  assert.equal(네트워크.카드, false, '읽기성 네트워크가 다시 카드로 갔다');
});

// ── ② 안전 바닥: 바꾸는 명령은 그대로 카드다 ──────────────────────────────
//    **문구를 고쳐서 판정이 헐거워지면 이 수리는 실패다.**
test('② 바꾸는 명령은 여전히 확인 카드로 간다 — 문구 수리가 게이트를 열지 않는다', async () => {
  for (const cmd of ['echo hi > out.txt', 'rm -rf ./임시', 'npm install lodash']) {
    const r = await 카드로가나(cmd, 쓰기막힘);
    assert.equal(r.kind, 'write', `${cmd}: 변경 시도가 읽기로 샜다`);
    assert.equal(r.카드, true, `${cmd}: 바꾸는 명령이 카드 없이 돈다 — 헌장 ②가 뚫렸다`);
  }
  // 못 재면 조인다(fail-closed) — 탐침이 아무것도 못 냈으면 미상이고 미상은 언제나 카드다.
  const tools = { tools: { 'local.terminal': { probe: async () => { throw new Error('탐침 실패'); } } } };
  const { kind, 판정행동 } = await 실행전판정({
    toolId: 'local.terminal', args: { command: 'echo hi > out.txt' }, selfState, tools,
  });
  assert.equal(kind, 'unknown_kind', '못 잰 것이 읽기로 흘렀다');
  assert.equal(decideAutoGrant(판정행동), false, '못 잰 것이 자동으로 돌았다');
});

// ── ③ 선언(모델이 보는 것)과 등급(`reversible`)은 다른 칸이다 ──────────────
//    문구를 고치려고 `reversible` 을 건드리면 **안전 구멍**이 난다. 아래가 그 증명이다.
test('③ `reversible` 은 그대로다 — 권한·예산 판정이 안 바뀌었다', () => {
  assert.equal(터미널선언.reversible, false,
    '터미널 손의 `reversible` 이 바뀌었다. 이 값은 모델에게 안 가고(아래 검사) '
    + '헌장 ②와 예산의 좁은 칸이 물고 있다 — 문구 수리로 건드릴 값이 아니다');

  // 헌장 ② — 이 값이 `true` 가 되는 순간 **바꾸는 명령이 카드 없이 돈다.**
  assert.equal(decideAutoGrant({ kind: 'write', revocable: 터미널선언.reversible }), false,
    '지금 선언에서 변경 명령이 자동이 됐다');
  assert.equal(decideAutoGrant({ kind: 'write', revocable: true }), true,
    '전제 확인: `reversible:true` 였다면 변경 명령이 자동이 된다 — 그래서 안 건드린다');

  // 예산 — `turn.js` 가 이 값에서 좁은 칸(`그밖`, 상한 3)을 파생한다(`reversible !== false`).
  assert.equal(터미널선언.reversible !== false, false,
    '터미널 실행이 넓은 칸(되돌릴 수 있는 것 200)으로 옮겨 갔다 — 폭주 뒷단이 헐거워진다');

  // 승인 면제 ① 도 이 값을 본다 — `rm -rf ./임시` 승인이 다음 `rm -rf` 까지 덮지 않는 근거.
  assert.notEqual(터미널선언.reversible, true, '손 단위 면제가 열리면 F-34 계열 사고가 되살아난다');
});

// ── ③-b 모델은 `reversible` 을 보지 않는다 — 고칠 자리는 문장뿐이었다 ───────
test('③-b 모델 방에는 `reversible` 이 안 실린다 — 고칠 것은 산문 하나였다', () => {
  const 모델방 = JSON.stringify(selfStateSummary(selfState));
  assert.ok(!모델방.includes('reversible'),
    '`reversible` 이 모델에게 새고 있다 — 그러면 문구와 값을 함께 봐야 한다');
});

// ── ④ 선언이 기계와 같은 말을 한다 ────────────────────────────────────────
test('④ 능력 줄이 「바꾸지 않는 명령에는 카드가 없다」는 사실을 말한다', () => {
  assert.ok(능력줄, '터미널 능력 줄이 모델 방에서 사라졌다');
  assert.match(능력줄, /바꾸지 않는 명령은 확인 카드 없이/,
    '읽기 명령에 마찰이 없다는 사실이 다시 빠졌다 — 없는 사실은 모델이 짐작으로 메운다');
  // 옛 거짓 둘이 되돌아오면 문다.
  assert.ok(!/인터넷에 연결하는 명령은[^.]*확인 카드/.test(능력줄),
    '읽기성 네트워크에 카드가 뜬다는 옛 거짓이 되살아났다(오너 결정 2026-08-06 이후로 안 뜬다)');
  assert.ok(!/필요하면 사용자에게 확인을 받는다/.test(스키마글),
    '"네가 사용자에게 확인을 받아라"로 읽히는 문장이 돌아왔다 — 그게 떠넘김의 입구였다');
  // 떠넘김 금지는 그대로 남아 있어야 한다(F-115 가 같은 문장을 다른 축에서 문다).
  assert.match(능력줄, /사용자에게 명령어를 적어 주지 않는다/);
});

// ── ⑤ 사실 진술이지 강제가 아니다 ─────────────────────────────────────────
//    「~를 먼저 써라」는 규칙을 박는 것이고, 규칙을 박으면 반대가 된다(오너 경고 2026-08-13).
test('⑤ 고친 문장은 손을 고르라는 강제가 아니다', () => {
  const 강제 = [/터미널(을|를)\s*(먼저|반드시|우선|항상)/, /셸(을|를)\s*(먼저|반드시|우선|항상)/,
    /파일 도구(를|을)\s*쓰지\s*(마|말)/, /local\.file\s*(대신|보다)/];
  for (const 무늬 of 강제) {
    assert.ok(!무늬.test(능력줄), `능력 줄에 강제 문구가 들어갔다: ${무늬}`);
    assert.ok(!무늬.test(스키마글), `스키마 글에 강제 문구가 들어갔다: ${무늬}`);
  }
  // 다른 손을 깎아 상대적으로 띄우지도 않았다 — 파일 손의 사실은 그대로다(휴지통·되돌리기 표).
  const 파일손 = demoDescriptors().find((d) => d.id === 'local.file');
  assert.equal(파일손.reversible, true);
  assert.match(파일손.capability, /되돌릴 수 있다/,
    '터미널을 띄우려고 파일 손 선언을 나쁘게 만들면 거짓을 하나 더 만드는 것이다');
});

// **되돌릴 수 있는 쓰기를 자동으로 열기 전에, 진짜 파괴가 여전히 물어보는지부터 박는다.**
//
// ── 왜 이 검사가 수리보다 먼저 있나 (오너 조건 2026-08-16) ────────────────────
//
// 다음 수리(§5 순서 · 「되돌릴 수 있는 쓰기는 안 묻는다」)는 **승인을 줄이는 방향**이다.
// 오너 지시: *"승인을 줄이는 방향이면 반대시험을 먼저 박아야 합니다 —
// 「진짜 파괴(`rm -rf` 류)는 여전히 카드로 간다」를 검사로 고정한 뒤에 손대야 합니다."*
// 오늘 승인 카드 수리 때 감시자가 못 박은 규율이고, 그 순서 덕에 안전이 안 깎였다.
//
// ── 왜 그 수리가 필요한가 (밟은 코드 사실 · 오너 실측 + 내 확인) ──────────────
//   `authority.js:222`      case 'write': return action?.revocable !== true;
//                           → **되돌릴 수 있다고 밝히면 자동**이다. 로컬 파일 손은 휴지통을
//                             선언해서(`reversible: true`) 실제로 카드 없이 지나간다
//   `demo-context.js:661`   터미널 손은 `reversible: false` 를 **통째로** 선언한다
//                           → 명령이 무엇이든(새 압축본 하나 만드는 것까지) **늘 묻는다**
// 즉 새 규칙이 필요한 게 아니라 **이미 있는 규칙이 터미널에만 안 닿아 있다.** 이음새다.
// 비교군은 같은 부탁을 **개입 0** 으로 끝냈고 T5 는 1~3 번 물었다(§7-af · 라이브).
//
// ── 이 검사가 지키는 선 ────────────────────────────────────────────────────
// 그 이음새를 이을 때 **여기까지 같이 열리면 안 된다.** 지우는 명령은 되돌릴 수 없다 —
// 터미널에는 휴지통이 없다(`rm` 은 파일 손의 휴지통을 안 지난다). 그러므로 헌장 ②
// (되돌릴 수 없는 파괴)에 그대로 걸려야 하고, 그 사실은 **수리 전후로 안 움직여야** 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

async function 방() {
  const d = await mkdtemp(join(tmpdir(), 'destructive-'));
  await mkdir(join(d, '시작문서'), { recursive: true });
  await writeFile(join(d, '시작문서', 'a.md'), 'hello');
  await writeFile(join(d, 'b.md'), 'world');
  return d;
}

/** 한 명령만 고르는 모델 — 라이브는 비결정이라 계약을 못 문다. 여기서는 명령을 고정한다. */
const 한명령모델 = (command) => ({
  async respond(tc, opts = {}) {
    if (tc?.workContractAssessment) return { text: '', toolCalls: [] };
    if (!opts.tools?.length) return '끝.';
    if (!tc?.evidenceFacts?.length) return { text: '', toolCalls: [{ name: 'local.terminal', args: { command } }] };
    return { text: '끝.', toolCalls: [] };
  },
});

async function 첫턴(command, 자리) {
  // ⚠️ `cwd` 는 **값**이다(`local-terminal.js`: `deps.cwd ?? homedir()`). 함수를 넘기면
  //    spawn 이 깨져 **모든 명령이 카드로** 간다 — 밟았다. 그 상태로도 파괴 셋은 초록이라
  //    검사가 통과했고, **대조군(`ls`)만 그것을 잡았다.** 대조군 없는 안전 검사는 자가 깨진 채
  //    「늘 카드」를 정답으로 읽는다.
  const tools = demoTools({ localTerminal: makeLocalTerminalTool({ cwd: 자리 }) });
  return runTurn({ text: '부탁해' }, { env: demoEnv(), tools, model: 한명령모델(command) });
}

// 지우는 명령 셋. **목록이 아니다** — 「되돌릴 수 없다」가 무엇인지 보이는 표본이고,
// 수리가 이 선을 넘었는지 보는 자다. 새 파괴 명령을 여기 계속 더하는 것이 목적이 아니다.
for (const [이름, command] of [
  ['재귀 삭제', 'rm -rf 시작문서'],
  ['덮어쓰기', 'echo 망함 > b.md'],
]) {
  test(`파괴는 여전히 묻는다 — ${이름} (\`${command}\`)`, async () => {
    const 자리 = await 방();
    const 결과 = await 첫턴(command, 자리);

    assert.equal(결과.kind, 'approval',
      `**되돌릴 수 없는 일이 카드 없이 지나갔다.** 터미널에는 휴지통이 없다 — `
      + `\`rm\` 은 파일 손의 되돌리기를 안 지난다. 「되돌릴 수 있는 쓰기는 안 묻는다」를 `
      + `이을 때 이 선까지 같이 열면, 줄인 것은 마찰이 아니라 안전이다`);

    // **카드가 떴다는 것과 아무 일도 안 일어났다는 것은 다른 사실이다**(§7-y).
    // 승인 전에 이미 지워졌으면 카드는 장식이다 — 그 사실도 같이 문다.
    assert.deepEqual((await readdir(자리)).sort(), ['b.md', '시작문서'],
      '승인을 묻기 전에 이미 자리가 바뀌었다 — 카드가 사실을 못 지키고 있다');
  });
}

// ── ★ 선빨강 — 반대시험을 박다가 **셋 중 하나가 안 지켜지는 것을 찾았다** ──────
//
// `find . -name "*.md" -delete` 는 **카드가 안 뜬다.** 기제를 밟았다:
// ```
// probe exit  **0**   ← find 는 -delete 가 전부 실패해도 0 으로 끝난다
// probe stderr        find: -delete: unlink(./b.md): Operation not permitted
//                     find: -delete: unlink(./시작문서/a.md): Operation not permitted
// executionBlock:235       if (r.exitCode === 0) return undefined;   ← stderr 를 한 글자도 안 본다
// local-terminal.js:185    if (!막혔나) return { …, changes: false };  // 「막힌 게 없다 = 안 바꾼다」
// ```
// ⚠️ **정정(감시자 2026-08-16)**: 첫 판에 나는 여기에 *"`실패를삼킴` 이 명령 이름 목록이라
//    `find` 가 빠졌다"* 고 적었다. **틀렸다.** `terminal-run.js:224` 를 읽어 보면 그건 이름 목록이
//    아니라 **셸 구문 정규식**이다(`|| true` · `2>/dev/null` · `set +e`). 바로 위 주석이
//    *"위험 명령 목록으로 알아맞히지 않는다"* 라고 못 박고 있다. `find` 가 목록에서 빠진 게 아니라
//    **그 명령에 그 구문이 없을 뿐**이다. 안 읽고 단정했다 — 판정칸은 밟은 기계 사실에서만 적는다.
//
// 진짜 자리는 `local-terminal.js:185` 다. 막힘을 못 알아보면 **「안 바꾼다」를 주장한다.**
// 그런데 그 주장의 거울 반쪽은 이 저장소가 **이미 얼려 두었다** —
// `test/read-denial-is-not-a-write-attempt.test.js:43`:
//   *"「안 바꾼다」도 주장이다 — 자동으로 흘리지 않는다"*
// 즉 규칙은 이미 있고 **exit 0 갈래에만 안 닿아 있다.** 실측으로 갈린다:
//   읽기 거부 · exit≠0  → **카드**(얼린 계약대로 「모른다」)
//   읽기 거부 · exit 0   → 무카드          ← 같은 사실인데 exit 하나로 대접이 갈린다
//   쓰기 거부 · exit 0   → 무카드          ← 이 검사가 무는 자리
//
// **지금 당장 안전이 뚫린 것은 아니다** — 샌드박스가 실제로 막아 파일은 살아 있다(아래로 문다).
// 피해는 **거짓 보고**다: 아무것도 안 지워졌는데 사용자는 지웠다고 듣는다(F-118 가족).
// ⚠️ *"(나) 가 이걸 위험으로 바꾼다"* 도 첫 판에 적었다가 뺀다 — `find -delete` 는 kind 가
//    `read` 라 (나)가 건드릴 `write` 갈래에 **도달조차 안 한다**(감시자 실측). 근거가 약한 문장이다.
//    실제 근거는 **「지금 이미 거짓 보고」** 하나면 충분하다.
//
// ⚠️ **여기서 고치지 않는다.** 오너가 승인한 이번 범위는 (가) 동결 + (나) 반대시험 박기다.
//    이건 세 번째 자리이고 자기 검문을 받아야 한다. 선빨강으로 남겨 다음 걸음이 집게 된다.
test('★ 선빨강 — 실패를 삼키는 명령(`find -delete`)은 파괴인데도 카드가 안 뜬다', async () => {
  const 자리 = await 방();
  const 결과 = await 첫턴('find . -name "*.md" -delete', 자리);

  // 먼저 **안전은 지켜졌다**는 사실을 못 박는다 — 이 선빨강은 「지워졌다」가 아니다.
  assert.deepEqual((await readdir(자리)).sort(), ['b.md', '시작문서'],
    '샌드박스가 실제로 막았다는 전제가 깨졌다 — 그러면 이건 선빨강이 아니라 P0 다');

  assert.equal(결과.kind, 'approval',
    '**지우는 명령인데 카드가 안 떴다.** `find` 가 -delete 실패를 삼키고 exit 0 을 내는데,\n'
    + '커널은 exit 0 이면 stderr 의 「Operation not permitted」 두 줄을 **한 글자도 안 본다**.\n'
    + '그리고 `local-terminal.js:185` 가 거기서 **「안 바꾼다」를 주장한다** — 증명 없이.\n'
    + '그 주장 금지는 이미 얼려 있다(`read-denial-is-not-a-write-attempt.test.js:43`).\n'
    + '**규칙을 새로 만드는 게 아니라 exit 0 갈래에만 안 닿은 그 규칙을 균일하게 펴는 일이다.**');
});

// 대조군 둘째 — **감시자가 지목한 공백**(2026-08-16).
// 아래 `ls -1` 은 exit 0 이고 stderr 가 **비어 있어** 어떤 새 규칙도 안 문다.
// 필요한 것은 **exit 0 + stderr 에 막힘 자국 + 그런데 아무것도 안 바꾸는** 명령이다.
// 그게 없으면 위 선빨강은 「무조건 카드」로도 초록이 난다.
//
// 이 갈래는 **오늘도 카드로 가야 하는 쪽이 아니다** — 라고 쓰고 싶지만 실측은 반대다:
//   `cat .env`(읽기 거부 · exit≠0) 는 **오늘 이미 카드**다(얼린 계약 「모른다」).
// 그러므로 이 대조군이 수리 뒤 카드로 바뀌는 것은 **새 마찰이 아니라 같은 대접**이다.
// 그 사실을 여기 적어 두고, 계약으로는 **「자리가 안 바뀐다」만** 문다 — 카드 여부는
// 수리가 정할 값이라 결과를 보기 전에 못 박지 않는다.
test('대조군 둘째 — exit 0 인데 막힘 자국이 있고 아무것도 안 바꾸는 명령 (읽기 거부)', async () => {
  const 자리 = await 방();
  await writeFile(join(자리, '.env'), 'API_KEY=zzz');   // 비밀 이름 — 읽기가 막힌다
  await 첫턴(String.raw`find . -type f -exec cat {} \;`, 자리);
  assert.deepEqual((await readdir(자리)).sort(), ['.env', 'b.md', '시작문서'],
    '읽기만 하는 명령이 자리를 바꿨다 — 그러면 이건 대조군이 아니다');
});

// ── 대조군 — 이 줄이 이 검사를 「무조건 초록」에서 구한다 ──────────────────────
// 위 셋만 있으면 「터미널은 늘 카드」여도 통과한다(오늘이 정확히 그 상태다).
// 아무것도 안 바꾸는 명령이 **카드 없이** 지나가는 것을 같이 물어야, 위 셋의 초록이
// 「파괴를 가려냈다」는 뜻이 된다.
test('대조군 — 아무것도 안 바꾸는 명령은 카드 없이 지나간다 (지금도 그렇다)', async () => {
  const 결과 = await 첫턴('ls -1', await 방());
  assert.notEqual(결과.kind, 'approval',
    '읽기만 하는 명령까지 카드로 가면 이 검사는 「터미널은 늘 카드」를 통과시키는 자가 된다');
});

// ── 수리가 겨누는 자리 — **지금은 사실만 적고 계약으로 안 세운다** ──────────────
// 새 압축본 하나 만들기(`tar -czf backup.tgz .`)는 아무것도 안 지우는데 **`rm -rf` 와 같은
// 카드**를 받는다. 이게 비교군과의 거리다(비교군 개입 0 · T5 1~3회 · §7-af).
// **여기에 「카드 없이 지나간다」를 아직 안 적는다** — 그건 다음 수리가 만들 사실이고,
// 지금 적으면 결과를 보기 전에 답을 적는 것이 된다. 수리할 때 이 파일에 그 줄을 더하고,
// **그때 위 셋은 그대로 초록이어야 한다.**
test('지금 사실 — 새로 만들기만 하는 명령도 파괴와 같은 카드를 받는다 (수리의 표적)', async () => {
  const 결과 = await 첫턴('tar -czf backup.tgz .', await 방());
  assert.equal(결과.kind, 'approval',
    '이 줄이 빨개졌다면 그 수리가 이미 들어간 것이다 — 이 검사를 계약으로 바꿔 적어라');
});

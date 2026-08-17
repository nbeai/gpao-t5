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
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
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

/**
 * 한 명령만 — **한 번만** — 고르는 모델. 라이브는 비결정이라 계약을 못 문다.
 * ⚠️ 「evidenceFacts 가 비면 또 고른다」로 짰다가 밟았다: 자동 실행이 성공해 파일이 생긴 뒤
 *    스텁이 **같은 명령을 또 골랐고**, 이번엔 기존 파일 덮어쓰기라 카드가 떴다 — 제품이 맞고
 *    자가 틀렸다. 계약을 무는 스텁은 자기 상태로 한 번만 골라야 한다.
 */
const 한명령모델 = (command, effects) => {
  let 골랐다 = false;
  return {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [] };
      if (!opts.tools?.length) return '끝.';
      if (!골랐다) {
        골랐다 = true;
        return { text: '', toolCalls: [{ name: 'local.terminal', args: { command, ...(effects ? { effects } : {}) } }] };
      }
      return { text: '끝.', toolCalls: [] };
    },
  };
};

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

// ── (나) 수리의 울타리 넷 — **수리 전에 얼린다** (감시자 지시 2026-08-16) ──────
//
// 다음 수리: 「기존 것을 하나도 안 건드리는 생성」은 카드 없이 끝낸다(개입 0).
// 가르는 기계 사실은 **쓰려다 막힌 자리가 현재 디스크에 존재하는가**다.
// 아래 넷은 그 수리가 **넘으면 안 되는 선**이고, 지금 전부 초록이다 — 수리 후에도 초록이어야 한다.

// 울타리 ① 복합 명령 — 새 이름이 앞, 파괴가 뒤.
// 막힌자리는 stderr 첫 일치 **하나**다(terminal-run.js) — 새 이름이 먼저 잡히면
// 「없는 자리 = 자동」으로 굴러떨어지고, 승인 없이 **명령 전체**(rm 포함)가 돈다.
test('울타리 ① — 새 이름 생성 뒤에 파괴를 붙인 복합 명령은 여전히 카드다', async () => {
  const 자리 = await 방();
  const 결과 = await 첫턴('echo x > 새이름.txt && rm -rf 시작문서', 자리);
  assert.equal(결과.kind, 'approval',
    '복합 명령의 **한 조각**(새 이름)만 보고 전체를 자동으로 흘렸다 — 뒤에 rm 이 붙어 있다');
  assert.deepEqual((await readdir(자리)).sort(), ['b.md', '시작문서'],
    '승인 전에 무엇인가 실행됐다');
});

// 울타리 ①-b **cd 변형 덮어쓰기** — 자리를 틀리게 특정하면 폴백보다 나쁘다 (손 관리자 2026-08-16).
// `cd 시작문서 && echo 망함 > a.md` 의 막힌 자리는 「a.md」로 잡히는데, 그걸 **cwd 기준으로**
// stat 하면 방/a.md 는 없으므로 「새 이름 = 자동」으로 굴러떨어진다. 그리고 granted 로
// 명령 전체가 돌면 **시작문서/a.md(실존)를 덮는다.** 오답 자동은 카드 유지보다 나쁘다 —
// 자리 해석이 확정 안 되는 모양(구획 여럿·cd 이동)은 전부 카드로 남아야 한다.
test('울타리 ①-b — cd 로 자리를 옮긴 덮어쓰기는 여전히 카드다 (틀린 기준으로 stat 하지 않는다)', async () => {
  const 자리 = await 방();
  const 결과 = await 첫턴('cd 시작문서 && echo 망함 > a.md', 자리);
  assert.equal(결과.kind, 'approval',
    '**자리를 cwd 기준으로 잘못 읽고 「새 이름」으로 승격했다** — 실제 자리에는 a.md 가 실존한다');
  assert.equal(await readFile(join(자리, '시작문서', 'a.md'), 'utf8'), 'hello',
    '승인 전에 기존 파일이 덮였다');
});

// 울타리 ② 새 이름인데 **시스템 자리** — 「없는 자리 = 안전」이 아니다.
// /Library/LaunchAgents 는 root 소유라 실제 피해는 안 나지만(이 검사가 안전한 이유),
// 「새 이름이니 자동」 규칙이 이 갈래를 열면 위협모델(system 영역)에 정면으로 닿는다.
test('울타리 ② — 시스템 자리의 새 이름 쓰기는 여전히 카드다', async () => {
  const 결과 = await 첫턴('echo x > /Library/LaunchAgents/t5-검사-새것.plist', await 방());
  assert.equal(결과.kind, 'approval',
    '**새 이름이라는 이유로 시스템 자리 쓰기가 자동이 됐다** — 없는 자리가 곧 안전한 자리가 아니다');
});

// 울타리 ③ write 가 아닌 변경 갈래(listen·privilege·signal)는 이 수리로 **안 움직인다**.
test('울타리 ③ — 포트 열기·권한 변경·프로세스 신호는 자리 유무와 무관하게 그대로 「바꾼다」다', async () => {
  for (const [이름, stderr] of [
    ['listen', 'Error: listen EPERM: operation not permitted 0.0.0.0:3000'],
    ['privilege', 'launchctl: not privileged to start service'],
    ['signal', 'zsh:kill:1: kill 123 failed: operation not permitted'],
  ]) {
    const 손 = makeLocalTerminalTool({
      sandboxAvailable: () => true,
      run: async () => ({ exitCode: 1, stdout: '', stderr }),
    });
    const p = await 손.probe('아무명령', { cwd: '/x' });
    assert.equal(p.changes, true,
      `${이름} 갈래가 「바꾼다」에서 내려왔다 — 이 갈래에는 자리가 없고, 자리 규칙이 닿으면 안 된다`);
  }
});

// 울타리 ④ 자리를 특정 못 하면($( ) 이름) **카드 유지** — 안전 폴백을 말이 아니라 검사로.
test('울타리 ④ — 이름을 실행 중에 만드는 생성은 자리를 못 밟으므로 여전히 카드다', async () => {
  const 결과 = await 첫턴('tar -czf b-$(date +%s).tgz .', await 방());
  assert.equal(결과.kind, 'approval',
    '자리를 못 밟았는데 자동이 됐다 — 모르면 카드다(미상에 자동 탈출구를 만들지 않는다)');
});

// ── ★ (나) 선빨강 — 수리가 만들 사실. **지금은 빨갛다** ─────────────────────
// 「기존 것을 하나도 안 건드리는 생성」이 카드 없이 끝나고 **실물이 디스크에 있다**.
// 계약은 카드 부재만이 아니다 — 감시자 조건 5: 디스크 실물을 같이 문다(§7-ai-3 종료 판정 그대로).
test('★ (나) 선빨강 — 새 이름 생성은 카드 없이 끝나고 실물이 디스크에 남는다', async () => {
  const 자리 = await 방();
  const 결과 = await 첫턴('tar -czf backup.tar.gz 시작문서', 자리);
  assert.notEqual(결과.kind, 'approval',
    '기존 것을 하나도 안 건드리는 생성인데 카드가 떴다 — 비교군은 같은 일을 개입 0 으로 끝낸다(§7-af)');
  assert.ok((await readdir(자리)).includes('backup.tar.gz'),
    '카드는 안 떴는데 실물이 없다 — 카드 부재가 실행을 뜻하지 않으면 그건 침묵이지 자동이 아니다');
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

// ── (나) 계약 — 옛 「지금 사실」 덫이 수리로 빨개져 계약으로 전환했다 (설계대로) ──
// `.` 을 통째로 읽어 새 이름 하나를 만드는 것도 같은 부류다 — 읽기는 헌장 넷 어디에도
// 안 닿고(감시자), 쓰는 자리는 새 이름 하나뿐이다.
test('(나) 계약 — `.` 전체를 새 압축본 하나로 만드는 것도 카드 없이 끝나고 실물이 남는다', async () => {
  const 자리 = await 방();
  const 결과 = await 첫턴('tar -czf backup.tgz .', 자리);
  assert.notEqual(결과.kind, 'approval', '기존 것을 하나도 안 건드리는 생성이 다시 카드로 돌아갔다');
  assert.ok((await readdir(자리)).includes('backup.tgz'), '카드는 안 떴는데 실물이 없다');
});

// ── ★ 선빨강 — **승인이 실행에 닿지 않는다** (라이브 3/3 · 나후-회차1~3 · 2026-08-16) ──
//
// 판정불능(미상) 카드의 계약은 「이대로 진행할까요?」다. 사용자가 눌렀다. 그런데 라이브 3/3 에서
// 승인 뒤 원장에 granted 실행이 **한 줄도 없고** probe 요약("아직 아무것도 안 바뀌었어요")만
// 되풀이됐다 — 파일 0/3. 기제: `granted` 깃발이 `probed?.changes === true` 일 때만 서는데
// (tool-boundary.js:73), 판정불능은 changes 가 없어 깃발이 안 선다. 승인 재개(executePlan)는
// 그 인자 그대로 handler 를 부르고, handler 는 `args.granted ? 'granted' : 'probe'` 라
// **probe 를 또 돈다.** 사용자의 승인이 실행에 영영 안 닿는다 — §7-an-2 「승인 눌러도 파일
// 1/4」의 뿌리다. changes:true 카드는 깃발이 미리 서 있어 이 병이 안 보였다.
test('★ 선빨강 — 판정불능 카드를 승인하면 실제로 실행된다 (probe 를 또 돌지 않는다)', async () => {
  const 자리 = await 방();
  const tools = demoTools({ localTerminal: makeLocalTerminalTool({ cwd: 자리 }) });
  // 새 효과 계약: 동적 이름이라 probe가 자리를 확정 못 해도,
  // 모델이 write를 선언하고 사용자가 그 효과를 카드에서 승인하면 실행은 닿아야 한다.
  const ctx = { env: demoEnv(), tools, model: 한명령모델('tar -czf b-$(date +%s).tgz .', ['write']) };
  const 첫 = await runTurn({ text: '부탁해' }, ctx);
  assert.equal(첫.kind, 'approval', '전제: $( ) 이름은 판정불능이라 카드다(울타리 ④)');

  const 이어 = await runTurn({ approve: 첫.pendingId }, ctx);
  const 실물 = (await readdir(자리)).filter((n) => n.endsWith('.tgz'));
  assert.ok(실물.length > 0,
    '**승인을 눌렀는데 실행이 안 됐다.** 원장에는 probe 요약만 또 남는다 — '
    + '사용자가 「이대로 진행할까요?」에 예라고 답한 그 사실이 granted 로 안 흐른다');
  assert.notEqual(이어.kind, 'approval', '승인 뒤에 같은 카드가 또 뜨면 죽은 버튼이다');
});

// ── (나) 계약 — **두 경로가 같은 답을 낸다** (감시자 조건 2 · 2026-08-16) ─────────
// `revocable` 이 authority 에 닿는 통로는 두 벌이다(걸음 tool-boundary:103 · 계획 action-plan).
// 한쪽만 고치면 「reversible:false 로 선언된 rm -rf 가 걸음 경로에서만 자동 실행됐다」
// (tool-boundary.js:9 · 실측 2026-08-03)가 그대로 재발한다. 같은 probe 사실을 두 경로에
// 넣어 **같은 답**인지 문다. 그리고 `허락한손` 이 이미 차 있는 상태도 문다 — `되돌릴수있나
// === true` 는 승인 면제 문(tool-boundary:202)까지 여는 열쇠라, 창조 아닌 명령에 그 열쇠가
// 새면 한 번의 승인이 다른 명령의 면제로 샌다.
test('(나) 계약 — 계획·걸음 두 경로가 같은 답: 창조는 자동, 파괴는 카드 (허락한손 상태 포함)', async () => {
  const { 실행전판정 } = await import('../src/kernel/l2-plan/tool-boundary.js');
  const { buildActionPlan } = await import('../src/kernel/l2-plan/action-plan.js');
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { demoEnv: env2 } = await import('../src/surface/demo-context.js');
  const 자리 = await 방();
  const tools = demoTools({ localTerminal: makeLocalTerminalTool({ cwd: 자리 }) });
  const selfState = buildSelfState(env2({ hands: Object.keys(tools.tools) }));

  for (const [command, 창조인가] of [
    ['tar -czf backup.tar.gz 시작문서', true],
    ['rm -rf 시작문서', false],
    ['echo 망함 > b.md', false],
  ]) {
    // 걸음 경로
    const { 판정인자, 판정행동 } = await 실행전판정({ toolId: 'local.terminal', args: { command }, selfState, tools });
    assert.equal(판정행동.revocable === true, 창조인가,
      `걸음 경로: \`${command}\` 의 revocable 이 ${창조인가 ? '창조 사실을 못 받았다' : '창조가 아닌데 true 다 — 면제 열쇠가 샌다'}`);
    // 계획 경로 — 같은 probe 사실로
    const plan = buildActionPlan({ intent: { neededTools: ['local.terminal'], terminalOp: 판정인자 }, selfState });
    const 카드없음 = plan.needsApproval.length === 0;
    assert.equal(카드없음, 창조인가,
      `계획 경로: \`${command}\` 가 걸음 경로와 다른 답을 냈다 — 두 벌 중 한쪽만 고친 그 사고다`);
  }
});

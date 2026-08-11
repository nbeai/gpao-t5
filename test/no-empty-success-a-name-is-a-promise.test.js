// **빈 성공을 성공으로 닫지 않는다** — 이름이 약속한 형식은 내용으로 지킨다.
//
// 라이브 실측(2026-08-11 · 실기기 채점기 · gpt-5.1 · 본선 병합본):
// ```
// 문장   "이 폴더에 8월_정산.xlsx 로 표 하나 만들어줘"
// 손     local.locate → local.file:write
// 기준자 file="empty"   ← 이름만 .xlsx 인 **0바이트 파일**
// 답     "만들었어요" 로 그 턴이 끝났다. 사용자는 열어 보고서야 안다
// ```
// 앞 단위가 셸 축·선언 순서·SKILL.md 세 장을 이미 넣었고 **모델은 그 문서를 읽었다**
// (답에 *".xlsx 구조를 직접 조립해서 넣어야 해서요"* — 그 문서의 말이다).
// **지식은 닿았는데 걸음이 안 났다.** `local.terminal` 을 한 번도 안 불렀다.
//
// 그래서 무는 자리는 문서가 아니라 **거짓 성공**이다. 두 겹이다:
//   ① `local.file write` 가 `.xlsx` 이름에 글을 쓰고 **성공 영수증**을 낸다
//   ② 그 걸음이 「성공」이라 P6-L ③(`막히면 다른 손으로`)이 **안 열린다** —
//      그 조항은 `failureState` 로 막힌 걸음을 세는데, 이건 실패가 아니라 **빈 성공**이다
// ①을 고치면 ②는 따라온다: 막힌 걸음이 서고 안 써 본 손(`local.terminal`)이 남아 있다.
//
// 가르는 자는 **기계**다 — 이름이 약속한 형식의 알려진 서명(zip 매직 `PK\x03\x04`,
// `%PDF-` …)을 실제로 쓸 바이트에서 본다. 이름으로 막지 않는다(진짜 zip 이면 통과한다).
// 가릴 서명이 없는 형식은 **「확인 못 함」으로 적는다** — 성공으로도 0 으로도 접지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { executionBlock } from '../src/runtime/terminal-run.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

async function 판() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'no-empty-success-')));
  return { root, tool: makeLocalFileTool({ roots: [root], dataDir: root }) };
}
const 있나 = async (p) => stat(p).then(() => true, () => false);

// ── ① 이름이 약속한 형식 — 어긋나면 성공으로 닫지 않는다 ────────────────────

test('선빨강: 빈 내용을 `.xlsx` 로 쓰면 성공이 아니다', async () => {
  const { root, tool } = await 판();
  const r = await tool.handler({ action: 'write', path: '8월_정산.xlsx', text: '' });
  assert.equal(r.blocked, true,
    `0바이트 .xlsx 가 성공으로 닫혔다(${JSON.stringify(r.userSafeSummary)}) — 사용자는 열어 보고서야 안다`);
  assert.equal(await 있나(join(root, '8월_정산.xlsx')), false,
    '껍데기가 자리에 남았다 — 다음 손이 「이미 있다」에 막히고 목록에는 엑셀이 하나 있는 것으로 보인다');
});

test('선빨강: 표를 글로 써서 `.xlsx` 에 넣어도 성공이 아니다 — 0바이트만의 병이 아니다', async () => {
  const { root, tool } = await 판();
  const r = await tool.handler({ action: 'write', path: '8월_정산.xlsx', text: '항목,금액\n매출,1200000\n' });
  assert.equal(r.blocked, true, 'CSV 를 .xlsx 이름으로 저장하고 「엑셀 만들었어요」로 닫혔다');
  assert.equal(await 있나(join(root, '8월_정산.xlsx')), false, '엑셀이 아닌 파일이 .xlsx 이름으로 남았다');
});

test('막다른 답이 아니다 — 그 자리에서 부를 수 있는 다음 손(터미널)을 손에 쥐여 준다', async () => {
  const { tool } = await 판();
  const r = await tool.handler({ action: 'write', path: '8월_정산.xlsx', text: '' });
  assert.ok(r.nextSafeAction, '사용자에게 할 말이 없다');
  const 수단 = (r.다음수단 ?? []).map((x) => x.방법);
  assert.ok(수단.includes('local.terminal'),
    `다음 손이 없다(${JSON.stringify(r.다음수단)}) — 모델은 "만들 수 없어요"밖에 할 수 없다`);
});

test('이름으로 막는 것이 아니다 — 내용이 진짜 zip 서명이면 저장된다', async () => {
  const { root, tool } = await 판();
  // zip 매직 그대로. 자는 **바이트**를 본다(확장자 금지 목록이 아니다).
  const r = await tool.handler({ action: 'write', path: '진짜.xlsx', text: 'PK진짜 꾸러미' });
  assert.equal(r.blocked, undefined, `서명이 맞는데 막혔다: ${JSON.stringify(r.userSafeSummary)}`);
  assert.ok(await 있나(join(root, '진짜.xlsx')));
});

test('`%PDF-` 로 시작하는 pdf 는 저장되고, 그냥 글인 pdf 는 막힌다', async () => {
  const { tool } = await 판();
  const 진짜 = await tool.handler({ action: 'write', path: '보고서.pdf', text: '%PDF-1.4\n1 0 obj\n' });
  assert.equal(진짜.blocked, undefined, 'PDF 서명이 맞는데 막혔다');
  const 가짜 = await tool.handler({ action: 'write', path: '보고서2.pdf', text: '# 보고서\n내용입니다' });
  assert.equal(가짜.blocked, true, '마크다운을 .pdf 로 저장하고 성공으로 닫았다');
});

// ── 반례 — 절단하면 이 줄들이 초록으로 남아야 한다 ──────────────────────────

test('반례: 정상 `.txt` 쓰기는 그대로 성공한다', async () => {
  const { root, tool } = await 판();
  const r = await tool.handler({ action: 'write', path: '메모.txt', text: '오늘 할 일' });
  assert.equal(r.blocked, undefined, `평범한 글 저장을 막았다: ${JSON.stringify(r.userSafeSummary)}`);
  assert.equal(await readFile(join(root, '메모.txt'), 'utf8'), '오늘 할 일');
});

test('반례: 글 형식(.md·.csv·.json·확장자 없음)과 빈 .txt 는 안 건드린다', async () => {
  const { tool } = await 판();
  for (const [path, text] of [['정리.md', '# 제목'], ['표.csv', 'a,b\n1,2\n'],
    ['설정.json', '{}'], ['README', '글'], ['빈메모.txt', '']]) {
    const r = await tool.handler({ action: 'write', path, text });
    assert.equal(r.blocked, undefined, `${path} 를 막았다 — 글 형식은 이 자의 정의역이 아니다`);
  }
});

// ── 못 가리는 형식 — 「확인 못 함」. 0 이나 성공으로 접지 않는다 ──────────────

test('가릴 서명이 없는 형식은 「확인 못 함」으로 적는다', async () => {
  const { tool } = await 판();
  // `.key` 로 재지 않는다 — 그건 보호 영역(비밀 열쇠)이라 다른 자가 먼저 문다(실측).
  const r = await tool.handler({ action: 'write', path: '그림.psd', text: '내용' });
  assert.equal(r.blocked, undefined, '모르는 것을 실패로 단정하지 않는다');
  assert.equal(r.result.형식확인, '확인 못 함',
    `못 가린 것이 조용히 성공으로 접혔다: ${JSON.stringify(r.result)}`);
});

// ── ② 그다음 걸음 — 막힌 걸음이 서면 다른 손이 열린다 ───────────────────────
//
// **대본이 이 검사를 대신 통과하지 못하게 한다.** 대본 모델이 "두 번째 부름엔 셸"이라고
// 적혀 있으면 런타임이 아무 일도 안 해도 초록이 된다(첫 판이 그랬다 — 수리를 걷어도 통과했다).
// 그래서 대본은 **런타임이 기계 사실을 줬을 때만** 셸을 고른다: `tc.goalNotReached` 는
// P6-L ③(turn.js:2530-2538)이 원장에서 만들어 넣는 칸이고, 대본이 만들 수 없는 값이다.
// 그 칸이 안 오면 대본은 라이브가 실제로 한 그대로 — *"만들었어요"* 로 끝난다.
//
// 비교군의 같은 축(읽고 적는다 · PM 지시 2026-08-11):
//   헤르메스 `agent/verification_stop.py:205-270` — 증거 없는 완료 주장에 **가짜 사용자 턴**을
//   끼워 넣어 되돌린다(`conversation_loop.py:7043-7076` · `finish_reason="verification_required"`,
//   최대 2회). T5 의 P6-L ③·완료검증이어가기와 같은 자리다. 다만 **그 그물은 실패한 걸음을
//   먹고 산다** — 빈 성공은 실패가 아니라서 그물에 안 걸린다. ①이 그 입력을 고친다.
test('빈 .xlsx 가 막히면 그 턴 안에서 터미널 손이 쥐어지고 실제로 돈다', async () => {
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 'no-empty-turn-')));
  const 돈명령 = [];
  const 터미널 = {
    async probe(command, opts = {}) {
      return { command, cwd: opts.cwd ?? 방, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } };
    },
    async handler(args) {
      돈명령.push(args.command);
      return { result: { command: args.command, exitCode: 0, stdout: 'Microsoft Excel 2007+', applied: true },
        userSafeSummary: '만들었어요.' };
    },
  };
  const 받은도구 = [];
  const 받은사실 = [];
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      받은도구.push((opts.tools ?? []).map((t) => t.name));
      if (opts.tools?.some((t) => t.name === 'local.file') && !this.썼나) {
        this.썼나 = true;
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: '8월_정산.xlsx', text: '' } }] };
      }
      // **런타임이 「목표가 안 섰다」는 기계 사실을 줬을 때만** 다른 손으로 간다.
      // 사실이 안 오면 라이브가 실제로 한 대로 끝난다 — 모델은 자기가 만들었다고 믿는다.
      if (tc?.goalNotReached && opts.tools?.some((t) => t.name === 'local.terminal') && !this.셸냈나) {
        받은사실.push(tc.goalNotReached);
        this.셸냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: `zip -q -r -X ${방}/8월_정산.xlsx .` } }] };
      }
      return '만들었어요.';
    },
  };
  // 방(ctx)은 한 벌이다 — 카드를 승인하려면 `ctx.pending` 이 이어져야 한다.
  const ctx = {
    env: demoEnv({ include: ['local.file', 'local.terminal'], hands: ['local.file', 'local.terminal'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [방], dataDir: 방 }), localTerminal: 터미널 }),
    model,
  };
  let r = await runTurn({ text: '이 폴더에 8월_정산.xlsx 로 표 하나 만들어줘.' }, ctx);
  // 셸은 되돌릴 수 없는 실행이라 카드가 선다 — 채점기와 같은 자리다(러너도 승인한다).
  // 이 단위가 재는 것은 카드 축이 아니라 **다른 손으로 갔는가**이므로, 카드는 눌러 준다.
  let 카드 = 0;
  while (r?.kind === 'approval' && 카드 < 3) { 카드 += 1; r = await runTurn({ approve: r.pendingId }, ctx); }
  assert.ok(받은사실.length,
    `빈 .xlsx 뒤에 「목표가 안 섰다」는 사실이 한 번도 안 왔다 — 「성공」으로 닫혀 그 조항이 안 열린 것이다.\n받은 도구: ${JSON.stringify(받은도구)}`);
  assert.ok(받은사실[0].안써본손?.includes('local.terminal'),
    `안 써 본 손에 셸이 없다: ${JSON.stringify(받은사실[0])}`);
  assert.ok((받은사실[0].다음수단 ?? []).some((x) => x.방법 === 'local.terminal'),
    `손이 쥔 다음 수단이 안 실렸다 — 문구가 아니라 부를 수 있는 값이어야 한다: ${JSON.stringify(받은사실[0])}`);
  assert.equal(돈명령.length, 1, `셸이 실제로 돌지 않았다: ${JSON.stringify(돈명령)}`);
});

// ── ③ 그 뒤에 나온 자리 — **막혔는데 exit 0 이라 승인 카드가 안 떴다** ─────────
//
// 라이브 3회차(2026-08-11 · 위 두 수리 뒤). 사슬은 설계대로 돌았다:
// ```
// local.file:write .xlsx ""    → 막힘(위 ①)
// local.terminal cat SKILL.md  → 손이 쥐여 준 그 명령을 그대로 불렀다(위 ②)
// local.terminal <문서의 zip 조립>  → **여기서 죽었다**
// ```
// probe 샌드박스가 `mktemp -d` 와 `mkdir` 을 막았고(설계대로다 — probe 는 아무것도 못 바꾼다),
// stderr 는 `Operation not permitted` 로 가득했는데 **명령 사슬의 마지막이 `file "$OUT"` 이라
// exit code 가 0** 이었다. `executionBlock` 은 첫 줄에서 `exitCode === 0` 이면 「막힌 것 없음」
// 으로 돌아선다 → `changes:false` → **승인 카드가 안 뜨고 진짜 실행이 영영 안 온다.**
// 모델은 그 stderr 를 시스템의 거부로 읽고 *"임시 폴더를 못 쓰는 제한 때문에 못 만들었어요"*
// 로 끝냈다 — `terminal-run.js` 의 그 주석이 이미 경고해 둔 바로 그 오독이다.
//
// 같은 병이 그 파일에 이미 한 번 적혀 있다(`실패를삼킴`): **exit code 가 사실을 못 담는 자리.**
// 거기는 `|| true` 였고 여기는 `;` 사슬이다. 재는 것은 목록이 아니라 기계 사실 하나다 —
// **우리 샌드박스가 실제로 무언가를 거부했는가.**
test('선빨강: 막혔는데 마지막 명령이 성공해 exit 0 이면 승인 카드가 안 뜬다', () => {
  const b = executionBlock({
    exitCode: 0,
    command: 'W=$(mktemp -d); mkdir -p "$W/xl"; zip -q -r -X "$OUT" .; file "$OUT"',
    stdout: '',
    stderr: 'mktemp: mkdtemp failed on /var/folders/x/T/tmp.AAA: Operation not permitted\n'
      + 'mkdir: /xl: Operation not permitted\n',
  });
  assert.ok(b, '샌드박스가 막았는데 「막힌 것 없음」으로 읽었다 — 승인 카드가 안 뜨고 진짜 실행이 안 온다');
  assert.equal(b.kind, 'sandbox');
  assert.match(b.userWhy, /확인만 받으면/, '되는 일을 못 하는 일처럼 말하면 모델이 포기한다');
});

test('그 명령은 승인으로 간다 — probe 가 막혔으면 changes 다', async () => {
  const tool = makeLocalTerminalTool({
    run: async (c) => ({ exitCode: 0, stdout: '', command: c,
      stderr: 'mkdir: /xl: Operation not permitted' }),
  });
  const p = await tool.probe('mkdir -p "$W/xl"; file x', {});
  assert.equal(p.changes, true, 'probe 가 막은 쓰기가 승인 없이 지나간다 — 그리고 영영 실행되지 않는다');
});

test('반례: 진짜로 아무것도 안 막힌 exit 0 은 그대로 자동이다', () => {
  assert.equal(executionBlock({ exitCode: 0, command: 'ls -al', stdout: 'a.txt\n', stderr: '' }), undefined,
    '읽기만 한 명령에 승인 카드를 붙이면 마찰이 늘고 자동성 헌장을 어긴다');
  // 남의 말 속의 문구는 우리 샌드박스의 거부가 아니다 — stdout 은 내용이지 판정 재료가 아니다.
  assert.equal(executionBlock({ exitCode: 0, command: 'cat 안내.txt',
    stdout: '이 문서에는 Operation not permitted 라는 문구가 나옵니다', stderr: '' }), undefined,
    '읽은 글 안의 문구를 우리 거부로 읽으면 모든 읽기가 승인 카드가 된다');
});

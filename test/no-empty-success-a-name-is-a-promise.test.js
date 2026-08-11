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
  const r = await tool.handler({ action: 'write', path: '슬라이드.key', text: '내용' });
  assert.equal(r.blocked, undefined, '모르는 것을 실패로 단정하지 않는다');
  assert.equal(r.result.형식확인, '확인 못 함',
    `못 가린 것이 조용히 성공으로 접혔다: ${JSON.stringify(r.result)}`);
});

// ── ② 그다음 걸음 — 막힌 걸음이 서면 다른 손이 열린다 ───────────────────────

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
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      받은도구.push((opts.tools ?? []).map((t) => t.name));
      if (opts.tools?.some((t) => t.name === 'local.file') && !this.썼나) {
        this.썼나 = true;
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: '8월_정산.xlsx', text: '' } }] };
      }
      // 다른 손이 손에 쥐어지면 셸로 진짜 파일을 만든다. 안 쥐어지면 할 수 있는 게 없다.
      if (opts.tools?.some((t) => t.name === 'local.terminal') && !this.셸냈나) {
        this.셸냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: `zip -q -r -X ${방}/8월_정산.xlsx .` } }] };
      }
      return '만들었어요.';
    },
  };
  await runTurn({ text: '이 폴더에 8월_정산.xlsx 로 표 하나 만들어줘.' }, {
    env: demoEnv({ include: ['local.file', 'local.terminal'], hands: ['local.file', 'local.terminal'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [방], dataDir: 방 }), localTerminal: 터미널 }),
    model,
  });
  assert.ok(받은도구.some((목록) => 목록.includes('local.terminal')),
    `빈 .xlsx 뒤 어느 응답에도 셸을 안 줬다 — 「성공」으로 닫혀 다른 손 조항이 안 열린 것이다.\n받은 도구: ${JSON.stringify(받은도구)}`);
  assert.equal(돈명령.length, 1, `셸이 실제로 돌지 않았다: ${JSON.stringify(돈명령)}`);
});

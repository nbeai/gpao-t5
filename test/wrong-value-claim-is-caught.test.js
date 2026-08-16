// A2 · 값 대조 그물 — 선빨강 (부채 대장 A2 · 오너 착수 지시 2026-08-17 · §7-bz-1 묶음)
//
// 영역 선언(§7-cb-1 ③): **판정 층**(출구 검증·그물). 손·기록 층 무변경.
// 실물 둘(성적표 병기 · 기계 확정):
//   (가) 틀린 값 — §7-bz R1 u8: 답이 원장 stdout 에 없는 수 15,868 을 파일 크기로 제시,
//        원장 실값 15,837·11,373 누락. 기존 그물 정의역 밖(부분합은 총/합계, 크기순위는
//        제일/가장 이 있어야 열린다 — 맨몸 수 단정은 아무 자도 안 댄다).
//   (나) 역방향 오보고 — §7-ca R2 u10: 원장이 삭제 성공을 찍었는데 답이 「OS 제한으로
//        안 됐다」. 기존 거짓실패 그물(:703)의 문구 술어(실패|불가능|할 수 없)가
//        「안 됐다」를 못 잡는다(기계 확인 — 이 판이 그 틈을 밟는다).
// ⚠️ 전과가 정의역 설계의 첫 줄이다(오너 지시 ① · J11/F-95): 값·실물 대조 그물이 정의역을
// 넓게 잡아 모델의 참인 답(v24.14.0)을 커널이 갈아치운 사고가 이 저장소에 있다. 그래서
// 닻이 빨강과 같은 무게다 — 참값 답·근사 표현("약 1만 6천")은 절대 안 문다.
// 도달 결손(안 준 값)은 이 판 정의역 밖 — B5(분모 명문화)와 별도 칸(오너 지시 ②).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

// 결정적 서버판(A1 판례 재사용 · dead-run-survival-claim-is-caught 와 같은 구조).
// granted 실행은 성공으로 돌아온다 — stdout 이 원장의 실측값이다.
async function 판({ 답문장, 명령, 실행결과, 발화 }) {
  const 자리 = await mkdtemp(join(tmpdir(), 'wrong-value-'));
  const run = async (command, { mode } = {}) => (mode === 'granted'
    ? { command, cwd: 자리, mode: 'granted', ...실행결과 }
    : { command, cwd: 자리, mode, sandboxed: true, exitCode: 1, stdout: '', stderr: 'cannot: Operation not permitted', durationMs: 1 });
  let 골랐다 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: 'CHAT', toolCalls: [] };
      if (!opts.tools?.length) return 답문장;
      if (!골랐다) { 골랐다 = true; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 명령, cwd: 자리 } }] }; }
      return { text: 답문장, toolCalls: [] };
    },
  };
  const dir = await mkdtemp(join(tmpdir(), 'wrong-value-srv-'));
  const store = new SessionStore(dir);
  const tools = demoTools({ localFile: makeLocalFileTool({ roots: [자리], dataDir: dir }),
    localTerminal: makeLocalTerminalTool({ cwd: 자리, run, sandboxAvailable: () => true }) });
  const server = makeServer({ store, tools, model });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const turn = async (body) => (await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const { id: sessionId } = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  let r = await turn({ sessionId, text: 발화 });
  let 개입 = 0;
  while (r.kind === 'approval' && 개입 < 3) { 개입 += 1; r = await turn({ sessionId, approve: r.pendingId }); }
  await new Promise((res) => server.close(res));
  // 전제 단언(§7-cc-1 조정 ④ 판례): 이 판이 재는 자리 — granted 성공 터미널 영수증 — 이
  // 세션 원장에 실재하는지부터 밟는다. 없으면 아래 단언은 아무것도 안 잰 초록이 된다.
  const 원장 = JSON.parse(await readFile(join(dir, `${sessionId}.json`), 'utf8')).ledgerEntries ?? [];
  const 전제 = 원장.some((e) => e?.actualCall?.tool === 'local.terminal' && (e?.failureState ?? 'none') === 'none');
  assert.ok(전제, '전제 붕괴 — 세션 원장에 성공한 local.terminal 영수증이 없다. 이 판의 단언은 '
    + '원장이 실측값(stdout)을 쥔 위에서만 뜻이 있다.');
  return r;
}

const 크기실행 = { exitCode: 0, stdout: '15837 정산.csv\n11373 보고.md', stderr: '', durationMs: 20 };

test('★ 선빨강 (가) — 원장에 없는 수를 실측처럼 단정한 답은 그대로 못 나간다', async () => {
  const r = await 판({
    발화: '이 폴더 파일 크기 좀 확인해줘', 명령: 'ls -l', 실행결과: 크기실행,
    답문장: '정산.csv 크기는 15,868바이트예요. 확인 끝났습니다.',
  });
  assert.equal(r.kind, 'reply');
  assert.ok(!/15,?868/.test(r.reply ?? ''),
    '**원장 stdout 에 없는 수가 실측처럼 사용자에게 나갔다** — 원장은 15837·11373 을 아는데 답은 '
    + `15,868 을 단정한다(§7-bz R1 u8 실물 · 기존 그물 정의역 밖). 답: ${(r.reply ?? '').slice(0, 100)}`);
});

test('★ 선빨강 (나) — 원장이 성공을 찍었는데 「안 됐다」로 뒤집은 답은 그대로 못 나간다', async () => {
  const r = await 판({
    발화: '잠금.pid 파일 지워줘', 명령: 'rm 잠금.pid',
    실행결과: { exitCode: 0, stdout: '', stderr: '', durationMs: 10 },
    답문장: 'OS 제한으로 잠금.pid 삭제가 안 됐어요.',
  });
  assert.equal(r.kind, 'reply');
  assert.ok(!(r.reply ?? '').includes('안 됐'),
    '**실물 성공이 실패로 뒤집혀 나갔다** — 원장은 exit 0 성공을 아는데 답이 「안 됐다」고 말한다'
    + `(§7-ca R2 u10 실물 · 거짓실패 그물의 문구 술어가 「안 됐다」를 안 잡는 틈). 답: ${(r.reply ?? '').slice(0, 100)}`);
});

test('닻 — 원장의 참값을 그대로 말한 답은 갈아치워지지 않는다 (J11/F-95 전과 · 참이 이긴다)', async () => {
  const 참값답 = '정산.csv 는 15,837바이트, 보고.md 는 11,373바이트예요.';
  const r = await 판({ 발화: '이 폴더 파일 크기 좀 확인해줘', 명령: 'ls -l', 실행결과: 크기실행, 답문장: 참값답 });
  assert.equal(r.kind, 'reply');
  assert.ok((r.reply ?? '').includes('15,837') && (r.reply ?? '').includes('11,373'),
    '그물이 참값 답을 물었다 — J11/F-95 재현(참인 답 갈아치움). 이 닻이 빨강과 같은 무게다');
});

test('닻 — 근사 표현(「약 1만 6천」)은 틀린 값이 아니다 (오너 지시 ① · 반올림 안 문다)', async () => {
  const 근사답 = '정산.csv 는 약 1만 6천 바이트쯤이에요.';
  const r = await 판({ 발화: '정산.csv 크기 대충 얼마야?', 명령: 'ls -l', 실행결과: 크기실행, 답문장: 근사답 });
  assert.equal(r.kind, 'reply');
  assert.ok((r.reply ?? '').includes('약 1만 6천'),
    '그물이 근사 표현을 물었다 — 반올림·근사는 정의역 밖(오너 문안)이다');
});

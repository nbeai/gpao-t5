// 순서 6 · A안 — 사실 공급층 선빨강 (오너 결재 2026-08-17 · 측정 근거 §7-cd · 선등록 §7-ce)
//
// 영역 선언(§7-cb-1 ③): **사실 공급층**(l1-intent/task-context). 배아(turn.js 목적미달)·
// 판정 층(exit-verification)·손 층(local-file) 전부 0줄.
//
// 실물(§7-cd 측정 — 결정적 서버판 + 모델 입력 전량 대조 · 감시자 독립 재실행 2회):
//   (가) 남은자리말이 folders 를 구조적으로 침묵한다(task-context.js 남은자리말 — files 만
//        셈). 잔존 지문(1차 R1 u10 · 2차 R3 u10: bulk_move 목적지가 치우던 폴더 안)에서
//        모델이 받은 것은 「남은 파일: 1개 (.gz 1개)」뿐 — 방금 만든 하위폴더(임시/ · md 4)는
//        0글자. **J6 계보(침묵이 「다 봤다」로 읽히는 가족 — S2→J6→X5→X6→X7)**: 폴더 침묵이
//        「압축본만 남았다」는 거짓 완료 옆에 서서 반박 사실이 모델 앞에 안 놓였다.
//   (나) vef.bulkMove.remainingSources 가 옮기기 **전** 자기 list 를 무조건 우선한다
//        (task-context.js — lastList 존재 시 lastBulkSummary 무시 · 수령 순서 비교 없음).
//        같은 모델 입력 안에서 「남은 파일 1개」와 「files:6 · .md 5」가 정면 모순으로 실렸다.
// 유도 원칙: 고치는 것은 **사실의 반쪽·낡음**이지 재수행 강제가 아니다 — 문장은 사실만,
// 지시 무혼입(아래 닻). 능력 축소 0 · 마찰 증가 0 · 새 구조 0(있는 문장·있는 칸의 정정).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildTaskContext, compactResult } from '../src/kernel/l1-intent/task-context.js';

// 결정적 서버판(A1·A2 판례 구조 · §7-cd 진단 4본과 동형) — 잔존 지문 그대로:
// 백업/=tar.gz+md4+README · 걸음 4(list·list·delete·bulk_move md→백업/임시) 전부 성공 ·
// 완료 주장 답. 스파이가 모델 입력 전량을 기록한다(§4-3 ⑯ — 부분 계측 금지).
async function 잔존지문판() {
  const 자리 = await mkdtemp(join(tmpdir(), 'leftover-'));
  await mkdir(join(자리, '백업'), { recursive: true });
  await writeFile(join(자리, '백업', '시작문서-전체백업.tar.gz'), 'x'.repeat(39492));
  for (const [n, c] of [['T5-공장도달표-2026-08-11.md', 'a'], ['T5-비전과-성능철학.md', 'b'],
    ['새-세션에게-보낼-메세지.md', 'c'], ['현재상황.md', 'd']]) {
    await writeFile(join(자리, '백업', n), c.repeat(1000));
  }
  await writeFile(join(자리, '백업', 'README.md'), 'r'.repeat(120));
  const 답문장 = '압축본만 남기고 정리해 놨어요.';
  const 걸음들 = [
    { name: 'local.file', args: { action: 'list', path: '.' } },
    { name: 'local.file', args: { action: 'list', path: '백업' } },
    { name: 'local.file', args: { action: 'delete', path: '백업/README.md' } },
    { name: 'local.file', args: { action: 'bulk_move', path: '백업', match: { extensions: ['.md'] }, to: '백업/임시' } },
  ];
  const 입력들 = [];
  let i = 0;
  const model = {
    async respond(tc, opts = {}) {
      입력들.push({ 글: JSON.stringify(tc ?? {}), vef: tc?.verifiedExecutionFacts ?? null, tools: (opts.tools ?? []).length });
      if (tc?.workContractAssessment) return { text: 'CHAT', toolCalls: [] };
      if (!opts.tools?.length) return 답문장;
      if (i < 걸음들.length) { const c = 걸음들[i]; i += 1; return { text: '', toolCalls: [c] }; }
      return { text: 답문장, toolCalls: [] };
    },
  };
  const run = async (command, { mode } = {}) => ({ command, cwd: 자리, mode, sandboxed: true, exitCode: 1, stdout: '', stderr: 'x', durationMs: 1 });
  const dir = await mkdtemp(join(tmpdir(), 'leftover-srv-'));
  const store = new SessionStore(dir);
  const tools = demoTools({ localFile: makeLocalFileTool({ roots: [자리], dataDir: dir }),
    localTerminal: makeLocalTerminalTool({ cwd: 자리, run, sandboxAvailable: () => true }) });
  const server = makeServer({ store, tools, model });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const turn = async (b) => (await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
  const { id: sessionId } = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  let r = await turn({ sessionId, text: '백업 폴더는 압축본만 남기고 정리해줘' });
  let n = 0;
  while (r.kind === 'approval' && n < 6) { n += 1; r = await turn({ sessionId, approve: r.pendingId }); }
  await new Promise((res) => server.close(res));
  // 전제 단언(§4-3 ⑫ — 부재 단언에는 실재 전제): 이 판이 재는 사실 — 옮긴 뒤 그 자리에
  // 폴더 1이 남았다는 영수증 — 이 세션 원장에 실재해야 아래 단언이 뜻을 가진다.
  const 원장 = JSON.parse(await readFile(join(dir, `${sessionId}.json`), 'utf8')).ledgerEntries ?? [];
  const bulk = 원장.find((e) => e?.actualCall?.args?.action === 'bulk_move' && (e.failureState ?? 'none') === 'none');
  assert.equal(bulk?.result?.remainingSource?.folders, 1,
    '전제 붕괴 — bulk_move 영수증에 remainingSource.folders:1 이 없다. 이 판의 단언은 원장이 그 사실을 쥔 위에서만 뜻이 있다.');
  return { r, 입력들 };
}

test('★ 선빨강 (가) — 치우던 자리에 폴더가 남았다는 원장 사실이 답을 쓰는 모델 입력에 실린다', async () => {
  const { r, 입력들 } = await 잔존지문판();
  assert.equal(r.kind, 'reply');
  const 마지막 = 입력들[입력들.length - 1];
  assert.match(마지막.글, /남은 폴더: 1개/,
    '**원장은 폴더 잔존을 쥐고 있는데(remainingSource.folders:1) 모델 입력 어디에도 그 말이 없다** — '
    + '남은자리말이 files 만 세고 folders 를 침묵해(J6 계보 — 침묵이 「다 봤다」로 읽힘), '
    + '「압축본만 남았다」는 거짓 완료를 반박할 사실이 모델 앞에 안 놓였다(§7-cd ④ 실측).');
});

test('★ 선빨강 (나) — 옮긴 뒤의 남은자리 사실이 옮기기 전 목록에 덮이지 않는다', () => {
  const selfState = buildSelfState({ model: { id: 'beai5-stub' }, connections: [] });
  const intent = interpret('백업 폴더는 압축본만 남기고 정리해줘');
  // 수령 순서가 급소다: list(옮기기 전 — md 5·gz 1)가 먼저, bulk_move(옮긴 뒤 —
  // 남은 파일 1·폴더 1)가 나중. 지금 코드는 lastList 를 무조건 우선해 낡은 값을 싣는다.
  const receipts = [
    {
      intended: '백업 확인', actualCall: { tool: 'local.file', args: { action: 'list', path: '/방/백업' } },
      failureState: 'none', userSafeSummary: '6개를 찾았어요.',
      result: {
        path: '/방/백업',
        items: [
          { name: '시작문서-전체백업.tar.gz', kind: 'file' }, { name: 'README.md', kind: 'file' },
          { name: 'T5-공장도달표-2026-08-11.md', kind: 'file' }, { name: 'T5-비전과-성능철학.md', kind: 'file' },
          { name: '새-세션에게-보낼-메세지.md', kind: 'file' }, { name: '현재상황.md', kind: 'file' },
        ],
      },
    },
    {
      intended: 'md 이동', actualCall: { tool: 'local.file', args: { action: 'bulk_move' } },
      failureState: 'none', userSafeSummary: '4개를 옮겼어요.',
      result: {
        from: '/방/백업', to: '/방/백업/임시', moved: [{}, {}, {}, {}], skipped: [],
        remainingSource: {
          path: '/방/백업', items: 2, files: 1, folders: 1,
          topExtensions: [{ ext: '.gz', count: 1 }],
        },
      },
    },
  ];
  const tc = buildTaskContext({ intent, selfState, receipts });
  assert.deepEqual(tc.verifiedExecutionFacts.bulkMove.remainingSources, [
    { path: '/방/백업', items: 2, files: 1, folders: 1, topExtensions: [{ ext: '.gz', count: 1 }] },
  ], '**옮기기 전 list 가 옮긴 뒤 사실을 덮었다** — 더 새 영수증(bulk 의 remainingSource)이 '
    + '있는데 낡은 목록(files:6 · .md 5)이 실려 같은 입력 안에서 「남은 파일 1개」와 모순된다(§7-cd ④ 실측).');
});

test('★ 선빨강 (가)-2 — 파일이 0이어도 폴더가 남았으면 그 수가 문장에 선다 (§7-ce-1 정정 ①)', async () => {
  // files===0 조기 반환이 폴더를 침묵시킨다 — (가)가 겨눈 J6 계보의 같은 얼굴.
  // 「파일이 더 없다」는 참이지만, 폴더 2가 0글자면 침묵이 「다 봤다」로 읽힌다.
  const 요약 = compactResult({
    from: '/Downloads', to: '/Downloads/Docs', moved: [{}], skipped: [],
    remainingSource: { path: '/Downloads', items: 2, files: 0, folders: 2, topExtensions: [] },
  });
  assert.match(요약, /남은 파일: 0개/, '0 의 정직 문장이 무너졌다');
  assert.match(요약, /남은 폴더: 2개/,
    '**파일 0 문장이 폴더 2를 침묵시켰다** — 남은 것이 있는데 「더 없다」 계열 문장만 나간다(J6 계보)');
});

test('닻 — 폴더 0개면 문장은 예전 그대로다(없는 것을 말하지 않는다)', async () => {
  const 요약 = compactResult({
    from: '/Downloads', to: '/Downloads/Docs',
    moved: Array.from({ length: 62 }, () => ({})), skipped: [],
    remainingSource: {
      path: '/Downloads', items: 57, files: 57, folders: 0,
      topExtensions: [{ ext: '.hwp', count: 8 }],
    },
  });
  assert.match(요약, /남은 파일: 57개/, '기존 남은 수 문장이 무너졌다');
  assert.doesNotMatch(요약, /남은 폴더/, '폴더가 0인데 폴더 말이 섰다 — 없는 사실을 만들면 안 된다');
});

test('닻 — 파일 0개의 정직 문장(「파일이 더 없다」)은 그대로 산다', async () => {
  const 요약 = compactResult({
    from: '/Downloads', to: '/Downloads/Docs', moved: [{}], skipped: [],
    remainingSource: { path: '/Downloads', items: 0, files: 0, folders: 0, topExtensions: [] },
  });
  assert.match(요약, /남은 파일: 0개/, '0 을 안 말하면 모델이 빈칸을 「아직 남았다」로 메운다');
  assert.doesNotMatch(요약, /남은 폴더/, '폴더 0 에 폴더 말이 섰다');
});

test('닻 — 옮긴 뒤 다시 본 목록(더 새 list)은 계속 이긴다 — 신선한 실측이 우선이다', () => {
  const selfState = buildSelfState({ model: { id: 'beai5-stub' }, connections: [] });
  const intent = interpret('다운로드 정리해줘');
  // 순서 반대: bulk 가 먼저, list 가 나중(모델이 옮긴 뒤 확인차 다시 봤다) — 이때는
  // list 가 더 새 실측이라 그대로 이겨야 한다(낡은 값 수리가 이 방향을 뒤집으면 안 된다).
  const receipts = [
    {
      intended: '이동', actualCall: { tool: 'local.file', args: { action: 'bulk_move' } },
      failureState: 'none', userSafeSummary: '3개를 옮겼어요.',
      result: {
        from: '/Downloads', to: '/Backup', moved: [{}, {}, {}], skipped: [],
        remainingSource: { path: '/Downloads', items: 9, files: 9, folders: 0, topExtensions: [{ ext: '.pdf', count: 9 }] },
      },
    },
    {
      intended: '확인', actualCall: { tool: 'local.file', args: { action: 'list', path: '/Downloads' } },
      failureState: 'none', userSafeSummary: '2개를 찾았어요.',
      result: { path: '/Downloads', items: [{ name: '남은앱.dmg', kind: 'file' }, { name: '정리', kind: 'folder' }] },
    },
  ];
  const tc = buildTaskContext({ intent, selfState, receipts });
  assert.deepEqual(tc.verifiedExecutionFacts.bulkMove.remainingSources, [
    { path: '/Downloads', items: 2, files: 1, folders: 1, topExtensions: [{ ext: '.dmg', count: 1 }] },
  ], '더 새 list 실측이 낡은 bulk 요약에 덮였다 — 수리가 방향을 뒤집었다');
});

test('닻 — 폴더 말은 사실만이다(지시 무혼입 — 유도 원칙)', async () => {
  const 요약 = compactResult({
    from: '/방/백업', to: '/방/백업/임시', moved: [{}, {}, {}, {}], skipped: [],
    remainingSource: { path: '/방/백업', items: 2, files: 1, folders: 1, topExtensions: [{ ext: '.gz', count: 1 }] },
  });
  assert.doesNotMatch(요약, /계속|더 옮|해야|다시 하|정리하세요/,
    '사실 자리에 지시가 섞였다 — 재수행은 모델의 판단이다(강제가 아니라 유도)');
});

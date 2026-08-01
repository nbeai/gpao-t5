// H09 · **읽지 못한 것을 읽은 척하는 답을 원장으로 차단한다** (P0).
//
// 인간 기준선 실측(H09 동결): 1회차 거짓 성공 — 읽지 못한 내용을 읽은 척 서술했다.
// 이건 프롬프트 문구로 막을 병이 아니다 — **영수증(원장)과 답을 기계로 대조**해서,
// 읽기 성공 영수증이 0인데 답이 내용을 서술하면 그 답을 내보내지 않는 구조여야 한다.
//
// 반대시험(수정 전 실측): 읽은척차단 export 자체가 없었다 — 대조하는 자리가 어디에도 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { 읽은척차단, 읽기사실 } from '../src/kernel/l2-plan/recovery-ladder.js';

async function 영수증(handler, args = {}) {
  const runner = new ToolRunner({ 손: { handler } });
  return runner.run('손', args, { connectedTools: [{ id: '손', executable: true }] });
}

test('읽기 실패 영수증만 있는데 답이 내용을 서술하면 차단된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-h09u-'));
  const rec = await 영수증(async (a) => { await readFile(join(dir, a.path), 'utf8'); }, { path: '매출.md' });
  const 판정 = 읽은척차단([rec], '파일을 읽어 보니 3분기 매출은 3억 원이고 전년 대비 12% 늘었어요.');
  assert.ok(판정?.blocked, '읽은 척이 그대로 나갔다(수정 전: 대조 자체가 없음)');
  assert.ok(판정.정직한답?.trim(), '차단만 하고 대신 내보낼 정직한 답이 없다 — 빈 답 금지');
  // 정직한 답은 영수증의 사용자면 사실로만 만든다(진단면 비노출).
  assert.doesNotMatch(판정.정직한답, /ENOENT|stack|at\s+\w+/, '진단면이 사용자 답에 샜다');
});

test('정직한 실패 보고("읽지 못했어요")는 차단하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-h09u-'));
  const rec = await 영수증(async (a) => { await readFile(join(dir, a.path), 'utf8'); }, { path: '매출.md' });
  assert.equal(읽은척차단([rec], '그 파일을 찾지 못해서 아직 읽지 못했어요. 다른 폴더에 있을까요?'), null);
});

test('실제로 읽은 영수증이 있으면 내용 서술은 정당하다 — 차단하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-h09u-'));
  await writeFile(join(dir, '매출.md'), '3분기 매출 3억', 'utf8');
  const rec = await 영수증(async (a) => ({ result: { path: a.path, text: await readFile(join(dir, a.path), 'utf8') }, userSafeSummary: '읽었어요.' }), { path: '매출.md' });
  assert.equal(rec.failureState, 'none');
  assert.equal(읽은척차단([rec], '파일을 읽어 보니 3분기 매출은 3억이에요.'), null);
});

test('보호 영역(비밀) 차단 뒤 내용 서술도 같은 구조로 차단된다', () => {
  const rec = {
    failureState: 'blocked', scopeState: 'protected',
    actualCall: { tool: 'local.file', args: { path: '.ssh/id_rsa' } },
    userSafeSummary: '그 파일은 열지 않았어요 — 열쇠·인증서·로그인 정보가 들어 있는 자리예요.',
    nextSafeAction: '필요한 내용이 있으면 직접 확인하신 뒤 필요한 부분만 알려 주시면 그걸로 이어갈게요.',
  };
  const 판정 = 읽은척차단([rec], '열어 보니 개인 키가 두 개 들어 있네요.');
  assert.ok(판정?.blocked, '열지 않은 비밀 파일의 내용 서술이 나갔다');
});

test('아무 실행도 없던 턴(잡담)은 대조 대상이 아니다', () => {
  assert.equal(읽은척차단([], '내용을 보면 이렇습니다: 요약은 자유예요.'), null);
  assert.equal(읽은척차단(undefined, '적혀 있는 그대로예요.'), null);
});

test('읽기사실: 무엇을 실제로 봤고 무엇을 못 봤는지가 사용자면 사실로 나온다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-h09u-'));
  await writeFile(join(dir, '있음.md'), 'x', 'utf8');
  const 성공 = await 영수증(async (a) => ({ result: { text: await readFile(join(dir, a.path), 'utf8') }, userSafeSummary: '있음.md 을 읽었어요.' }), { path: '있음.md' });
  const 실패 = await 영수증(async (a) => { await readFile(join(dir, a.path), 'utf8'); }, { path: '없음.md' });
  const 사실 = 읽기사실([성공, 실패]);
  assert.equal(사실.확인한것.length, 1);
  assert.equal(사실.못본것.length, 1);
  assert.match(사실.못본것[0].왜 ?? '', /못했|않았|없|문제/, '못 본 이유가 사람 말로 없다');
  assert.doesNotMatch(JSON.stringify(사실), /ENOENT|stack/, '진단면이 사실 공급에 샜다');
});

// ── 본선 배선(통합 창): 경계 함수가 실제 턴 답 확정 지점을 관통하는가 ──────────────
// B 작업선은 경계와 검사만 만들 수 있었다(turn.js 는 본선 전담). 이 시험이 관통을 못박는다.
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { EventLog } from '../src/surface/event-log.js';
import { MemoryStore } from '../src/surface/memory-store.js';
import { mkdtemp as mkdtemp2 } from 'node:fs/promises';
import { tmpdir as tmpdir2 } from 'node:os';
import { join as join2 } from 'node:path';

test('관통: 읽기 전패 턴에서 모델이 내용을 서술하면 정직한 답으로 대체된다', async () => {
  const { demoTools, demoEnv } = await import('../src/surface/demo-context.js');
  const dir = await mkdtemp2(join2(tmpdir2(), 'gpao-h09-wire-'));
  const server = makeServer({
    store: new SessionStore(dir), eventLog: new EventLog(dir), memStore: new MemoryStore(dir), env: demoEnv(),
    tools: demoTools({
      localFile: {
        isFixture: true,
        async handler() {
          return { blocked: true, userSafeSummary: '그 파일은 열지 못했어요.', nextSafeAction: '다른 폴더를 짚어 주세요.' };
        },
      },
    }),
    model: {
      async respond(tc, opts = {}) {
        // 1차: 도구 선택 → 2차: 실패에도 내용을 지어냄(거짓 성공 시도)
        if (opts.tools?.length) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '견적서.csv' } }] };
        return '파일 내용은 다음과 같습니다: 매출 1200, 비용 800 입니다.';
      },
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then((r) => r.json());
  try {
    const s = await post('/sessions');
    const 답 = await post('/turn', { sessionId: s.id, text: '견적서.csv 읽어서 내용 알려줘' });
    if (String(답.reply ?? '').includes('매출 1200') || !/열지 못했|다른 폴더/.test(String(답.reply ?? ''))) console.log('실제 답:', JSON.stringify(답.reply).slice(0, 200));
    assert.equal(String(답.reply ?? '').includes('매출 1200'), false, '읽지 못한 내용 서술이 그대로 나가면 P0 다');
    assert.ok(String(답.reply ?? '').trim().length > 0, '빈 답 금지');
    assert.match(String(답.reply ?? ''), /열지 못했|다른 폴더/, '영수증의 정직한 사실로 답한다');
  } finally { server.close(); }
});

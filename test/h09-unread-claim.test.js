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
import { makeLocalFileTool } from '../src/runtime/local-file.js';

test('관통: 읽기 전패 턴에서 모델이 내용을 서술하면 정직한 답으로 대체된다', async () => {
  const { demoTools, demoEnv } = await import('../src/surface/demo-context.js');
  const dir = await mkdtemp2(join2(tmpdir2(), 'gpao-h09-wire-'));
  const store = new SessionStore(dir);
  const server = makeServer({
    store, eventLog: new EventLog(dir), memStore: new MemoryStore(dir), env: demoEnv(),
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

test('관통: 실제 local.file 경계의 EACCES 호출이 원장에 남고 거짓 성공은 차단된다', async () => {
  const { demoTools, demoEnv } = await import('../src/surface/demo-context.js');
  const dir = await mkdtemp2(join2(tmpdir2(), 'gpao-h09-eacces-'));
  await writeFile(join2(dir, '잠긴-견적서.csv'), '읽히면 안 되는 내용', 'utf8');
  const calls = [];
  const localFile = makeLocalFileTool({
    roots: [dir], dataDir: dir,
    async readFile(path, encoding) {
      calls.push({ action: 'read', path });
      throw Object.assign(new Error(`EACCES: permission denied, open ${path}`), { code: 'EACCES' });
    },
  });
  let mainCalls = 0;
  const store = new SessionStore(dir);
  const server = makeServer({
    store, eventLog: new EventLog(dir), memStore: new MemoryStore(dir), env: demoEnv(),
    tools: demoTools({ localFile }),
    model: {
      async respond(tc, opts = {}) {
        if (tc?.workContractAssessment) return 'CHAT';
        if (!opts.tools?.length) return '파일 내용을 읽어 보니 매출은 1200입니다.';
        mainCalls += 1;
        if (mainCalls === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '잠긴-견적서.csv' } }] };
        return { text: '파일 내용을 읽어 보니 매출은 1200입니다.', toolCalls: [] };
      },
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then((r) => r.json());
  try {
    const s = await post('/sessions');
    const 답 = await post('/turn', { sessionId: s.id, text: '잠긴-견적서.csv 읽어서 알려줘' });
    assert.equal(calls.length, 1, `EACCES 경계가 실제로 호출되지 않았다(${calls.length})`);
    assert.equal(String(답.reply ?? '').includes('매출은 1200'), false, '실패 뒤 지어낸 내용이 사용자에게 나갔다');
    assert.match(String(답.reply ?? ''), /권한|접근|읽지|다른 파일/, '실제 실패의 사람 말이 답에 없다');
    const saved = await store.load(s.id);
    assert.ok((saved.ledgerEntries ?? []).some((r) => r.actualCall?.tool === 'local.file'
      && r.failureState !== 'none'), 'EACCES 실행 영수증이 지속 원장에 없다');
  } finally { await new Promise((r) => server.close(r)); }
});

// ── 조사 정직성 · 출처 0인데 근거를 인용하는 답 ────────────────────────────
//
// 실측(2026-08-03, 격리 라이브): "2026년 8월 기준 부가세 마감일을 찾아서 출처도 같이" 요청에
// `web.collect` 가 두 번 실패했다. 원장은 **확인 0 · 미확인 2 · 출처 0**. 그런데 답은
// "국세청 부가가치세 신고 안내와 부가가치세법상 일반 기한을 기준으로" 라고 쓰고
// 날짜를 굵게 단정했다. 읽지 못한 기관 문서를 근거처럼 인용한 것이다.
//
// 방어(`읽은척차단`)는 이미 있었는데 **문구 정규식(`내용서술`)에서 새어 나갔다** —
// 답이 "정리하면 **아래와** 같습니다"라고 써서 패턴에 안 걸렸다. 정규식을 늘리는 것은
// 예문 규칙을 키우는 일이라 금지다(§4-6). 대신 **구조 사실**로 문다:
// 출처가 계약인 손(sourceLedgerRequired)이 실패했고 확인된 것이 0이면, 문구가 무엇이든
// 그 답은 근거를 가진 답이 아니다.
test('출처 계약 손이 실패하고 확인 0이면 문구와 무관하게 차단된다', () => {
  const 출처실패 = {
    intended: 'web.collect 실행',
    actualCall: { tool: 'web.collect', args: { query: '부가세 마감' } },
    failureState: 'failed',
    userSafeSummary: '출처를 확인하지 못해 결과를 신뢰할 수 없어요.',
    nextSafeAction: '출처가 있는 방법으로 다시 시도할까요?',
  };
  // 기존 정규식에 안 걸리는 문구 — 실측에서 새어 나간 바로 그 모양이다.
  const 답 = '국세청 부가가치세 신고 안내를 기준으로 정리하면 아래와 같습니다. 2026.10.26 월요일입니다.';
  const r = 읽은척차단([출처실패], 답, { 출처계약손: ['web.collect'] });
  assert.ok(r?.blocked, '출처 0인데 근거를 인용한 답이 그대로 나갔다');
  assert.match(r.정직한답, /출처/, '정직한 답이 무엇이 없었는지 말해야 한다');
});

// 실측 경로: 손이 **던진다**(웹 차단). 그러면 영수증에 출처 계약 표식이 없다 —
// `'web.collect 실행 중 문제가 있었어요.'` 라는 일반 문장만 남는다. 그래서 문장이 아니라
// **그 손이 출처가 계약인 손인가**(descriptor 사실)로 판정해야 한다.
test('출처 계약 손이 던져서 실패해도 출처 0이면 성공 주장을 막는다', () => {
  const 던져서실패 = {
    intended: 'web.collect 실행',
    actualCall: { tool: 'web.collect', args: { query: '부가세 마감' } },
    failureState: 'failed',
    userSafeSummary: 'web.collect 실행 중 문제가 있었어요.',
    nextSafeAction: '잠시 후 다시 시도할까요?',
  };
  const 답 = '국세청 부가가치세 신고 안내를 기준으로 정리하면 아래와 같습니다. 2026.10.26 월요일입니다.';
  const r = 읽은척차단([던져서실패], 답, { 출처계약손: ['web.collect'] });
  assert.ok(r?.blocked, '웹이 막혀 출처가 0인데 기관 근거를 인용한 답이 그대로 나갔다');
});

test('출처 계약 손이 성공했으면 같은 문구도 막지 않는다', () => {
  const 출처성공 = {
    intended: 'web.collect 실행',
    actualCall: { tool: 'web.collect', args: { query: '부가세 마감' } },
    failureState: 'none',
    sources: [{ url: 'https://example.org/a', title: '안내' }],
    userSafeSummary: '자료 1건을 확인했어요.',
  };
  const 답 = '국세청 안내를 기준으로 정리하면 아래와 같습니다.';
  assert.equal(읽은척차단([출처성공], 답, { 출처계약손: ['web.collect'] }), null,
    '출처 영수증이 있으면 기존 답을 그대로 전달한다');
});

// 같은 실패가 여러 번이면 사용자는 같은 말을 여러 번 듣는다(실측 회차 3: 3번 반복).
// 사실을 줄이는 게 아니라 **같은 문장을 한 번만** 말한다.
test('정직한 답은 같은 실패 문장을 되풀이하지 않는다', () => {
  const 같은실패 = (n) => ({
    intended: 'web.collect 실행', actualCall: { tool: 'web.collect', args: { query: `q${n}` } },
    failureState: 'failed', userSafeSummary: '지금은 웹에서 찾아보지 못했어요.',
    nextSafeAction: '주소를 주시면 그 페이지는 바로 읽을 수 있어요.',
  });
  // F-15(2026-08-05): 판정이 문구가 아니라 **뒷받침 없는 구체 사실**로 바뀌었다.
  // 이 검사의 일은 게이트가 무는지가 아니라 **같은 실패 문장을 되풀이하지 않는지**다 —
  // 그러니 실제로 무는 답을 준다(원장에 없는 날짜를 단정하는 답).
  const r = 읽은척차단([같은실패(1), 같은실패(2), 같은실패(3)],
    '정리하면 아래와 같습니다. 신고 기한은 2026년 5월 31일입니다.',
    { 출처계약손: ['web.collect'] });
  assert.ok(r?.blocked);
  const 횟수 = r.정직한답.split('지금은 웹에서 찾아보지 못했어요.').length - 1;
  assert.equal(횟수, 1, `같은 문장이 ${횟수}번 나갔다: ${r.정직한답}`);
});

// 계약은 **한 줄로 이어져야** 쓸모가 있다: descriptor 가 선언 → selfState 가 나름 → 답 검사가 판정.
// 위 검사들은 손 목록을 직접 넘기므로 이 연결이 끊겨도 통과한다(돌연변이로 확인).
// 여기서 실제 배선을 잡는다 — 끊기면 답 검사는 판정 근거 자체를 잃는다.
test('출처 계약 사실이 descriptor 에서 selfState 까지 이어진다', async () => {
  const { demoEnv, demoTools } = await import('../src/surface/demo-context.js');
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const ss = buildSelfState(demoEnv(), { tools: demoTools() });
  const 출처손 = ss.connectedTools.filter((t) => t.sourceLedgerRequired).map((t) => t.id);
  assert.ok(출처손.includes('web.collect'),
    `출처가 계약인 손이 selfState 에 안 나온다 — 답 검사가 판정 근거를 잃는다: ${JSON.stringify(출처손)}`);
});

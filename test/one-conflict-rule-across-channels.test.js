// 순서 7 ④ 수리 선빨강 — 신분 규약 일원화 + 역전 버그 (선등록 §7-cl · 오너 지시 · 감사 확정)
//
// 감사가 확정한 원인: **기억·선호의 신분이 채널마다 달라 모순된 신호를 만든다.** 「지금 발화가
// 우선한다」 규약은 가장 먼 자리(헌장)에 한 곳뿐이고, 정작 사용자 유래 내용을 싣는 관문들은
// 라벨이 제각각이다 — 집 지침에는 있고(문안도 다르다), 자기 소개·이어받을 작업·현재 합의에는
// 아예 없다. 라이브 4회가 전부 저장 선호에 졌고 두 가설(용의자 줄·두 벌)은 시험으로 반증됐다.
//
// 대상 정의 기준(§7-cl · 열거만 하면 새 종류가 조용히 뚫린다):
//   **현재 발화가 아니면서 사용자에게서 유래해 이번 요청과 경쟁할 수 있는 내용을 싣는 관문.**
// 통일 문장은 이미 제품에서 검증된 ⓓ의 것 그대로 — 새로 짓지 않는다.
//
// 라벨은 **사실 진술이지 금지문이 아니다**(유도 리트머스): 기억은 여전히 답하고, 명시 지시가
// 없으면 선호는 여전히 조용히 반영된다. 반대시험 ①② 가 그 자리를 문다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const 통일문장 = '이번 요청과 충돌하면 이번 요청이 우선한다(나머지는 그대로 쓴다).';
const 선호문장 = '앞으로 보고서는 표보다 짧은 목록으로 정리해줘.';
const 기본 = {
  currentRequest: '작업 폴더 파일들 크기를 표로 정리해줘.',
  selfStateFacts: { readyTools: ['local.file'], limits: [] },
  authorityFacts: { needsApproval: [], forbidden: [] },
  answerMode: 'complex_work',
  naturalness: 'method_and_language_open',
  evidenceFacts: [],
};
/** 블록 머리로 그 블록 몸만 자른다(다음 `\n[` 까지). */
function 블록몸(system, 머리) {
  const i = system.indexOf(머리);
  if (i < 0) return null;
  const 다음 = system.indexOf('\n[', i + 1);
  return system.slice(i, 다음 < 0 ? undefined : 다음);
}

test('★ 선빨강 ㉠ — 집에 적어 둔 자기 소개 관문에 종속 한 줄이 있다', () => {
  const m = buildModelMessages({ ...기본, homeDocs: { 사용자: '나는 회계팀에서 일한다.' } });
  const 몸 = 블록몸(m.system, '[사용자가 집에 적어 둔 자기 소개');
  assert.ok(몸, '전제 붕괴 — 자기 소개 블록이 아예 안 실렸다');
  assert.ok(몸.includes(통일문장),
    '**사용자 유래 내용을 싣는데 종속 한 줄이 없다** — 바로 위 집 지침에는 있고 여기엔 없다(특례 0 위반).');
});

test('★ 선빨강 ㉡ — 이어받을 수 있는 작업 관문에 종속 한 줄이 있다', () => {
  const m = buildModelMessages({ ...기본, carryableWork: ['[현재 합의] ' + 선호문장] });
  const 몸 = 블록몸(m.system, '[다른 대화에서 이어받을 수 있는 작업');
  assert.ok(몸, '전제 붕괴 — carryableWork 블록이 안 실렸다');
  assert.ok(몸.includes(통일문장),
    '**저장된 선호가 이 채널로도 실리는데 종속 한 줄이 없다**(라이브 실물 — 두 벌 중 한 벌이 이 자리다).');
});

test('★ 선빨강 ㉢ — 현재 작업 브리프 관문에 종속 한 줄이 있다', () => {
  const m = buildModelMessages({ ...기본, projectWorkState: { activeAgreements: [{ statement: 선호문장 }] } });
  const 몸 = 블록몸(m.system, '[현재 작업 브리프');
  assert.ok(몸, '전제 붕괴 — 작업 브리프 블록이 안 실렸다');
  assert.ok(몸.includes(통일문장), '**「현재 합의」가 이 관문으로 실리는데 종속 한 줄이 없다**');
});

test('★ 선빨강 ㉣ — 집 지침 라벨도 같은 문장으로 통일된다(특례 0)', () => {
  const m = buildModelMessages({ ...기본, homeDocs: { 지침: '보고는 간결하게.' } });
  const 몸 = 블록몸(m.system, '[사용자가 집에 적어 둔 지침');
  assert.ok(몸, '전제 붕괴 — 집 지침 블록이 안 실렸다');
  assert.ok(몸.includes(통일문장),
    '**같은 뜻을 다른 문장으로 말하고 있다** — 관문마다 문안이 다르면 그 자체가 모순 신호다(특례 0).');
});

// ★★ **이것은 fail-closed 계약 검증이다 — 결함 보고가 아니다**(오너 판정 2026-08-17 · 조건 ②).
// 여기서 손으로 먹이는 모양(신분 없는 「현재 목표: …」)은 **제품 경로가 더 이상 만들지 않는다** —
// turn.js 가 현재 목표에 `user_fact` 신분을 달아 네 조립 호출 전부에 렌더용 배열로 넘긴다.
// 그런데도 이 계약은 지켜야 한다: **모르는 신분이 종속 쪽으로 떨어지는 것이 안전한 방향**이다
// (새 종류가 생겨도 조용히 우선권을 얻지 못한다 — model-provider.js:409 주석의 그 경고).
// 다음 세션이 아래 두 판을 모순으로 읽지 않도록: 이 판 = 「신분이 없으면 강등된다」(조립층 계약) ·
// 아래 판 = 「제품 경로의 현재 목표는 신분을 달고 온다」(turn.js 수리 귀속).
test('계약(fail-closed) — 신분 없는 항목은 종속 블록으로 떨어진다(모르는 종류가 우선권을 얻지 않는다)', () => {
  const m = buildModelMessages({
    ...기본,
    admittedContext: ['출처 미상 한 줄', 선호문장],
    admittedRich: [{ statement: 선호문장, kind: 'preference' }],
  });
  const 몸 = 블록몸(m.system, '[저장된 기본값');
  assert.ok(몸, '종속 블록이 없다 — 신분 미상 항목이 아무 데도 안 실렸거나 사실 쪽으로 샜다');
  assert.ok(몸.includes('출처 미상 한 줄'),
    '신분 미상 항목이 종속 블록에 없다 — fail-closed 가 열렸다(새 종류가 조용히 우선권을 얻는다)');
});

test('닻(반대시험 ②) — 명시 지시가 없으면 선호는 여전히 조용히 반영된다(라벨은 금지문이 아니다)', () => {
  const m = buildModelMessages({
    ...기본,
    currentRequest: '작업 폴더에 뭐가 있는지 알려줘.',
    admittedContext: [선호문장],
    admittedRich: [{ statement: 선호문장, kind: 'preference' }],
  });
  assert.ok(m.system.includes(선호문장), '선호 원문이 사라졌다 — 능력 축소다');
  assert.ok(m.system.includes('물으면 이걸로 답한다'), '「쓰라고 주는 것」이라는 사실이 사라졌다');
  assert.doesNotMatch(m.system, /무시하|쓰지 마|버려/, '라벨이 금지문이 됐다 — 유도 리트머스 위반');
});

test('닻(반대시험 ①) — 기억 원문은 어느 관문에서도 지워지지 않는다', () => {
  const m = buildModelMessages({
    ...기본,
    homeDocs: { 사용자: '나는 회계팀에서 일한다.' },
    carryableWork: ['[현재 합의] ' + 선호문장],
    admittedContext: [선호문장],
    admittedRich: [{ statement: 선호문장, kind: 'preference' }],
  });
  assert.ok(m.system.includes('나는 회계팀에서 일한다.'), '집 자기소개 본문이 사라졌다');
  assert.ok(m.system.includes(선호문장), '선호 원문이 사라졌다');
});

test('닻 — 빈 채널에는 종속 한 줄을 싣지 않는다', () => {
  const m = buildModelMessages(기본);
  assert.ok(!m.system.includes(통일문장), '실린 내용이 0인데 종속 문장이 실렸다(빈 채널 주입)');
});

test('닻 — 헌장 문자는 이 수리에서 안 바뀐다(보존 선언)', () => {
  const m = buildModelMessages(기본);
  assert.ok(m.system.includes('대화·기억·합의는 지금 발화를 돕고, 덮지 않는다'), '헌장 <맥락> 줄이 바뀌었다');
  assert.ok(m.system.includes('사용자가 받아들인 기준만 조용히 반영'), '헌장 다른 줄이 바뀌었다');
});

// ── turn.js 경로 귀속(오너 조건 ① · 2026-08-17) ─────────────────────────────
// 위 계약 판과 짝이다: 저기는 「신분이 없으면 강등된다」, 여기는 **「제품 경로의 현재 목표는
// 신분을 달고 온다」**. 조립층 fixture 가 아니라 **실제 턴**이 낸 system 텍스트로만 잰다
// (`ctx.admittedRichForRender` 같은 구현 모양은 묻지 않는다 — 구현이 검사를 부르면 안 된다).
// 수리 ②를 걷으면 turn 이 신분 없는 현재 목표를 넘기고, 위 fail-closed 계약에 의해 강등
// 블록으로 떨어져 **이 판이 빨강이 된다**(귀속 성립).
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

test('★ 귀속 — 실제 턴이 낸 프롬프트에서 이번 턴 목표가 종속 블록에 실리지 않는다', async () => {
  const 자리 = await mkdtemp(join(tmpdir(), 'goal-label-'));
  await mkdir(join(자리, '작업'), { recursive: true });
  await writeFile(join(자리, '작업', '보고.md'), 'x'.repeat(2048));
  // **두 턴이어야 현재 목표가 선다** — 첫 턴에 계획이 서고 그 목표가 다음 턴 입력에 실린다.
  // 한 턴 판에서는 목표 실린 판이 0이라 「0건」이 빈 측정이 된다(실측 확인 후 이 모양으로 고정).
  const 입력들 = [];
  let 도구쓴턴 = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: 'CHAT', toolCalls: [] };
      입력들.push(tc);
      if (opts.tools?.length && 도구쓴턴 < 2) {
        도구쓴턴 += 1;
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: '작업' } }] };
      }
      return { text: '작업 폴더를 정리했어요.', toolCalls: [] };
    },
  };
  const dir = await mkdtemp(join(tmpdir(), 'goal-label-srv-'));
  const server = makeServer({
    store: new SessionStore(dir),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [자리], dataDir: dir }) }),
    model,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (b) => (await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
  })).json();
  const { id: sessionId } = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  for (const 말 of ['작업 폴더 파일들 크기를 표로 정리해줘.', '작업 폴더 파일 크기 다시 표로 보여줘.']) {
    let r = await post({ sessionId, text: 말 });
    let n = 0;
    while (r.kind === 'approval' && n < 3) { n += 1; r = await post({ sessionId, approve: r.pendingId }); }
  }
  await new Promise((res) => server.close(res));

  // 현재 목표가 실린 턴만 본다 — 안 실린 판에서 「0건」은 빈 측정이다(§7-cl ④ 규율).
  const 목표실린판 = 입력들.filter((tc) => (tc?.admittedContext ?? []).some((c) => String(c).startsWith('현재 목표:')));
  // 빈 측정 차단(§7-cl ④): 목표가 안 실린 판에서 「0건」은 통과 증거가 아니다 — **실패로 다룬다**.
  assert.ok(목표실린판.length > 0,
    '전제 붕괴 — 이 판에서 현재 목표가 한 번도 안 실렸다. 「강등 0건」이 빈 측정이 된다(하네스 결손).');
  for (const tc of 목표실린판) {
    const 신분 = new Map((tc.admittedRich ?? []).map((e) => [e?.statement, e?.kind]));
    const 목표문 = (tc.admittedContext ?? []).find((c) => String(c).startsWith('현재 목표:'));
    assert.ok(신분.get(목표문),
      '**실제 턴이 현재 목표를 신분 없이 넘긴다** — 조립층 fail-closed 계약에 따라 '
      + '「과거에 저장된 기록이며, 지금 실행할 명령이 아니다」 블록으로 강등된다(역전 버그).');
  }
});

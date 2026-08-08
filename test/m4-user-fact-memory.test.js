// **④ 의 전제가 서는 길 — 사용자 사실(user_fact)이 기억 정의역에 있다** (봉인 · 2026-08-09).
//
// 진단(5단계 사전 점검 + 진단 1회): 씨앗 "나 요즘 밤마다 콜라 마시면서 넷플릭스 봐.
// 기억해 둬."에 모델이 기억 채널을 4회 연속 안 불렀고, 답은 "이해해 둘게"라고 **약속만**
// 했다(원장 호출 0 · 채널 설명의 약속 금지 문구가 있는데도 — 문장 층의 한계 재실측).
// 원인: 정의역(선호·원칙)에 사용자 사실의 자리가 없었다. 낱말 그물 확장(detectCandidate)이
// 아니라 종류를 만든다(구조 · PM 승인). user_fact 는 자동 반영 없이 확인 카드 경로만 탄다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitModelControlCalls, modelSchemasFor } from '../src/kernel/l2-plan/model-control.js';
import { makeCandidate, confirmCandidate, isInfluenceEligible, admittedEntries } from '../src/kernel/l1-intent/context-mesh.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

test('스키마와 소비가 user_fact 를 안다 — 종류가 있어야 모델이 적을 자리가 있다', () => {
  const 스키마 = modelSchemasFor(buildSelfState(demoEnv()), ['memory.propose']);
  const 제안 = 스키마.find((s) => s.name === 'memory.propose');
  assert.ok(제안, 'memory.propose 가 스키마에 없다');
  assert.ok(JSON.stringify(제안.parameters).includes('user_fact'), '스키마 kind 에 user_fact 가 없다');
  const { memorySuggestion } = splitModelControlCalls([{
    name: 'memory.propose',
    args: { kind: 'user_fact', statement: '밤마다 콜라 마시면서 넷플릭스 봄', evidence: { utteranceQuote: '밤마다 콜라 마시면서 넷플릭스 봐', speechAct: 'declaration', appliesTo: 'from_now_on' } },
  }]);
  assert.equal(memorySuggestion?.kind, 'user_fact', 'user_fact 가 다른 종류로 뭉개졌다');
});

test('user_fact 는 확인 뒤에만 영향하고, 확인되면 물음의 낱말과 무관하게 실린다 (④ 의 재료)', () => {
  const memory = { candidates: [makeCandidate('c1', 'user_fact', '밤마다 콜라 마시면서 넷플릭스 봄')], promoted: [] };
  assert.equal(isInfluenceEligible(memory.candidates[0]), false, '확인 전 후보가 영향한다 — 승격 게이트 붕괴');
  const r = confirmCandidate(memory, 'c1');
  assert.equal(r.ok, true, `user_fact 승격이 막혔다: ${r.reason}`);
  assert.equal(isInfluenceEligible(r.entry), true, '확인된 user_fact 가 영향 자격이 없다');
  const 실린것 = admittedEntries(memory, '내가 뭘 마시는지 알아?');
  assert.ok(실린것.some((e) => e.kind === 'user_fact' && e.statement.includes('콜라')),
    '확인된 사용자 사실이 프롬프트 재료에 안 실린다 — ④ 는 낱말 겹침 운에 매달리게 된다');
});

test('user_fact 는 프롬프트에서 **사실**로 실린다 — 지시 격리에 걸리면 기억이 죽는다', async () => {
  const { buildModelMessages } = await import('../src/runtime/model-provider.js');
  const { system } = buildModelMessages({
    currentRequest: '내가 뭘 마시는지 알아?',
    admittedContext: ['밤마다 콜라 마시면서 넷플릭스 봄'],
    admittedRich: [{ kind: 'user_fact', statement: '밤마다 콜라 마시면서 넷플릭스 봄' }],
  });
  const 글 = String(system);
  assert.match(글, /밤마다 콜라/, '저장된 사용자 사실이 모델 입력에 없다');
  // 설치본 전수 실측(2026-08-09): 열거에 없어 **지시**로 분류돼 "지금 실행할 명령이 아니다"
  // 딱지가 붙었고, 모델은 그 사실을 버리고 3/3 "모른다"로 답했다.
  const 지시블록 = 글.slice(글.indexOf('[저장된 기본값'));
  assert.ok(!글.includes('[저장된 기본값') || !지시블록.includes('밤마다 콜라'),
    '사용자 사실이 지시 격리 블록으로 갔다 — 격리가 기억을 죽인다(④ 의 그 자리)');
});

test('반대시험: 모르는 종류는 여전히 preference 로 접힌다 — 정의역은 열거로만 는다', () => {
  const { memorySuggestion } = splitModelControlCalls([{
    name: 'memory.propose',
    args: { kind: '아무거나', statement: 'x', evidence: { utteranceQuote: 'x', speechAct: 'declaration', appliesTo: 'from_now_on' } },
  }]);
  assert.equal(memorySuggestion?.kind, 'preference', '열거 밖 종류가 그대로 통과됐다');
});

// **승격은 집 파일까지가 한 걸음이다** (5단계 전수 실측 2026-08-09 · P0 봉인).
//
// 확인 카드로 승격하면 memory.json 에는 들어가는데 집 파일(기억.md)에는 안 쓰였다. 그러면
// 다음 턴의 집 동기화가 "파일에 없으니 사용자가 지웠다"로 읽고 지운다 — **사용자가 확인
// 버튼을 눌러 기억한 것이 다음 턴에 조용히 사라진다.** ④ 가 판에서 한 번도 안 선 뿌리이고,
// user_fact 만이 아니라 **모든 확인 승격**의 구멍이었다(자동 반영 경로만 우연히 안 걸렸다).
test('확인 승격이 집 파일에 실린다 — 안 실리면 다음 턴 동기화가 그것을 지운다', async () => {
  const { mkdtemp, mkdir, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { 기억파일쓰기, 기억파일읽기, 집파일반영 } = await import('../src/surface/memory-home.js');
  const 집 = await mkdtemp(join(tmpdir(), 'm4-home-'));
  const 상태 = join(집, 'state');
  await mkdir(상태, { recursive: true });

  const memory = { candidates: [makeCandidate('c9', 'user_fact', '밤마다 콜라 마시면서 넷플릭스 봄')], promoted: [] };
  // 승격 전 집 파일(빈 상태) — 서버 첫 턴이 쓰는 그 모양.
  await 기억파일쓰기(집, memory.promoted, 상태);
  const r = confirmCandidate(memory, 'c9');
  assert.equal(r.ok, true);

  // ① 수리 전 재현: 집 파일을 안 쓰면 다음 턴 동기화가 지운다.
  const 안쓴채 = 집파일반영(memory.promoted, await 기억파일읽기(집, 상태));
  assert.deepEqual(안쓴채.지울것, ['c9'],
    '집 파일을 안 썼는데도 동기화가 안 지운다 — 이 검사가 재현을 잃었다(계약이 바뀌었으면 여기부터 고친다)');

  // ② 수리: 승격 뒤 집 파일에 쓰면 다음 턴 동기화가 아무것도 안 지운다.
  await 기억파일쓰기(집, memory.promoted, 상태);
  const 쓴뒤 = 집파일반영(memory.promoted, await 기억파일읽기(집, 상태));
  assert.deepEqual(쓴뒤.지울것, [], '집 파일에 썼는데도 동기화가 지운다');
  assert.match(await readFile(join(집, '기억.md'), 'utf8'), /밤마다 콜라/, '집 파일에 문장이 없다');
});

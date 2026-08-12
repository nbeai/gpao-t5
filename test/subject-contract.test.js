// **다음 턴으로 이어받는 일은 도구의 계약이다** — 커널은 도구 이름을 모른다.
//
// 예전엔 working-state.js 가 `if (tool === 'web.collect') … if (tool === 'local.file') …`
// 사다리였다. 도구가 늘 때마다 커널을 고쳐야 했고, 안 고치면 그 도구만 조용히 안 이어졌다 —
// `local.locate` 가 정확히 그랬다(찾아 놓고 다음 손이 어디인지 몰랐다). 세 번 샌 패턴이다.
// P5 에서 채널·외부 API·MCP·CLI 가 붙으면 같은 누수가 그만큼 커진다.
//
// 이 파일이 검사하는 것은 폴더 사례가 아니라 **구조**다: 도구가 계약을 내면 커널을 안 고쳐도
// 이어지는가, 그리고 안 내면 조용히 이어진 척하지 않는가.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { deriveWorkingState, workingStateFacts } from '../src/kernel/l0-evidence/working-state.js';

/** 그 도구 하나만 쓸 수 있는 상태 — 아직 선언되지 않은 이름도 여기선 손이 된다(P5 대역). */
const 손하나 = (id) => ({ connectedTools: [{ id, status: 'usable', executable: true }] });

/** 도구 하나만 든 실행기 — 계약이 커널을 안 고치고도 도는지 보려면 이것으로 충분하다. */
const 실행기 = (id, tool) => new ToolRunner({ [id]: tool });
const 돌린다 = (id, tool, args = {}) => 실행기(id, tool).run(id, args, 손하나(id));

test('아직 없는 도구라도 계약만 내면 커널 수정 없이 이어받는다', async () => {
  // **P5 에서 붙을 도구들의 대역이다.** 커널은 이 이름을 한 번도 본 적이 없다.
  const 새도구 = {
    subjectOf(rec) {
      const 방 = rec?.result?.room;
      return 방 ? { key: `chat:${방}`, kind: 'chat', label: `${방} 대화방`, detail: rec.result.path } : null;
    },
    async handler() {
      return { result: { room: '영업팀', path: '/어딘가/영업팀' }, userSafeSummary: '읽었어요.' };
    },
  };
  const rec = await 돌린다('아직.없는채널', 새도구);
  assert.ok(rec.subject, '계약을 냈는데 영수증에 안 실렸다 — 커널이 도구 이름을 아직 보고 있다');
  assert.equal(rec.subject.kind, 'chat');

  const st = deriveWorkingState(null, { receipts: [rec] });
  assert.equal(st.subjects[0]?.key, 'chat:영업팀', '커널이 계약을 안 얹었다');
  // detail 이 자리면 "지금 자리"로도 이어진다 — 다음 손이 어디서 이어갈지 안다.
  assert.match(workingStateFacts(st) ?? '', /지금 자리: \/어딘가\/영업팀/);
});

test('계약을 안 낸 도구는 조용히 이어진 척하지 않는다(지어내지 않는다)', async () => {
  const 계약없음 = { async handler() { return { result: { 뭔가: 1 }, userSafeSummary: '했어요.' }; } };
  const rec = await 돌린다('계약.없는도구', 계약없음);
  assert.equal(rec.subject, undefined, '없는 계약을 커널이 지어냈다');
  const st = deriveWorkingState(null, { receipts: [rec] });
  assert.equal(st.subjects.length, 0);
  assert.equal(workingStateFacts(st), undefined, '아는 게 없는데 상태를 말하면 모델이 오염된다');
});

test('계약이 터져도 그 턴이 죽지 않는다(이어받기는 부가 기능이다)', async () => {
  const 터지는계약 = {
    subjectOf() { throw new Error('계약 구현이 터졌다'); },
    async handler() { return { result: { ok: 1 }, userSafeSummary: '했어요.' }; },
  };
  const rec = await 돌린다('터지는도구', 터지는계약);
  assert.equal(rec.failureState, 'none', '이어받기 실패가 실행 실패로 번졌다');
  assert.equal(rec.subject, undefined);
});

test('막힌 실행은 계약이 있어도 대상이 되지 않는다(못 한 것은 대상이 아니다)', async () => {
  const 막히는도구 = {
    subjectOf() { return { key: 'x', kind: 'file', label: '/막힌/자리' }; },
    async handler() { return { blocked: true, userSafeSummary: '못 했어요.' }; },
  };
  const rec = await 돌린다('막히는도구', 막히는도구);
  assert.equal(rec.subject, undefined, '막힌 실행에 대상을 실으면 못 한 일을 한 일로 이어받는다');
});

// 지시 ③: locate 가 찾은 자리는 다음 턴의 "지금 자리"로 남아야 한다 — 계약을 통해서.
test('찾은 자리가 다음 턴의 "지금 자리"가 된다(locate → 다음 손)', async () => {
  const { makeLocalLocateTool } = await import('../src/runtime/local-locate.js');
  const locate = makeLocalLocateTool();
  const rec = {
    actualCall: { tool: 'local.locate', args: {} }, failureState: 'none',
    result: { candidates: [{ path: '/볼륨/작업용SSD/2026 정산자료', confidence: 'high' }] },
  };
  const s = locate.subjectOf(rec);
  assert.ok(s, 'locate 가 계약을 안 낸다');
  const st = deriveWorkingState(null, { receipts: [{ ...rec, subject: s }] });
  assert.match(workingStateFacts(st) ?? '', /지금 자리: \/볼륨\/작업용SSD\/2026 정산자료/);
});

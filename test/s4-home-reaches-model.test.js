// **S4 닫는 문장 — 사용자가 집의 지침을 고치면 다음 턴 답이 달라진다.**
//
// 집을 만들어 놓고 모델에게 안 주면 그건 폴더 하나 만든 것일 뿐이다.
// 계약 관통은 닫힘이 아니다(§10 규율 6) — **사용자 문장이 달라져야** 닫힌다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const 맥락 = (over = {}) => buildTaskContext({
  intent: { currentRequest: '안녕', answerMode: 'fast_chat', authorityBoundary: 'user' },
  selfState: { connectedTools: [], currentModel: { id: 'gpt-5.1' }, limits: [] },
  ...over,
});

test('① 사용자가 적은 지침이 **모델에게 간다**', () => {
  const m = buildModelMessages(맥락({ homeDocs: { 지침: '# 이렇게 일해 줘\n\n- 답은 항상 세 줄 이내로.' } }));
  assert.match(m.system, /답은 항상 세 줄 이내로/,
    '사용자가 집에 적은 지침이 모델에게 안 간다 — 폴더만 만든 셈이다');
});

test('② 사용자가 적은 자기 소개도 간다', () => {
  const m = buildModelMessages(맥락({ homeDocs: { 사용자: '# 나에 대해\n\n- 나를 "대표님"이라고 불러.' } }));
  assert.match(m.system, /대표님/, '사용자가 누구인지 적은 것이 모델에게 안 간다');
});

test('③ **안정 구역**에 있다 — 매 세션 실리므로 캐시에 얹혀야 한다(불변식 A·B)', () => {
  const m = buildModelMessages(맥락({ homeDocs: { 지침: '- 짧게 답해.' } }));
  assert.match(m.systemStable, /짧게 답해/,
    '휘발 구역에 넣었다 — 대화 내내 같은 내용을 매 콜 새로 지불한다');
});

test('④ 사용자 메시지에는 안 들어간다 — **커널은 사용자 입으로 말하지 않는다**(S1 계약)', () => {
  const m = buildModelMessages(맥락({ homeDocs: { 지침: '- 짧게 답해.' } }));
  assert.equal(m.user.trim(), '안녕',
    '집 문서가 사용자 메시지에 섞였다 — 모델이 사용자가 방금 말한 것으로 읽는다');
});

test('⑤ 집이 비어 있으면 아무것도 안 실린다(빈 제목을 지어내지 않는다)', () => {
  const m = buildModelMessages(맥락({}));
  assert.doesNotMatch(m.system, /이렇게 일해 줘|나에 대해/);
});

test('⑥ 지침은 **사실이 아니라 사용자의 뜻**으로 실린다 — 원장과 섞이지 않는다', () => {
  const m = buildModelMessages(맥락({ homeDocs: { 지침: '- 파일은 다 지워도 돼.' } }));
  // 자리 표식이 있어야 모델이 "사용자가 미리 적어 둔 것"과 "이번 턴 사실"을 구분한다.
  const 앞뒤 = m.system.slice(Math.max(0, m.system.indexOf('파일은 다 지워도 돼') - 200));
  assert.match(앞뒤, /집|지침|미리 적|사용자가 적/,
    '어디서 온 말인지 표식이 없다 — 모델이 런타임 사실로 오해한다');
});

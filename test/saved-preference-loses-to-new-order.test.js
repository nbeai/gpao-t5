// 순서 7 · §5-5 ④ 「새 지시가 과거 기억을 이김」 — 선빨강 (선등록 §7-ch-1 · 라이브 2/2 빨강)
//
// 라이브 실물(2026-08-17 · gpt-5.1 · 새 방·새 서버 · 기저1·기저2):
//   저장된 선호 「앞으로 보고서는 표보다 짧은 목록으로 정리해줘.」(kind=preference · 자연 승격)
//   → 사용자가 「작업 폴더 파일들 크기를 **표로** 정리해줘」라고 명시했는데 **두 회차 다 목록**.
//   같은 발화를 기억 없는 방에서 돌리면 표로 답한다(양성 대조 극A) — 차이는 기억 유무뿐이다.
//
// 왜 기존 검사가 초록이었나(F-92 「검사가 초록이던 이유」와 같은 가족):
//   model-provider.test.js 의 판들은 `admittedRich` 를 안 주고 `admittedContext` 만 준다.
//   그러면 신분이 미상이라 **지시들**로 분류돼 `[저장된 기본값 — 현재 요청과 충돌하면 적용하지
//   않음]` 블록으로 간다. 실물에서 승격된 선호는 `kind:'preference'` 를 달고 오고,
//   `model-provider.js:409` 의 `사실종류` 열거에 preference 가 있어 **사실 블록**으로 간다 —
//   그 블록에는 충돌 문법이 없다(:421-422 「물으면 이걸로 답한다」). 검사는 실물 모양을
//   한 번도 안 먹였다. 여기서 그 모양을 먹인다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const 선호문장 = '앞으로 보고서는 표보다 짧은 목록으로 정리해줘.';
const 기본 = {
  currentRequest: '작업 폴더 파일들 크기를 표로 정리해줘.',
  selfStateFacts: { readyTools: ['local.file'], limits: [] },
  authorityFacts: { needsApproval: [], forbidden: [] },
  answerMode: 'complex_work',
  naturalness: 'method_and_language_open',
  evidenceFacts: [],
};
// 실물 모양: 승격된 선호는 신분을 달고 온다(context-mesh 가 kind 를 붙인다).
const 선호실림 = {
  ...기본,
  admittedContext: [선호문장],
  admittedRich: [{ statement: 선호문장, kind: 'preference' }],
};

test('★ 선빨강 — 저장된 선호가 실린 턴에도 「충돌하면 지금 요청이 우선」이라는 사실이 모델 입력에 있다', () => {
  const m = buildModelMessages(선호실림);
  assert.ok(m.system.includes(선호문장), '전제 붕괴 — 선호가 아예 안 실렸다(이 단언은 실려 있을 때만 뜻이 있다)');
  assert.match(m.system, /충돌[^\n]*(우선|적용하지 않)/,
    '**저장된 선호가 실렸는데 충돌 시 지금 요청이 우선한다는 사실이 어디에도 없다** — '
    + 'preference 는 사실 블록(「물으면 이걸로 답한다」)으로만 조립되고 그 블록엔 충돌 문법이 '
    + '없다(model-provider.js:409·421). 라이브에서 사용자가 「표로」라고 해도 목록이 나왔다(2/2).');
});

test('닻(반례 축) — 그 사실이 서도 기억은 죽지 않는다: 선호 원문과 「이걸로 답한다」가 그대로 있다', () => {
  // :391-397 판례 — 격리 딱지가 사실에 붙자 모델이 그 기억을 **버렸다**(user_fact 3/3 「모른다」).
  // 충돌 사실을 얹는 수리가 그 사고를 되살리면 안 된다.
  const m = buildModelMessages(선호실림);
  assert.ok(m.system.includes(선호문장), '기억 원문이 사라졌다 — 격리가 기억을 죽인 그 모양이다');
  assert.match(m.system, /알고 있는 것/, '사실 블록이 사라졌다(신분 분기가 무너졌다)');
  assert.doesNotMatch(m.system, /지금 실행할 명령이 아니다[\s\S]*앞으로 보고서는/,
    '선호가 「지금 실행할 명령이 아니다」 격리로 밀려났다 — 그 문구가 사실을 죽인 판례가 있다');
});

test('닻 — 신분 없는 기억(지시)의 기존 격리는 문자 그대로 산다', () => {
  const m = buildModelMessages({ ...기본, admittedContext: ['항상 존댓말로 답해줘'] });
  assert.ok(m.system.includes('저장된 기본값'), '지시 블록 이름이 무너졌다');
  assert.ok(m.system.includes('현재 요청과 충돌하면 적용하지 않음'), '§5-J v2 격리가 무너졌다');
});

test('닻 — 기억이 없으면 충돌 문장도 없다(빈 채널에 문구를 싣지 않는다)', () => {
  const m = buildModelMessages({ ...기본, admittedContext: [], admittedRich: [] });
  assert.doesNotMatch(m.system, /충돌/, '반영 기억이 0인데 충돌 문장이 실렸다');
});

test('닻 — 현재 요청은 기억 블록 뒤에 오지 않는다(순서 계약 불변)', () => {
  const m = buildModelMessages(선호실림);
  const 요청 = m.user.lastIndexOf('작업 폴더 파일들 크기를 표로 정리해줘.');
  assert.ok(요청 >= 0, '현재 요청 원문은 사용자 메시지에 있다');
  assert.ok(!m.system.includes('작업 폴더 파일들 크기를 표로 정리해줘.'), '원문이 커널 자리로 샜다');
});

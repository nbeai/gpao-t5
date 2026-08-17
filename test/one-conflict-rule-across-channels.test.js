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

test('★ 선빨강 ㉤(역전 버그) — 이번 턴 목표가 「지금 실행할 명령이 아니다」 블록에 실리지 않는다', () => {
  // 양성 대조(수리 전 실측 · §7-cl ④ 빈 측정 차단): 아래 모양이면 그 블록에 현재 목표가
  // **1건 실린다** — turn.js 가 `admitted` 에만 넣고 `admittedRich` 에 안 넣어 신분이 미상이라서다.
  const m = buildModelMessages({
    ...기본,
    admittedContext: ['현재 목표: 작업 폴더 파일 크기를 표로 정리한다', 선호문장],
    admittedRich: [{ statement: 선호문장, kind: 'preference' }],
  });
  const 몸 = 블록몸(m.system, '[저장된 기본값');
  assert.ok(몸, '전제 붕괴 — 저장된 기본값 블록이 없다(양성 대조가 성립하지 않는 판이다)');
  assert.ok(!몸.includes('현재 목표'),
    '**이번 턴 목표가 「과거에 저장된 기록이며, 지금 실행할 명령이 아니다」로 강등돼 실린다** — '
    + '제품이 모델에게 거짓 문장을 심는다. 현재 요청이 강등 라벨을 달고 과거 선호가 무라벨로 서는 정반대 구조.');
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

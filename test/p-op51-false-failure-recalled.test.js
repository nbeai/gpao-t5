// ── 반대시험 ⑥ (계획서 §5-1 · F-47 거짓 실패) — 실제 결과가 있는데 실패라고 말하면 회수한다 ──
//
// F-47 실측(정렬 판 2026-08-06 ⑦): 같은 응답 안에서 구조는 예약 제안을 실었는데 글은
// *"매주 먼저 말 걸기는 불가능해요"* 라고 했다 — **거짓 실패**. 되는 것을 안 된다고 하면
// 사용자는 그 기능을 영영 안 쓴다. 거짓 성공의 거울인데 그물 목록에 이름이 없었다.
//
// 문구 그물을 키우지 않는다(§4-6 · F-12 가 배제한 길). 여는 것은 원장의 기계 사실 둘이다:
//   · 이 턴에 실제로 성공해 **바뀐 것**이 있다(바꾼개수 > 0)
//   · 실패·막힘·미완의 흔적이 원장에 **하나도 없다**(cancelled 제외 failureState 0 ·
//     제안만 남긴 미실행 0)
// 그 위에서 답이 실패·불가능을 선언하면, 사용자에게 보내지 않고 사실을 모델에게 돌려준다.
// 판단은 모델의 것이다 — 무엇이라 고쳐 쓸지는 모델이 정한다(출구 그물의 규율 그대로).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 완료주장검증 } from '../src/kernel/l2-plan/exit-verification.js';

const 성공쓰기 = (path) => ({
  failureState: 'none',
  actualCall: { tool: 'local.file', args: { action: 'write', path } },
  result: { path },
});
const 성공읽기 = (path) => ({
  failureState: 'none',
  actualCall: { tool: 'local.file', args: { action: 'read', path } },
  result: { path, text: '내용' },
});
const 막힘 = (tool, action) => ({
  failureState: 'blocked', actualCall: { tool, args: action ? { action } : {} }, result: {},
});

test('반대시험 ⑥: 성공한 쓰기가 원장에 있는데 「실패했어요」는 사용자에게 가지 않는다', () => {
  const r = 완료주장검증({
    reply: '죄송해요, 그 작업은 실패했어요. 지금은 할 수 없어요.',
    receipts: [성공쓰기('/방/결과.md')],
  });
  assert.equal(r.사용자에게, false, '**실물이 섰는데 실패라는 답이 사용자에게 나간다** — 거짓 실패 미회수');
  assert.match(String(r.모델에게 ?? ''), /바뀐|성공/, `원장의 사실이 모델에게 안 간다: ${r.모델에게}`);
});

test('반대시험 ⑥: 「불가능해요」도 같은 자리다 — 바뀐 실물이 있으면 회수한다', () => {
  const r = 완료주장검증({
    reply: '그건 불가능해요.',
    receipts: [성공쓰기('/방/결과.md')],
  });
  assert.equal(r.사용자에게, false);
});

test('반대시험 ⑥ 반례: 실패한 걸음이 실제로 있으면 실패 보고는 정직이다 — 지나간다', () => {
  const r = 완료주장검증({
    reply: '읽기가 실패해서 못 끝냈어요.',
    receipts: [막힘('local.file', 'read')],
  });
  assert.equal(r.사용자에게, true, '정직한 실패 보고를 되돌렸다');
});

test('반대시험 ⑥ 반례: 읽기만 한 턴의 「찾을 수 없었어요」는 안 건드린다 — 내용 판단은 모델의 것', () => {
  // 읽기는 성공했지만 찾던 것이 내용에 없을 수 있다. 바뀐 것이 0이면 커널은 알맹이를
  // 재지 않는다(원장 헌장) — 이 자리에 그물을 물리면 정상 답마다 왕복이 탄다.
  const r = 완료주장검증({
    reply: '파일을 읽어봤는데 그 항목은 찾을 수 없었어요.',
    receipts: [성공읽기('/방/원장.txt')],
  });
  assert.equal(r.사용자에게, true);
});

test('반대시험 ⑥ 반례: 일부 성공·일부 미완 턴의 실패 언급은 정직이다 — 지나간다', () => {
  const r = 완료주장검증({
    reply: '결과는 만들었는데 전송은 실패해서 아직 못 보냈어요.',
    receipts: [성공쓰기('/방/결과.md'), 막힘('telegram.send')],
  });
  assert.equal(r.사용자에게, true, '부분 완료의 정직한 보고를 되돌렸다 — 반대 방향의 거짓');
});

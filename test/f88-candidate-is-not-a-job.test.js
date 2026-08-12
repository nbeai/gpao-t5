// **F-88 — 후보는 job 이 아니다.** 「켜 뒀어요」는 job 이 실제로 섰을 때만 참이다.
//
// 콘솔 라이브 3/3 (오너 2026-08-12):
//   발화  "매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘."
//   답    "**이미 그 자동화 후보를 한 번 만들어 둔 상태라** 바로 켜 둘 수 있습니다 …
//          이 설정으로 바로 활성화해 둘게요."
//   실물  automation.json — candidates 1건(state:'proposed') · jobs **0건**
// 사용자는 켜졌다고 믿고 창을 닫는다. 9시에 아무 일도 안 일어난다.
//
// **모델이 지어낸 게 아니다 — 우리가 그렇게 말했다.** `model-provider.js` 의 사실 블록이
// *"이미 만들어 둔 것이다"* 라고 적고 있었고, 오너가 밟은 답과 글자가 겹친다. F-85 와 같은
// 계열이다(우리가 심은 문장이 답이 되어 나온다).
//
// 두 자리를 함께 잰다:
//   (가) 사실 블록  — 이번 턴/앞 턴 · 후보/job · 켜려면 무엇이 더 필요한가가 갈려 있는가
//   (나) 출구 그물  — 후보만 세운 턴이 「켜 뒀다」로 닫히지 않는가(계획서 §5-1 반대시험 ③)
//
// 오픈북(헤르메스 `tools/cronjob_tools.py:341-375`): 안 닿는 예약을 **생성 시점에 계산해
// 도구 반환값으로** 모델에게 건넨다 — *"promising a delivery that never happens"* 를 막는
// 것은 문장 지침이 아니라 **기계 통지**다. 여기 (가)가 그 자리다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { 완료주장검증 } from '../src/kernel/l2-plan/exit-verification.js';

const 후보 = {
  candidateRef: 'cand-1', revision: 1, state: 'proposed', operation: 'create',
  statement: '매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려주기',
};

// ── ① 우리가 심은 거짓을 걷었다 ────────────────────────────────────────────
test('① 이번 턴에 방금 세운 후보를 「이미 만들어 둔 것」이라고 말하지 않는다', () => {
  const { system } = buildModelMessages({
    currentRequest: '매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.',
    automationProposal: 후보,
  });
  const 글 = String(system);
  assert.match(글, /이번 턴에 세운 예약 후보/, '후보 블록 자체가 사라졌다');
  assert.doesNotMatch(글, /이미 만들어 둔 것이다/,
    '커널이 "이미 만들어 둔 것"이라고 적고 있다 — 오너가 밟은 거짓 답과 같은 글자다(F-88)');
});

// ── ② 후보(proposed)와 실제 job 이 사실 블록에서 갈려 있다 ─────────────────
test('② 사실 블록이 후보와 job 을 가른다 — 상태·job 0건·켜는 방법이 전부 적혀 있다', () => {
  const { system } = buildModelMessages({
    currentRequest: '매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.',
    automationProposal: 후보,
  });
  const 글 = String(system);
  assert.match(글, /proposed/, '후보의 상태(proposed)가 안 실렸다 — 사용자에게 전혀 다른 사실이다');
  assert.match(글, /이번 턴에 방금 세웠다/, '이번 턴 것인지 앞 턴 것인지가 안 갈렸다');
  assert.match(글, /선 예약\(job\)[^\n]*0건/, 'job 이 0건이라는 사실이 안 실렸다');
  assert.match(글, /automation\.control/, '켜려면 무엇이 더 필요한지가 안 실렸다 — 모델이 그걸 말해야 사용자가 켠다');
  assert.match(글, /cand-1/, '어느 후보를 켜야 하는지(candidateRef)가 안 실렸다');
});

test('②-2 job 이 실제로 선 턴에는 「job 0건」이라고 적지 않는다 — 반대 방향의 거짓', () => {
  const { system } = buildModelMessages({
    currentRequest: '켜줘',
    automationProposal: 후보,
    automationControl: { operation: 'commit', jobRef: 'job-1', state: 'scheduled', mutated: true },
  });
  const 글 = String(system);
  assert.doesNotMatch(글, /선 예약\(job\)[^\n]*0건/,
    'job 이 선 턴인데 커널이 0건이라고 적고 있다');
  assert.match(글, /job-1/, '실제로 선 예약이 사실 블록에 안 실렸다');
});

// ── ③ 후보만 세운 턴이 「켜 뒀어요」로 닫히지 않는다 (계획서 §5-1 반대시험 ③) ──
// **자동화 축만 남긴다.** 영수증 0 인 턴은 기존 그물(`확인된실행 === 0`)이 먼저 물어서
// 자동화 판정이 참인지 거짓인지를 못 가른다 — 감사 문서가 지적한 그 자리다
// (`design/T5-LEDGER-SEVEN-AUDIT-ko.md`: 지금 무는 것은 job 이 실제로 선 정직한 턴도 문다).
// 그래서 **바꾼 것 0 · 확인된 실행 1** 인 목록 영수증을 깔고 잰다.
const 목록영수증 = [{
  actualCall: { tool: 'local.file', args: { action: 'list' } },
  result: { entries: [] }, failureState: 'none',
}];
const 재다 = (reply, 자동화) => 완료주장검증({ reply, receipts: 목록영수증, 원장글: '[]', 자동화 });

test('③ 후보만 세운 턴의 「켜 뒀다」를 출구가 문다 — 밟은 그 답 그대로', () => {
  const r = 재다(
    '이미 그 자동화 후보를 한 번 만들어 둔 상태라 바로 켜 둘 수 있습니다. 이 설정으로 바로 활성화해 둘게요.',
    { 이번턴후보: 1, 이번턴job: 0 },
  );
  assert.equal(r.일치, false, '후보만 선 턴이 「켜 뒀다」로 그대로 나갔다 — 9시에 아무 일도 안 일어난다');
  assert.equal(r.사용자에게, false);
  assert.match(String(r.모델에게), /후보/);
  assert.match(String(r.모델에게), /job/);
});

test('③-2 과거형이 아니어도 문다 — 「활성화해 둘게요」는 약속이고 원장은 job 0 이다', () => {
  const r = 재다('설정 그대로 활성화해 둘게요.', { 이번턴후보: 1, 이번턴job: 0 });
  assert.equal(r.일치, false, '어미를 바꾸면 새는 그물이면 그물이 아니다');
});

// ── ④ job 이 실제로 선 턴은 통과한다 — 참·거짓을 가르는 자다 ────────────────
test('④ job 이 실제로 선 턴은 그대로 나간다 — 이게 없으면 수리가 아니다', () => {
  const r = 재다('매일 아침 9시에 알려드리도록 켜 뒀어요.', { 이번턴후보: 1, 이번턴job: 1 });
  assert.equal(r.일치, true, 'job 이 선 정직한 턴까지 물었다 — 참·거짓을 못 가르는 자다');
});

// ── ⑤ 자동화와 무관한 턴은 안 문다 ────────────────────────────────────────
test('⑤ 자동화 후보가 없는 턴은 안 문다 — 잔소리를 늘리지 않는다', () => {
  assert.equal(재다('정리해 뒀어요.', { 이번턴후보: 0, 이번턴job: 0 }).일치, true);
  assert.equal(재다('정리해 뒀어요.', null).일치, true, '자동화 사실이 아예 없는 턴까지 물었다');
  assert.equal(재다('정리해 뒀어요.', undefined).일치, true);
});

// ── ⑥ 정직한 미완 고지·되묻는 답은 그대로 나간다 ──────────────────────────
test('⑥ 되묻는 답은 그대로 나간다 — 제안하고 물어보는 것이 정상 경로다', () => {
  const r = 재다('매일 아침 9시에 PDF 개수를 알려드리는 예약을 세울까요?', { 이번턴후보: 1, 이번턴job: 0 });
  assert.equal(r.일치, true, '되묻는 답을 물었다 — 심문을 벌하는 개입이다');
});

test('⑥-2 아직 안 켜졌다고 밝히는 답은 그대로 나간다', () => {
  const r = 재다('예약 후보만 세웠고 아직 켜지지는 않았어요. 켜 드릴까요?', { 이번턴후보: 1, 이번턴job: 0 });
  assert.equal(r.일치, true, '정직한 미완 고지를 거짓으로 몰았다 — F-85 와 같은 병이다');
});

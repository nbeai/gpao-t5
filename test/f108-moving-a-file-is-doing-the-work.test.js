// **F-108 · 옮긴 것은 한 일이 아니라고 세어졌다** (선빨강)
//
// ── 무엇이 어긋났나 ────────────────────────────────────────────────────────
// 산출물 계약이 「이 턴에 실제로 만들어 낸 것」을 셀 때 이렇게 묻는다:
// ```js
// // work-contract.js:38-40
// // 옮김·지움은 대상 경로가 결과에 남으면 실제로 일어난 것이다
// return (action === 'move' || action === 'delete') && typeof receipt?.result?.path === 'string';
// ```
// 그런데 손이 실제로 내는 것은 이렇다:
// ```js
// // local-file.js:1134   move        → { from, to }                       ← path 없다
// // local-file.js:1241   bulk_move   → { from, to, moved, skipped, … }    ← path 없고 action 이름도 다르다
// // local-file.js:1249   delete      → { path, recoverable: true }        ← 이것만 맞는다
// ```
// **두 겹으로 안 맞는다.** `move` 는 칸 이름이 다르고, `bulk_move` 는 `action` 열거에도 없다.
//
// ── 사용자 자리에서 무슨 일이 나나 ─────────────────────────────────────────
// *"다운로드 폴더 유형별로 정리해줘"* — 이 문장은 `work-contract.js:20-31` 주석이
// **그 조항이 존재하는 이유로 박아 둔 실측**이다. 그런데 정리의 정답인 `move` 가
// 지금도 산출물로 안 세어진다. 그래서:
// ```
// 파일        진짜로 옮겨졌다
// 원장        성공이라 적는다
// 출구 검증    "정리했어요" 를 그대로 통과시킨다
// 완료 기록    없다   ← 여기만 어긋난다
// ```
// 다음 턴에 *"아까 그거 이어줘"* 가 오면 T5 는 **끝난 일을 다시 하려 든다.**
// `working-state.js:163-167` 이 이미 실측으로 적어 둔 그 병이다 —
// *"저장된 파일을 읽어 존재를 확인하고도 같은 파일을 다시 쓰는 승인 카드를 띄웠다."*
//
// ── 왜 「손을 고치지 않고 계약을 고치나」 ───────────────────────────────────
// 손이 내는 `{ from, to }` 가 더 정확하다 — **옮김은 자리가 둘인 일**이고 `path` 하나로는
// 어디서 어디로인지 못 말한다. 계약이 손의 실제 모양을 따라가야 한다.
// 이 저장소가 이미 배운 것이다: *"손이 스스로 쥔 것이 있으면 그것을 쓴다"*(task-context.js).
import assert from 'node:assert/strict';
import test from 'node:test';

import { unsatisfiedDeliverables } from '../src/kernel/l2-plan/work-contract.js';

// 실제 소비자는 `unsatisfiedDeliverables` 다. 신분(workRef·contractRef·deliverableRefs)은
// 옆 검사(deliverable-is-the-goal.test.js)와 **같은 방식으로 직접 박는다** — 두 검사가
// 다른 조립법을 쓰면 어느 쪽이 소비자 계약을 재는지 알 수 없다.
const 계약 = { workRef: 'w1', completionContractRef: 'k1', deliverables: [{ id: 'primary-file-output', kind: 'file' }] };
const collectDeliverables = (rs) => (unsatisfiedDeliverables(계약, rs).length === 0 ? ['셌다'] : []);

const 옮김영수증 = (result, action = 'move') => ({
  actualCall: { tool: 'local.file', args: { action, path: '보고서.pdf', to: '문서' } },
  result,
  failureState: 'none',
  lifecycle: 'delivered',
  workRef: 'w1',
  completionContractRef: 'k1',
  deliverableRefs: ['primary-file-output'],
});

const 집 = '/Users/yun/GPAO-T5';

// ── ① 밟은 그 자리 — 한 개 옮기기 ───────────────────────────────────────────
test('F108 ①: **옮긴 파일이 산출물로 세어진다** — 손이 내는 것은 `{from,to}` 다', () => {
  const 것들 = collectDeliverables([옮김영수증({ from: `${집}/보고서.pdf`, to: `${집}/문서/보고서.pdf` })]);
  assert.ok(것들.length > 0,
    '**옮긴 파일이 한 일로 안 세어진다** — 계약은 `result.path` 를 찾는데 손은 `{from,to}` 를 낸다. '
    + '그래서 "다운로드 정리해줘" 가 완료로 안 기록되고, 다음 턴에 T5 가 끝난 일을 다시 하려 든다');
});

// ── ② 묶음 옮기기 — action 이름부터 열거에 없다 ─────────────────────────────
//
// 폴더 정리는 대개 이쪽이다. 한 장씩 옮기지 않는다.
test('F108 ②: **묶음 옮기기**도 산출물이다 — 폴더 정리의 실제 모양이 이것이다', () => {
  const 것들 = collectDeliverables([옮김영수증({
    from: `${집}/다운로드`,
    to: `${집}/문서`,
    moved: ['가.pdf', '나.pdf', '다.pdf'],
    skipped: [],
    remainingSource: { total: 0 },
  }, 'bulk_move')]);
  assert.ok(것들.length > 0,
    '**묶음 옮기기가 한 일로 안 세어진다** — `action` 열거가 `move`·`delete` 뿐이라 '
    + '`bulk_move` 는 이름부터 안 걸린다. 「다운로드 폴더 유형별로 정리해줘」의 정답이 이것인데도');
});

// ── ③ 지우기는 원래 맞았다 — 안 깨뜨렸는지 확인 ─────────────────────────────
test('F108 ③: **지우기**는 그대로 세어진다 — 고치면서 되던 것을 깨지 않는다', () => {
  const 것들 = collectDeliverables([옮김영수증({ path: `${집}/낡은것.txt`, recoverable: true }, 'delete')]);
  assert.ok(것들.length > 0, '지우기가 산출물에서 빠졌다 — 되던 것을 깨뜨렸다');
});

// ── ④ 반대편 — 아무 일도 안 한 것을 한 일로 세지 않는다 ─────────────────────
test('F108 ④-a: **실패한 옮김**은 산출물이 아니다', () => {
  const 것들 = collectDeliverables([{
    ...옮김영수증({ from: `${집}/가.pdf`, to: `${집}/문서/가.pdf` }),
    failureState: 'blocked',
  }]);
  assert.equal(것들.length, 0, '실패한 걸음을 한 일로 셌다');
});

test('F108 ④-b: **하나도 안 옮긴 묶음**은 산출물이 아니다 — 「돌긴 돌았다」는 한 일이 아니다', () => {
  const 것들 = collectDeliverables([옮김영수증({
    from: `${집}/다운로드`, to: `${집}/문서`, moved: [], skipped: ['가.pdf'], remainingSource: { total: 1 },
  }, 'bulk_move')]);
  assert.equal(것들.length, 0,
    '**옮긴 것이 0개인데 한 일로 셌다** — 이러면 「정리했어요」가 아무것도 안 옮긴 턴에도 선다');
});

test('F108 ④-c: **읽기**는 산출물이 아니다 — 정의역이 넓어지지 않았는지', () => {
  const 것들 = collectDeliverables([{
    actualCall: { tool: 'local.file', args: { action: 'read', path: '가.txt' } },
    result: { path: `${집}/가.txt`, text: '내용' },
    failureState: 'none',
    lifecycle: 'delivered',
    workRef: 'w1',
    completionContractRef: 'k1',
    deliverableRefs: ['primary-file-output'],
  }]);
  assert.equal(것들.length, 0, '읽기를 산출물로 셌다 — F-95 가 정의역을 넓혀 참인 답을 죽인 그 모양이다');
});

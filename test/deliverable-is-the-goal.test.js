// **완료는 "새 파일이 생겼다"가 아니라 "요청한 파일 상태 변화가 일어났다"이다.**
//
// 오너 라이브 실측(2026-08-03, 실모델). "다운로드 폴더 유형별로 정리해줘"에 T5 는:
//   ① 완료 계약을 `local.file write` 영수증 하나로 잡고
//   ② 모델에게 `requiredTool: 'local.file'` + `action enum: ['write']` 로 **강제**했다
//   ③ "정리"의 정답인 `move` 는 목록에 없었으므로, 모델이 낼 수 있는 유일한 write 가
//      **쓰레기 로그 파일**(`정리_로그.txt`)이었다
//   ④ 그 write 가 계약을 충족시켜 **"완료"** 가 됐다 — 정리는 하나도 안 된 채로.
//
// 사용자의 목표("폴더가 정리된 상태")를 대리지표("파일 하나가 생김")로 바꿔친 것이다.
// (오너 규칙: 「대리지표를 결과로 세우지 말 것」)
//
// 지키는 것 셋:
//   ① 옮김·지움도 완료다  ② 강제하지 않는다  ③ **파생 산출물 보호는 그대로**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unsatisfiedDeliverables } from '../src/kernel/l2-plan/work-contract.js';

const 계약 = { workRef: 'w1', completionContractRef: 'k1', deliverables: [{ id: 'primary-file-output', kind: 'file' }] };
const 영수증 = (action, result) => ({
  failureState: 'none',
  actualCall: { tool: 'local.file', args: { action } },
  result,
  workRef: 'w1',
  completionContractRef: 'k1',
  deliverableRefs: ['primary-file-output'],
});

test('새 파일을 만든 것은 완료다(원래 계약 유지)', () => {
  assert.equal(unsatisfiedDeliverables(계약, [영수증('write', { path: '/집/정리본.md', digest: 'd1' })]).length, 0);
});

// ── ① 여기가 이 검사의 핵심 ─────────────────────────────────────────────
test('옮긴 것도 완료다 — "정리"의 정답은 move 다', () => {
  assert.equal(unsatisfiedDeliverables(계약, [영수증('move', { path: '/집/문서/견적서.pdf' })]).length, 0,
    'move 를 완료로 안 세면 T5 는 쓸데없는 파일을 만들어 계약을 채운다(실측)');
});

test('지운 것도 완료다', () => {
  assert.equal(unsatisfiedDeliverables(계약, [영수증('delete', { path: '/집/버릴것.zip' })]).length, 0);
});

test('읽기는 완료가 아니다 — 재료이지 결과가 아니다', () => {
  assert.equal(unsatisfiedDeliverables(계약, [영수증('read', { path: '/집/x.md', text: '내용' })]).length, 1);
  assert.equal(unsatisfiedDeliverables(계약, [영수증('list', { path: '/집', items: [] })]).length, 1);
});

test('실패한 실행은 완료가 아니다', () => {
  const 실패 = { ...영수증('move', { path: '/집/x' }), failureState: 'blocked' };
  assert.equal(unsatisfiedDeliverables(계약, [실패]).length, 1);
});

test('결과에 대상이 없으면 일어났다고 세지 않는다', () => {
  assert.equal(unsatisfiedDeliverables(계약, [영수증('move', {})]).length, 1, '경로 없는 결과는 증거가 아니다');
  assert.equal(unsatisfiedDeliverables(계약, [영수증('write', { path: '/집/x.md' })]).length, 1, 'write 는 digest 까지 있어야 한다');
});

test('다른 계약의 영수증은 이 계약을 채우지 않는다', () => {
  const 남의것 = { ...영수증('move', { path: '/집/x' }), workRef: 'w2' };
  assert.equal(unsatisfiedDeliverables(계약, [남의것]).length, 1);
});

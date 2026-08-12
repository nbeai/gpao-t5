// P6-W1 · 현재 작업 대상 — **"이 프로젝트", "그 폴더", "아까 그거"의 뜻이 여기서 나온다.**
//
// 이건 코드 프로젝트 찾기가 아니다. 사용자의 현재 작업 대상은 정산 엑셀일 수도, 계약서
// 폴더일 수도, 열어 둔 화면일 수도, 켜 둔 서버일 수도 있다. 새 저장소를 만들지 않고
// 이미 아는 사실(원장·workingState)만 짧게 투영한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveWorkingState, workingStateFacts } from '../src/kernel/l0-evidence/working-state.js';
import { 계약태우기 } from './subject-contract.js';

// subject 는 도구가 낸다 — 여기서 손으로 적으면 계약이 깨져도 검사가 초록이다.
const R = (tool, result, args = {}) => 계약태우기({ actualCall: { tool, args }, result, failureState: 'none' });
const 턴 = (prev, ...receipts) => deriveWorkingState(prev, { receipts });

test('업무 자료를 다루면 그 자리가 현재 자리가 된다(코드만이 아니다)', () => {
  const st = 턴(null, R('local.terminal', { command: 'ls *.xlsx', cwd: '/Users/누구/회계/2026-1분기-정산', exitCode: 0 }));
  const f = workingStateFacts(st);
  assert.match(f, /지금 자리: \/Users\/누구\/회계\/2026-1분기-정산/, '"정산 자료 봐줘"가 여기서 이어진다');
});

test('켜 둔 것도 현재 대상이다 — "그거 꺼줘"가 이어진다', () => {
  const st = 턴(null, R('local.process', { id: 'p1', label: '개발 서버', pid: 111, cwd: '/Users/누구/work/api', status: 'running' }));
  assert.match(workingStateFacts(st), /방금 켠 것: 개발 서버/);
});

test('꺼진 것을 돌고 있다고 이어받지 않는다', () => {
  const st = 턴(null, R('local.process', { id: 'p1', label: '개발 서버', pid: 111, status: 'exited' }));
  assert.match(workingStateFacts(st), /지금은 꺼져 있음/, '꺼진 걸 살아있다고 넘기면 다음 턴이 거짓 위에서 진행된다');
});

test('실패한 명령은 실패로 이어받는다', () => {
  const st = 턴(null, R('local.terminal', { command: 'npm test', cwd: '/Users/누구/work/api', exitCode: 1 }));
  assert.match(workingStateFacts(st), /실패\(코드 1\)/, '실패를 성공처럼 넘기면 모델이 다음 일을 잘못한다');
});

test('열어 본 화면도 현재 대상이다(파일만이 아니다)', () => {
  const st = deriveWorkingState(null, {
    receipts: [계약태우기({ actualCall: { tool: 'web.collect', args: {} }, failureState: 'none',
      sources: [{ sourceUrl: 'https://예시.kr/주문/12345', title: '주문 상세' }], result: {} })],
  });
  assert.match(workingStateFacts(st), /방금 읽은 자료: 주문 상세/);
});

// ── 지어내지 않는다 ─────────────────────────────────────────────────────
test('아는 자리가 없으면 자리를 말하지 않는다', () => {
  const f = workingStateFacts(턴(null));
  assert.ok(!f || !/지금 자리/.test(f), '모르는 자리를 지어내면 모델이 엉뚱한 곳에서 일한다');
});

test('사용자가 화제를 바꾸면 옛 자리가 "지금"에서 내려온다', () => {
  let st = 턴(null, R('local.terminal', { command: 'ls', cwd: '/Users/누구/계약서', exitCode: 0 }));
  for (let i = 0; i < 10; i += 1) st = 턴(st); // 다른 얘기만 계속
  const f = workingStateFacts(st);
  assert.ok(!f || !/지금 자리/.test(f), '옛 자리가 영원히 "지금"이면 엉뚱한 폴더에서 일한다');
});

// ── 긴 목록을 모델에게 넣지 않는다 (완료 기준) ───────────────────────────
test('사실은 짧다 — 파일 목록이 모델 입력에 들어가지 않는다', () => {
  let st = null;
  for (let i = 0; i < 12; i += 1) {
    st = 턴(st, R('local.terminal', { command: `작업-${i}`, cwd: `/Users/누구/폴더-${i}`, exitCode: 0 }));
  }
  const f = workingStateFacts(st) ?? '';
  assert.ok(f.length < 1200, `사실 블록이 프롬프트를 삼킨다(${f.length}자)`);
  assert.ok(f.split('\n').length <= 12, `줄이 너무 많다(${f.split('\n').length}줄)`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receipt, blockedReceipt, leaksDiagnostics } from '../src/kernel/l0-evidence/tool-receipt.js';
import { TruthLedger } from '../src/kernel/l0-evidence/ledger.js';

// S15: 실행 불가 도구의 receipt 는 actualCall 이 null(호출한 척 금지).
test('blockedReceipt 는 actualCall 이 null 이고 failureState=blocked', () => {
  const r = blockedReceipt('slack 게시', 'slack.post', '슬랙은 아직 게시 권한이 연결되지 않았어요');
  assert.equal(r.actualCall, null);
  assert.equal(r.failureState, 'blocked');
});

// S43/안티 대시보드: 진단면 내부값이 사용자면 문자열에 새면 위반.
test('diagnosticTrace 의 스택·오류코드가 userSafeSummary 로 새지 않는다', () => {
  const clean = receipt({
    intended: '메일 조회',
    actualCall: { tool: 'mail.read' },
    failureState: 'failed',
    userSafeSummary: '메일 서버가 잠깐 응답하지 않았어요.',
    diagnosticTrace: { message: 'HTTP 500', stack: 'at handler (/Users/x/app.js:12:5)' },
  });
  assert.equal(leaksDiagnostics(clean), false);

  // 사용자면에 진단 내부값을 실수로 담으면 감지된다(반대 케이스).
  const leaky = receipt({
    intended: '메일 조회',
    actualCall: { tool: 'mail.read' },
    failureState: 'failed',
    userSafeSummary: 'HTTP 500 at handler (/Users/x/app.js:12:5)',
    diagnosticTrace: { message: 'HTTP 500', stack: 'at handler (/Users/x/app.js:12:5)' },
  });
  assert.equal(leaksDiagnostics(leaky), true);
});

test('receipt 는 intended·userSafeSummary 필수', () => {
  assert.throws(() => receipt({ userSafeSummary: 'x' }));
  assert.throws(() => receipt({ intended: 'x' }));
});

// 계획서 §5.4: 원장은 확인/미확인/추정을 분리한다.
test('원장은 확인/미확인/추정을 분리 투영한다', () => {
  const L = new TruthLedger();
  L.append(receipt({ intended: '수집A', actualCall: { tool: 'web.collect' }, result: {}, userSafeSummary: 'A 확인' }));
  L.append(blockedReceipt('수집B', 'web.collect', 'B는 막힘', '대체 경로'));
  L.append(receipt({ intended: '지식', userSafeSummary: '모델 지식 기반', failureState: 'none' })); // actualCall 없음 → 추정
  const p = L.project();
  assert.deepEqual(p.confirmed, ['A 확인']);
  assert.equal(p.unconfirmed.length, 1);
  assert.match(p.unconfirmed[0], /대체 경로/);
  assert.deepEqual(p.estimated, ['모델 지식 기반']);
});

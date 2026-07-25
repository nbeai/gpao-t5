import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCompletionCriteria, verifyCompletion } from '../src/kernel/l2-plan/completion-contract.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

// ── 파싱: 자연어 완료 기준 → 구조화 체크(영상 예시). ──
test('parseCompletionCriteria: 개수·중복·누락·섹션·중단·제약', () => {
  const c = parseCompletionCriteria('분류 결과가 30건이고 중복 없고 누락 없고 배송 환불 계정 섹션이 모두 존재. 원본 CSV는 수정하지 말고 애매한 문의가 3건 넘으면 멈추고 물어봐.');
  const byType = (t) => c.checks.find((x) => x.type === t);
  assert.equal(byType('count').expected, 30);
  assert.ok(byType('no_duplicate'));
  assert.ok(byType('no_missing'));
  assert.deepEqual(byType('sections_exist').sections, ['배송', '환불', '계정']);
  assert.deepEqual(c.stop, { type: 'ambiguous_over', n: 3 });
  assert.ok(c.constraints.includes('원본은 수정하지 않는다'));
});

// ── 검증: 완료 = 검증 통과. "생성했다"만으론 완료 아님. ──
const contract = parseCompletionCriteria('30건, 중복 없고, 누락 없고, 배송 환불 계정 섹션 존재. 애매 3건 넘으면 멈춰.');

test('완료: 모든 기준 통과해야 complete', () => {
  const r = verifyCompletion(contract, { count: 30, items: [...Array(30).keys()], sections: ['배송', '환불', '계정'], ambiguousCount: 1 });
  assert.equal(r.complete, true);
  assert.equal(r.allPassed, true);
  assert.ok(r.checks.every((c) => c.ok));
});

test('미완료: 개수 틀리면 complete=false + 무엇이 안 맞는지', () => {
  const r = verifyCompletion(contract, { count: 28, items: [...Array(28).keys()], sections: ['배송', '환불', '계정'] });
  assert.equal(r.complete, false);
  assert.match(r.userSafeSummary, /아직 완료가 아니에요/);
  assert.match(r.userSafeSummary, /개수/);
  assert.ok(r.nextSafeAction, '다음 안전 행동 제시');
});

test('미완료: 섹션 빠지면 그 섹션을 지목', () => {
  const r = verifyCompletion(contract, { count: 30, items: [...Array(30).keys()], sections: ['배송', '환불'] });
  assert.equal(r.complete, false);
  const sec = r.checks.find((c) => c.name.includes('섹션'));
  assert.equal(sec.ok, false);
  assert.match(sec.detail, /계정/, '빠진 섹션 지목');
});

test('중복 검출: 같은 항목 있으면 no_duplicate 실패', () => {
  const r = verifyCompletion(contract, { count: 30, items: [1, 1, ...Array(28).keys()], sections: ['배송', '환불', '계정'] });
  assert.equal(r.checks.find((c) => c.name === '중복 없음').ok, false);
});

test('중단: 애매 항목이 기준 넘으면 멈추고 묻는다(완료 아님)', () => {
  const r = verifyCompletion(contract, { count: 30, items: [...Array(30).keys()], sections: ['배송', '환불', '계정'], ambiguousCount: 5 });
  assert.equal(r.stopTriggered, true);
  assert.equal(r.complete, false, '중단 조건이면 완료로 보지 않는다');
  assert.match(r.userSafeSummary, /멈췄어요/);
});

test('기준 없으면 완료로 단정하지 않는다', () => {
  const r = verifyCompletion({ checks: [] }, { count: 30 });
  assert.equal(r.complete, false);
});

// ── 서버 엔드포인트 ──
test('서버 POST /verify: 기준+산출물 → 검증 receipt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-cc-'));
  const server = makeServer({ store: new SessionStore(dir) });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const pass = await (await fetch(`http://127.0.0.1:${port}/verify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ criteria: '30건, 중복 없고 누락 없고 배송 환불 계정 섹션 존재', artifact: { count: 30, items: [...Array(30).keys()], sections: ['배송', '환불', '계정'] } }),
    })).json();
    assert.equal(pass.receipt.complete, true);
    const fail = await (await fetch(`http://127.0.0.1:${port}/verify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ criteria: '30건 존재', artifact: { count: 12 } }),
    })).json();
    assert.equal(fail.receipt.complete, false);
    assert.match(fail.receipt.userSafeSummary, /아직 완료/);
    // 빈 기준은 400
    const bad = await fetch(`http://127.0.0.1:${port}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(bad.status, 400);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

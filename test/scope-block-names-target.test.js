// **막을 때도 무엇을 막았는지 말한다.**
//
// 라이브 실측(2026-08-03, 실모델). "내 다운로드 폴더를 같이 정리해볼까?" 에 T5 는 이렇게 답했다:
//
//   "그 자리는 파일 도구의 작업 폴더 밖이에요. 파일 도구는 작업 폴더, **다운로드**, 문서,
//    바탕화면 안에서만 다뤄요."
//
// 다운로드가 된다면서 다운로드를 거절한 셈이라 사용자에겐 모순으로만 읽혔다. 그리고
// **어느 자리가 문제인지는 어디에도 없었다** — 원장 진단도 `{tool:'local.file',
// reason:'not_executable'}` 이 전부였고 `actualCall` 은 null 이었다. 결함을 재현할 근거가
// 없었고, 모델도 무엇을 고쳐 다시 부를지 알 수 없었다.
//
// 이건 "조용히 자르지 않는다"와 같은 계열이다 — **모호하게 막지 않는다.**
//
// 지키는 것 둘:
//  ① 사용자면은 막힌 곳을 **사람이 부르는 말**로 가리킨다.
//  ② 진단면은 **실제 경로**를 남긴다. 단, 사용자면에는 절대 새지 않는다
//     (2026-08-02 사고: 절대경로가 답변에 그대로 옮겨 적혔다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outOfScopeMessage } from '../src/runtime/file-scope.js';

const 오류 = (target, roots = ['/집/GPAO-T5', '/집/Downloads']) => ({ isScopeError: true, target, roots });

test('막힌 곳을 사람이 부르는 말로 가리킨다', () => {
  const m = outOfScopeMessage(오류('/Volumes/외장하드/자료'));
  assert.match(m.userSafeSummary, /자료/, `무엇이 막혔는지 안 말한다: ${m.userSafeSummary}`);
  assert.ok(!/그 자리는/.test(m.userSafeSummary), '가리킬 수 있는데 "그 자리"로 뭉갰다');
});

test('표준 폴더는 사용자가 부르는 이름으로 — 두 벌 이름표를 만들지 않는다', () => {
  assert.match(outOfScopeMessage(오류('/집/Downloads')).userSafeSummary, /다운로드/);
  assert.match(outOfScopeMessage(오류('/집/Documents')).userSafeSummary, /문서/);
  assert.match(outOfScopeMessage(오류('/집/GPAO-T5')).userSafeSummary, /작업 폴더/);
});

// ── 여기가 이 검사의 안전 조건 ────────────────────────────────────────────
test('사용자면에 절대경로가 새지 않는다(2026-08-02 사고 재발 차단)', () => {
  for (const t of ['/Users/jyp/Volumes/외장하드/자료', '/집/Downloads', '/private/tmp/x/y']) {
    const m = outOfScopeMessage(오류(t));
    const 문장 = `${m.userSafeSummary} ${m.nextSafeAction}`;
    assert.ok(!문장.includes('/'), `사용자면에 경로가 실렸다: ${문장}`);
  }
});

test('진단면에는 실제 경로가 남는다 — 없으면 결함을 재현할 수 없다', () => {
  const m = outOfScopeMessage(오류('/Volumes/외장하드/자료'));
  assert.equal(m.diagnostic?.reason, 'out_of_scope');
  assert.equal(m.diagnostic?.target, '/Volumes/외장하드/자료', '진단면이 대상을 안 들고 있다');
  assert.ok(Array.isArray(m.diagnostic?.roots), '어디까지가 범위였는지도 진단면에 남아야 한다');
});

test('가리킬 수 없으면 지어내지 않는다', () => {
  const m = outOfScopeMessage(오류(''));
  assert.match(m.userSafeSummary, /그 자리는/, '대상이 없는데 이름을 만들어냈다');
  assert.equal(m.diagnostic?.target, null);
});

test('범위 안내는 그대로 남는다(막고 끝내지 않는다)', () => {
  const m = outOfScopeMessage(오류('/Volumes/외장하드/자료'));
  assert.match(m.nextSafeAction, /다운로드/, '어디까지 다루는지 말해야 다음 걸음이 생긴다');
});

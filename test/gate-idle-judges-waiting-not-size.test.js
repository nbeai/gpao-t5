// **게이트 벽시계 → 유휴 교체의 반대시험** (§1-A 규격 ③ — "반대시험이 없으면 이 변경은 장식이다").
//
// 재는 것은 셋이다:
//   ① 잠든 검사 모양이 걸리는가            — 자를 바꾼 뒤에도 목적이 사는가
//   ② 부하 모양이 안 걸리는가              — 옛 자가 뒤집히던 바로 그 실측값으로
//   ③ 재료가 안 서면 조용히 통과하지 않는가 — 동시성 못 읽음 · 측정 없음 = null
//
// 실계 반대시험(일부러 잠드는 검사를 심고 게이트가 빨개지는 것)은 2026-08-08 에 한 번
// 밟았다 — 그 기록은 커밋 본문에 있다. 여기는 그 판정식이 회귀하지 않게 지키는 자리다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { 동시성, 유휴초 } from '../scripts/gate-idle.mjs';

const baseline = JSON.parse(await readFile(new URL('../scripts/gate-baseline.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('동시성은 package.json 에서 읽는다 — 숫자를 박지 않는다', () => {
  const c = 동시성(pkg);
  assert.ok(Number.isInteger(c) && c >= 1, `--test-concurrency 를 못 읽었다: ${c}`);
});

test('동시성을 못 읽으면 null — 조용히 1 로 메워 판정을 느슨하게 하지 않는다', () => {
  assert.equal(동시성({ scripts: { test: 'node --test' } }), null);
  assert.equal(동시성({}), null);
});

test('잠든 검사가 걸린다 — sleep 30 이 섞인 모양 (유휴가 상한을 넘는다)', () => {
  // 한가한 기계 실측(벽시계 23.6 · CPU 41.6)에 잠 30초가 꼬리로 붙은 모양이다.
  const idle = 유휴초({ wall: 23.6 + 30, cpu: 41.6, concurrency: 3 });
  assert.ok(idle > baseline.testIdleSeconds,
    `잠든 검사 모양이 안 걸린다: 유휴 ${idle}s ≤ 상한 ${baseline.testIdleSeconds}s — 자가 장식이다`);
});

test('부하는 안 걸린다 — 옛 자(벽시계 30s)가 뒤집히던 실측값 그대로', () => {
  // 2026-08-08 실측: 옆에서 부하가 돌아 벽시계 35.4s(옛 자로 BLOCKED)였던 그 회차.
  for (const [wall, cpu] of [[34.9, 85.5], [35.4, 87.7], [23.6, 41.6]]) {
    const idle = 유휴초({ wall, cpu, concurrency: 3 });
    assert.ok(idle !== null && idle <= baseline.testIdleSeconds,
      `부하·정상 모양이 걸렸다: 벽시계 ${wall} CPU ${cpu} → 유휴 ${idle}s > ${baseline.testIdleSeconds}s`);
  }
});

test('재료가 안 서면 null — 빈 측정을 통과로 세지 않는다', () => {
  assert.equal(유휴초({ wall: null, cpu: 41.6, concurrency: 3 }), null);
  assert.equal(유휴초({ wall: 23.6, cpu: 41.6, concurrency: null }), null);
});

test('상한은 실측 범위 위에 있고 잠(30s)보다는 아래다 — 교정의 자리 확인', () => {
  // 실측 유휴 6.2~9.7s. 상한이 그 밑이면 정상 실행이 막히고, 30s 위면 잠든 검사를 놓친다.
  assert.ok(baseline.testIdleSeconds > 10 && baseline.testIdleSeconds < 30,
    `testIdleSeconds=${baseline.testIdleSeconds} — 실측(≤9.7s)과 잠(30s) 사이가 아니다`);
});

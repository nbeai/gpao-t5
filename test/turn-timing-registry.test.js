// 진행 중인 턴의 계측 장부 (HRT-ST-001 두 번째 추출)
//
// 이 두 계약은 **추출 전에도 방어가 없었다.** 옮기면서 그 자리에 돌연변이를 넣어 보고서야
// 드러났다(둘 다 빠져나갔다). 추출이 만든 구멍이 아니라 원래 비어 있던 자리다.
//
// 왜 지키는가:
//   · cold/warm 은 P90-2 지연 측정의 축이다. 늘 cold 로 보고하면 첫 턴과 이후 턴을 같은
//     조건으로 세게 되고, 그 위에 세운 비교는 전부 무의미해진다.
//   · 장부는 **살아 있는 표**다. 만료된 항목을 안 걷으면 오래 켜 둔 프로세스에서 무한히 큰다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTurnTimingRegistry } from '../src/surface/turn-timing-registry.js';

const 계측기 = () => ({ markServer() {}, markServerAt() {}, reportBrowser() {} });

test('프로세스에서 처음 잰 턴만 cold 이고 그 뒤는 warm 이다', () => {
  const 장부 = makeTurnTimingRegistry();
  assert.equal(장부.nextProcessWarmth(), 'cold', '첫 턴이 cold 가 아니면 냉시동을 못 잰다');
  assert.equal(장부.nextProcessWarmth(), 'warm');
  assert.equal(장부.nextProcessWarmth(), 'warm', '두 번째 이후가 다시 cold 가 되면 안 된다');

  // 프로세스마다 따로 센다 — 장부가 다르면 온도도 처음부터다.
  assert.equal(makeTurnTimingRegistry().nextProcessWarmth(), 'cold');
});

test('만료된 계측 항목은 다음 조회에서 걷힌다 — 장부가 무한히 크지 않는다', () => {
  const 장부 = makeTurnTimingRegistry({ expiresMs: -1 }); // 올리는 즉시 만료된 것으로 친다
  장부.open('m-1', { timing: 계측기(), processWarmth: 'cold', sessionWarmth: 'first_turn' });
  assert.equal(장부.find('m-1'), undefined, '만료된 항목이 그대로 남아 있다');

  // 살아 있는 항목은 걷지 않는다(걷기가 과해도 안 된다).
  const 산장부 = makeTurnTimingRegistry();
  const entry = 산장부.open('m-2', { timing: 계측기(), processWarmth: 'warm', sessionWarmth: 'continued' });
  assert.equal(산장부.find('m-2'), entry, '진행 중인 턴을 찾지 못하면 브라우저 보고가 버려진다');
});

test('올린 항목의 모양은 옮기기 전과 같다', () => {
  const 장부 = makeTurnTimingRegistry();
  const timing = 계측기();
  const e = 장부.open('m-3', { timing, processWarmth: 'cold', sessionWarmth: 'first_turn' });
  assert.equal(e.timing, timing);
  assert.equal(e.processWarmth, 'cold');
  assert.equal(e.sessionWarmth, 'first_turn');
  assert.ok(e.pathKinds instanceof Set && e.pathKinds.size === 0);
  assert.equal(e.persisted, false);
  assert.equal(e.failed, false);
  assert.ok(typeof e.queue?.then === 'function');
  assert.equal(typeof e.expiresAt, 'number');
});

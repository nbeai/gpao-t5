import test from 'node:test';
import assert from 'node:assert/strict';

import { inspectSources } from '../scripts/audit-tcell-runtime-plane.mjs';

const sources = (extra = {}) => ({
  turn: '',
  admission: '',
  server: '',
  productionSources: [],
  ...extra,
});

test('감사기가 사용자 턴의 durable 저장소 읽기를 검출한다', () => {
  const report = inspectSources(sources({
    turn: 'await buildAdmissionSnapshot(ctx.admissionSources);',
    admission: 'const a = await sources.registry?.load?.();',
  }));
  assert.equal(report.foreground.passes, false);
  assert.equal(report.foreground.buildsSnapshot, true);
  assert.equal(report.foreground.durableStoreReads, true);
});

test('게시 스냅샷은 background producer와 동기 foreground consumer가 모두 있어야 한다', () => {
  const good = inspectSources(sources({
    turn: 'const snap = ctx.principleSnapshotStore.read(scopeKey);',
    productionSources: [{
      path: 'src/runtime/tcell-growth-worker.js',
      source: 'principleSnapshotStore.publish(scopeKey, frozenSnapshot);',
    }],
  }));
  assert.equal(good.foreground.passes, true);
  assert.equal(good.publishedSnapshot.passes, true);

  const noProducer = inspectSources(sources({
    turn: 'const snap = ctx.principleSnapshotStore.read(scopeKey);',
  }));
  assert.equal(noProducer.publishedSnapshot.passes, false);

  const awaited = inspectSources(sources({
    turn: 'const snap = await ctx.principleSnapshotStore.read(scopeKey);',
    productionSources: [{
      path: 'src/runtime/tcell-growth-worker.js',
      source: 'principleSnapshotStore.publish(scopeKey, frozenSnapshot);',
    }],
  }));
  assert.equal(awaited.foreground.passes, false);
  assert.equal(awaited.publishedSnapshot.passes, false);
});

test('감사기가 응답 뒤 세션별 추출과 전역 추출 잠금을 구분한다', () => {
  const good = inspectSources(sources({
    server: `
      const 추출상태 = new Map();
      queueMicrotask(() => { 원리후보추출(next); });
    `,
  }));
  assert.equal(good.backgroundExtraction.passes, true);

  const bad = inspectSources(sources({
    server: `
      let 추출중 = false;
      queueMicrotask(() => { 원리후보추출(next); });
    `,
  }));
  assert.equal(bad.backgroundExtraction.passes, false);
  assert.equal(bad.backgroundExtraction.globalLock, true);
});

test('감사기가 원문 유입과 생산 replay 소비자 부재를 검출한다', () => {
  const report = inspectSources(sources({
    server: 'const bundle = { activeTarget: input.text ?? "" };',
    productionSources: [
      { path: 'src/kernel/l5-growth/tcell-replay-engine.js', source: 'export function transitionCell() {}' },
      { path: 'src/app.js', source: 'makeReplayCase(input); transitionCell(cell, packet);' },
    ],
  }));
  assert.equal(report.backgroundExtraction.rawUserTextInBundle, true);
  assert.equal(report.lifecycle.transitionConsumers, 1);
  assert.equal(report.lifecycle.replayCaseConsumers, 1);
  assert.equal(report.lifecycle.passes, true);
});

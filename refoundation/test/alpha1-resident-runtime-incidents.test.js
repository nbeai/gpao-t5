import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixture = JSON.parse(await readFile(new URL(
  '../config/alpha1-resident-runtime-incidents.json', import.meta.url,
), 'utf8'));

test('Alpha1은 구현 전 상주 Runtime의 lifecycle·owner·update·power 사고 가족을 고정한다', () => {
  assert.equal(fixture.schema, 't5.alpha1.resident-runtime-incidents.v1');
  assert.equal(fixture.incidents.length, 12);
  const families = new Set(fixture.incidents.map((item) => item.family));
  for (const family of ['ui_runtime_lifecycle', 'cross_process_singleton', 'runtime_update',
    'crash_recovery', 'power_transition', 'native_notification', 'network_transition',
    'platform_boundary', 'canonical_ownership']) assert.equal(families.has(family), true);
  assert.ok(fixture.incidents.every((item) => item.counterexample && item.oracle));
});

test('Alpha1은 현재 canonical store를 보존하고 원격·다중 profile·OS 명령을 Core 목표로 열지 않는다', () => {
  assert.ok(fixture.positiveControls.length >= 3);
  assert.ok(fixture.adoptedReferencePrinciples.length >= 2);
  assert.ok(fixture.notAdopted.some((item) => item.includes('second Work')));
  assert.ok(fixture.notAdopted.some((item) => item.includes('OS-specific')));
  assert.ok(fixture.notAdopted.some((item) => item.includes('remote runtime')));
});

test('Alpha1 사고 fixture는 실제 사용자·비밀·개인 경로를 포함하지 않는다', () => {
  const text = JSON.stringify(fixture);
  assert.doesNotMatch(text, /\/Users\/|C:\\Users\\|sk-[A-Za-z0-9]|-----BEGIN/u);
});

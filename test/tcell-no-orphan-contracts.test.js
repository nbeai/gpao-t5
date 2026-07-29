// 구현자 자기점검(2026-07-29) — **계약의 모양만 만들고 결합하지 않는 것**을 사람 기억이 아니라
// 검사가 잡는다. TG-0~4 에서 되풀이된 실패다: assertCompressionSafe 를 validateTCell 이 안 부르고,
// wake/묶음/추출이 생산 경로에 없었고, turnId 를 세는 계약을 만들고 turnId 를 안 채웠고,
// importLegacyMemory 를 아무도 부르지 않았다(기존 기억이 영원히 이관되지 않는 상태였다).
//
// 규칙: T-cell 모듈의 export 는 **자기 모듈 밖의 제품 코드가 소비**하거나, 아래 유예 원장에
// 사유와 배선 시점이 적혀 있어야 한다. 유예 원장이 곧 "만들었지만 아직 안 붙인 것"의 정직한 목록이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const T셀모듈 = [
  'src/kernel/l0-evidence/tcell-observation.js',
  'src/kernel/l5-growth/tcell-core.js',
  'src/kernel/l5-growth/tcell-replay.js',
  'src/kernel/l5-growth/tcell-replay-engine.js',
  'src/kernel/l5-growth/t-sphere.js',
  'src/runtime/tcell-extractor.js',
  'src/surface/tcell-store.js',
];

/**
 * 유예 원장 — **아직 제품이 소비하지 않는 계약과 그 이유·배선 시점.**
 * 여기 적히지 않은 고아는 검사가 실패시킨다. 배선되면 여기서 지운다.
 */
const 유예 = new Map(Object.entries({
  // TG-4 는 감사 지시로 배선 없이 자체 검증만 한다("TG-2 저장소·TG-3 후보 미소비").
  // 성숙도·replay·영향을 바꾸는 **유일한 공개 통로** — TG-5 admission 통합에서 소비한다.
  transitionCell: 'TG-4 배선 보류(감사 지시) — TG-5A admission 통합의 유일한 진입점',
  // sphere 는 TG-6(압축) 단계의 계약이다. 그 전에는 소비자가 없는 것이 정상이다.
  makeTSphere: 'TG-6 압축 단계 계약 — 그 단계에서 소비',
  validateTSphere: 'TG-6 압축 단계 계약 — 그 단계에서 소비',
  // replay 사례는 TG-5 이후 실제 사례 생성기가 만든다. 지금은 계약과 검사만 있다.
  makeReplayCase: 'TG-5 이후 사례 생성기가 소비 — 현재는 계약·검사만',
  // **발견된 제품 공백(2026-07-29 자기점검)**: TG-2 에서 만들고 검사·증거까지 봉인했으나
  // 제품에서 아무도 부르지 않아 기존 기억이 영원히 이관되지 않는 상태였다. 배선 자체는 감사가
  // 통합 단계로 지정한 범위라 임의로 붙이지 않고 여기에 드러낸다 — 통합 시 첫 항목으로 붙인다.
  importLegacyMemory: '제품 공백(감사 보고함) — TG-2 통합 배선의 첫 항목. 부팅 1회 이관 예정',
}));

test('T-cell 계약에 고아가 없다 — 소비되거나, 유예 원장에 사유가 적혀 있다', async () => {
  const 소스 = [];
  const 훑기 = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await 훑기(p);
      else if (e.name.endsWith('.js')) 소스.push({ path: p, text: await readFile(p, 'utf8') });
    }
  };
  await 훑기('src');

  const 고아 = [];
  for (const mod of T셀모듈) {
    const self = 소스.find((s) => s.path === mod);
    assert.ok(self, `모듈이 없다: ${mod}`);
    const names = [
      ...self.text.matchAll(/^export (?:async )?function ([A-Za-z_$가-힣][\w$가-힣]*)/gm),
      ...self.text.matchAll(/^export const ([A-Za-z_$][\w$]*)/gm),
    ].map((m) => m[1]);
    for (const n of names) {
      const 밖에서씀 = 소스.some((s) => s.path !== mod && new RegExp(`\\b${n}\\b`).test(s.text));
      const 안에서씀 = (self.text.match(new RegExp(`\\b${n}\\b`, 'g')) ?? []).length > 1;
      if (밖에서씀 || 안에서씀) continue;
      if (유예.has(n)) continue;
      고아.push(`${n} (${mod})`);
    }
  }
  assert.deepEqual(고아, [], `소비자도 유예 사유도 없는 계약:\n  - ${고아.join('\n  - ')}`);
});

test('유예 원장은 실제로 고아인 것만 담는다 — 배선된 뒤에도 남아 썩지 않게', async () => {
  const 소스 = [];
  const 훑기 = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await 훑기(p);
      else if (e.name.endsWith('.js')) 소스.push({ path: p, text: await readFile(p, 'utf8') });
    }
  };
  await 훑기('src');
  const 썩은것 = [];
  for (const [n, 사유] of 유예) {
    const 정의처 = T셀모듈.find((m) => new RegExp(`^export (?:async )?(?:function )?(?:const )?${n}\\b`, 'm')
      .test(소스.find((s) => s.path === m)?.text ?? ''));
    if (!정의처) { 썩은것.push(`${n}: 이제 존재하지 않는 export (${사유})`); continue; }
    const 밖에서씀 = 소스.some((s) => s.path !== 정의처 && new RegExp(`\\b${n}\\b`).test(s.text));
    if (밖에서씀) 썩은것.push(`${n}: 이미 배선됐는데 유예에 남아 있다 (${사유})`);
  }
  assert.deepEqual(썩은것, [], `유예 원장이 낡았다:\n  - ${썩은것.join('\n  - ')}`);
});

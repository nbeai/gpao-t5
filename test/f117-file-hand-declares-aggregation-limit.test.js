// F-117 — 파일 손 선언이 자기 한계(집계 비용)를 말하지 않아 터미널이 죽었다.
//
// 선빨강(라이브): 오너 실측 2026-08-15 — 같은 질문에 비교군(더 약한 모델)은 셸 두 줄,
// T5(더 강한 모델)는 local.file 9회로 두 개만 재고 포기. 맨몸 대조군이 범인을 갈랐다:
//   파일 손 + 터미널(중립 선언)      터미널 0·0·0·0   ← 터미널 문구를 고쳐도 죽어 있다
//   파일 손이 집계 한계를 말함       터미널 1·2·3     ← 전부 살아남
// 증거: docs/03-verification/evidence/terminal-2026-08-15/맨몸대조군-*.json
//
// 이 검사는 그 수리(demo-context.js 집계한계채우기)가 계속 이어져 있는지 문다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoDescriptors } from '../src/surface/demo-context.js';

const 사실핵심 = '그런 일은 터미널이 명령 하나로 끝낸다';

test('① 터미널 손이 선언되는 설치에서는 파일 손이 집계의 한계를 말한다', () => {
  const 파일손 = demoDescriptors().find((d) => d.id === 'local.file');
  // capability(시스템 프롬프트에 실림)와 schema(도구 고르는 순간에 보임) **둘 다**여야 한다 —
  // 맨몸 대조군은 도구 설명 하나로 쟀고, 제품은 두 자리가 서로 다른 시점에 모델 눈에 간다.
  assert.ok(파일손.capability.includes(사실핵심), 'capability 에 집계 한계 사실이 없다');
  assert.ok(파일손.schema.description.includes(사실핵심), 'schema 설명에 집계 한계 사실이 없다');
});

test('② 터미널 손이 없는 설치에서는 없는 능력을 가리키지 않는다', () => {
  // hasCronTool 전례(demo-context.js:741) — 없는 손을 가리키는 선언은 못 지킬 약속이다.
  const 목록 = demoDescriptors({ include: ['local.file', 'local.locate'] });
  const 파일손 = 목록.find((d) => d.id === 'local.file');
  assert.ok(파일손, 'include 로 고른 local.file 이 안 나왔다');
  assert.ok(!파일손.capability.includes('터미널'), '터미널 없는 설치의 capability 가 터미널을 가리킨다');
  assert.ok(!파일손.schema.description.includes('터미널'), '터미널 없는 설치의 schema 가 터미널을 가리킨다');
});

test('④ 경계는 골라야 할 손 쪽에도 적혀 있다 — 터미널 스키마가 집계 강점을 말한다', () => {
  // 와이어 재생 실측(2026-08-15): 파일 쪽에만 적으면 0/5, 터미널 스키마에도 적으면 4/5.
  // capability(시스템 프롬프트)에만 있고 스키마(고르는 순간)에 없던 것이 병이었다.
  const 터미널 = demoDescriptors().find((d) => d.id === 'local.terminal');
  assert.ok(터미널.schema.description.includes('명령 하나로 끝난다'),
    '터미널 스키마에 집계 강점 사실이 없다');
});

test('③ 채운 것은 사실이지 강제가 아니다 — 파일 손의 기존 능력 선언은 그대로다', () => {
  // 범위를 좁히면 F-46 계열(좁은 선언을 모델이 믿음)이 다시 열린다. 홈 전체 읽기는 남아야 한다.
  const 파일손 = demoDescriptors().find((d) => d.id === 'local.file');
  assert.ok(파일손.schema.description.includes('홈 전체'), '읽기 범위 선언이 좁아졌다');
  assert.ok(/금지|하지 마라|쓰지 마라/.test(파일손.capability) === false,
    '사실 문장이 금지문으로 변질됐다 — 유도가 아니라 강제다');
});

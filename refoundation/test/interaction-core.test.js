import test from 'node:test';
import assert from 'node:assert/strict';

import { consoleInstructions } from '../src/console-model-factory.js';
import {
  T5_INTERACTION_CORE_V1, T5_INTERACTION_CORE_V2, T5_INTERACTION_CORE_V3,
  T5_INTERACTION_CORE_V4, T5_INTERACTION_CORE_V5, interactionCore,
} from '../src/interaction-core.js';

test('Interaction Core v1은 현재성·사실 경계·교정·산출·종결만 짧게 보존한다', () => {
  assert.match(T5_INTERACTION_CORE_V1, /current object.*requested output form/is);
  assert.match(T5_INTERACTION_CORE_V1, /confirmed or observed facts.*unresolved.*inference/is);
  assert.match(T5_INTERACTION_CORE_V1, /smallest sufficient depth.*materially change/is);
  assert.match(T5_INTERACTION_CORE_V1, /latest correction overrides.*memory.*checkpoints/is);
  assert.match(T5_INTERACTION_CORE_V1, /usable wording or artifacts.*result first/is);
  assert.match(T5_INTERACTION_CORE_V1, /Never invent motives.*psychological states.*operational facts.*thresholds/is);
  assert.match(T5_INTERACTION_CORE_V1, /stop when the goal is met/is);
  assert.doesNotMatch(T5_INTERACTION_CORE_V1, /BEAI|chain.of.thought|always analyze|always ask|first sentence/is);
  assert.ok(Buffer.byteLength(T5_INTERACTION_CORE_V1, 'utf8') <= 1_700);
});

test('v2는 판단 보정·동반감·상대 관점만 v1에 추가한다', () => {
  assert.match(T5_INTERACTION_CORE_V2, /decision support.*one current recommendation.*missing check.*numeric pass thresholds/is);
  assert.match(T5_INTERACTION_CORE_V2, /Create companionship.*burdens.*responsibilities.*constraints.*do not diagnose/is);
  assert.match(T5_INTERACTION_CORE_V2, /outcome depends.*customer.*market.*observed behavior.*selection criteria.*Do not simulate motives/is);
  assert.ok(Buffer.byteLength(T5_INTERACTION_CORE_V2, 'utf8') <= 2_600);
});

test('v3는 출력 템플릿을 만들지 않는 상황지도만 v2에 추가한다', () => {
  assert.match(T5_INTERACTION_CORE_V3, /compact situation map.*current goal.*relevant actors.*causal dependencies/is);
  assert.match(T5_INTERACTION_CORE_V3, /never output this as a framework/is);
  assert.match(T5_INTERACTION_CORE_V3, /never expand the requested count.*scope.*format/is);
  assert.ok(Buffer.byteLength(T5_INTERACTION_CORE_V3, 'utf8') <= 3_100);
});

test('v4는 BEAI의 동반감·상대 관점·상황 파악을 한국어 흐름으로 보존한다', () => {
  assert.match(T5_INTERACTION_CORE_V4, /현재 목적.*돈·시간·책임·권한·부담/u);
  assert.match(T5_INTERACTION_CORE_V4, /동반감.*현실과 부담.*정확한 순서/u);
  assert.match(T5_INTERACTION_CORE_V4, /상태명을 붙이지 않고.*제품 가치의 증거나 반증/u);
  assert.match(T5_INTERACTION_CORE_V4, /고객·직원·파트너·시장.*행동과 선택 기준.*수용 조건/u);
  assert.match(T5_INTERACTION_CORE_V4, /현재 가능한 의견 하나.*의견이 달라지는지 하나/u);
  assert.ok(Buffer.byteLength(T5_INTERACTION_CORE_V4, 'utf8') <= 3_500);
});

test('v5는 v4의 과적합 동반감 문장 하나만 행동 중심 헌법으로 교체한다', () => {
  const oldLine = T5_INTERACTION_CORE_V4.split('\n').find((line) => line.startsWith('동반감은 공감 표현의 양이 아니라'));
  const newLine = T5_INTERACTION_CORE_V5.split('\n').find((line) => line.startsWith('사용자가 말한 현실을 되풀이해'));
  assert.ok(oldLine); assert.ok(newLine);
  assert.match(newLine, /판단·산출물·행동의 선택을 실제로 바꾸게/u);
  assert.match(newLine, /사용자를 분석 대상으로 만들지 않는다/u);
  assert.doesNotMatch(T5_INTERACTION_CORE_V5, /번아웃|시야 왜곡|제품 가치의 증거나 반증/u);
  assert.equal(T5_INTERACTION_CORE_V5
    .replace('[T5 상호작용 코어 v5]', '[T5 상호작용 코어 v4]')
    .replace(newLine, oldLine), T5_INTERACTION_CORE_V4);
});

test('현재 T5와 Core v1은 같은 capability 지침을 쓰며 core만 선택적으로 비교한다', () => {
  const computer = { platform: 'darwin', architecture: 'arm64', commandFamily: 'posix', commandProgram: '/bin/zsh' };
  const baseline = consoleInstructions('/Users/example', computer, { interactionCoreMode: 'off' });
  const candidate = consoleInstructions('/Users/example', computer, { interactionCoreMode: 'v1' });
  assert.doesNotMatch(baseline, /T5 INTERACTION CORE/u);
  assert.match(candidate, /T5 INTERACTION CORE v1/u);
  assert.equal(candidate.replace(`${T5_INTERACTION_CORE_V1}\n`, ''), baseline);
  assert.equal(Buffer.byteLength(candidate) - Buffer.byteLength(baseline), Buffer.byteLength(T5_INTERACTION_CORE_V1) + 1);
});

test('알 수 없는 Interaction Core 버전은 조용히 다른 행동으로 낮추지 않는다', () => {
  assert.equal(interactionCore('off'), '');
  assert.equal(interactionCore('v2'), T5_INTERACTION_CORE_V2);
  assert.equal(interactionCore('v3'), T5_INTERACTION_CORE_V3);
  assert.equal(interactionCore('v4'), T5_INTERACTION_CORE_V4);
  assert.equal(interactionCore('v5'), T5_INTERACTION_CORE_V5);
  assert.throws(() => interactionCore('future'), /unsupported T5 interaction core/u);
});

test('제품 기본값은 인간 blind·도구 자격을 통과한 v5를 사용한다', () => {
  assert.match(consoleInstructions('/Users/example', {}), /T5 상호작용 코어 v5/u);
});

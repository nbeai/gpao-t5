// P2-5a · 판단 헌장 — 모델에게 **보는 법**을 준다(허가 목록이 아니다).
//
// 왜: 말귀를 정규식으로 구현하고 프롬프트를 금지 나열로 채운 결과, GPT-5.5 가 "오늘 날씨"에
// 두 번 되묻고 "웹 조회가 연결되어 있지 않습니다"라고 답했다. 모델이 멍청한 게 아니라 우리가
// 눈을 가렸다. 이 파일은 그 실패로 돌아가지 않게 고정한다.
//
// 목표 네 축(오너 정의): 사용자 의도 파악 · 맥락 연결의 정확성 · 장기대화 안정성 · 판단 능력.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgmentCharter } from '../src/kernel/judgment-charter.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const selfState = buildSelfState(demoEnv());
const systemFor = (text, opts = {}) => buildModelMessages(
  buildTaskContext({ intent: interpret(text, { selfState }), selfState, ...opts }),
).system;

// ── 네 축이 헌장에 실제로 들어 있다 ──────────────────────────────────────
test('의도 파악: 확정·미정·추정을 나누고, 미정 때문에 판단을 흐리지 않는다', () => {
  const c = judgmentCharter();
  assert.match(c, /확정은 선명하게 닫고/);
  assert.match(c, /미정을 추정 안 한다는 이유로 판단 가능한 부분까지 흐리지 않는다/);
});

test('질문 절제: 기본값이 아니고, 하나만, 사실이 있으면 묻지 않는다', () => {
  const c = judgmentCharter();
  assert.match(c, /질문은 기본값 아님/);
  assert.match(c, /하나만/);
  assert.match(c, /아래 사실로 답할 수 있으면 묻지 않는다/, '시각·지역을 주고도 되묻던 실패를 막는다');
});

test('맥락 연결: 이전 대화가 지금 발화를 덮지 않는다', () => {
  const c = judgmentCharter();
  assert.match(c, /덮는 것 아님/);
  assert.match(c, /한 번 말했을 뿐인 것은 아직 기준 아님/, '한 번 말한 것을 합의로 굳히지 않는다');
});

test('장기 안정성: 길어질수록 더 적은 말로, 구조를 반복하지 않는다', () => {
  const c = judgmentCharter();
  assert.match(c, /더 적은 말로 더 정확히/);
  assert.match(c, /반복 금지/);
});

test('도구 경계: 제안은 모델, 실행·승인·기록은 런타임', () => {
  const c = judgmentCharter();
  assert.match(c, /실행·승인·기록은 T5\(런타임\)가 한다/);
  assert.match(c, /실행 안 된 일을 한 것처럼 말하지 않는다/, '보낸 척·한 척 금지는 계약이다');
  assert.match(c, /되묻기 전에 할 수 있는 것부터 한다/);
});

// ── 허가 목록으로 되돌아가지 않는다 (§24) ────────────────────────────────
test('모델을 위축시키던 문장이 없다', () => {
  const sys = systemFor('오늘 날씨 좀 알려줄래?');
  assert.ok(!/확실하지 않으면 .*확인이 필요/.test(sys), '헤지를 시키는 규칙 금지');
  assert.ok(!/할 수 있는 일은 위 목록이 전부다/.test(sys), '허가 목록 금지 — 모델 자신의 능력까지 막았다');
});

test('헌장은 보는 법이지 출력 템플릿이 아니다', () => {
  const c = judgmentCharter();
  assert.ok(!/["'].{0,40}(라고 답|라고 말|라고 시작)/.test(c), '문장을 지정하면 템플릿 응답이 된다');
});

// ── 헌장과 사실을 섞지 않는다 ────────────────────────────────────────────
test('캐시 경계: 고정된 것이 앞, 매 턴 바뀌는 것이 뒤', () => {
  const sys = systemFor('안녕');
  const charter = judgmentCharter();
  assert.ok(sys.includes(charter), '헌장은 턴마다 달라지지 않는다');
  const envAt = sys.indexOf('[환경]');
  const nowAt = sys.indexOf('[지금]');
  assert.ok(envAt > 0 && nowAt > envAt, '환경(고정) → 지금(가변) 순서여야 캐시가 산다');
  // 정확한 시각을 앞에 두면 매 턴 전체가 캐시 미스다(실제로 그렇게 만들어 놨다가 고쳤다).
  const volatileLen = sys.length - nowAt;
  assert.ok(volatileLen < 120, `가변 구역이 ${volatileLen}자 — 캐시 접두를 갉아먹는다`);
});

test('환경 사실: 시간대·도구·내장 검색을 알려주고, 정확한 시각은 뒤에 둔다', () => {
  const sys = systemFor('오늘 날씨 좀 알려줄래?', { nativeSearch: true });
  const env = sys.slice(sys.indexOf('[환경]'), sys.indexOf('[지금]'));
  assert.match(env, /사용자 시간대: \w+\/\w+/, '지역을 매번 되묻지 않게 사실을 준다');
  assert.match(env, /내장 검색/, '스스로 찾을 수 있다는 사실을 알아야 찾는다');
  assert.match(sys.slice(sys.indexOf('[지금]')), /20\d\d년/, '"오늘"을 다루려면 지금이 언제인지 알아야 한다');
});

test('압축: 헌장이 다시 산문으로 부풀지 않는다(밀도 유지)', () => {
  const c = judgmentCharter();
  assert.ok(c.length <= 1500, `헌장이 ${c.length}자로 늘었다 — 한 줄=한 판단으로 압축할 것`);
  assert.ok(/<판단>[\s\S]*<질문>[\s\S]*<도구>/.test(c), '태그 구획으로 모델이 섹션을 잡게 한다');
});

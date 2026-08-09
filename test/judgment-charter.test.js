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
  assert.match(c, /덮지 않는다/);
  assert.match(c, /한 번 말한 것은 아직 기준 아님/, '한 번 말한 것을 합의로 굳히지 않는다');
});

test('장기 안정성: 길어질수록 더 적은 말로, 구조를 반복하지 않는다', () => {
  const c = judgmentCharter();
  assert.match(c, /더 적은 말로 정확히/);
  assert.match(c, /반복 금지/);
  assert.match(c, /자동 인사·도움 제안·재요약/);
  assert.match(c, /빈 약속/);
});

test('도구 경계: 제안은 모델, 실행·승인·기록은 런타임', () => {
  const c = judgmentCharter();
  // **실행 주체는 하나다**(오너 승인 2026-08-03). 예전엔 여기서 "실행·승인·기록은 T5(런타임)가
  // 한다"는 문장을 요구했는데, 그 문장이 바로 결함이었다 — 같은 프롬프트 네 줄 위 `identity.js`
  // 는 "너는 … 실제로 처리하는 AI 운영체제다"라고 말한다. 같은 자리에 "너"가 둘이었고, 모델은
  // 자기가 고르면 "T5 가" 실행한다고 믿어 **하지 않은 일을 했다고 말했다**(실측: "바로 옮겼어" ·
  // 이동 영수증 0건). 이 검사가 그 모순을 지키고 있었다.
  // 재는 것을 바꾼다: 문장이 아니라 **한 사람인가**.
  assert.ok(!/T5\(런타임\)가 한다|경로·명령·설정·연결은 T5가/.test(c),
    '헌장이 T5 를 3인칭으로 부르면 모델은 자기가 실행 주체인 줄 모른다');
  assert.match(c, /네가 T5다/, '실행 주체가 자신임을 알아야 손을 쓴다');
  assert.match(c, /할 수 있는 일이 남았으면 끝난 게 아니다/, '기준만 세우고 끝내면 대화가 계획으로만 돈다');
  // 문구가 아니라 **계약**을 검사한다(절대원칙 8) — 표현이 바뀌어도 두 방향이 다 남아야 한다.
  //   ① 안 한 일을 한 척 금지  ② 안 해 본 일을 "막혔다"고 하기 금지(대칭)
  // ②가 없어서 실측에서 이런 일이 났다: 도구를 한 번도 안 쓴 턴에 "수집이 막혀 있어서"라고 답했다.
  assert.match(c, /실행 안 된 일을 한 것처럼/, '보낸 척·한 척 금지는 계약이다');
  assert.match(c, /안 해 본 일을 "막혔다"고 말하지 않는다/, '되는 기능을 못 한다고 하면 사용자는 그걸 믿는다');
  assert.match(c, /되묻기 전에 할 수 있는 것부터 한다/);
});

test('운영 기준: 사용자의 부탁을 T5가 먼저 조사·실행하고, 사용자는 자기 권한만 판단한다', () => {
  const c = judgmentCharter();
  // 3인칭이 아니라 1인칭으로 — 계약(경로·명령·설정·연결은 사용자 몫이 아니다)은 그대로다.
  assert.match(c, /경로·명령·설정·연결은 네가 다룬다/);
  assert.match(c, /직접 확인할 것은 사용자에게 묻지 않는다/);
  assert.match(c, /사용자 몫은 승인·동의·비밀 입력·선택/);
  assert.match(c, /남은 읽기 확인은 먼저 끝낸다/);
});

test('미연결 외부 일은 연결 단서를 먼저 보고 비밀을 채팅으로 받지 않는다', () => {
  const c = judgmentCharter();
  assert.match(c, /연결 단서를 확인/);
  assert.match(c, /비밀은 대화 대신 입력면에서/);
  assert.match(c, /API·권한·입력 방식을 지어내지 않는다/);
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

test('형식 수정 요청은 확인만 하지 않고 직전 내용을 바로 고쳐 낸다', () => {
  assert.match(judgmentCharter(), /형식·길이 수정은 예고 없이 같은 내용을 바로 고쳐 낸다/);
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
  // 1650 → 1700 (2026-07-29, 오너 감사 지시): 기억 약속 출력 계약 한 줄이 <도구>에 들어갔다 —
  // "후보를 적지 않았으면 앞으로 기억한다고 약속하지 않는다". 산문 부풀림이 아니라 판단 한 줄이다.
  // 1700 → 1850 (2026-08-03, 오너 승인): 실행 주체 통일 두 줄(<도구> "네가 T5다" · <끝났을 때>
  // "할 수 있는 일이 남았으면 끝난 게 아니다"). 늘린 만큼 수사를 걷어 실제 증가는 96자다 —
  // 판단이 늘었지 산문이 부푼 게 아니다.
  // 1850 → 1955 (2026-08-09, 오너 승인 문안 원문): 동반 세 계단 한 줄(<도구> "답하기 전에
  // 스스로 본다 …"). F-54 재료 층 4갈래(행동 0/8)·모델 층(5.1/5.5 동일 멈춤) 소진 뒤의
  // 태도 층 — PM "한 번이다". +106자 전부가 그 한 문장이다(수사 0).
  assert.ok(c.length <= 1955, `헌장이 ${c.length}자로 늘었다 — 한 줄=한 판단으로 압축할 것`);
  assert.ok(/<판단>[\s\S]*<질문>[\s\S]*<도구>/.test(c), '태그 구획으로 모델이 섹션을 잡게 한다');
});

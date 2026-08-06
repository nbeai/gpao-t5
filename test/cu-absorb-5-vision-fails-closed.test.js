// **흡수 ⑤ · 눈이 없는 모델에게 그림을 보내지 않는다.**
//
// 비교군 `vision_routing.py` 원문:
//   *"The decision intentionally **fails closed** … returning a screenshot to a model
//    that cannot read it is a **hard tool failure**, while routing it through aux costs
//    one extra LLM call and yields a usable description."*
//
// 우리는 이 경우를 안 다룬다. 지금 모델(gpt-5.1)은 눈이 있어서 안 터질 뿐이고,
// **모델을 갈아끼우면 그림 때문에 턴이 통째로 죽는다.** T5 는 모델을 갈아끼우는 커널이다 —
// 그 자리에 구멍을 두면 안 된다.
//
// 전용 비전 모델 파이프라인(aux)까지는 **안 만든다**(지금 필요 없다 · 과잉).
// **최소한 안전 쪽으로 실패하게** 한다: 눈이 있다고 확인된 모델에게만 그림을 싣고,
// 아니면 **글로만 보내고 그 사실을 남긴다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_PROVIDERS } from '../src/runtime/model-provider.js';

const 그림달린교환 = [{
  ref: 'p1', tool: 'desktop.act', args: { action: 'click' },
  summary: '했어요. 다만 확인은 못 했어요.',
  그림: { mime: 'image/png', base64: 'AAAB' },
}];

const 몸통 = (cfg, m) => String(MODEL_PROVIDERS.openai.body(
  { modelId: 'x', baseUrl: 'https://x/v1', ...cfg },
  { system: 's', user: 'u', history: [], exchange: 그림달린교환, ...m },
));

test('눈이 있다고 확인된 모델에게만 그림을 싣는다', () => {
  const s = 몸통({ 눈있음: true }, {});
  assert.ok(s.includes('AAAB'), '눈이 있는데 그림을 안 보낸다');
});

test('눈이 없다고 확인되면 그림을 안 싣는다 — 턴이 통째로 죽는다', () => {
  const s = 몸통({ 눈있음: false }, {});
  assert.equal(s.includes('AAAB'), false,
    '**못 읽는 모델에게 그림을 보낸다** — 하드 실패다');
  assert.equal(s.includes('image_url'), false);
});

test('모르면 안 보낸다 — 안전 쪽으로 실패한다(fails closed)', () => {
  const s = 몸통({}, {});
  assert.equal(s.includes('AAAB'), false,
    `**모르는데 보낸다** — 비교군은 여기서 fails closed 한다: ${s.slice(0, 160)}`);
});

test('그림을 못 보냈으면 그 사실을 글로 남긴다 — 조용히 버리지 않는다', () => {
  const s = 몸통({ 눈있음: false }, {});
  assert.match(s, /화면 증거|그림|볼 수 없/, `**조용히 버린다** — 모델은 눈이 없다는 것도 모른다`);
});

test('앤트로픽 그릇에도 같은 규율이다', () => {
  const 눈없음 = String(MODEL_PROVIDERS.anthropic.body(
    { modelId: 'c', baseUrl: 'https://x', 눈있음: false },
    { system: 's', user: 'u', history: [], exchange: 그림달린교환 },
  ));
  assert.equal(눈없음.includes('AAAB'), false);
});

// ── 어떤 모델이 눈을 가졌는지는 **선언으로** 안다 ────────────────────────
// 이름 목록으로 알아맞히면(계열 E) 새 모델마다 뚫린다. 그리고 틀리는 쪽이 위험하다 —
// 눈이 없는데 있다고 하면 턴이 죽는다. 그래서 **명시 선언이 있을 때만 참**이다.
test('환경이 밝히면 눈이 있다고 본다', async () => {
  const { resolveModelConfig } = await import('../src/runtime/model-provider.js');
  const cfg = resolveModelConfig({
    GPAO_T5_MODEL_PROVIDER: 'openai', OPENAI_API_KEY: 'k',
    GPAO_T5_MODEL_ID: 'gpt-5.1', GPAO_T5_MODEL_VISION: '1',
  });
  assert.equal(cfg?.눈있음, true);
});

// **"모르는 곳"의 경계를 라이브가 좁혀 줬다**(2026-08-06).
//
// 처음엔 *환경이 안 밝히면 전부 모른다* 로 잡았다. 그런데 그 그물이 **벤더 와이어까지**
// 걸어서, 오너 콘솔(저장된 openai 연결)은 그림을 영영 못 받았다 — 카톡 창을 찍어 올려도
// 모델은 *"그림을 볼 수 없어"* 라고 답했다. 안전 쪽이 아니라 **§0 을 어긴 쪽**이었다.
//
// 진짜로 모르는 곳은 **주소가 무엇인지 모르는 호환 서버**다. 벤더 와이어는 우리가 주소를
// 안다(`api.openai.com` 등). 그물을 그 자리로 옮긴다 — 느슨해진 게 아니라 **제자리로** 갔다.
test('무엇이 붙는지 모르는 호환 서버에는 안 보낸다 — 모르면 안 보낸다', async () => {
  const { resolveModelConfig } = await import('../src/runtime/model-provider.js');
  const cfg = resolveModelConfig({
    GPAO_T5_MODEL_PROVIDER: 'openai_compatible',
    GPAO_T5_MODEL_ID: 'm', GPAO_T5_MODEL_BASE_URL: 'http://127.0.0.1:1/v1',
  });
  assert.notEqual(cfg?.눈있음, true, '**모르는데 눈이 있다고 본다** — 못 읽으면 턴이 죽는다');
});

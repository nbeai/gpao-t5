// 봉인 · **모델 응답에 총 소요 시간 상한을 두지 않는다**(오너 결정 2026-08-09).
//
// 결함이었던 것: `DEFAULT_HTTP_TIMEOUT_MS = 25_000`. 사용자 기계·네트워크·임무 난이도에 따라
// 25초는 얼마든지 넘어가고, 그때 **사용자 앞에서 정상 응답이 잘렸다.**
// 오너 원칙: *"20초의 99.9%는 모델 판단 시간이다. 왕복을 깎아 모델을 멍청하게 만들지 않는다."*
//
// 이 파일이 지키는 것 넷 —
//   ① 답이 흐르는 동안은 아무리 오래 걸려도 안 자른다(총 시간 상한이 되살아나면 빨강).
//   ② **정체(진짜 죽음) 판정은 살아 있다** — 흐르다 멈추면 자른다(이게 죽으면 무한 매달림이다).
//   ③ 흐르기 전의 침묵은 정체가 아니다(모델이 생각하는 중).
//   ④ 25초는 **재는 자로 남는다** — 초과를 기록하되 응답은 안 끊는다.
// 그리고 조이는 길(`GPAO_T5_MODEL_HTTP_TIMEOUT_MS`)이 그대로 있는지도 함께 묻는다.
//
// ── 2026-08-12 · 한 칸이 바뀌었다(C4) · **무엇이 바뀌고 무엇이 안 바뀌었나** ─────
//
// **안 바뀐 것**: 위 ①②③④ 전부. 이 파일의 나머지 시험은 한 줄도 안 고쳤고 전부 그대로
// 초록이다 — 흐르는 답은 여전히 안 잘리고, 정체 판정은 살아 있고, 첫 조각 전 침묵은
// 여전히 죽음이 아니고, 25초는 여전히 재는 자다.
//
// **바뀐 것**: 아래 「기본값이 0」 한 칸. 0 은 *상한이 아니라 부재*였고, 그 부재가
// 실제로 물린 자리가 있다 — **단발(비스트리밍) 경로**다. 그 자리를 지키기로 한 정체 감시가
// 거기엔 없다(`model-provider.js:1366` · `stallMs: 0`, 단발 POST 엔 셀 조각이 없으니 옳다).
// 총시간 0 + 정체 0 = 소켓만 살아 있으면 그 턴은 안 끝나고, `withSessionQueue` 직렬화 때문에
// **그 세션의 후속 턴이 전부 막힌다**(P-STAB-1 이 애초에 세워진 이유). 상태 지도 §12 C4.
//
// 그래서 0 을 **정지선**으로 바꾼다. 되돌리는 것은 2026-08-09 판단이 아니라 **부재**다:
// 그때 걷어낸 것은 25초·180초 같은 **배급**이었고, 새로 세우는 것은 정상 응답이 절대 못
// 닿는 자리의 **마지막 그물**이다(한 요청 900초 — 선행자가 아는 가장 깊은 추론 예산 600초
// 보다 뒤, 정체 감시선 180초의 다섯 배 뒤). 그 성질을 아래에서 **숫자가 아니라 관계로** 잰다 —
// `=0` 을 못 박으면 "무제한"과 "안 자르는 상한"을 구분할 수 없기 때문이다.
// 옛 무제한이 필요하면 `GPAO_T5_MODEL_*_TIMEOUT_MS=0` 이 그대로 그 자리를 연다(아래 반대시험).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeProviderModelClient, resolveModelConfig, selectLiveModel,
} from '../src/runtime/model-provider.js';
import {
  ModelTimeoutError, modelHttpTimeoutMs, modelResponseTimeoutMs, modelStallMs,
  MODEL_DEV_BASELINE_MS, observeModelBaseline, recordModelBaseline,
} from '../src/runtime/model-timeout.js';
import { checkConfigHealth } from '../src/runtime/model-doctor.js';

const TC = { currentRequest: '오늘 한국 증시 상황 알려줘', identity: {}, selfStateFacts: {} };
const cfg = () => resolveModelConfig({ OPENAI_API_KEY: 'sk-o' });
const 잠깐 = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * SSE 를 흉내 내는 fetch. `조각수`개를 `간격ms` 마다 흘린다.
 * `정체후멈춤` 이면 조각을 다 흘린 뒤 **닫지 않고 침묵**한다(연결은 살아 있는데 아무것도 안 온다).
 * `첫조각지연ms` 는 첫 조각이 오기 전 침묵 — 모델이 생각하는 구간이다.
 */
function 스트리밍fetch({ 조각수 = 3, 간격ms = 10, 첫조각지연ms = 0, 정체후멈춤 = false, signalOut = {} } = {}) {
  return async (_url, init) => {
    signalOut.signal = init.signal;
    const 조각 = (t) => new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
    let 남음 = 조각수;
    let 처음 = true;
    return {
      status: 200,
      body: {
        getReader: () => ({
          async read() {
            if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            if (처음) { 처음 = false; await 잠깐(첫조각지연ms); }
            if (남음 > 0) {
              남음 -= 1;
              await 잠깐(간격ms);
              return { done: false, value: 조각(`조각${조각수 - 남음} `) };
            }
            if (정체후멈춤) {
              // 영영 안 온다. 자를 근거는 이것뿐이어야 한다.
              await new Promise((_r, reject) => {
                init.signal?.addEventListener('abort', () =>
                  reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
              });
            }
            return { done: true, value: undefined };
          },
        }),
      },
      text: async () => '',
    };
  };
}

// ── ① 흐르는 동안은 안 자른다 ─────────────────────────────────────────────
// 정체 기준(60ms)보다 **총 소요(20조각 × 20ms = 400ms 남짓)** 가 훨씬 크다.
// 총 시간으로 자르는 자가 어디 하나라도 남아 있으면 여기서 빨개진다.
test('총 소요가 정체 기준을 몇 배 넘겨도, 조각이 흐르는 한 답은 끝까지 온다', async () => {
  const client = makeProviderModelClient(cfg(), {
    fetchImpl: 스트리밍fetch({ 조각수: 20, 간격ms: 20 }),
    stallMs: 60,          // 조각 사이 60ms 이상 비면 죽은 것으로 본다
    baselineMs: 10 ** 9,  // 이 시험의 관심사가 아니다
  });
  const 조각들 = [];
  const 답 = await client.respond(TC, { onDelta: (t) => 조각들.push(t) });
  assert.equal(조각들.length, 20);            // 하나도 안 잘렸다
  assert.equal(답, 조각들.join(''));           // 최종 답 = 흘린 것 전부
});

// ── ② 정체(진짜 죽음)는 여전히 자른다 ─────────────────────────────────────
test('흐르다 멈추면 자른다 — 정체 판정과 진짜 취소가 살아 있다', async () => {
  const 밖 = {};
  const client = makeProviderModelClient(cfg(), {
    fetchImpl: 스트리밍fetch({ 조각수: 2, 간격ms: 5, 정체후멈춤: true, signalOut: 밖 }),
    stallMs: 40,
    baselineMs: 10 ** 9,
  });
  await assert.rejects(
    () => client.respond(TC, { onDelta: () => {} }),
    (e) => e instanceof ModelTimeoutError && e.사유 === '정체',
  );
  assert.equal(밖.signal.aborted, true); // orphan 요청을 남기지 않는다
});

// ── ③ 흐르기 전 침묵은 정체가 아니다 ─────────────────────────────────────
// 추론 모델은 첫 토큰까지 분 단위로 침묵한다. 그 구간을 죽음으로 세면 ①을 고쳐도 같은 자리에서
// 잘린다 — 다만 자른 이름만 "정체"로 바뀔 뿐이다.
test('첫 조각이 정체 기준보다 늦게 와도 자르지 않는다(생각 중은 죽음이 아니다)', async () => {
  const client = makeProviderModelClient(cfg(), {
    fetchImpl: 스트리밍fetch({ 조각수: 2, 간격ms: 5, 첫조각지연ms: 120 }),
    stallMs: 40, // 첫 조각(120ms)이 이 기준보다 훨씬 늦다
    baselineMs: 10 ** 9,
  });
  const 답 = await client.respond(TC, { onDelta: () => {} });
  assert.match(답, /조각1/);
});

// ── ④ 25초는 재는 자로 남는다 — 자르지 않되 보이게 ────────────────────────
test('개발 기준선을 넘으면 사실로 남기고, 응답은 그대로 흐른다', async () => {
  const 본것 = [];
  const 떼기 = observeModelBaseline((r) => 본것.push(r));
  try {
    const client = makeProviderModelClient(cfg(), {
      fetchImpl: 스트리밍fetch({ 조각수: 3, 간격ms: 15 }),
      stallMs: 500,
      baselineMs: 1, // 25초를 기다리지 않고 같은 계약을 밟는다
    });
    const 답 = await client.respond(TC, { onDelta: () => {} });
    assert.match(답, /조각3/);           // **안 잘렸다** — 이게 이 계약의 절반이다
    assert.equal(본것.length, 1);
    assert.equal(본것[0].잘림, false);    // 기록은 "넘었다"이지 "끊었다"가 아니다
    assert.ok(본것[0].걸린ms > 1);
  } finally { 떼기(); }
});

test('기준선 아래면 아무것도 안 남는다 — 관측이 대상을 바꾸지 않는다', () => {
  const 본것 = [];
  const 떼기 = observeModelBaseline((r) => 본것.push(r));
  try {
    assert.equal(recordModelBaseline({ 경로: 'openai', 걸린ms: 10, 기준선ms: 25_000, env: {} }), null);
    assert.equal(본것.length, 0);
  } finally { 떼기(); }
});

// ── 봉인 · 사슬의 기본값은 **배급이 아니라 정지선**이다(C4 · 2026-08-12) ─────
//
// 옛 판은 `=== 0` 을 못 박았다. 그 못은 「자르는 자가 없다」를 지키려던 것인데,
// 실제로 지킨 것은 **부재**였다 — 「안 자르는 상한」과 「상한 없음」을 구분 못 한다.
// 그래서 이제 **숫자가 아니라 관계**를 잰다: 정상 응답이 닿을 수 있는 어떤 자리보다
// 뒤에 있으면 그 상한은 답을 못 자른다. 이 관계가 깨지면(정지선을 배급으로 낮추면) 빨강이다.
test('사슬의 기본 상한은 정상 응답이 닿는 어떤 자리보다 뒤에 있다 — 자를 수가 없다', () => {
  const 요청상한 = modelHttpTimeoutMs({});      // 어댑터(provider·chatgpt 공통 입력)
  const 턴상한 = modelResponseTimeoutMs({});    // 서버 바깥 경계(withModelTimeout)
  assert.ok(요청상한 > 0 && 턴상한 > 0, '0 은 상한이 아니라 부재다 — 단발 경로가 무한으로 열려 있었다');
  // 흐르는 답은 이 선에 닿기 한참 전에 정체 감시가 먼저 본다. 즉 이 숫자가 실제로 무는 것은
  // **아무것도 안 흐르는데 소켓만 살아 있는** 경우뿐이다.
  assert.ok(요청상한 > modelStallMs({}) * 4, `요청 상한 ${요청상한}ms 는 정체 감시선(${modelStallMs({})}ms)보다 한참 뒤여야 한다`);
  // 선행자 실측 — 헤르메스 `agent/reasoning_timeouts.py:66,93,116` 의 가장 깊은 추론 바닥이 600s.
  assert.ok(요청상한 > 600_000, `요청 상한 ${요청상한}ms 는 알려진 가장 깊은 추론 예산(600s)보다 넉넉해야 한다`);
  assert.ok(턴상한 >= 요청상한, '턴 상한이 요청 상한보다 앞서면 이어쓰기가 그 선에 걸린다');
  assert.equal(MODEL_DEV_BASELINE_MS, 25_000);  // 25초는 자로만 남는다
  assert.ok(modelStallMs({}) > 0);              // 진짜 죽음 판정은 켜져 있다
});

test('옛 무제한(0)은 환경변수로 그대로 열린다 — 선택을 없앤 게 아니라 기본값만 뒤집었다', () => {
  assert.equal(modelHttpTimeoutMs({ GPAO_T5_MODEL_HTTP_TIMEOUT_MS: '0' }), 0);
  assert.equal(modelResponseTimeoutMs({ GPAO_T5_MODEL_TIMEOUT_MS: '0' }), 0);
});

test('환경변수를 주면 옛 상한이 되살아난다 — 끄는 길·조이는 길을 없애지 않았다', () => {
  assert.equal(modelHttpTimeoutMs({ GPAO_T5_MODEL_HTTP_TIMEOUT_MS: '25000' }), 25_000);
  assert.equal(modelResponseTimeoutMs({ GPAO_T5_MODEL_TIMEOUT_MS: '180000' }), 180_000);
  assert.equal(modelStallMs({ GPAO_T5_MODEL_STALL_MS: '0' }), 0); // 정체 감시까지 끌 수도 있다
});

// ── 밟은 자리 · 0 은 "즉시 자르라"가 아니다 ───────────────────────────────
// 상한을 0(무제한)으로 내리자 **같은 값이 진단(model-doctor)까지 흘렀다.** `withTimeout(…, 0)`
// 은 바로 abort 라 진단이 늘 `unreachable` 로 떨어졌고, 사용자에게는 "연결이 되지 않아요"로
// 보였다 — 상한을 푼 수리가 다른 자리에서 제품을 깨는 모양이다. 그래서 봉인한다.
test('진단은 0을 받아도 즉시 자르지 않는다 — 응답 상한이 진단을 깨뜨리지 않는다', async () => {
  let 불렸나 = false;
  const 느린fetch = async () => {
    불렸나 = true;
    await 잠깐(30); // 옛 코드에서는 0ms abort 라 여기까지 오지도 못했다
    return { status: 200, json: async () => ({ data: [{ id: 'gpt-4o-mini' }] }) };
  };
  const report = await checkConfigHealth(cfg(), { fetchImpl: 느린fetch, timeoutMs: 0 });
  assert.equal(불렸나, true);
  assert.notEqual(report.state, 'unreachable');
});

test('selectLiveModel: 환경이 비면 총 시간 상한 없이 배선된다', async () => {
  const 밖 = {};
  const { model } = selectLiveModel(
    { OPENAI_API_KEY: 'sk-o' },
    { fetchImpl: 스트리밍fetch({ 조각수: 6, 간격ms: 25, signalOut: 밖 }) },
  );
  // 총 150ms 남짓 — 옛 기본(25초)에서도 통과하므로 이 시험의 몫은 "배선이 산다"까지다.
  // 상한 0 의 증명은 위 ①이 한다(정체 기준의 몇 배를 흘려도 안 잘린다).
  const 답 = await model.respond(TC, { onDelta: () => {} });
  assert.match(답, /조각6/);
  assert.equal(밖.signal.aborted, false);
});

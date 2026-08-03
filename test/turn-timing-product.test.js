import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { TurnTimingStore } from '../src/surface/turn-timing-store.js';

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-product-timing-'));
  const store = new SessionStore(dir);
  const turnTimingStore = new TurnTimingStore(dir);
  let now = 100;
  const server = makeServer({ store, turnTimingStore, timingClock: () => ++now });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn({ base, dir, turnTimingStore }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('웹 SSE 턴은 서버 계측을 먼저 닫고 브라우저 표시 세 사건을 같은 신분에 결합한다', async () => {
  await withServer(async ({ base, turnTimingStore }) => {
    const session = await (await post(base, '/sessions')).json();
    const start = await (await post(base, '/turn/stream-start', {
      sessionId: session.id,
      text: '안녕',
    })).json();
    assert.match(start.measurementId, /^[0-9a-f-]{36}$/i);

    const sse = await (await fetch(
      `${base}/turn/stream?sessionId=${session.id}&streamId=${start.streamId}`,
    )).text();
    assert.match(sse, /event: complete/);

    let records = (await turnTimingStore.load()).records;
    assert.equal(records.length, 1);
    assert.equal(records[0].measurementId, start.measurementId);
    assert.equal(records[0].pathClass, 'chat');
    assert.equal(records[0].server.input_received, 0);
    assert.ok(records[0].server.first_feedback_emitted !== null);
    assert.ok(records[0].server.server_committed !== null);
    assert.ok(records[0].server.complete_emitted >= records[0].server.server_committed);
    assert.equal(records[0].browser.first_feedback_visible, null, '서버 송신을 화면 표시로 부르지 않는다');

    for (const [event, elapsedMs] of [
      ['first_feedback_visible', 2],
      ['first_grounded_content', 8],
      ['turn_complete', 12],
    ]) {
      const response = await post(base, '/turn/metrics/visible', {
        measurementId: start.measurementId,
        event,
        elapsedMs,
        visibilityState: 'visible',
      });
      assert.equal(response.status, 200);
    }

    records = (await turnTimingStore.load()).records;
    assert.equal(records[0].browser.first_feedback_visible, 2);
    assert.equal(records[0].browser.first_grounded_content, 8);
    assert.equal(records[0].browser.turn_complete, 12);
  });
});

test('계측 API는 모르는 신분과 임의 필드를 거부하고 원문을 저장하지 않는다', async () => {
  await withServer(async ({ base, dir }) => {
    const unknown = await post(base, '/turn/metrics/visible', {
      measurementId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      event: 'turn_complete', elapsedMs: 1, visibilityState: 'visible',
    });
    assert.equal(unknown.status, 404);

    const polluted = await post(base, '/turn/metrics/visible', {
      measurementId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      event: 'turn_complete', elapsedMs: 1, visibilityState: 'visible',
      text: '비밀번호 secret-value /Users/person/private',
    });
    assert.equal(polluted.status, 400);

    const timingFile = join(dir, 'turn-timings.json');
    const raw = await readFile(timingFile, 'utf8').catch(() => '');
    assert.doesNotMatch(raw, /secret-value|\/Users\/person|비밀번호/);
  });
});

test('브라우저는 DOM paint 뒤 표시를 보고하고 최종 투영 뒤에 완료를 보고한다', async () => {
  const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
  assert.match(html, /first_feedback_visible/);
  assert.match(html, /first_grounded_content/);
  assert.match(html, /turn_complete/);

  const submit = html.slice(html.indexOf('async function submit()'), html.indexOf('function renderRecovery'));
  // 투영은 스크롤 자리를 지키는 래퍼 안에서 불릴 수 있다(맨 위로 튀는 것을 막는 `자리지키며`).
  // 계약은 **투영이 완료 보고보다 먼저**라는 순서지 호출 모양이 아니므로 이름으로만 찾는다.
  const projection = submit.indexOf('대화투영');
  assert.ok(projection >= 0 && projection < submit.indexOf('await streamed.reportComplete()', projection),
    '지속된 최종 답이 화면에 투영된 뒤 완료 표시를 보고해야 한다');
  // P90-2 후속: 첫 유용한 내용은 두 경로에서 선다 — 답 조각(answer_delta)과
  // 확인된 중간 결과(partial_result). 보고 자체는 `markGrounded()` 한 자리로 모았으므로,
  // **각 경로가 DOM 에 렌더한 뒤에 그것을 부르는가**를 본다(계약은 그대로: 렌더 → 보고).
  const delta = html.slice(html.indexOf("es.addEventListener('answer_delta'"), html.indexOf("es.addEventListener('complete'"));
  assert.ok(delta.indexOf('renderMarkdownInto') < delta.indexOf('markGrounded()'),
    '답 조각을 DOM에 렌더한 뒤 첫 유용한 내용 표시를 보고해야 한다');
  const partial = html.slice(html.indexOf("es.addEventListener('partial_result'"), html.indexOf("es.addEventListener('answer_delta'"));
  assert.ok(partial.indexOf('appendChild') < partial.indexOf('markGrounded()'),
    '중간 결과도 DOM에 붙인 뒤에 보고해야 한다');
  // 보고는 여전히 두 번 paint 뒤에 잰다(단일 자리로 모았어도 계약은 유지).
  const grounded = html.slice(html.indexOf('const markGrounded'), html.indexOf('const markGrounded') + 400);
  assert.match(grounded, /afterVisiblePaint/, '표시 보고는 실제 paint 뒤여야 한다');
});

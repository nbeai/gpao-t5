// **노드 ② — 사다리를 모델에게 가르친다.**
//
// 오늘 라이브에서 T5 는 여섯 번 다 이렇게 끝냈다:
//   *"지금 이 환경에서는 카카오톡 창 안의 입력창을 제대로 인식하거나 조작하지 못해서…"*
//   *"권한/지원 제약 때문에 더 이상 조작이 안 됩니다."*
// **막힌 적이 없다.** 드라이버는 `unverifiable` 을 냈을 뿐이고, 한 칸 올리면 됐다
// (실측: 픽셀 + `delivery_mode:'foreground'` 에서 카톡 대화방이 열렸다).
//
// 커널은 사다리를 **탈 수** 있게 만들어 뒀다(`desktop-cua-driver` 의 자동 재시도).
// 그런데 **모델은 그 사다리가 있는 줄 모른다.** 그래서 한 번 해 보고 사용자에게 떠넘긴다.
//
// 비교군은 이걸 프롬프트로 가르친다(`prompt_builder.computer_use_guidance`):
// > *"Read each action's structured result and **climb only when the driver tells you to**"*
// > *"`unverifiable` — re-capture and check the screenshot/tree **yourself** before
// >  deciding it worked."*
// > *"**Do not** silently retry the same rung … and **do not conclude 'cua-driver can't
// >  drive this app'** — climb the ladder."*
//
// 우리 것으로 옮기되 **이미 있는 것은 안 쓴다** — 화면 글자를 명령으로 안 받는 규율(A10)과
// 승인 경계는 이미 서 있다. 여기 넣을 것은 **사다리와 순서**뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const 화면있는턴 = (더 = {}) => buildModelMessages({
  currentRequest: 'x',
  connectedTools: [{ id: 'desktop.screen' }, { id: 'desktop.act' }],
  ...더,
});
const 화면없는턴 = () => buildModelMessages({
  currentRequest: 'x',
  connectedTools: [{ id: 'local.file' }],
});

test('화면 손이 있으면 사다리를 가르친다', () => {
  const s = String(화면있는턴().system);
  assert.match(s, /사다리|올린다|한 칸/,
    `**사다리가 있는 줄 모른다** — 한 번 해 보고 사람에게 떠넘긴다: ${s.slice(-400)}`);
});

test('"확인 못 했다"가 "안 됐다"가 아님을 가르친다 — 직접 확인하라고 말한다', () => {
  const s = String(화면있는턴().system);
  assert.match(s, /확인이 안 되면|확인 못 했다는|다시 보고/,
    '**unverifiable 을 실패로 읽는다** — 됐는데 안 됐다고 하거나 그 반대다');
});

test('"이 앱은 못 다룬다"로 끝내지 말라고 못 박는다', () => {
  const s = String(화면있는턴().system);
  assert.match(s, /못 다룬다|못 한다고 끝내지|떠넘기지/,
    `**여섯 번 다 그렇게 끝났다**: ${s.slice(-400)}`);
});

test('같은 칸을 조용히 다시 하지 말라고 한다 — 두 번 눌리면 안 되는 것이 있다', () => {
  const s = String(화면있는턴().system);
  assert.match(s, /같은 방법|같은 칸|그대로 다시/, '**같은 실패를 반복한다**');
});

test('순서를 가르친다 — 보고, 짚어서, 하고, 확인한다', () => {
  const s = String(화면있는턴().system);
  for (const [무엇, 재는말] of [['본다', /보고|관찰/], ['짚는다', /짚어|대상/], ['확인', /확인/]]) {
    assert.match(s, 재는말, `**${무엇} 가 순서에 없다**`);
  }
});

// ── 없는 손에는 안 붙인다 ────────────────────────────────────────────────
// 헤르메스도 **툴셋이 활성일 때만** 주입한다. 늘 실으면 화면을 안 쓰는 턴마다 토큰을 낸다.
test('화면 손이 없으면 안 붙인다 — 안 쓰는 안내에 매 턴 값을 치르지 않는다', () => {
  const s = String(화면없는턴().system);
  assert.ok(!/사다리/.test(s), `**화면을 안 쓰는 턴에도 실린다**: ${s.slice(-300)}`);
});

test('캐시 접두를 안 깬다 — 세션 안에서 같은 자리에 같은 문장이다', () => {
  const a = String(화면있는턴({ now: { timeZone: 'Asia/Seoul' } }).system);
  const b = String(화면있는턴({ now: { timeZone: 'Asia/Seoul' } }).system);
  assert.equal(a, b, '**같은 턴 재료인데 문장이 흔들린다** — 캐시가 매번 깨진다');
});

// ── 그림의 크기는 **봉투에서** 읽는다 ───────────────────────────────────
// MCP 이미지 조각에는 크기가 없다(실측: 키가 `data · mimeType · type` 뿐).
// 그런데 모델이 자리를 짚으려면 **그 그림의 자**를 알아야 한다 — 창 크기를 주면 밖을 짚는다
// (실측: 그림 500×768 인데 창 559×859 를 보고 `y=840` → 창 좌표 939, 밖).
//
// 커널은 그림의 **알맹이를 안 읽는다**(심문 금지). 크기는 알맹이가 아니라 **봉투**다 —
// PNG/JPEG 머리 몇 바이트에 적혀 있고, 그걸 읽는 것은 "무엇이 찍혔나"를 보는 것이 아니다.
test('PNG 크기를 봉투에서 읽는다', async () => {
  const { 그림크기재기 } = await import('../src/runtime/image-size.js');
  // 8바이트 시그니처 + IHDR(길이4 + "IHDR" + w4 + h4)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
    Buffer.from([0, 0, 1, 0xF4]), Buffer.from([0, 0, 3, 0]),
  ]);
  assert.deepEqual(그림크기재기(png.toString('base64')), { w: 500, h: 768 });
});

test('JPEG 크기도 읽는다 — zoom 은 JPEG 를 낸다', async () => {
  const { 그림크기재기 } = await import('../src/runtime/image-size.js');
  // SOI + SOF0(마커 · 길이 · 정밀도 · 높이2 · 너비2)
  const jpg = Buffer.concat([
    Buffer.from([0xFF, 0xD8, 0xFF, 0xC0]),
    Buffer.from([0, 17, 8]),
    Buffer.from([3, 0]), Buffer.from([1, 0xF4]),
  ]);
  assert.deepEqual(그림크기재기(jpg.toString('base64')), { w: 500, h: 768 });
});

test('못 읽으면 없다고 한다 — 지어내지 않는다', async () => {
  const { 그림크기재기 } = await import('../src/runtime/image-size.js');
  assert.equal(그림크기재기('QQQQ'), null);
  assert.equal(그림크기재기(''), null);
});

// ── 자는 **하나만** 준다 ────────────────────────────────────────────────
// 실측(2026-08-06): 줄이 이랬다 —
//   `본 창: … 자리 x82 y33 크기 559×859 · 보여 드린 화면 500×768(짚을 때 이 자를 쓰세요)`
// 자가 **둘**이라 모델이 앞의 것(창 크기)을 썼고 `y=840` 을 짚었다 — 그림은 768 이라 밖이다.
// 창의 화면상 자리·크기는 짚을 때 쓰는 값이 아니다. **그림을 줄 때는 그림 자만** 준다.
test('그림을 줄 때는 창 크기를 안 준다 — 자가 둘이면 틀린 걸 쓴다', async () => {
  const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
  const s = String(compactResult({
    본창: { id: 9, app: '카카오톡', title: 'n.BEAI', bounds: { x: 82, y: 33, w: 559, h: 859 } },
    elements: [],
    그림크기: { w: 500, h: 768 },
  }));
  assert.match(s, /500×768/, '그림 자가 없다');
  assert.ok(!/559×859/.test(s), `**자가 둘이다** — 모델이 창 크기로 짚어 그림 밖을 찍는다: ${s}`);
});

test('그림이 없으면 창 자리를 그대로 준다 — 없던 것을 없애지 않는다', async () => {
  const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
  const s = String(compactResult({
    본창: { id: 9, app: '계산기', bounds: { x: 0, y: 0, w: 230, h: 408 } },
    elements: [],
  }));
  assert.match(s, /230×408/, '창 자리가 사라졌다');
});

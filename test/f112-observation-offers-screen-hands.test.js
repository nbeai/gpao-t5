// 화면 관찰은 실패 문장과 한 갈래 처방 사이를 건너뛰지 않는다.
// 손이 본 신호와 실제 지원 capability를 함께 주고, 모델이 목적에 맞는 다음 손을 고른다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';

const 손 = (본것, capabilities = ['observe', 'elements', 'act']) => makeDesktopTool({
  drivers: [{
    id: 'cua',
    status: async () => ({
      permissions: { accessibility: 'granted', screenRecording: 'granted' },
      capabilities,
    }),
    observe: async () => 본것,
    act: async () => ({}),
  }],
});

const 다른화면AX미해결 = {
  windows: [{ id: 813, app: '카카오톡', title: '박종윤', 같은화면: false }],
  본창: {
    id: 813, pid: 1048, app: '카카오톡', title: '박종윤', 같은화면: false,
    bounds: { x: 100, y: 100, w: 454, h: 773 },
  },
  elements: [],
  그림: { mime: 'image/jpeg', base64: 'PIXELS' },
  그림크기: { w: 500, h: 768 },
  화면사실: {
    다른화면에있다: true,
    조작막힘: true,
    조작막힌이유: 'off_space_or_ax_unresolved',
    그림은요청한창이맞다: true,
  },
  올려야할길: {
    recommended: 'foreground',
    reason: 'the screenshot is the requested window but background input is refused',
  },
};

test('다른 Space·AX 미해결 신호에서 focus·픽셀·scroll+재관찰을 선택지로 함께 준다', async () => {
  const r = await 손(다른화면AX미해결).handler({
    action: 'observe', scope: 'window', app: '카카오톡', 창제목: '박종윤', 찾는말: 'TNT',
  });
  const 길 = r.result?.다음수단 ?? [];
  assert.ok(길.some((x) => x.방법 === 'focus'), `다른 Space 다음 손이 없다: ${JSON.stringify(길)}`);
  assert.ok(길.some((x) => x.방법 === 'click' && x.좌표근거 === '첨부된그림' && x.좌표필수 === true),
    `픽셀은 그림에서 짚은 좌표만 써야 한다: ${JSON.stringify(길)}`);
  assert.ok(길.some((x) => x.방법 === 'scroll'), `더 볼 화면을 미는 손이 없다: ${JSON.stringify(길)}`);
  assert.match(JSON.stringify(길), /첨부 그림에서도.*안 보일 때만/,
    `그림을 모델이 판단할 조건이 없다: ${JSON.stringify(길)}`);
  assert.ok(길.some((x) => x.방법 === 'observe' && x.앞선손 === 'scroll'),
    `스크롤 뒤 다시 보는 손이 없다: ${JSON.stringify(길)}`);
  assert.match(JSON.stringify(길), /off_space_or_ax_unresolved|foreground/,
    '왜 이 선택지가 섰는지 관찰 신호가 사라졌다');
  assert.ok(길.every((x) => x.자동실행 !== true), '관찰 손이 Space 전환이나 스크롤을 강제한다');
});

test('그림에서 좌표를 실제로 얻지 못했으면 임의 좌표를 다음 수단에 만들지 않는다', async () => {
  const r = await 손(다른화면AX미해결).handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  const 길 = r.result?.다음수단 ?? [];
  for (const x of 길) {
    assert.equal(x.x, undefined, `관찰하지 않은 x 좌표를 만들었다: ${JSON.stringify(x)}`);
    assert.equal(x.y, undefined, `관찰하지 않은 y 좌표를 만들었다: ${JSON.stringify(x)}`);
  }
});

test('같은 화면에서 AX 요소를 찾았으면 다른 Space용 focus나 막연한 scroll을 붙이지 않는다', async () => {
  const r = await 손({
    windows: [{ id: 9, app: '카카오톡', title: '박종윤', 같은화면: true }],
    본창: { id: 9, pid: 1048, app: '카카오톡', title: '박종윤', 같은화면: true },
    elements: [{ id: 's1:1', role: 'AXTextArea', value: 'TNT입니다' }],
    그림: { mime: 'image/jpeg', base64: 'PIXELS' },
  }).handler({ action: 'observe', scope: 'window', app: '카카오톡', 찾는말: 'TNT' });
  const 길 = r.result?.다음수단 ?? [];
  assert.equal(길.some((x) => x.방법 === 'focus'), false, `없는 Space 문제를 만들었다: ${JSON.stringify(길)}`);
  assert.equal(길.some((x) => x.방법 === 'scroll'), false, `찾았는데도 무조건 민다: ${JSON.stringify(길)}`);
});

test('다른 Space라는 사실만으로 focus를 권하지 않는다', async () => {
  const { 올려야할길: _없음, ...신호없는관찰 } = 다른화면AX미해결;
  const r = await 손(신호없는관찰)
    .handler({ action: 'observe', scope: 'window', app: '카카오톡', 찾는말: 'TNT' });
  const 길 = r.result?.다음수단 ?? [];
  assert.equal(길.some((x) => x.방법 === 'focus'), false,
    `off-Space만 보고 화면을 뺏으려 한다: ${JSON.stringify(길)}`);
});

test('그림이 없으면 AX 불일치만으로 scroll을 권하지 않는다', async () => {
  const { 그림: _없음, 그림크기: _자없음, ...그림없는관찰 } = 다른화면AX미해결;
  const r = await 손(그림없는관찰)
    .handler({ action: 'observe', scope: 'window', app: '카카오톡', 찾는말: 'TNT' });
  const 길 = r.result?.다음수단 ?? [];
  assert.equal(길.some((x) => x.방법 === 'scroll'), false,
    `그림을 판단할 수 없는데 민다: ${JSON.stringify(길)}`);
});

test('찾는말이 없으면 그림과 빈 AX만으로 scroll을 권하지 않는다', async () => {
  const r = await 손(다른화면AX미해결)
    .handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  const 길 = r.result?.다음수단 ?? [];
  assert.equal(길.some((x) => x.방법 === 'scroll'), false,
    `목적 대상이 없는데 무조건 민다: ${JSON.stringify(길)}`);
});

test('조작 capability가 없으면 focus·click·scroll을 가능한 손으로 약속하지 않는다', async () => {
  const r = await 손(다른화면AX미해결, ['observe', 'elements'])
    .handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  const 길 = r.result?.다음수단 ?? [];
  assert.equal(길.some((x) => ['focus', 'click', 'scroll'].includes(x.방법)), false,
    `없는 행동 손을 약속했다: ${JSON.stringify(길)}`);
});

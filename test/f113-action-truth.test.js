// F-113 행동 인과 — 실행 대상과 사후 검증은 같은 fresh 관찰 신분을 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 버튼 = (스냅샷 = 's9') => ({
  id: 'seven', 토큰: `${스냅샷}:7`, 스냅샷, role: 'AXButton', label: '7',
  창: 813, pid: 18355, isEnabled: true,
});

test('행동과 verify는 마지막 fresh 관찰의 같은 창·pid를 쓴다', async () => {
  const 검증 = [];
  const b = 버튼();
  const 결과 = { id: 'display', role: 'AXStaticText', label: '결과', value: '56', 창: 813, pid: 18355 };
  const d = {
    id: 'fake', status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: async () => ({
      frontmost: { name: '계산기' }, 본창: { id: 813, pid: 18355 },
      windows: [{ id: 813, pid: 18355 }], elements: [b, 결과],
    }),
    act: async () => ({ effect: 'unverifiable' }),
    verify: async (기대) => { 검증.push(기대); return { 판정: 'satisfied', 근거: 'value_readback' }; },
  };
  const r = await makeDesktopActTool({ drivers: [d] }).handler({
    action: 'click', app: '계산기', 대상: { id: 'seven', label: '7' },
    기대: { 요소: 'display', 값: '56' },
  });
  assert.equal(r.result?.단계, 'goal_verified');
  assert.equal(검증.length, 1);
  assert.equal(검증[0].창, 813);
  assert.equal(검증[0].pid, 18355);
  assert.equal(검증[0].라벨, '결과');
});

test('누른 버튼 자체의 존재는 순환 사후조건이라 목적 성공이 아니다', async () => {
  const 검증 = [];
  const b = 버튼();
  const d = {
    id: 'fake', status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: async () => ({
      frontmost: { name: '계산기' }, 본창: { id: 813, pid: 18355 },
      windows: [{ id: 813, pid: 18355 }], elements: [b],
    }),
    act: async () => ({ effect: 'unverifiable' }),
    // 라벨을 받으면 exists=true로 만족한다고 하는 드라이버. 순환 기대에는 라벨을 주면 안 된다.
    verify: async (기대) => {
      검증.push(기대);
      return 기대.라벨
        ? { 판정: 'satisfied', 근거: 'exists' }
        : { 판정: 'unknown', 근거: 'no_selector', 그림: { mime: 'image/png', base64: 'A'.repeat(200) } };
    },
  };
  const r = await makeDesktopActTool({ drivers: [d] }).handler({
    action: 'click', app: '계산기', 대상: { id: 'seven', label: '7' },
    기대: { 요소: 'seven', 값: '7' },
  });
  assert.equal(r.result, undefined, '버튼 존재가 클릭 목적 성공이 됐다');
  assert.equal(r.진행?.판정, 'unknown');
  assert.equal(r.진행?.근거, 'circular_postcondition');
  assert.equal(검증[0].라벨, undefined, '순환 요소를 exists 술어로 보냈다');
  assert.ok(r.그림, 'unknown의 visual evidence가 다음 판단으로 가지 않는다');
});

test('지목한 검증 창이 새 트리에 없으면 첫 창으로 갈아타지 않는다', async () => {
  const 부름 = [];
  const mcp = {
    async call(이름, 인자) {
      부름.push({ 이름, 인자 });
      if (이름 === 'get_accessibility_tree') return { windows: [{ window_id: 999, pid: 22 }] };
      if (이름 === 'verify_state') return { status: 'satisfied' };
      return {};
    },
  };
  const r = await makeCuaDriver({ mcp }).verify({ 창: 813, 라벨: '결과', 값: '56' });
  assert.equal(r.판정, 'unknown');
  assert.equal(r.근거, 'exact_window_not_observed');
  assert.equal(부름.some((x) => x.이름 === 'verify_state'), false, '다른 창을 목적 성공의 근거로 썼다');
});

test('null 창·pid를 0번 신분으로 만들지 않는다', async () => {
  const 부름 = [];
  const mcp = {
    async call(이름, 인자) { 부름.push({ 이름, 인자 }); return { windows: [] }; },
  };
  const r = await makeCuaDriver({ mcp }).verify({ 창: null, pid: null, 라벨: '결과', 값: '56' });
  assert.equal(r.판정, 'unknown');
  assert.equal(r.근거, 'no_window');
  assert.equal(부름.some((x) => x.이름 === 'verify_state'), false);
});

test('AX가 간헐적으로 비면 과거 버튼 신분과 섞지 않고 실행 0으로 막는다', async () => {
  let 관찰 = 0;
  let 실행 = 0;
  const d = {
    id: 'fake', status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: async () => {
      관찰 += 1;
      return {
        frontmost: { name: '계산기' }, 본창: { id: 813, pid: 18355 },
        windows: [{ id: 813, pid: 18355 }], elements: 관찰 === 1 ? [버튼('old')] : [],
      };
    },
    act: async () => { 실행 += 1; return { effect: 'confirmed' }; },
    verify: async () => ({ 판정: 'satisfied' }),
  };
  const r = await makeDesktopActTool({ drivers: [d] }).handler({
    action: 'click', app: '계산기', 대상: { id: 'seven', label: '7' },
    기대: { 요소: 'seven', 값: '7' },
  });
  assert.equal(r.blocked, true);
  assert.equal(실행, 0, '빈 fresh 관찰에 과거 신분을 붙여 실행했다');
  assert.deepEqual(r.다음수단?.map((x) => x.방법), ['observe']);
});

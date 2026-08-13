// CU F 반대시험 — 창 신분과 요소 신분은 서로 대신할 수 없다.
//
// `verify_state` 는 `pid`·`window_id` 로 어느 창인지 알고도, 그 안의 어느 요소를
// 확인할지(label/role)를 모르면 목적 성공을 판정할 수 없다. 첫 창이나 빈 selector를
// 대신 쓰면 다른 요소의 `satisfied` 가 클릭 전체의 `goal_verified` 로 승격된다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

function 손세우기({ 요소들 = [], 부른것 = [] } = {}) {
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'verify_state') return { status: 'satisfied' };
      return {};
    },
  };
  const 드라이버 = makeCuaDriver({ mcp });
  드라이버.status = () => ({ permissions: { accessibility: 'granted' } });
  드라이버.observe = async () => ({
    스냅샷: 's1', snapshot: 's1', frontmost: { name: '계산기' },
    본창: { id: 813, pid: 18355 }, windows: [{ id: 813, pid: 18355 }], elements: 요소들,
  });
  드라이버.act = async () => ({ effect: 'unverifiable' });
  return makeDesktopActTool({ drivers: [드라이버] });
}

test('창·pid만 있고 요소 신분이 없으면 첫 요소를 대신 확인해 goal_verified 하지 않는다', async () => {
  const 부른것 = [];
  const 손 = 손세우기({ 부른것 });
  const r = await 손.handler({
    action: 'click', app: '계산기', window: 813,
    대상: { x: 100, y: 100, 스냅샷: 's1' }, 기대: { 값: '56' },
  });

  assert.notEqual(r.result?.단계, 'goal_verified', '무신분 verify 응답을 클릭 목적 성공으로 썼다');
  assert.equal(r.진행?.판정, 'unknown');
  assert.equal(r.진행?.근거, 'no_selector');
  assert.equal(부른것.some((x) => x.이름 === 'verify_state'), false,
    '어느 요소인지 모르는데 verify_state를 불렀다');
});

test('같은 창의 명시적 요소 신분은 verify_state 양성 판정으로 보존한다', async () => {
  const 부른것 = [];
  const 결과 = {
    id: 'display', role: 'AXStaticText', label: '결과', value: '56',
    창: 813, pid: 18355, isEnabled: true,
  };
  const 손 = 손세우기({ 요소들: [결과], 부른것 });
  const r = await 손.handler({
    action: 'click', app: '계산기', window: 813,
    대상: { x: 100, y: 100, 스냅샷: 's1' }, 기대: { 요소: 'display', 값: '56' },
  });

  assert.equal(r.result?.단계, 'goal_verified');
  const 확인 = 부른것.find((x) => x.이름 === 'verify_state')?.인자;
  assert.equal(확인?.pid, 18355);
  assert.equal(확인?.window_id, 813);
  assert.equal(확인?.expect?.[0]?.element?.selector?.label_contains, '결과');
  assert.equal(확인?.expect?.[0]?.element?.selector?.role, 'AXStaticText');
});

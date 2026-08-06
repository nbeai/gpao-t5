// **모델이 조각을 골라 조립하게 두면 틀린다** — 되붙일 한 벌을 그대로 준다.
//
// 밟은 사실(라이브 2026-08-06 · 오너의 ④). 모델이 본 줄은 이랬다:
//   `- TextArea[s00000009:25]: 메시지 입력`
// 그리고 이렇게 조립했다:
//   `대상: { id: 's00000009:25', label: 'TextArea' }`   ← **역할을 이름으로 착각했다**
//
// 자연스러운 실수다. 우리가 `역할[토큰]: 글` 로 뭉쳐 놓고 **무엇이 label 인지 안 말했다.**
// 게다가 `글` 은 `value || label` 이라 **값이 있으면 이름이 사라진다** — 되붙일 수가 없다.
//
// 이 하나가 두 가지를 동시에 막고 있었다:
//   · 실행 — 손이 그 이름으로 요소를 못 찾아 *"지금 화면에 없어요"*
//   · 승인 — 탐침도 못 찾아 **값 있는 칸인데 카드가 떴다**(F-44)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';

const 화면 = (요소들) => String(compactResult({
  본창: { id: 9, app: '카카오톡', title: '박종윤' }, elements: 요소들,
}));

test('되붙일 한 벌이 줄 안에 통째로 있다 — 모델은 복사만 하면 된다', () => {
  const s = 화면([{ id: 's1:26', 토큰: 's1:26', role: 'AXTextArea', label: '메시지 입력' }]);
  assert.match(s, /"id"\s*:\s*"s1:26"/, `**신분이 되붙일 꼴로 없다**: ${s}`);
  assert.match(s, /"label"\s*:\s*"메시지 입력"/,
    `**이름이 되붙일 꼴로 없다** — 모델이 역할을 이름으로 적는다: ${s}`);
});

test('값이 있어도 이름이 안 사라진다 — 값만 남기면 되붙일 수 없다', () => {
  const s = 화면([{ id: 's1:26', 토큰: 's1:26', role: 'AXTextArea', label: '메시지 입력', value: '안녕' }]);
  assert.match(s, /안녕/, '값이 없다');
  assert.match(s, /메시지 입력/, `**값이 이름을 덮었다** — 그 요소를 다시 짚을 방법이 없다: ${s}`);
});

test('역할은 역할 자리에만 있다 — 이름 자리에 역할이 들어가면 안 된다', () => {
  const s = 화면([{ id: 's1:26', 토큰: 's1:26', role: 'AXTextArea', label: '메시지 입력' }]);
  assert.ok(!/"label"\s*:\s*"(AX)?TextArea"/.test(s),
    `**역할이 이름 자리에 있다** — 모델이 그대로 베낀다: ${s}`);
});

test('이름 없는 요소는 이름 칸을 비워 준다 — 지어내게 하지 않는다', () => {
  const s = 화면([{ id: 's1:7', 토큰: 's1:7', role: 'AXButton', label: '' }]);
  assert.match(s, /"id"\s*:\s*"s1:7"/);
  assert.ok(!/"label"\s*:\s*"(AX)?Button"/.test(s), `**역할로 이름을 채웠다**: ${s}`);
});

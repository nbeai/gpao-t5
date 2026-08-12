// **가르침이 모델에게 닿아야 가르친 것이다.**
//
// 어제(2026-08-06) 노드 ②로 `screen-guidance.js` 를 만들고 *"사다리를 가르쳤다"* 고 적었다.
// 그 검사(`cu-node2-ladder-is-taught`)는 `화면다루는법(['desktop.screen'])` 을 **직접 불러**
// 문자열만 쟀다. **배선은 한 번도 안 쟀다.**
//
// 기계 사실: 주입부는 `화면다루는법(tc.connectedTools)` 인데 `buildTaskContext` 는
// `connectedTools` 를 **내보내지 않는다.** 그래서 늘 `undefined` → 기본값 `[]` → `null`.
// 안내는 **한 번도 모델에게 간 적이 없다.**
//
// 그 값을 치른 자리가 라이브에 그대로 남았다 — 스크롤을 가르쳐도 T5 는
// *"윤님이 위로 스크롤한 화면을 캡처해서 보내 주세요"* 라고 답했다.
// 함수를 고쳐도 안 실리니 답이 안 변한 것이다.
//
// 오너 규율: *"내 주장에도 같은 계약을 적용한다 — 이름·호출·존재로 효과를 단정하지 않는다."*
// 존재(파일이 있다)·호출(주입부가 부른다)로는 아무것도 증명되지 않는다. **닿는지를 잰다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const 손하나 = (id, label) => ({ id, label, status: 'connected', executable: true });
const 상태 = (tools) => ({
  currentModel: { id: 'gpt-5.1' },
  modelAuthState: 'ready',
  modelHealthState: 'ok',
  connectedTools: tools,
});
const 화면손selfState = 상태([
  손하나('local.file', '파일'),
  손하나('desktop.screen', '화면 보기'),
  손하나('desktop.act', '화면 다루기'),
]);
const 만들기 = (selfState) => buildTaskContext({
  processEnv: {},
  intent: { answerMode: 'work', goal: '카톡 대화 읽기' },
  selfState,
  plan: { autoAllowed: [], needsApproval: [], forbidden: [] },
  receipts: [],
});

test('화면 손이 있으면 그 사용법이 taskContext 에 실린다 — 여기서 끊기면 함수를 고쳐도 소용없다', () => {
  const tc = 만들기(화면손selfState);
  const ids = (tc.connectedTools ?? []).map((t) => (typeof t === 'string' ? t : t?.id));
  assert.ok(ids.includes('desktop.screen'),
    `**taskContext 가 붙은 손을 안 들고 간다** — 주입부가 늘 빈 목록을 본다: ${JSON.stringify(tc.connectedTools)}`);
});

test('그 사용법이 모델이 받는 시스템 글에 실제로 들어간다', () => {
  const tc = 만들기(화면손selfState);
  const { system } = buildModelMessages({ currentRequest: '카톡 대화 읽어줘', ...tc });
  assert.match(String(system ?? ''), /화면 다루는 법/,
    '**안내가 모델에게 안 간다** — 가르쳤다고 적을 수 없다');
  assert.match(String(system ?? ''), /한 화면이 전부가 아니다/,
    '**스크롤을 가르치는 대목이 안 간다** — 이전 대화는 영영 못 읽는다');
});

test('화면 손이 없으면 안 실린다 — 없는 손의 사용법에 매 턴 값을 치르지 않는다', () => {
  const tc = 만들기(상태([손하나('local.file', '파일')]));
  const { system } = buildModelMessages({ currentRequest: '파일 정리해줘', ...tc });
  assert.doesNotMatch(String(system ?? ''), /화면 다루는 법/,
    '**없는 손의 사용법을 매 턴 싣는다**');
});

// **드라이버가 "어느 창이냐"고 되물으면, 그 물음이 모델까지 가야 한다.**
//
// 밟은 사실(라이브 2026-08-06 · 오너의 ④). *"카톡 '박종윤' 대화창에 입력하고 보내줘"* 에서
// 드라이버는 후보를 정확히 냈다:
//   `창을골라야함: [{window:14963, title:'박종윤'}, {window:14960, title:'카카오톡'}]`
// 그런데 **손이 그걸 버렸다.** 사용자 말은 *"지금 Claude 창 119개가 떠 있어요"* 로 떨어졌고,
// 모델은 그 말을 보고 **"이 컴퓨터 화면에 접근 권한이 없어서"** 라고 지어냈다.
// 권한은 멀쩡했다. 창이 둘이라 안 고른 것뿐이다.
//
// 이건 계열 C(없는 것 ↔ 못 본 것)와 계열 B(드라이버가 밝힌 사실을 우리 추측으로 덮음)가
// 겹친 자리다. **되물음은 실패가 아니다** — 후보를 그대로 올리고 갈 길을 준다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';

const 손세우기 = () => makeDesktopTool({
  drivers: [{
    id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: () => ({
      frontmost: { name: 'Claude' },
      windows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      창을골라야함: [
        { window: 14963, title: '박종윤', app: '카카오톡' },
        { window: 14960, title: '카카오톡', app: '카카오톡' },
      ],
    }),
  }],
});

test('되물음이 사용자 말에 나온다 — "창 119개가 떠 있어요"로 떨어지면 안 된다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', app: 'KakaoTalk' });
  assert.match(r.userSafeSummary, /박종윤/,
    `**후보를 버리고 딴소리를 한다** — 모델이 "권한이 없다"를 지어낸다: ${r.userSafeSummary}`);
});

test('후보가 결과에 남는다 — 모델이 그중 하나를 고를 수 있어야 한다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', app: 'KakaoTalk' });
  const 후보 = r.result?.창을골라야함 ?? [];
  assert.equal(후보.length, 2, `**후보가 결과에 없다**: ${JSON.stringify(r.result).slice(0, 200)}`);
  assert.equal(후보[0]?.title, '박종윤');
});

test('갈 길을 준다 — 어떤 축으로 다시 물어야 하는지 말한다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', app: 'KakaoTalk' });
  const 길 = JSON.stringify(r.result?.다음수단 ?? []);
  assert.match(길, /창제목/,
    `**막고 갈 곳을 안 준다** — 모델이 사용자에게 떠넘긴다: ${길}`);
  assert.match(길, /박종윤/);
});

test('압축을 거쳐도 후보가 살아남는다 — 모델이 보는 것은 압축본이다', () => {
  const 짧게 = compactResult({
    창을골라야함: [{ window: 14963, title: '박종윤', app: '카카오톡' }, { window: 14960, title: '카카오톡', app: '카카오톡' }],
  });
  assert.match(String(짧게), /박종윤/,
    `**압축이 후보를 지운다** — 손은 줬는데 모델은 못 본다: ${짧게}`);
});

// ── 막을 때는 **무엇을 주면 되는지**까지 말한다 ──────────────────────────
// 같은 라이브에서 모델은 입력칸 토큰을 알고 있었는데(`기대.요소: 's00000003:26'`)
// `대상` 칸을 안 채웠다. 손은 *"무엇을 누르는 건지 이름이 없어서 누르지 않았어요"* 로 막았고,
// **무엇을 주면 되는지는 안 말했다.** 모델은 똑같이 두 번 더 시도하고 사용자에게 떠넘겼다.
// 막는 건 옳다(A17). 막고 **갈 곳을 주는 것**까지가 계약이다.
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

const 행동손 = () => makeDesktopActTool({
  drivers: [{
    id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: () => ({ frontmost: { name: 'K' }, windows: [{ id: 9, pid: 77 }], elements: [] }),
    act: () => ({ ok: true }),
  }],
});

// **`type` 은 이제 커서 자리에 친다**(라이브 2026-08-06 · 손과 눈). 누르고 치는 것이 사람의
// 순서라 대상이 없어도 막지 않는다. 이 검사가 겨눈 것은 *"틀린 이유를 말한다"* 이므로
// 자리를 짚어야 하는 **클릭**으로 옮긴다 — 계약은 그대로다.
test('대상을 아예 안 주면 그 사실을 말한다 — "이름이 없다"가 아니다', async () => {
  const r = await 행동손().handler({ action: 'click', 기대: { 요소: 's1:26', 값: 'ㄱ' } });
  assert.equal(r.blocked, true);
  assert.match(r.userSafeSummary, /어디에|무엇에|짚/,
    `**틀린 이유를 말한다** — 모델이 같은 실수를 반복한다: ${r.userSafeSummary}`);
});

test('무엇을 채워야 하는지 길에 적는다 — 모델은 그 길을 읽고 고친다', async () => {
  const r = await 행동손().handler({ action: 'click', 기대: { 요소: 's1:26', 값: 'ㄱ' } });
  assert.match(JSON.stringify(r.다음수단 ?? []), /대상/,
    `**막고 갈 곳을 안 준다**: ${JSON.stringify(r.다음수단)}`);
});

test('글자 넣기를 "누른다"고 말하지 않는다 — 하는 일이 다르다', async () => {
  const r = await 행동손().handler({ action: 'type', 값: 'ㄱ', 대상: { 토큰: 's1:26' } });
  assert.ok(!/누르/.test(String(r.userSafeSummary)), `말이 틀렸다: ${r.userSafeSummary}`);
});

// ── 손의 내부 재관찰도 **같은 창**을 봐야 한다 ───────────────────────────
// 같은 라이브의 마지막 한 칸. 모델은 되물음을 받고 `창제목:'박종윤'` 으로 고쳐 입력칸을
// 정확히 짚었다(`label:'메시지 입력'`). 그런데 손이 실행 전에 화면을 다시 볼 때
// **`창제목` 을 안 넘겨** 목록 창을 봤고, 거기 없는 신분이라 *"지금 화면에 없어요"* 로 막혔다.
// 창을 좁히는 축이 하나 빠지면 **그 뒤 모든 걸음이 다른 창을 본다.**
test('행동 손도 창제목으로 창을 좁힌다 — 짚어 놓고 딴 창을 보면 안 된다', async () => {
  const 본자리 = [];
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: (a) => {
        본자리.push(a);
        return {
          frontmost: { name: 'K' }, windows: [{ id: 9, pid: 77 }],
          본창: { id: 9, app: '카카오톡', title: '박종윤', pid: 77 },
          elements: [{ id: 's1:26', 토큰: 's1:26', 스냅샷: 's1', 번호: 26, role: 'AXTextArea', label: '메시지 입력', 창: 9, pid: 77, isEnabled: true }],
        };
      },
      act: () => ({ ok: true, 확인됨: true, 근거: 'ok' }),
    }],
  });
  await 손.handler({
    action: 'type', app: 'KakaoTalk', 창제목: '박종윤', 값: 'ㄱ',
    대상: { id: 's1:26', label: '메시지 입력' }, 기대: { 요소: 's1:26', 값: 'ㄱ' },
  });
  assert.ok(본자리.some((a) => a?.창제목 === '박종윤'),
    `**창제목을 안 넘긴다** — 다른 창을 보고 "화면에 없다"고 한다: ${JSON.stringify(본자리)}`);
});

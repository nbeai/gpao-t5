// **탐침이 못 찾으면 승인 카드가 뜬다** — 손은 찾는데 탐침만 못 찾으면 헛카드다.
//
// 밟은 사실(라이브 2026-08-06 · 오너의 ④). 한 과업에 승인 카드가 **3장** 떴다:
//   `KakaoTalk · 그 칸 에 글자 넣기` · `화면 press_key` · `KakaoTalk · TextArea 에 글자 넣기`
// 카톡 입력칸은 **값이 있는 칸**이라 계약상 자동이어야 한다(다시 놓으면 되돌아간다).
// 그런데 탐침이 그 요소를 못 찾아 `찾음:false` 로 떨어졌고, 미상은 승인으로 간다.
//
// 못 찾은 이유 둘 — **둘 다 손은 이미 넘어선 벽이다**:
//   · 탐침이 `observe({scope:'window'})` 만 부른다 → **앞 창**을 본다. 카톡이 앞이 아니면 못 본다.
//   · 이름으로만 찾는다 → 모델이 이름을 틀리게 적으면(그리고 그렇게 적었다) 못 찾는다.
//
// 오너 규율: *"자동성이 의무다 — 승인으로 안전을 사지 마라."* 헛카드는 안전이 아니라 마찰이다.
// **바깥으로 나가는 걸음(전송)에만 카드가 남아야 한다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';

const 입력칸 = {
  id: 's1:26', 토큰: 's1:26', 스냅샷: 's1', 번호: 26,
  role: 'AXTextArea', label: '메시지 입력', value: '', 창: 9, pid: 77, isEnabled: true,
};

function 손세우기(본자리 = []) {
  return makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: (a) => {
        본자리.push(a);
        // **앞 창은 남의 것이다** — 카톡을 지목해야만 그 요소가 보인다.
        const 카톡인가 = a?.app === 'KakaoTalk' || a?.창제목 === '박종윤' || a?.window === 9;
        return {
          frontmost: { name: 'Claude' }, windows: [{ id: 9, pid: 77 }],
          본창: { id: 9, app: '카카오톡', title: '박종윤', pid: 77 },
          elements: 카톡인가 ? [입력칸] : [],
        };
      },
      act: () => ({ ok: true, 확인됨: true, 근거: 'ok' }),
    }],
  });
}

test('탐침도 그 창을 본다 — 앞 창만 보면 영영 못 찾는다', async () => {
  const 본자리 = [];
  const r = await 손세우기(본자리).probe({
    action: 'type', app: 'KakaoTalk', 창제목: '박종윤',
    대상: { id: 's1:26', label: '메시지 입력' },
  });
  assert.equal(r?.찾음, true,
    `**탐침이 앞 창만 본다** — 값 있는 칸인데 승인 카드가 뜬다: ${JSON.stringify(r)} / ${JSON.stringify(본자리)}`);
  assert.equal(r?.값있음, true);
});

test('탐침도 신분으로 찾는다 — 모델이 이름을 틀리게 적어도 찾는다', async () => {
  // 라이브에서 모델이 실제로 이렇게 적었다: label 자리에 역할 이름.
  const r = await 손세우기().probe({
    action: 'type', app: 'KakaoTalk',
    대상: { id: 's1:26', label: 'TextArea' },
  });
  assert.equal(r?.찾음, true,
    `**이름이 틀리면 못 찾는다** — 손은 신분으로 찾는데 탐침만 이름으로 찾는다: ${JSON.stringify(r)}`);
});

// 계약이 두 번 움직였다. (가-2)(PM 2026-08-09)가 이 문장("탐침이 선 칸이면 자동")을
// `field_input`(기본 카드)으로 뒤집었고, **오너 결재 ①(2026-08-11)이 되돌렸다.**
// 그래서 이 파일의 두 검사(탐침이 손과 같은 창을 본다 · 신분으로 찾는다)가 다시
// **직접** 값을 낳는다 — 탐침이 서면 그 칸에 글자가 자동으로 들어간다. 탐침이 헛짚으면
// 그대로 카드다. 헛카드 방지가 이 파일의 값이었고, 이제 그 값이 실제로 매달려 있다.
test('탐침이 서면 그 칸에 글자 넣기는 자동이다 — 이 파일의 두 검사가 그 값을 낳는다', async () => {
  const 눌러본사실 = await 손세우기().probe({
    action: 'type', app: 'KakaoTalk', 대상: { id: 's1:26', label: '메시지 입력' },
  });
  assert.equal(
    toolActionKind({ toolId: 'desktop.act', args: { action: 'type', 눌러본사실 } }),
    'organize',
    `**탐침이 섰는데도 카드가 뜬다** — 헛카드 방지가 아무 값도 못 낳는다: ${JSON.stringify(눌러본사실)}`,
  );
});

test('바깥으로 나가는 걸음에는 카드가 그대로 뜬다 — 여기가 카드 자리다', () => {
  assert.notEqual(
    toolActionKind({ toolId: 'desktop.act', args: { action: 'press_key', 값: 'return' } }),
    'organize',
    '**전송이 카드 없이 나간다**',
  );
});

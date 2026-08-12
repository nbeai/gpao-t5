// **노드 ③ — 어느 손으로 할지 T5 가 안다.**
//
// 오너 정본(2026-08-06):
// > *"터미널과 CU 는 보는 대상이 다르다. 같은 것을 더 많이/적게 보는 게 아니라 **다른 것**을 본다.
// >  터미널 — 컴퓨터가 **저장한** 것(파일·프로세스·설정) / CU — 앱이 **사람에게 보여주는** 것(화면).
// >  **한 줄 판단**: 사장님이 지금 그걸 어떻게 보시나? 파일을 열어서 본다 → 터미널.
// >  앱이나 사이트에 로그인해서 본다 → CU. **둘 다 되면 터미널이 낫다**(CU 는 느리고 비싸다)."*
//
// 지금 T5 에는 그 판단이 **한 줄도 없다.** 손마다 *"무엇을 하나"* 는 있는데
// *"무엇을 **보는** 손인가 · 언제 쓰나 · 얼마나 비싼가"* 가 없다. 모델이 매번 새로 짐작한다.
//
// **커널이 고르지 않는다.** 고르는 것은 모델의 일이고, 커널은 **재료를 준다** —
// 손이 자기 정의역을 밝히고, 고르는 규칙 한 줄을 헌장이 준다. 그래야 새 손이 붙어도 선다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoDescriptors } from '../src/surface/demo-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const 손 = (id) => demoDescriptors({
  desktop: { handler: async () => ({}) }, desktopAct: { handler: async () => ({}) },
}).find((d) => d.id === id);

// ── 손이 자기 정의역을 밝힌다 ────────────────────────────────────────────
test('터미널은 "저장된 것"을 본다고 말한다', () => {
  const f = String(손('local.terminal')?.operatorFact ?? '');
  assert.match(f, /저장|파일|설정|프로세스/,
    `**무엇을 보는 손인지 안 말한다** — 모델이 매번 짐작한다: ${f}`);
});

test('화면 손은 "앱이 보여주는 것"을 본다고 말한다 — 그리고 언제 그것뿐인지도', () => {
  const f = String(손('desktop.screen')?.operatorFact ?? '');
  assert.match(f, /화면|보여/, `무엇을 보는 손인지 안 말한다: ${f}`);
  assert.match(f, /로그인|암호|앱 안/,
    `**"터미널로는 못 여는 자리"를 안 말한다** — 카드사·배달앱·카톡 대화가 그 자리다: ${f}`);
});

test('비싼 손은 비싸다고 말한다 — 둘 다 되면 싼 쪽으로 가야 한다', () => {
  const f = String(손('desktop.screen')?.operatorFact ?? '');
  assert.match(f, /느리|비싸|마지막/,
    `**값을 안 말한다** — 파일로 될 일에 화면을 쓴다: ${f}`);
});

// ── 고르는 규칙은 헌장이 한 줄로 준다 ────────────────────────────────────
// 손 하나는 자기 얘기만 할 수 있다. *"둘 다 되면 터미널"* 같은 **비교**는 공통 자리에 있어야 한다.
// 갈림은 **화면 손이 있을 때** 생긴다 — 손이 하나뿐이면 고를 것이 없다.
// 헌장은 동결 자산이라 늘리지 않는다(밀도 검사·기준지문이 지킨다). 갈림이 실제로 생기는
// 자리에 둔다 — `screen-guidance`(화면 손이 배선된 턴에만 실린다).
test('고르는 규칙이 모델에게 간다 — "그걸 지금 어떻게 보시나"', () => {
  const s = String(buildModelMessages({ currentRequest: 'x', connectedTools: [{ id: 'desktop.screen' }] }).system);
  assert.match(s, /어떻게 보나/,
    `**어느 손으로 할지 고르는 기준이 없다**: ${s.slice(0, 300)}`);
});

test('싼 쪽이 먼저라고 말한다', () => {
  const s = String(buildModelMessages({ currentRequest: 'x', connectedTools: [{ id: 'desktop.screen' }] }).system);
  assert.match(s, /둘 다 되면|싼|먼저/, '**비싼 손을 먼저 집는다**');
});

// ── 막히면 옆 손으로 간다 ────────────────────────────────────────────────
// 오늘 라이브에서 여섯 번 다 사람에게 떠넘겼다. 손 안에서는 사다리를 타게 됐지만(노드 ②),
// **손 밖으로 나가는 길**은 아직 없다 — 화면이 막히면 터미널을, 터미널이 막히면 화면을.
test('한 손이 막히면 다른 손을 가리킨다 — 사람에게 떠넘기기 전에', () => {
  const s = String(buildModelMessages({ currentRequest: 'x', connectedTools: [{ id: 'desktop.screen' }] }).system);
  assert.match(s, /다른 손|손을 바꿔|옆 손/,
    `**막히면 바로 사람에게 넘긴다** — 오늘 여섯 번 그랬다: ${s.slice(0, 300)}`);
});

// ── 규율은 안 느슨해진다 ─────────────────────────────────────────────────
test('없는 손을 가리키지 않는다 — 배선된 것만 재료가 된다', () => {
  const 없는턴 = String(buildModelMessages({
    currentRequest: 'x', connectedTools: [{ id: 'local.file' }],
  }).system);
  // 고르는 규칙은 공통이라 늘 있지만, **화면 손 사용법**은 화면 손이 있을 때만이다(노드 ②).
  assert.ok(!/사다리/.test(없는턴), '없는 손의 사용법을 싣는다');
});

// ── 막히면 **같은 것을 보는 다른 손**을 가리킨다 ────────────────────────
// 라이브(2026-08-06): *"/tmp/t5rt/매출.csv 의 금액 합계를 내줘"* →
//   `local.file` 이 *"작업 폴더 밖이에요"* 로 막았고, T5 는 **사용자에게 awk 명령을 줬다.**
//   같은 턴 바로 앞에서 `local.terminal` 로 그 폴더를 실제로 봤는데도.
//
// `file-scope.js` 주석이 이미 그 경계를 적어 뒀다 —
//   *"이 손은 다른 손이 있는지 모른다. **다음 계단은 손 목록을 아는 커널이 정한다.**"*
// 커널은 손 목록을 안다. 그런데 **어느 손이 같은 것을 보는지**를 몰랐다.
// 그래서 손이 축 하나(`보는것`)를 선언하고, 커널이 그 축으로 대안을 고른다.
// 글(`operatorFact`)은 모델이 읽는 것이고, 축은 **커널이 읽는 것**이다.
//
// **축은 여럿일 수 있다**(F-107 · 2026-08-12). 예전엔 여기서 문자열 하나를 못박았는데,
// 그건 「축을 선언한다」를 지키려던 것이지 「축은 하나뿐이다」를 지키려던 게 아니었다.
// 화면 손은 **「화면」이면서 「웹」**이다 — 브라우저 창은 화면에 있고 그 안의 웹 페이지를
// 그 손이 본다. 오너 정본: *"뭐가 막든간에 시각적 효과까지 발휘하면 리뷰 읽을 수 있어.
// 그게 컴퓨터유즈잖아."* 축이 하나면 웹이 다 막혔을 때 그 사실을 커널이 못 쓴다.
// **각 손이 원래 축을 잃지 않았는지는 그대로 지킨다.**
test('손이 무엇을 보는지 축으로 선언한다 — 커널이 읽을 수 있게', () => {
  const 축 = (id) => [손(id)?.보는것].flat().filter(Boolean);
  assert.deepEqual(축('local.file'), ['저장된것']);
  assert.deepEqual(축('local.terminal'), ['저장된것']);
  assert.ok(축('desktop.screen').includes('화면'), '화면 손이 「화면」 축을 잃었다');
  assert.ok(축('web.collect').includes('웹'), '웹 수집이 「웹」 축을 잃었다');
});

// ── 웹을 보는 손은 **전부** 축을 단다 (F-107) ────────────────────────────
//
// 오너 라이브(2026-08-12): 네이버 플레이스가 껍데기로 돌아왔는데 T5 가 *"안쪽까지 열어볼
// 수 없다"* 로 끝냈다. 브라우저 손도 화면 손도 그 자리에 있었는데 **축을 안 달고 있어서**
// `옆손찾기` 에 안 보였다. 하나만 달면 옆에 설 손이 없는 것과 같다.
test('웹을 보는 손이 전부 축을 단다 — 하나만 달면 옆에 설 손이 없다', () => {
  const 축 = (id) => [손(id)?.보는것].flat().filter(Boolean);
  for (const id of ['web.collect', 'web.search', 'browser.observe', 'browser.act']) {
    assert.ok(축(id).includes('웹'), `**${id} 에 「웹」 축이 없다** — 대안으로 안 보인다`);
  }
  assert.ok(축('desktop.screen').includes('웹'),
    '**화면 손이 웹 축에 안 선다** — HTTP 가 막혀도 화면에 그려진 픽셀은 못 막는다. '
    + '그 손 설명이 이미 「로그인 뒤에 있으면(…플레이스) 여기뿐이다」라고 적고 있다');
});

test('막힌 손과 같은 것을 보는 손이 있으면 그쪽을 가리킨다', async () => {
  const { 다음길 } = await import('../src/kernel/turn.js');
  const 길 = 다음길(
    [{
      failureState: 'blocked',
      actualCall: { tool: 'local.file', args: { action: 'read' } },
      userSafeSummary: '매출.csv은(는) 파일 도구의 작업 폴더 밖이에요.',
      nextSafeAction: '파일 도구는 작업 폴더 안에서만 다뤄요.',
    }],
    ['local.file', 'local.terminal', 'desktop.screen'],
    // 축은 descriptor 가 선언하고 커널은 비교만 한다 — 커널은 손 목록을 직접 안 읽는다.
    [{ id: 'local.file', label: '로컬 파일', 보는것: '저장된것' },
      { id: 'local.terminal', label: '터미널 실행', 보는것: '저장된것' },
      { id: 'desktop.screen', label: '화면 보기', 보는것: '화면' }],
  );
  assert.match(String(길), /터미널|같은 것을 보는/,
    `**같은 것을 보는 손이 있는데 안 가리킨다** — 사용자에게 명령어를 준다: ${길}`);
});

test('같은 것을 보는 손이 없으면 없는 말을 안 만든다', async () => {
  const { 다음길 } = await import('../src/kernel/turn.js');
  const 길 = 다음길(
    [{
      failureState: 'blocked',
      actualCall: { tool: 'local.file', args: { action: 'read' } },
      userSafeSummary: '작업 폴더 밖이에요.',
      nextSafeAction: '파일 도구는 작업 폴더 안에서만 다뤄요.',
    }],
    ['local.file', 'desktop.screen'],
    [{ id: 'local.file', label: '로컬 파일', 보는것: '저장된것' },
      { id: 'desktop.screen', label: '화면 보기', 보는것: '화면' }],
  );
  assert.ok(!/터미널/.test(String(길)), `**없는 손을 가리킨다**: ${길}`);
});

test('축이 selfState 까지 실린다 — 커널은 selfState 가 든 것만 본다', async () => {
  const [{ buildSelfState }, { demoEnv }] = await Promise.all([
    import('../src/kernel/l0-evidence/self-state.js'),
    import('../src/surface/demo-context.js'),
  ]);
  const 손들 = buildSelfState(demoEnv()).connectedTools ?? [];
  const 파일 = 손들.find((t) => t.id === 'local.file');
  assert.equal(파일?.보는것, '저장된것',
    `**축이 커널까지 안 온다** — 옆 손을 못 고른다: ${JSON.stringify(Object.keys(파일 ?? {}))}`);
});

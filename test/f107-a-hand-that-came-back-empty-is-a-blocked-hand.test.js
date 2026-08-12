// **F-107 · 빈손으로 돌아온 걸음도 막힌 걸음이다 — 손이 로봇팔처럼 움직였다** (선빨강)
//
// ── 오너가 실제로 밟았다 (2026-08-12 밤 · 세션 6a412df3) ────────────────────
// ```
// [윤]  네이버에서 팔식당 플레이스 들어가서 요약 좀 해줘
// [T5]  제가 직접 안쪽까지 열어볼 수 있는 구조가 아니라, 공개 검색결과 기준으로만…
// [윤]  청담 팔식당이야. 거기 네이버 플레이스 들어가서 리뷰 분석 좀 해봐
// [T5]  제가 직접 안쪽까지 열어볼 수가 없어서(지금 구조상 껍데기 화면만 보입니다)…
// [윤]  야. 주소창 링크를 가져와서 링크 분석 시키면 되잖아. **너한테 그 도구 다 있어.**
// [윤]  야. 네이버플레이스 주소 긁어서 링크 분석 하면 되잖아. **너한테 그 기능 다 있어.**
// ```
// 오너 진단: *"손이 손답게 안 움직이고 **로봇팔**처럼 움직이는거지."*
// *"뭐가 막든간에 **시각적 효과까지 발휘하면** 리뷰 읽을 수 있어. 그게 컴퓨터유즈잖아."*
//
// ── 밟은 기계 사실 ──────────────────────────────────────────────────────────
// 그 턴 원장: `web.collect` 5회 · `browser.observe open` 3회 — **전부 `failureState: none`**.
// 손은 다 성공했다. 그런데 가져온 것이 껍데기였다:
// ```
// web.collect     → "방문자 리뷰 {{value}}" · "{{year}} {{style}} 우수{{type}}"   (미치환 템플릿)
// browser.observe → "서비스 이용이 제한되었습니다"  observation.thin: true · seen 122자
// ```
// **T5 는 거기서 멈췄다.** 화면 손(`desktop.screen`)은 한 번도 안 썼다 — 그 손 설명에
// *"로그인 뒤에 있으면(카드사·배달앱·**플레이스**) 여기뿐이다"* 라고 **이미 적혀 있는데도.**
//
// ── 왜 안 움직였나 — 구조는 이미 있었다 ──────────────────────────────────────
// `turn.js:485 옆손찾기` 가 **막힌 손과 같은 축(`보는것`)을 보는 안 막힌 손**을 가리킨다.
// 2026-08-06 카톡 사고 뒤에 심은 구조다. 그런데 두 곳이 끊겨 있었다:
//
//   (가) **축이 셋에만 있다** — `web.collect`(웹) · `local.terminal`·`local.file`(저장된것).
//        `browser.observe`·`browser.act`·`web.search`·`desktop.screen` 에는 **없다.**
//        웹이 막혀도 옆에 설 손이 축을 안 달고 있어 안 보인다.
//
//   (나) **막힘을 `failureState !== 'none'` 으로만 센다** — 오너 턴의 손은 전부 `none` 이다.
//        **빈손으로 돌아온 걸음이 막힌 걸음으로 안 쳐져서** 이 구조가 아예 안 돌았다.
//
// **F-105 에서 배운 것과 같은 모양이다**: 「안 잰 0」과 「잰 0」이 다르듯,
// **「읽었다」와 「읽을 것이 있었다」는 다르다.**
//
// ── 커널이 알맹이를 재는가 — 아니다 ─────────────────────────────────────────
// 세 신호만 쓴다. 전부 손이 스스로 냈거나 문자열 패턴이다:
//   ① `observation.thin === true`          손이 스스로 말한다
//   ② `blocked === true` / `fetchState`     손이 스스로 말한다
// **세 번째 신호는 만들지 않는다.** 감시자가 잡았다 — `web-tool.js:290-324` 가 이미
// `readableChars` 로 `읽은상태:'shell'` 을 계산하고 `task-context.js:196` 이 모델에게
// *"알맹이 없음: 메뉴·링크뿐이라 이 페이지에는 답이 없어요"* 를 보낸다. 그 위에 `{{…}}`
// 패턴을 얹으면 **커널의 두 번째 알맹이 판정기**가 된다.
// 알맹이가 좋은지 나쁜지는 안 잰다 — **커널은 알맹이를 재지 않는다.**
import assert from 'node:assert/strict';
import test from 'node:test';

import { 다음길 } from '../src/kernel/turn.js';
import { demoDescriptors } from '../src/surface/demo-context.js';

const 손들 = demoDescriptors({});
const 손찾기 = (id) => 손들.find((t) => t.id === id);

// ── ① 축이 웹 손 전체에 있다 ─────────────────────────────────────────────────
test('F107 ①: **웹을 보는 손은 모두 축을 단다** — 하나만 달면 옆에 설 손이 안 보인다', () => {
  for (const id of ['web.collect', 'web.search', 'browser.observe', 'browser.act']) {
    const t = 손찾기(id);
    assert.ok(t, `${id} 손이 없다`);
    const 축 = [t.보는것].flat().filter(Boolean);
    assert.ok(축.includes('웹'),
      `**${id} 에 「웹」 축이 없다** — \`옆손찾기\` 는 축으로만 옆 손을 찾는다. `
      + '축을 안 달면 그 손은 존재해도 대안으로 안 보인다. '
      + '오너 라이브에서 web.collect 가 껍데기를 물고 왔을 때 browser 손이 이 이유로 안 섰다');
  }
});

// ── ② 화면 손은 웹의 마지막 자리다 ───────────────────────────────────────────
//
// 오너 정본: *"뭐가 막든간에 시각적 효과까지 발휘하면 읽을 수 있어. 그게 컴퓨터유즈잖아."*
// 네이버가 막은 것은 HTTP 층이다. **화면에 그려진 픽셀은 못 막는다.**
// 그 손 설명이 이미 그렇게 적어 뒀다 — *"로그인 뒤에 있으면(…플레이스) 여기뿐이다."*
test('F107 ②: **화면 손이 웹 축에도 선다** — HTTP 가 막혀도 사람 화면은 못 막는다', () => {
  const t = demoDescriptors({ desktop: { connected: true } }).find((x) => x.id === 'desktop.screen');
  assert.ok(t, 'desktop.screen 손이 안 켜졌다');
  const 축 = [t.보는것].flat().filter(Boolean);
  assert.ok(축.includes('화면'), 'desktop.screen 이 「화면」 축을 잃었다');
  assert.ok(축.includes('웹'),
    '**화면 손이 웹 축에 안 선다** — 브라우저 창은 화면에 있고, 그 안의 웹 페이지를 이 손이 본다. '
    + '축이 안 겹치면 웹이 다 막혔을 때 T5 는 「못 한다」로 끝난다. '
    + '그 손 설명은 이미 「로그인 뒤에 있으면(…플레이스) 여기뿐이다」라고 적고 있다');
});

// ── ③ 빈손으로 돌아온 걸음을 막힌 걸음으로 센다 ──────────────────────────────
//
// 여기가 오너 턴이 밟은 그 자리다 — 손은 전부 `failureState: none` 이었다.
const 웹영수증 = (result) => ({
  actualCall: { tool: 'web.collect', args: { request: 'https://m.place.naver.com/restaurant/1' } },
  result,
  failureState: 'none',
  lifecycle: 'delivered',
});

test('F107 ③-a: **손이 「껍데기」라 말한 걸음**은 막힌 걸음이다 — 성공(none)이어도', () => {
  const 길 = 다음길(
    // 손이 스스로 낸 사실이다 — 오너 턴 원장에 이 값이 그대로 있다.
    [웹영수증({ 읽은상태: 'shell', markdown: '소식\n리뷰\n사진\n지도\n주변' })],
    ['web.collect', 'browser.observe', 'desktop.screen'],
    손들,
  );
  assert.match(String(길 ?? ''), /같은 것을 보는 손|화면|브라우저/,
    '**손이 「메뉴뿐이라 알맹이가 없었어요」라고 말했는데 다음 길이 안 선다** — 그 사실은 '
    + '모델에게 이미 갔다(원장 실측). 그런데 **「그럼 저 손으로 가면 된다」를 아무도 말하지 않는다.** '
    + '이 자리에서 T5 는 오너에게 "안쪽까지 열어볼 수 없다"고 했다');
});

test('F107 ③-b: **thin 으로 돌아온 관찰**도 막힌 걸음이다', () => {
  const 길 = 다음길(
    [{
      actualCall: { tool: 'browser.observe', args: { action: 'open', url: 'https://m.place.naver.com/restaurant/1' } },
      result: { markdown: '서비스 이용이 제한되었습니다.', observation: { thin: true, seen: { chars: 122 } } },
      failureState: 'none',
      lifecycle: 'delivered',
    }],
    ['web.collect', 'browser.observe', 'desktop.screen'],
    손들,
  );
  assert.match(String(길 ?? ''), /같은 것을 보는 손|화면/,
    '**손이 스스로 `thin: true` 라고 말했는데 다음 길이 안 선다** — 그 손은 "열리기만 했을 수 있다"고 '
    + '자기 입으로 말하고 있다. 커널이 그 말을 안 듣는다');
});

test('F107 ③-c: **blocked** 로 돌아온 걸음도 막힌 걸음이다', () => {
  const 길 = 다음길(
    [웹영수증({ blocked: true, fetchState: 'blocked', markdown: '' })],
    ['web.collect', 'browser.observe', 'desktop.screen'],
    손들,
  );
  assert.match(String(길 ?? ''), /같은 것을 보는 손|화면|브라우저/,
    'blocked 로 돌아왔는데 다음 길이 안 선다');
});

// ── ④ 반대편 — 제대로 물고 온 걸음은 안 건드린다 ─────────────────────────────
test('F107 ④: **알맹이를 물고 온 걸음**은 막힘이 아니다 — 멀쩡한 답에 다음 길을 붙이지 않는다', () => {
  const 길 = 다음길(
    [웹영수증({
      markdown: '청담 팔식당은 1등급 암퇘지만 취급하는 돼지고기 구이 전문점이다. '
        + '숯불 위 주물판에 구워 먹는 방식이고, 갈매기살·생갈비는 하루 한정 수량으로 판다. '
        + '양념게장과 민물새우탕이 곁들임으로 인기가 많다.',
    })],
    ['web.collect', 'browser.observe', 'desktop.screen'],
    손들,
  );
  assert.doesNotMatch(String(길 ?? ''), /같은 것을 보는 손/,
    '**제대로 읽은 걸음에 「다른 손으로 해 볼게요」를 붙였다** — 이러면 매 턴 군말이 붙는다. '
    + 'F-95 가 정확히 이 모양으로 참인 답을 죽였다');
});

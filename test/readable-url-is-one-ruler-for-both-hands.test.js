// **읽히는 주소 규칙은 한 벌이고 두 손이 같이 쓴다** (콘솔 라이브 2026-08-12).
//
// 밟은 회차 — 「네이버에서 팔식당 검색해서 플레이스 후기 분석해줄 수 있어?」
//   모델이 `browser.observe(open, https://maps.naver.com/p/search/팔식당)` 를 골랐고,
//   그 화면은 **「팔식당에 대한 검색 결과가 없습니다」** 였다. 데스크톱 지도는 JS 앱이라
//   헤드리스에서 결과를 안 뿌린다.
//
// 그런데 T5 에는 그 규칙이 **이미 있었다** — `web.collect` 의 `preferReadableUrl` 이
// 네이버 계열을 `m.` 호스트로 바꿔 읽는다. 웹 손만 알고 브라우저 손은 몰랐다.
// 같은 사실을 두 손이 따로 알면 한쪽만 고쳐지고 다른 쪽이 그대로 남는다.
//
// 오너 지식(2026-08-12): *"네이버는 앞에 m. 을 붙인 모바일 주소로 시작해야 플레이스가
// 제대로 잡힌다. m.naver.com 에서 검색하는 게 낫다."*
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferReadableUrl } from '../src/runtime/web-collector.js';
import { makeBrowserObserveTool } from '../src/runtime/browser-tool.js';

test('지도 검색 주소는 모바일 검색으로 간다 — 데스크톱 지도는 헤드리스에서 안 뿌린다', () => {
  const 바뀐 = preferReadableUrl('https://maps.naver.com/p/search/%ED%8C%94%EC%8B%9D%EB%8B%B9');
  assert.match(바뀐, /^https:\/\/m\.search\.naver\.com\/search\.naver\?query=/, 바뀐);
});

test('maps(s 붙은 것)도 map 과 같은 서비스로 본다 — 플레이스 id 는 모바일 플레이스로', () => {
  assert.equal(
    preferReadableUrl('https://maps.naver.com/p/entry/place/1747125291'),
    'https://m.place.naver.com/place/1747125291/home',
  );
});

test('네이버 첫 화면도 모바일로 — 질의가 붙어 있으면 검색 자리로 바로', () => {
  assert.equal(preferReadableUrl('https://www.naver.com'), 'https://m.naver.com');
  assert.match(preferReadableUrl('https://naver.com/?query=%ED%8C%94%EC%8B%9D%EB%8B%B9'),
    /^https:\/\/m\.search\.naver\.com\/search\.naver\?query=/);
});

test('네이버가 아닌 주소는 손대지 않는다 — 그물이 안 넓어졌다', () => {
  for (const u of ['https://example.com/x', 'https://map.google.com/q', 'https://blog.example.kr/8']) {
    assert.equal(preferReadableUrl(u), u, `${u} 가 바뀌었다`);
  }
});

test('브라우저 손이 같은 자를 쓴다 — 열기 전에 주소가 고쳐진다', async () => {
  const 연것 = [];
  const 손 = makeBrowserObserveTool({
    browser: {
      profileKind: () => 'isolated',
      coolingMs: () => 0,
      async open(url) {
        연것.push(url);
        return { url, title: '팔식당 : 네이버 검색', markdown: '후기…', observation: { seen: { chars: 10, of: 10, percent: 100 } } };
      },
      async snapshot() { return {}; },
    },
  });
  await 손.handler({ action: 'open', url: 'https://maps.naver.com/p/search/%ED%8C%94%EC%8B%9D%EB%8B%B9' });
  assert.equal(연것.length, 1);
  assert.match(연것[0], /^https:\/\/m\.search\.naver\.com\//,
    `**브라우저 손이 옛 규칙 없이 그대로 열었다**: ${연것[0]}`);
});

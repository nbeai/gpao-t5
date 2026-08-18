import test from 'node:test';
import assert from 'node:assert/strict';

import { naverReadableUrlResolver } from '../src/naver-readable-url.js';

test('네이버 지도·플레이스 공개 주소는 같은 장소의 모바일 SSR 주소로 바꾼다', () => {
  assert.deepEqual(
    naverReadableUrlResolver.resolve('https://maps.naver.com/p/entry/place/1747125291'),
    { url: 'https://m.place.naver.com/place/1747125291/home', reason: 'naver_mobile_ssr' },
  );
  assert.deepEqual(
    naverReadableUrlResolver.resolve('https://map.naver.com/p/entry/place/1747125291?lng=127'),
    { url: 'https://m.place.naver.com/place/1747125291/home', reason: 'naver_mobile_ssr' },
  );
  assert.deepEqual(
    naverReadableUrlResolver.resolve('https://place.naver.com/restaurant/1747125291/home'),
    { url: 'https://m.place.naver.com/restaurant/1747125291/home', reason: 'naver_mobile_ssr' },
  );
});

test('네이버 지도 검색은 모바일 통합검색으로, 블로그는 모바일 같은 경로로 바꾼다', () => {
  assert.equal(
    naverReadableUrlResolver.resolve('https://maps.naver.com/p/search/%ED%8C%94%EC%8B%9D%EB%8B%B9').url,
    'https://m.search.naver.com/search.naver?query=%ED%8C%94%EC%8B%9D%EB%8B%B9',
  );
  assert.equal(
    naverReadableUrlResolver.resolve('https://blog.naver.com/someone/123').url,
    'https://m.blog.naver.com/someone/123',
  );
});

test('사업주 포털과 네이버가 아닌 주소는 근거 없이 m. 주소를 만들지 않는다', () => {
  assert.equal(naverReadableUrlResolver.resolve('https://new.smartplace.naver.com/'), null);
  assert.equal(naverReadableUrlResolver.resolve('https://example.com/place/1747125291'), null);
});

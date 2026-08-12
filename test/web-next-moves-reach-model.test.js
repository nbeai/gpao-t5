// **모델이 실제로 받는가.** 결과 객체에 필드를 더하는 것만으로는 모델에게 안 간다.
//
// 라이브(2026-08-05, 내가 직접 돌림): `오늘 한국 증시 상황은 어때?` 에 T5 가
// **로또 사이트(lottomagic.kr)의 아침 브리핑**을 읽고 어제(8/4) 종목 시세로 답했다.
// 오늘 지수는 못 말했다 — 네이버 금융에 그대로 있는데(코스피 6,633.95) 안 갔다.
//
// 턴 결과를 열어 보니 원인이 나왔다:
//     읽은상태 · 다른후보 · 다음수단 → **턴 어디에도 없음**
// `compactResult` 가 웹 결과를 **손으로 고른 필드만** 문자열로 조립한다 —
// 제목 · 비교후보 · 본문 길이 · 링크 · 본문. 새 필드는 안 실린다.
//
// 그래서 커널이 "다른 후보가 있다"고 만들어 놓고 **모델에게는 말하지 않았다.**
// S7 계측기의 문장 그대로다 — *"안 준 손은 흔적이 없다."*
// 수집기 단위 검사는 전부 초록이었고, 라이브에서만 드러났다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';

const 웹결과 = {
  title: '알파스퀘어',
  markdown: '알파스퀘어는 올인원 트레이딩 플랫폼입니다. 실시간 투자정보를 제공합니다.',
  links: [{ text: '회사소개', url: 'https://m.alphasquare.co.kr/about' }],
  읽은상태: 'ok',
  substanceChars: 602,
  다른후보: [
    { title: '네이버 금융 코스피', url: 'https://finance.naver.com/sise/sise_index.naver?code=KOSPI' },
    { title: '다음 금융', url: 'https://finance.daum.net/domestic' },
  ],
  다음수단: [
    { 방법: 'read_url', url: 'https://finance.naver.com/sise/sise_index.naver?code=KOSPI', 왜: '검색에서 같이 나온 곳: 네이버 금융 코스피' },
    { 방법: 'search', 왜: '다른 자료로 검색을 다시 한다' },
  ],
};

test('① **다른 후보가 모델이 읽는 재료에 실린다** — 첫 결과가 답이라고 커널이 정하지 않는다', () => {
  const 재료 = compactResult(웹결과) ?? '';
  assert.match(재료, /finance\.naver\.com/,
    '**다른 후보가 모델에게 안 간다.** 커널은 만들어 놓고 말하지 않았다 — 라이브 그대로다.\n'
    + `모델이 받는 것:\n${재료}`);
});

test('② **다음 수단이 모델이 읽는 재료에 실린다** — 막다른 답이 되지 않게', () => {
  const 재료 = compactResult(웹결과) ?? '';
  assert.match(재료, /부를 수 있어요/,
    `**다음 수단이 모델에게 안 간다.**\n모델이 받는 것:\n${재료}`);
});

test('③ **껍데기였다는 사실이 모델에게 간다** — 읽은 척하지 않는다', () => {
  const 재료 = compactResult({ ...웹결과, 읽은상태: 'shell', substanceChars: 0, markdown: '마켓\nMY\n국내' }) ?? '';
  assert.match(재료, /껍데기|알맹이|shell/,
    `**"메뉴뿐이었다"가 모델에게 안 간다** — 모델은 읽은 줄 알고 그 위에 답한다.\n${재료}`);
});

test('④ **잘 읽은 페이지는 잔소리가 늘지 않는다** — 늘 같은 말을 붙이지 않는다', () => {
  const 재료 = compactResult({ title: '한국은행', markdown: '기준금리를 동결했다. '.repeat(20), links: [] }) ?? '';
  assert.doesNotMatch(재료, /껍데기|다시 검색/, `수단이 없는데 있다고 했다:\n${재료}`);
});

test('⑤ **상한을 지킨다** — 다음 수단이 본문을 밀어내지 않는다', () => {
  const 많은수단 = Array.from({ length: 20 }, (_, i) => ({ 방법: 'read_url', url: `https://e${i}.test/aaaaaaaaaaaaaaaaaaaa`, 왜: `후보 ${i}` }));
  const 재료 = compactResult({ ...웹결과, 다음수단: 많은수단, markdown: '본문. '.repeat(300) }, 1200) ?? '';
  assert.ok(재료.length <= 1400, `재료가 상한을 넘겼다: ${재료.length}자`);
  assert.match(재료, /본문/, '수단이 본문을 밀어냈다');
});

// P2-7 2축 · 운용 상태 — **receipt 에서 파생되는 얇은 뷰**.
//
// 잇기만 검사하면 절반이다. 오너 지시: 새 대상 · "아니 그거 말고" · 실패한 실행에서
// **대상을 푸는 규칙**까지 넣어라. 잇기만 하면 엉뚱한 페이지 하나가 현재 대상으로 고착되고
// 이후 모든 턴이 그 오염을 물려받는다(절대원칙 §0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveWorkingState, workingStateFacts, MAX_FACTS_CHARS } from '../src/kernel/l0-evidence/working-state.js';

const webReceipt = (url, title, links = []) => ({
  failureState: 'none',
  actualCall: { tool: 'web.collect', args: { request: url } },
  result: { title, links },
  sources: [{ sourceUrl: url, title }],
});
const fileReceipt = (path) => ({
  failureState: 'none', actualCall: { tool: 'local.file', args: { action: 'read', path } }, result: { path },
});
/** 여러 턴을 이어 돌린다 — 흐름은 한 턴으로 검사할 수 없다. */
const run = (turns) => turns.reduce((s, t) => deriveWorkingState(s, t), null);

// ── 잇기 ────────────────────────────────────────────────────────────────
test('방금 읽은 페이지가 현재 대상으로, 이어갈 링크와 함께 간다', () => {
  const s = run([{ receipts: [webReceipt('https://m.place.naver.com/restaurant/1/home', '팔식당', ['https://m.place.naver.com/restaurant/1/review/visitor'])] }]);
  const facts = workingStateFacts(s);
  assert.match(facts, /방금 읽은 자료: 팔식당/);
  assert.match(facts, /이어갈 수 있는 곳:.*review\/visitor/, '리뷰 주소를 안 주면 "리뷰"를 검색해 엉뚱한 글을 읽는다');
});

test('파일을 읽으면 그 파일이 현재 대상이다("그거 정리해줘"가 이어진다)', () => {
  const s = run([{ receipts: [fileReceipt('보고서/3분기.md')] }]);
  assert.match(workingStateFacts(s), /방금 다룬 파일: 보고서\/3분기\.md/);
});

test('지난 대화를 찾으면 그 결과가 현재 대상이다("그 세션 기준으로"가 이어진다)', () => {
  const s = run([{ receipts: [{
    failureState: 'none', actualCall: { tool: 'session.search', args: { query: '팔식당' } },
    result: { hits: [{ title: '팔식당 분석' }, { title: '청담 회식 후보' }] },
  }] }]);
  assert.match(workingStateFacts(s), /방금 찾은 지난 대화: 팔식당 분석, 청담 회식 후보/);
});

// ── 풀기 ────────────────────────────────────────────────────────────────
test('새 대상을 다루면 이전 대상은 현재 자리에서 물러난다', () => {
  const s = run([
    { receipts: [webReceipt('https://a.example/1', '팔식당')] },
    { receipts: [webReceipt('https://b.example/2', '다른 가게')] },
  ]);
  const facts = workingStateFacts(s);
  assert.match(facts, /방금 읽은 자료: 다른 가게/);
  assert.doesNotMatch(facts, /방금 읽은 자료: 팔식당/, '이전 대상이 현재를 계속 주장하면 안 된다');
  assert.match(facts, /앞서 다룬 것: 팔식당\(1턴 전\)/, '사라지진 않는다 — 배경 사실로 남는다');
});

test('"아니 그거 말고" — 대상을 안 쓰는 턴이 이어지면 "방금"에서 내려온다(고집 금지)', () => {
  // 규칙(정규식)으로 부정을 잡지 않는다. 사실로 푼다 — 안 쓰이면 현재가 아니다(§24).
  const after1 = run([{ receipts: [webReceipt('https://a.example/1', '팔식당')] }, { receipts: [] }]);
  assert.match(workingStateFacts(after1), /방금 읽은 자료: 팔식당/, '바로 다음 턴까지는 "방금"이 맞다');

  const after2 = deriveWorkingState(after1, { receipts: [] });
  const facts = workingStateFacts(after2);
  assert.doesNotMatch(facts, /방금 읽은 자료/, '두 턴을 안 쓰면 더는 현재 대상이 아니다');
  assert.match(facts, /앞서 다룬 것: 팔식당\(2턴 전\)/, '몇 턴 전인지 정확히 말한다');
});

test('오래 안 쓰인 대상은 뷰에서 아예 내려간다(옛것이 영원히 현재인 척하지 않는다)', () => {
  let s = run([{ receipts: [webReceipt('https://a.example/1', '팔식당')] }]);
  for (let i = 0; i < 9; i += 1) s = deriveWorkingState(s, { receipts: [] });
  assert.equal(workingStateFacts(s), undefined, '아무 것도 안 남으면 블록 자체를 만들지 않는다');
});

test('실패한 실행은 대상이 되지 않고, 그 결과 내용도 사실로 올라가지 않는다', () => {
  const s = run([{
    receipts: [{
      failureState: 'blocked',
      actualCall: { tool: 'web.collect', args: { request: 'https://x.example' } },
      result: { title: '엉뚱한 페이지', markdown: '이걸 근거로 답하면 안 된다' },
      sources: [{ sourceUrl: 'https://x.example', title: '엉뚱한 페이지' }],
    }],
    blocked: '그 사이트가 막아서 아는 범위로 답할까요?',
  }]);
  const facts = workingStateFacts(s);
  assert.doesNotMatch(facts, /엉뚱한 페이지/, '못 한 일의 내용물을 사실로 주면 모델이 그걸 근거로 답한다');
  assert.match(facts, /막혔던 것과 다음 길: 그 사이트가 막아서/, '막힌 이유와 다음 길은 다음 턴에도 기억한다');
});

test('막힌 뒤 다른 길로 성공하면 "막혔다"가 풀린다(되는 길을 찾았는데 막혔다고 하면 거짓이다)', () => {
  const s = run([
    { receipts: [{ failureState: 'blocked', actualCall: { tool: 'web.collect' } }], blocked: '막혔어요' },
    { receipts: [webReceipt('https://a.example/1', '팔식당')] },
  ]);
  assert.doesNotMatch(workingStateFacts(s), /막혔던 것/);
});

// ── 크기 (실측 근거) ────────────────────────────────────────────────────
test(`이 블록이 프롬프트를 삼키지 않는다(상한 ${MAX_FACTS_CHARS}자 — 실측 558자의 두 배)`, () => {
  const many = Array.from({ length: 5 }, (_, i) =>
    webReceipt(`https://long.example/${i}`, '아주 긴 제목'.repeat(40),
      Array.from({ length: 8 }, (_, j) => `https://long.example/${i}/${'경로'.repeat(30)}${j}`)));
  const s = run(many.map((r) => ({ receipts: [r] })));
  const facts = workingStateFacts(s);
  assert.ok(facts.length <= MAX_FACTS_CHARS, `${facts.length}자 — 이 뷰가 커지면 정작 대화 이력이 밀려난다`);
  assert.match(facts, /방금 읽은 자료/, '잘리더라도 현재 대상은 남아야 한다(오래된 쪽부터 버린다)');
});

test('상태가 없으면 아무 것도 지어내지 않는다', () => {
  assert.equal(workingStateFacts(null), undefined);
  assert.equal(workingStateFacts(deriveWorkingState(null, {})), undefined);
});

test('배경 목록에 같은 이름을 두 번 쓰지 않는다(모델이 서로 다른 둘로 읽는다)', () => {
  // 라이브 실측: 한 가게의 홈과 리뷰 페이지가 "팔식당 : 네이버(2턴 전), 팔식당 : 네이버(3턴 전)"으로 찍혔다.
  let s = run([
    { receipts: [webReceipt('https://m.place.naver.com/restaurant/1/home', '팔식당 : 네이버')] },
    { receipts: [webReceipt('https://m.place.naver.com/restaurant/1/review/visitor', '팔식당 : 네이버')] },
  ]);
  s = deriveWorkingState(s, { receipts: [] });
  s = deriveWorkingState(s, { receipts: [] });
  const older = workingStateFacts(s).match(/앞서 다룬 것: (.*)/)[1];
  assert.equal(older.split(',').length, 1, `같은 이름이 두 번 나온다: ${older}`);
});

// P6-W3 ③ · **찾은 자리는 다음 걸음의 자리다.**
// 라이브 실측: locate 가 `/Volumes/작업용SSD/2026 정산자료` 를 정확히 짚었는데 그 사실이
// 상태에 안 남아서, 다음 손(터미널)이 어디를 볼지 모른 채 같은 자리를 여러 번 훑었다.
// 찾아 놓고 안 이어주면 사용자에게 "경로를 알려주세요"로 새는 바로 그 구조다.
test('찾은 자리가 다음 걸음의 자리로 이어진다(터미널이 거기서 이어서 한다)', () => {
  const 찾음 = {
    actualCall: { tool: 'local.locate', args: { what: '정산 자료', from: '작업용SSD' } },
    failureState: 'none',
    result: { candidates: [{ path: '/볼륨/작업용SSD/2026 정산자료', confidence: 'high' }] },
  };
  const st = deriveWorkingState(null, { receipts: [찾음] });
  const facts = workingStateFacts(st);
  assert.match(facts, /지금 자리: \/볼륨\/작업용SSD\/2026 정산자료/,
    `찾은 자리가 "지금 자리"로 안 올라가면 다음 손이 어디서 할지 모른다:\n${facts}`);
  assert.match(facts, /방금 찾은 자리/, `찾았다는 사실이 안 남는다:\n${facts}`);
});

test('확신 없는 후보는 자리라고 말하지 않는다(아닌 것을 사실로 올리지 않는다)', () => {
  const 애매 = {
    actualCall: { tool: 'local.locate' }, failureState: 'none',
    result: { candidates: [{ path: '/어딘가/그냥폴더', confidence: 'low' }] },
  };
  const st = deriveWorkingState(null, { receipts: [애매] });
  assert.equal(workingStateFacts(st), undefined, '낮은 후보를 현재 자리로 올리면 다음 턴이 오염된다');
});

// **줄 선 말이 보인다** (비교군 정밀분석 §3 처방1 · 2026-08-13).
//
// 서버는 **이미** 한 세션의 턴을 줄 세운다(`server.js` `withSessionQueue`). 안 깨진다.
// **없던 것은 그 사실을 말하는 화면뿐이었다** — 답이 흐르는 중에 말을 보내면 두 번째
// 「요청을 이해하고 있어요…」가 서고 「멈추기」가 둘이 됐다. 사람은 자기 말이 먹힌 건지
// 줄 서 있는 건지 알 길이 없었다. 조각 D 와 같은 병이다: **있는 사실을 화면이 안 말했다.**
//
// 오픈클로는 이 자리에 모드 넷을 둔다(`concepts/queue-steering.md`).
// T5 가 지금 하는 것은 그중 `followup` 이다 — 이 검사가 무는 것은
// **「하는 것을 그대로 말하는가」**다. 안 하는 것(끼워 넣기)을 한다고 말하면 그게 거짓이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
const submit = (() => {
  const at = html.indexOf('async function submit() {');
  if (at < 0) return '';
  const 뒤 = html.slice(at);
  return 뒤.slice(0, 뒤.indexOf('\n}') + 2);
})();

test('submit 을 찾았다 — 없으면 아래가 아무것도 못 지킨다', () => {
  assert.ok(submit.length > 0, 'submit 을 못 찾았다');
});

test('앞의 답이 흐르는 중이면 **줄 서 있다고 말한다**', () => {
  assert.match(submit, /const 앞선것 = \[\.\.\.document\.querySelectorAll\('\.stopbtn'\)\]\.some\(\(b\) => !b\.disabled\)/,
    '지금 도는 턴이 있는지는 살아 있는 멈춤 버튼으로 안다(새 상태를 안 만든다)');
  assert.match(submit, /앞의 답이 끝나면 이어서 할게요 — 줄 서 있어요/,
    '줄 선 사실을 사용자 언어로 말해야 한다 — 침묵하면 먹힌 건지 모른다');
});

// ★ 이 검사가 알맹이다. 안 도는 것에 도는 표시를 남기면 화면이 거짓말을 한다.
test('줄 서 있는 것과 취소된 것에는 **도는 표시를 안 남긴다**', () => {
  assert.match(html, /\.trace\.queued::before \{ animation:none;/,
    '뛰는 점은 「지금 일하는 중」이라는 뜻이다 — 줄 서 있는 것은 일하고 있지 않다');
  assert.match(html, /\.trace\.still::before \{ display:none; \}/,
    '취소된 줄에 도는 점이 남으면 안 보내진 것이 도는 것처럼 보인다');
  assert.match(submit, /trace\.className = 'trace still';/, '취소되면 도는 조를 벗는다');
});

test('줄 서 있는 동안 버튼은 「멈추기」가 아니라 「차례 취소」다 — 죽은 버튼 금지', () => {
  assert.match(submit, /멈춤\.textContent = 앞선것 \? '차례 취소' : '멈추기';/,
    '아직 아무것도 안 돌고 있는데 「멈추기」를 주면 누를 것이 없는 버튼이다');
  assert.match(submit, /if \(멈춤\.textContent === '차례 취소'\) \{/, '취소 갈래가 따로 있어야 한다');
});

test('차례 취소는 **서버를 안 부른다** — 아직 아무것도 안 돌고 있다', () => {
  const 취소 = submit.slice(submit.indexOf("if (멈춤.textContent === '차례 취소')"),
    submit.indexOf("멈춤.disabled = true; 멈춤.textContent = '멈추는 중…';"));
  assert.ok(취소.length > 0, '취소 갈래를 못 찾았다');
  assert.doesNotMatch(취소, /fetch\(/, '안 돌고 있는 것을 서버에 멈추라고 하면 거짓 요청이다');
  assert.match(취소, /입력칸에얹기\(t\);/,
    '사람의 말을 버리지 않는다 — 취소는 삭제가 아니다(조각 B 와 같은 규율)');
});

test('취소했으면 **스트림을 아예 시작하지 않는다**', () => {
  assert.match(submit, /if \(취소됨\) \{ 멈춤치우기\(\); return; \}/,
    '취소한 뒤에도 streamTurn 으로 내려가면 취소가 취소가 아니다');
  assert.match(submit, /while \(앞선것 && !취소됨 &&/,
    '먼저 화면에서 기다려야 「차례 취소」가 진짜 취소가 된다 — 서버로 떠난 것은 못 물린다');
});

test('차례가 오면 **줄 섰다는 말을 거둔다** — 낡은 문구를 남기지 않는다', () => {
  assert.match(submit, /if \(앞선것\) \{ trace\.textContent = '요청을 이해하고 있어요…'; trace\.classList\.remove\('queued'\); 멈춤\.textContent = '멈추기'; \}/,
    '차례가 왔는데 「줄 서 있어요」가 남아 있으면 화면이 낡은 사실을 말한다');
});

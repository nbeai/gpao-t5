// 텔레그램 서식 투영(오너 실사용 보고 2026-07-29) — 마크다운 부호가 사용자에게 그대로
// 도착했다. 변환은 channel-sender 한 곳(단일 변환 경계): 승인 전송·채널 자동 답장 공통.
// 계약: ① 지원 서식은 HTML 로 ② 나머지는 안전 이스케이프 ③ HTML 거부 시 순수 문자로
// 정확히 한 번 후퇴(서식보다 전달이 먼저다) ④ 보낸 척 금지 유지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTelegramHtml, stripMarkdownForChat, makeChannelSender } from '../src/runtime/channel-sender.js';

test('마크다운 → 텔레그램 HTML: 굵게·기울임·코드·목록·헤더·링크', () => {
  assert.equal(toTelegramHtml('**굵게** 그리고 *기울임*'), '<b>굵게</b> 그리고 <i>기울임</i>');
  assert.equal(toTelegramHtml('`kill -9` 실행'), '<code>kill -9</code> 실행');
  assert.equal(toTelegramHtml('- 첫째\n* 둘째'), '· 첫째\n· 둘째');
  assert.equal(toTelegramHtml('## 요약'), '<b>요약</b>');
  assert.equal(toTelegramHtml('[문서](https://a.b/c)'), '<a href="https://a.b/c">문서</a>');
  assert.equal(toTelegramHtml('합계 224,000원 <검증>'), '합계 224,000원 &lt;검증&gt;');
  assert.equal(toTelegramHtml('```\nconst a = 1 < 2;\n```'), '<pre>const a = 1 &lt; 2;</pre>');
});

test('순수 문자 후퇴: 부호 제거, 내용 보존', () => {
  assert.equal(stripMarkdownForChat('**굵게** `코드` [문서](https://a.b/c)'), '굵게 코드 문서 (https://a.b/c)');
  assert.equal(stripMarkdownForChat('- 항목 *하나*'), '· 항목 하나');
});

function 가짜텔레그램(응답들) {
  const 요청 = [];
  return {
    요청,
    fetch: async (_url, opts) => {
      요청.push(JSON.parse(opts.body));
      const r = 응답들[Math.min(요청.length - 1, 응답들.length - 1)];
      return { status: r.status, json: async () => r.json };
    },
  };
}

test('전송은 HTML parse_mode 로 나간다', async () => {
  const tg = 가짜텔레그램([{ status: 200, json: { ok: true } }]);
  const hand = makeChannelSender({ channel: 'telegram', token: 't', fetchImpl: tg.fetch });
  const r = await hand.handler({ text: '**굵게** 확인', target: '1' });
  assert.equal(r.result?.sent, true);
  assert.equal(tg.요청.length, 1);
  assert.equal(tg.요청[0].parse_mode, 'HTML');
  assert.equal(tg.요청[0].text, '<b>굵게</b> 확인');
});

test('HTML 거부(400 parse) → 순수 문자로 정확히 한 번 후퇴, 전달 사실 유지', async () => {
  const tg = 가짜텔레그램([
    { status: 400, json: { ok: false, description: "Bad Request: can't parse entities" } },
    { status: 200, json: { ok: true } },
  ]);
  const hand = makeChannelSender({ channel: 'telegram', token: 't', fetchImpl: tg.fetch });
  const r = await hand.handler({ text: '**굵게** 확인', target: '1' });
  assert.equal(r.result?.sent, true, `후퇴가 전달을 살리지 못했다: ${JSON.stringify(r)}`);
  assert.equal(tg.요청.length, 2);
  assert.equal(tg.요청[1].parse_mode, undefined, '후퇴에 parse_mode 가 남았다');
  assert.equal(tg.요청[1].text, '굵게 확인');
});

test('서식과 무관한 거부(권한 등)는 후퇴 없이 정직하게 실패로 남는다', async () => {
  const tg = 가짜텔레그램([{ status: 403, json: { ok: false, description: 'Forbidden: bot was blocked' } }]);
  const hand = makeChannelSender({ channel: 'telegram', token: 't', fetchImpl: tg.fetch });
  const r = await hand.handler({ text: '안녕', target: '1' });
  assert.ok(!r.result?.sent, '거부됐는데 보냈다고 했다');
  assert.equal(tg.요청.length, 1, '무관한 실패에 후퇴 재시도가 나갔다');
});

// **웹 손 검사** — 도구가 호출됐나가 아니라 **사용자 목적이 끝났나**를 잰다.
//
// ── 왜 이 대본이 따로 있나 ──────────────────────────────────────────────────
// 오너 정의(2026-08-13): *"내가 말하는 손은 기능이 아니라 **기능과 성능의 조합**이야.
// 더하기가 아니라 곱하기이고 함수이지. … **특정 영역의 일만 잘 할 수 있다면 그건 손이
// 아니라 로봇팔인거다.**"*
//
// 그래서 검사 단위가 넷으로 갈린다. 앞의 셋이 다 초록이어도 넷째가 빨강이면 **손은 빨강**이다.
// ```
// 배선 검사   도구가 호출됐다
// 원장 검사   영수증이 생겼다
// 관절 검사   동작이 실행됐다
// 손  검사   **사용자 목적이 정확한 결과로 끝났다**   ← 이 대본이 재는 것
// ```
// 오너가 밟은 그 턴이 정확히 이 틈이었다 — `web.collect` 5회 + `browser.observe` 3회가
// **전부 `failureState:'none'`**(코드 기준 여덟 번 성공)인데 사용자는 리뷰 분석을 못 받았다.
//
// ── 어떻게 재나 ────────────────────────────────────────────────────────────
// 요구마다 **답에 있어야 할 것을 기계로 셀 수 있는 형태**로 적는다. 답의 좋고 나쁨은 안 잰다 —
// 「요구된 것이 거기 있는가」만 본다. 못 세는 요구는 이 대본에 넣지 않는다(빈 측정 금지 · F-105).
//
// ── 자가 틀린 이력 (2026-08-13, 같은 날 세 번) ─────────────────────────────
// ① 답 끝의 *"더 필요하면 말해줘"* 를 「떠넘김」으로 세서 **달성한 회차 둘을 미달로** 찍었다.
// ② 브라우저를 안 물린 채 재고 「브라우저로 안 넘어간다」고 적을 뻔했다(손이 아예 없었다).
// ③ 「안 멈췄다」를 「해냈다」로 읽었다.
// 그래서 이 대본은 **양성 대조를 먼저 돌린다** — 자가 무는 것을 보이고 나서 잰다.
import { homedir } from 'node:os';
import { realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { 방하나, readCredential } from './h04-memory-round.mjs';

const 웹손 = ['web.search', 'web.collect', 'browser.observe', 'browser.act'];

/**
 * 요구 목록 — **영역의 폭**을 깐다. 한 사건이 아니다.
 *
 * 사용자가 웹에 대고 하는 요구는 검색·리서치·주소분석·정보수급·버튼·입력 무엇이든이다.
 * 그 폭에서 어디가 끊기는지를 봐야 「웹 손」을 판정할 수 있다.
 */
export const 요구들 = [
  {
    id: 'w01-검색', 말: '요즘 국산 전기차 중에 주행거리 제일 긴 게 뭐야?',
    // 차 이름 + 숫자(km) 가 있어야 답이다. 어느 차인지는 안 묻는다 — 커널은 알맹이를 안 잰다.
    잰다: (a) => ({ 값: `km 수치 ${(a.match(/\d{3,}\s*km/gi) ?? []).length}개`, 됐나: /\d{3,}\s*km/i.test(a) }),
  },
  {
    id: 'w02-비교', 말: '아이폰 17이랑 갤럭시 S26 카메라 비교해서 정리해줘.',
    잰다: (a) => {
      const 둘다 = /아이폰|iPhone/i.test(a) && /갤럭시|Galaxy|S26/i.test(a);
      const 수치 = (a.match(/\d+\s*(MP|만 ?화소|배|mm|f\/)/gi) ?? []).length;
      return { 값: `양쪽 ${둘다} · 수치 ${수치}`, 됐나: 둘다 && 수치 >= 4 };
    },
  },
  {
    id: 'w03-주소분석', 말: 'https://ko.wikipedia.org/wiki/대한민국 이 링크 뭐 담고 있는지 알려줘.',
    잰다: (a) => ({ 값: `${a.length}자`, 됐나: a.length > 200 && /대한민국|한국/.test(a) }),
  },
  {
    id: 'w04-페이지요약', 말: 'https://news.naver.com/section/105 이 페이지 지금 뭐 떠 있어?',
    잰다: (a) => {
      const 항 = a.split('\n').filter((l) => /^\s*(\d+[.)]|[-*•])\s*\S/.test(l)).length;
      return { 값: `항목 ${항}개`, 됐나: 항 >= 3 };
    },
  },
  {
    id: 'w05-동적리뷰', 말: '청담 팔식당 네이버 플레이스 리뷰 분석해줘.',
    // **오너가 밟은 그 문장.** 플레이스는 JS 로 그리고 봇을 막는다 — 정적 수집으로는 껍데기다.
    // 리뷰 분석이면 리뷰에서 나온 **구체 표현**이 있어야 하고, 사용자에게 되넘기면 미달이다.
    잰다: (a) => {
      const 떠넘김 = /복사해서|붙여 ?주|직접 (열어|들어가)|리뷰 (원문|몇 개)만? ?(붙여|알려)/.test(a);
      const 인용 = (a.match(/["“][^"”]{6,}["”]/g) ?? []).length;
      const 항목 = /장점|단점|불만|칭찬|재방문|긍정|부정/.test(a);
      return { 값: `인용 ${인용} · 항목 ${항목} · 떠넘김 ${떠넘김}`, 됐나: !떠넘김 && 항목 && 인용 >= 2 };
    },
  },
  {
    id: 'w06-사이트내검색', 말: '네이버에서 "전기차 보조금" 검색해서 첫 페이지 결과 알려줘.',
    잰다: (a) => {
      const url = (a.match(/https?:\/\/\S+/g) ?? []).length;
      const 항 = a.split('\n').filter((l) => /^\s*\d+[.)]/.test(l)).length;
      return { 값: `결과 ${항} · URL ${url}`, 됐나: 항 >= 3 && url >= 2 };
    },
  },
  {
    id: 'w07-대량수집', 말: 'https://news.naver.com/section/105 여기 기사 제목 20개 이상 모아줘.',
    잰다: (a) => {
      const 줄 = a.split('\n').filter((l) => /^\s*(\d+[.)]|[-*•])\s*\S/.test(l)).length;
      return { 값: `제목 ${줄}개`, 됐나: 줄 >= 20 };
    },
  },
  {
    id: 'w08-차단면', 말: '쿠팡에서 무선이어폰 인기 상품 값 알려줘.',
    잰다: (a) => {
      const 값 = (a.match(/\d{1,3}[,.]?\d{3}\s*원/g) ?? []).length;
      return { 값: `가격 ${값}개`, 됐나: 값 >= 3 };
    },
  },
  {
    id: 'w09-다출처', 말: '서울 근교 당일치기 여행지 세 곳, 최근 후기 근거로 추천해줘.',
    잰다: (a) => {
      const 곳 = a.split('\n').filter((l) => /^\s*\d+[.)]\s*\S/.test(l)).length;
      return { 값: `장소 ${곳}개`, 됐나: 곳 >= 3 };
    },
  },
  {
    id: 'w10-실시간값', 말: '지금 원달러 환율 얼마야?',
    잰다: (a) => {
      const m = a.match(/1[,.]?[2-5]\d{2}(\.\d+)?\s*원/);
      return { 값: m ? m[0] : '숫자 없음', 됐나: Boolean(m) };
    },
  },
];

/**
 * **양성 대조** — 자가 무는지 먼저 보인다(F-104 규율).
 *
 * 이게 없으면 「0 달성」이 「정말 못 했다」인지 「자가 눈이 멀었다」인지 못 가른다.
 * 실제로 이 대본의 앞판이 그 모양으로 세 번 틀렸다.
 */
export function 양성대조() {
  const 판 = [
    ['w10 이 진짜 환율을 잡는가', 'w10-실시간값', '지금 원달러 환율은 1,416.21원입니다.', true],
    ['w10 이 빈 답을 안 잡는가', 'w10-실시간값', '환율은 은행마다 다릅니다.', false],
    ['w05 가 떠넘김을 잡는가', 'w05-동적리뷰', '리뷰 원문 몇 개만 붙여 주면 장점·단점을 분석해 드릴게요.', false],
    ['w05 가 진짜 분석을 통과시키는가', 'w05-동적리뷰',
      '장점은 "고기 질이 좋아요" 92명, "친절해요" 87명으로 모였고 단점은 가격입니다.', true],
  ];
  const 줄 = [];
  let 어긋남 = 0;
  for (const [이름, id, 답, 기대] of 판) {
    const 실제 = 요구들.find((q) => q.id === id).잰다(답).됐나;
    if (실제 !== 기대) 어긋남 += 1;
    줄.push(`  ${실제 === 기대 ? '✔' : '✘'} ${이름} — 기대 ${기대} · 실제 ${실제}`);
  }
  return { 줄, 어긋남 };
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.includes('--run')) throw new Error('--run 없이는 모델을 호출하지 않는다');
  const 고른 = argv.filter((a) => !a.startsWith('--'));
  const 출력 = argv.includes('--output') ? argv[argv.indexOf('--output') + 1] : null;

  // **자를 먼저 보인다.** 어긋나면 회차를 아예 돌리지 않는다 — 못 믿을 자로 잰 값은 값이 아니다.
  const 대조 = 양성대조();
  process.stdout.write(`── 양성 대조 ──\n${대조.줄.join('\n')}\n`);
  if (대조.어긋남) throw new Error(`양성 대조 ${대조.어긋남}건 어긋남 — 이 자로는 재지 않는다`);

  const credential = readCredential(await realpath(homedir()));
  const 회차 = [];
  for (const q of 요구들) {
    if (고른.length && !고른.some((c) => q.id.startsWith(c))) continue;
    let 방;
    try {
      방 = await 방하나(credential, false, 웹손);
      const s = await 방.새세션();
      const r = await 방.post('/turn', { sessionId: s, text: q.말 });
      const 답 = String(r.result?.reply ?? r.reply ?? '');
      const 원장 = await 방.세션원장(s);
      const 손 = 원장.filter((e) => e?.actualCall?.tool).map((e) => ({
        tool: e.actualCall.tool,
        상태: e.result?.읽은상태 ?? (e.result?.observation?.thin ? 'thin' : (e.result?.blocked ? 'blocked' : 'ok')),
        실패: e.failureState ?? 'none',
      }));
      const v = q.잰다(답);
      // **코드 기준 성공과 사용자 기준 성공을 나란히 적는다** — 그 틈이 이 대본의 존재 이유다.
      const 코드성공 = 손.length > 0 && 손.every((h) => h.실패 === 'none');
      회차.push({ id: q.id, 말: q.말, 코드성공, 목적달성: v.됐나, 잰값: v.값, 손, 답 });
      process.stdout.write(`${q.id.padEnd(16)} ${v.됐나 ? '달성' : '★미달'} | 코드성공 ${코드성공 ? 'O' : 'X'} | ${v.값.padEnd(26)} | ${손.map((h) => h.tool.replace(/^(web|browser|local|desktop)\./, (m) => m[0] + '.') + (h.상태 === 'ok' ? '' : `:${h.상태}`)).join(' ')}\n`);
    } catch (e) {
      회차.push({ id: q.id, 터짐: e.message });
      process.stdout.write(`${q.id.padEnd(16)} ★터짐 ${e.message.slice(0, 60)}\n`);
    } finally { if (방) await 방.close(); }
  }

  const 잰것 = 회차.filter((x) => !x.터짐);
  const 달성 = 잰것.filter((x) => x.목적달성).length;
  const 틈 = 잰것.filter((x) => x.코드성공 && !x.목적달성);
  process.stdout.write(`\n── 손 검사 ──\n목적 달성 ${달성}/${잰것.length}\n`);
  process.stdout.write(`**코드는 성공인데 목적은 실패** ${틈.length}건${틈.length ? `: ${틈.map((x) => x.id).join(' · ')}` : ''}\n`);
  if (출력) {
    await writeFile(resolve(출력), JSON.stringify({ 양성대조: 대조.줄, 회차 }, null, 2), 'utf8');
    process.stdout.write(`덤프: ${resolve(출력)}\n`);
  }
}

if (process.argv[1] && (await realpath(process.argv[1])) === (await realpath(new URL(import.meta.url).pathname))) {
  await main();
}

// 사슬 분석기 — J12 2차 **발동 실측 전용**. 정오는 재지 않는다.
//
// 왜 정오를 안 재나(감시자 조정 5): 정오 규칙은 `채점기.mjs` 하나뿐이어야 한다.
// 여기서 정오를 자체 구현하면 채점기 **밖에** 두 번째 자가 생기고, 그것이 바로
// 「같은 관대화 3회」의 문을 다시 여는 모양이다. 이 파일은 세 가지만 센다:
//   ① 재생성(계약말 주입) 발동 수 / 총 턴 수
//   ② 주입 계약말 원문 — **직전 요청 대비 새로 늘어난 메시지 전량 diff** 에서 뽑는다
//      (마지막 메시지만 훑으면 놓친다 · 미검출도 결과로 적는다 — 없는 것을 만들지 않는다)
//   ③ 최종답이 첫 생성인지 · 재생성인지 · 어느 쪽도 아닌지 (문자열 대조)
//
// 사람 분류 0. 전부 문자열 대조다.
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'docs/03-verification/evidence/terminal-2026-08-15/J12-요청사슬';
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

const 정규화 = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const 본문 = (응답) => 정규화(응답?.choices?.[0]?.message?.content);
const 도구들 = (응답) => (응답?.choices?.[0]?.message?.tool_calls ?? []).map((c) => c.function?.name);
const 메시지키 = (m) => `${m.role}|${정규화(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 400)}`;

// 주입 계약말 후보 — 커널이 모델에게 「다시 써라」고 넣는 말의 서명(turn.js 실물에서 옮김).
// 못 찾으면 못 찾았다고 적는다. 새 서명이 생기면 미검출로 드러난다.
const 주입서명 = [/목적에 (아직 )?안 닿/, /방금 답은/, /다시 (답|써)/, /완료를 뒷받침/, /원장에 실제로/];

const 표 = [];
for (const f of files) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  const 사슬 = j.사슬 ?? [];
  const 최종답들 = (j.회차들 ?? []).map((r) => 정규화(r.답));
  const 발화들 = (j.회차들 ?? []).map((r) => r.오너);

  // 생성 요청 = 도구 없이 글을 낸 요청. 그중 앞선 생성 요청과 **직전 메시지 집합이 겹치는데
  // 계약말이 새로 낀 것**이 재생성이다.
  let 앞메시지 = new Set();
  const 생성들 = [];
  for (const 고리 of 사슬) {
    const msgs = (고리.요청?.messages ?? []).map(메시지키);
    const 새로온것 = msgs.filter((k) => !앞메시지.has(k));
    앞메시지 = new Set(msgs);
    const 글 = 본문(고리.응답);
    const 주입 = 새로온것.filter((k) => 주입서명.some((re) => re.test(k)));
    if (글) 생성들.push({ 순번: 고리.순번, 글, 주입, 새로온것수: 새로온것.length });
    else if (주입.length) 생성들.push({ 순번: 고리.순번, 글: null, 주입, 도구: 도구들(고리.응답) });
  }

  const 재생성들 = 생성들.filter((g) => g.주입.length);
  // 최종답이 어느 생성의 산출인가 — 문자열 대조(포함 관계까지 본다: 렌더가 다듬을 수 있다).
  const 판정 = 최종답들.map((답) => {
    if (!답) return '답 없음';
    const 일치 = 생성들.filter((g) => g.글 && (g.글 === 답 || g.글.includes(답) || 답.includes(g.글)));
    if (!일치.length) return '어느 생성과도 불일치';
    const 재생성인가 = 일치.every((g) => g.주입.length);
    const 첫생성인가 = 일치.every((g) => !g.주입.length);
    return 재생성인가 ? '재생성 채택' : 첫생성인가 ? '첫 생성 채택' : '혼재';
  });

  표.push({
    파일: f.slice(11, 19),
    발화수: 발화들.length,
    발화: 발화들.map((t) => String(t).slice(0, 22)).join(' / '),
    사슬길이: 사슬.length,
    생성요청: 생성들.length,
    재생성: 재생성들.length,
    주입원문: 재생성들.flatMap((g) => g.주입.map((k) => k.replace(/^\w+\|/, '').slice(0, 110))),
    최종답판정: 판정,
  });
}

console.log('── 회차별 (발동 실측 전용 · 정오는 채점기 소관) ──');
for (const r of 표) {
  console.log(`${r.파일}  턴${r.발화수} 사슬${r.사슬길이} 생성${r.생성요청} 재생성${r.재생성}  ${r.최종답판정.join(' · ')}`);
  console.log(`          발화: ${r.발화}`);
  for (const p of r.주입원문) console.log(`          ↳ 주입: ${p}`);
}

const 총턴 = 표.reduce((s, r) => s + r.발화수, 0);
const 총재생성 = 표.reduce((s, r) => s + r.재생성, 0);
const 판정셈 = {};
for (const r of 표) for (const p of r.최종답판정) 판정셈[p] = (판정셈[p] ?? 0) + 1;
console.log(`\n합계: 사슬 ${표.length}개 · 총 턴 ${총턴} · 재생성 발동 ${총재생성}턴`);
console.log(`최종답 출처: ${Object.entries(판정셈).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
if (!총재생성) console.log('※ 주입 서명 미검출 — 서명 목록이 낡았을 수 있다. 없는 것을 만들지 않는다.');

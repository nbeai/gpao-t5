// ⚠️⚠️⚠️ 무효 — 이 계측기의 결과를 인용하지 마라 ⚠️⚠️⚠️
//
// 판별 문자열 «[이번 턴 실행 사실] 없음» 은 도구 결과를 받은 요청 60건 **전부**에 나타나는
// 상수였다(정합 0건 · 자기 정정). 판별력이 없으므로 이 도구가 만든 표(「16회 전부 :2822」류)는
// **전부 버려졌다.** 파일은 자기 정정의 기록으로만 남긴다 — 다시 돌려도 같은 이유로 무효다.
//
// 무효 판정 정본:
//   docs/03-verification/evidence/terminal-2026-08-15/기준선과-남은자리.md §7-n
//   design/NEXT-SESSION.md §3-10 「무효·폐기 확정 — 다시 파지 마라」
//   docs/03-verification/evidence/terminal-2026-08-16/유산감사-2026-08-16.md (경고 부재 지적)
//
// ─────────────────────────────────────────────────────────────────────────────
// (아래는 원문 그대로 — 코드 로직 불변)
//
// 귀속표 — 재생성(되부름) 발동을 **호출부별로 전수 귀속**한다. J12 3차 선등록의 분자를 만든다.
//
// 왜 필요한가(감시자 검문 2026-08-15): 되부름 계약말은 turn.js:2908 **한 벌을 공유**하므로
// 사슬분석기가 센 「발동 16」은 세 호출부의 합계다. 표적(:2828)의 몫을 모르면 「내려간다」의
// 바닥이 미지수이고, 결과를 본 뒤 문턱을 고르는 구멍이 열린다.
//
// 귀속은 **요청 본문의 기계 사실**로만 한다(사람 분류 0):
//   :2822 한걸음도안뗐다  — 재생성 요청에 "[이번 턴 실행 사실] 없음" (그 턴 도구 0건)
//   :2828 걸음이말하는미달 — 실행 사실이 있는데 "안 써 본 손" 이 섰다
//   :2740 목적에안닿은답  — "안 연 후보"·"더 볼 자리" 계열(candidatesUnopened·searchNotExhausted)
// 어느 서명도 안 맞으면 「귀속 불가」로 적는다 — 없는 것을 만들지 않는다.
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'docs/03-verification/evidence/terminal-2026-08-15/J12-요청사슬';
const 계약말 = /목적에 (아직 )?안 닿|방금 답은/;

const 셈 = { ':2822 걸음0': 0, ':2828 걸음있음': 0, ':2740 후보·얕은찾기': 0, '귀속 불가': 0 };
const 셀 = {};   // 발화별

for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  const 발화 = (j.회차들 ?? []).map((r) => String(r.오너)).join(' / ');
  const 셀키 = String(j.회차들?.[0]?.오너 ?? '?').slice(0, 24) + (j.회차들?.length > 1 ? ' (2턴쌍)' : '');
  셀[셀키] ??= { 사슬: 0, 발동: 0, 귀속: {} };
  셀[셀키].사슬 += 1;

  for (const 고리 of j.사슬 ?? []) {
    const msgs = 고리.요청?.messages ?? [];
    if (!msgs.some((m) => 계약말.test(String(m.content ?? '')))) continue;
    const sys = msgs.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
    const 실행사실없음 = /\[이번 턴 실행 사실\] 없음/.test(sys);
    const 안써본손 = /한 번도 안 써 본 손/.test(sys);
    const 후보계열 = /안 연 후보|더 볼 자리|찾기를 다 하지|넓혀|후보를 열지/.test(sys);

    let 귀속;
    if (후보계열) 귀속 = ':2740 후보·얕은찾기';
    else if (안써본손 && 실행사실없음) 귀속 = ':2822 걸음0';
    else if (안써본손) 귀속 = ':2828 걸음있음';
    else 귀속 = '귀속 불가';

    셈[귀속] += 1;
    셀[셀키].발동 += 1;
    셀[셀키].귀속[귀속] = (셀[셀키].귀속[귀속] ?? 0) + 1;
    console.log(`${f.slice(11, 19)} 요청${고리.순번}  ${귀속}   ${발화.slice(0, 40)}`);
  }
}

console.log('\n── 호출부 귀속 전수 ──');
for (const [k, v] of Object.entries(셈)) console.log(`  ${k}: ${v}회`);
console.log('\n── 발화 셀별 (원자수 · 비율 금지) ──');
for (const [k, v] of Object.entries(셀)) {
  const 내역 = Object.entries(v.귀속).map(([a, b]) => `${a} ${b}`).join(' · ') || '발동 없음';
  console.log(`  ${k}  사슬 ${v.사슬} · 발동 ${v.발동}  [${내역}]`);
}

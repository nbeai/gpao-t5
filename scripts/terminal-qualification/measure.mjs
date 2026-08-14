// **자(尺).** 오너 선언(2026-08-14): *"유일한 감사는 실제 콘솔 라이브 결과다."*
// 사람 감사는 폐지됐다. 그러니 이 파일이 T5 의 유일한 자다 — **자가 헐거우면 전부 거짓이 된다.**
// (`재는 자가 틀리면 재는 것이 전부 거짓이다` · 2026-08-12)
//
// 회차마다 **같은 자 다섯**을 잰다:
//   ① 사용자 개입 횟수     승인 카드 · 되묻기 · 대본의 유도 갈래 · "직접 하세요" 떠넘김
//   ② 실물이 생겼나
//   ③ 원본 불변
//   ④ 사용자가 결과 자리를 아는가
//   ⑤ **어디서 멈췄나** — 손 고름 → 실행 → 실물 → 내용 → 자리 고지
//
// ⑤가 핵심이다. 오너 확정: **「만점 아니면 빵점」은 완료 선언에만 쓰고, 진단 기록에는 어디서
// 멈췄는지를 남긴다.** 2026-08-14 라이브 6회가 전부 빵점이었는데 그 안의 「셸은 됐고 파일에서
// 멈췄다」가 결함 위치를 짚은 유일한 단서였다.

/** 원장 한 줄에서 채점이 보는 것만 꺼낸다(원문은 따로 통째로 보존한다). */
export function 영수증정리(원장 = []) {
  return 원장.filter((e) => e?.actualCall?.tool).map((e) => ({
    tool: e.actualCall.tool,
    action: e.actualCall.args?.action ?? e.actualCall.args?.op ?? null,
    path: e.actualCall.args?.path ?? e.result?.path ?? null,
    command: e.actualCall.args?.command ?? null,
    cwd: e.actualCall.args?.cwd ?? e.result?.cwd ?? null,
    failureState: e.failureState ?? null,
    failedBy: e.result?.failedBy ?? null,
    failReason: e.result?.failReason ?? null,
    exitCode: e.result?.exitCode ?? null,
    applied: e.result?.applied ?? null,
  }));
}

// 떠넘김 — **문구 판정이라 태생이 약하다.** 그래서 셋을 지킨다:
//   ① 「의심」이라고 부르고 ② 매칭된 원문을 그대로 남기고 ③ 다른 축과 섞지 않는다.
// 나중에 사람이 이 근거만 보고 다시 판정할 수 있어야 한다.
const 떠넘김패턴 = [
  /물리적으로\s*(못|불가|할 수 없)/,
  /직접\s*(해\s*주세요|하세요|하시|실행|열어|확인해)/,
  /사용자가?\s*직접/,
  /제가\s*(직접\s*)?(할 수 없|하지 못|접근할 수 없|실행할 수 없)/,
  /아래\s*명령(어)?을?\s*(복사|실행|붙여)/,
  /터미널에\s*(직접|아래)/,
];

export function 떠넘김의심(글) {
  const 문장 = String(글 ?? '');
  const 잡힌것 = [];
  for (const 패턴 of 떠넘김패턴) {
    const m = 문장.match(패턴);
    if (!m) continue;
    const 자리 = 문장.indexOf(m[0]);
    잡힌것.push(문장.slice(Math.max(0, 자리 - 30), 자리 + m[0].length + 30));
  }
  return 잡힌것;
}

/**
 * 다섯 축 + 멈춘칸.
 * @param {object} p
 * @param {object} p.과업        tasks.mjs 의 한 칸
 * @param {Array}  p.턴들        [{발화, 갈래, kind, reply, question}]
 * @param {Array}  p.영수증      영수증정리() 결과
 * @param {{새로생김:string[],변함:string[],사라짐:string[]}} p.대조
 * @param {object} p.새파일내용
 */
export function 채점({ 과업, 턴들, 영수증, 대조, 새파일내용 }) {
  const 마지막답 = [...턴들].reverse().find((t) => typeof t.reply === 'string' && t.reply.trim())?.reply ?? '';
  const 사실 = {
    마지막답,
    모든답: 턴들.map((t) => t.reply ?? t.question ?? '').join('\n'),
    영수증,
    터미널영수증: 영수증.filter((r) => r.tool === 'local.terminal'),
    새로생김: 대조.새로생김,
    새파일내용,
  };

  // ── ① 사용자 개입 ────────────────────────────────────────────────────────
  const 승인카드 = 턴들.filter((t) => t.kind === 'approval').length;
  const 되묻기 = 턴들.filter((t) => t.kind === 'clarify').length;
  const 유도갈래 = 턴들.filter((t) => t.갈래 === '유도').length;
  const 떠넘김 = 떠넘김의심(마지막답);
  const 개입 = {
    합: 승인카드 + 되묻기 + 유도갈래 + 떠넘김.length,
    승인카드, 되묻기, 유도갈래,
    떠넘김의심: 떠넘김.length,
    떠넘김근거: 떠넘김,
    // 대본 발화 자체는 개입이 아니다(설계상 예정된 것). **유도 갈래로 잡힌 것만** 비용이다.
    대본발화: 턴들.filter((t) => t.갈래).map((t) => ({ 갈래: t.갈래, 발화: t.발화 })),
  };

  // ── ② 실물 ──────────────────────────────────────────────────────────────
  const 실물 = { 새로생김: 대조.새로생김, 생겼나: 대조.새로생김.length > 0 };

  // ── ③ 원본 불변 ─────────────────────────────────────────────────────────
  const 원본불변 = { 지켜졌나: 대조.변함.length === 0 && 대조.사라짐.length === 0, 변함: 대조.변함, 사라짐: 대조.사라짐 };

  // ── ④ 자리 고지 ─────────────────────────────────────────────────────────
  //
  // **실물을 요구하는 과업에서는 실제로 생긴 파일 이름만 자리로 센다.** 과업 문장에 적힌
  // 이름(`순매출.tsv`)을 후보에 넣었더니, 파일을 하나도 안 만들고 *"표/순매출.tsv 에 넣었어요"*
  // 라고만 말한 회차가 이 축에서 PASS 를 받았다(가짜 상류 예행 2026-08-14). **없는 것의 자리는
  // 알릴 수 없다** — 그 자리는 사용자를 없는 파일로 보내는 거짓말이다.
  const 자리후보 = 과업.실물필요
    ? [...대조.새로생김, ...대조.새로생김.map((p) => p.split('/').pop())]
    : (과업.자리표현 ?? []);
  const 말한자리 = [...new Set(자리후보)].filter((w) => w && 마지막답.includes(w));
  const 자리고지 = { 알렸나: 말한자리.length > 0, 말한자리, 재본후보: [...new Set(자리후보)] };

  // ── 내용 ────────────────────────────────────────────────────────────────
  const 내용 = 과업.내용검사(사실);

  // ── ⑤ 어디서 멈췄나 ─────────────────────────────────────────────────────
  const 손고름 = 영수증.length > 0;
  // 「실행」은 **돈 것**이다. 막히거나(blocked) 시작조차 못 한 것은 아직 안 돈 것이다.
  const 돈영수증 = 영수증.filter((r) => r.failureState === 'none' && r.applied !== false);
  const 칸들 = [
    { 이름: '손고름', 상태: 손고름 ? 'PASS' : 'FAIL', 근거: `영수증 ${영수증.length}건` },
    { 이름: '실행', 상태: 돈영수증.length ? 'PASS' : 'FAIL', 근거: `실제로 돈 영수증 ${돈영수증.length}건` },
    과업.실물필요
      ? { 이름: '실물', 상태: 실물.생겼나 ? 'PASS' : 'FAIL', 근거: 대조.새로생김 }
      : { 이름: '실물', 상태: '해당없음', 근거: '이 과업은 파일을 요구하지 않는다' },
    { 이름: '내용', 상태: 내용.통과 ? 'PASS' : 'FAIL', 근거: 내용.근거 },
    { 이름: '자리고지', 상태: 자리고지.알렸나 ? 'PASS' : 'FAIL', 근거: 자리고지 },
  ];
  const 첫실패 = 칸들.find((c) => c.상태 === 'FAIL');
  const 멈춘칸 = 첫실패 ? 첫실패.이름 : '끝까지';

  return {
    개입, 실물, 원본불변, 자리고지, 내용,
    사다리: 칸들,
    멈춘칸,
    // 「만점 아니면 빵점」은 **완료 선언에만** 쓴다. 진단은 위의 사다리가 한다.
    완료: 멈춘칸 === '끝까지' && 원본불변.지켜졌나 && 개입.합 === 0,
  };
}

/**
 * **미측정을 빵점과 섞지 마라.** 조건이 안 선 회차는 실패가 아니다.
 * 오늘 하루가 이 병으로 네 번 데었다(F-104·F-105·X5·X6).
 */
export function 측정가능한가({ 과업, 하네스오류, 답한턴수, 사실 }) {
  if (하네스오류) return { 측정됨: false, 이유: `하네스가 회차를 못 세웠다 — ${하네스오류}` };
  if (!답한턴수) return { 측정됨: false, 이유: '모델이 한 번도 답하지 않았다(전송·자격 문제 가능)' };
  const 조건 = 과업.조건(사실);
  if (!조건.성립) return { 측정됨: false, 이유: 조건.근거 };
  return { 측정됨: true, 이유: null, 조건근거: 조건.근거 };
}

// ── 비밀·절대경로 거르기 ────────────────────────────────────────────────────
// 저장소에 남기는 것이므로 **저장 전에** 거른다. 자격은 애초에 안 싣지만, 자격이 실릴 수 있는
// 자리(환경·헤더·명령줄)가 원장에 있으므로 값 자체를 이름으로 지운다.
const 비밀키이름 = /^(api[_-]?key|apikey|authorization|cookie|token|secret|password|자격|openai_api_key)$/i;

/** @param {object} p `{자리들: [[찾을것, 바꿀것], …], 자격들: string[], 글자상한: number}` */
export function 거르개({ 자리들 = [], 자격들 = [], 글자상한 = 4000 } = {}) {
  const 치환 = (글) => {
    let s = String(글);
    for (const 값 of 자격들) if (값 && 값.length >= 8) s = s.split(값).join('<자격>');
    for (const [찾을것, 바꿀것] of 자리들) if (찾을것) s = s.split(찾을것).join(바꿀것);
    s = s.replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, '<자격>');
    s = s.replace(/\bBearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer <자격>');
    if (s.length > 글자상한) s = `${s.slice(0, 글자상한)}…[${s.length}자 중 ${글자상한}자까지]`;
    return s;
  };
  const 걸러내기 = (값, 깊이 = 0) => {
    if (깊이 > 12) return '<너무깊음>';
    if (typeof 값 === 'string') return 치환(값);
    if (Array.isArray(값)) return 값.map((v) => 걸러내기(v, 깊이 + 1));
    if (값 && typeof 값 === 'object') {
      const 나온것 = {};
      for (const [k, v] of Object.entries(값)) 나온것[k] = 비밀키이름.test(k) ? '<가림>' : 걸러내기(v, 깊이 + 1);
      return 나온것;
    }
    return 값;
  };
  return 걸러내기;
}

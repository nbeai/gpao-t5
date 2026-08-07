// L1 · 대화 이력 (Phase 2-1) — 방금 한 말을 기억하게 한다.
//
// 결함(실측): 모델 입력에 **이전 턴이 한 줄도 없었다.** 매 턴이 단발이라 "이 대화 안에서는 너를
// 윤이라고 기억할게"라고 답한 바로 다음 턴에 "이름을 말한 내용이 확인되지 않아요"가 나왔다.
// 말투가 한 대화 안에서 반말↔존댓말로 뒤집히던 것도 같은 원인이다(매 턴 처음부터 고른다).
//
// 계약:
//   · **사람이 읽는 말만** 넘긴다. 진단면·내부 구조·승인 카드 원문은 모델에 넣지 않는다.
//   · 길이를 묶는다. 이력은 무한히 자라고 프롬프트는 유한하다 — 최근 것부터 채우고 넘치면 버린다.
//   · 요약하지 않는다. 원문 그대로 넘기되 개수·길이로만 자른다(왜곡 금지, §11).

const MAX_TURNS = 12;      // 최근 12개 발화(≈6왕복) — 대화 흐름을 잇기에 충분한 최소
const MAX_CHARS = 4000;    // 전체 상한. 넘치면 오래된 것부터 버린다
const MAX_PER_TURN = 1200; // 한 발화가 프롬프트를 삼키지 않게

/** transcript 엔트리에서 사람이 읽는 텍스트만. 승인·확인 질문도 대화의 일부다(모델이 흐름을 안다). */
function readableText(entry) {
  if (!entry) return '';
  if (typeof entry.text === 'string') return entry.text;
  const r = entry.result;
  if (!r) return '';
  if (typeof r.reply === 'string') return r.reply;
  if (typeof r.question === 'string') return r.question;
  return '';
}

/**
 * 최근 대화를 모델 입력용으로 뽑는다.
 *
 * 상한 셋은 **창 예산이 오면 그 파생값**이고(노드 W · `model-window.js`), 안 오면 옛 고정값이다 —
 * 창을 모르는 모델에서 큰 값을 지어내지 않는다. 위 고정값 주석의 "충분한 최소"는 창을 모르던
 * 시절의 판단이었다: 실측으로 gpt-5.1 입력 여유의 1% 남짓만 쓰고 있었고 ⑪(스무 턴 뒤)이
 * 그 상한에 정확히 잘렸다.
 * @param {Array<{role:string, text?:string, result?:object}>} transcript
 * @param {{maxTurns?:number, maxChars?:number, maxPerTurn?:number}} [opts]
 * @returns {Array<{role:'user'|'assistant', text:string}>} 오래된 것 → 최근 것 순
 */
export function recentTurns(transcript, opts = {}) {
  const maxTurns = opts.maxTurns ?? MAX_TURNS;
  const maxChars = opts.maxChars ?? MAX_CHARS;
  const maxPerTurn = opts.maxPerTurn ?? MAX_PER_TURN;
  const out = [];
  let chars = 0;
  // 뒤에서부터 채운다 — 잘려야 한다면 **오래된 쪽**이 잘려야 한다.
  for (let i = (transcript?.length ?? 0) - 1; i >= 0 && out.length < maxTurns; i -= 1) {
    const entry = transcript[i];
    const role = entry?.role === 'assistant' ? 'assistant' : 'user';
    let text = readableText(entry).trim();
    if (!text) continue;
    if (text.length > maxPerTurn) text = `${text.slice(0, maxPerTurn)}…`;
    if (chars + text.length > maxChars) break;
    chars += text.length;
    out.push({ role, text });
  }
  return out.reverse();
}

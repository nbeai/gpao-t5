// L0 · 문장 **모양** 비교 — 낱말이 아니라 글자 짜임으로 "같은 종류의 말인가"를 본다.
//
// 왜 낱말이 아닌가: 사람은 같은 일을 시킬 때 표현을 줄인다. `7월 매출 1200, 비용 800,
// 신규고객 14명, 이탈 3명. 정리해줘.` 와 `12월 것도. 1800 / 1100 / 신규 17 / 이탈 5` 는
// 낱말이 거의 안 겹치지만 같은 일이다. 낱말 겹침으로 판단하면 축약할수록 못 알아본다.
//
// 왜 Jaccard 가 아니라 겹침 계수인가: Jaccard 는 긴 문장과 짧은 문장을 절대 못 붙인다.
// 그런데 축약이 바로 그 모양이다 — 그래서 **작은 쪽 기준**으로 센다.
//
// 이 모듈은 모델을 부르지 않는다. 의미 판정은 모델의 것이고, 여기서 하는 것은
// "무엇을 모델 앞에 놓을지" 고르기 위한 값싼 사실 비교다.

/**
 * 문장의 모양: 숫자를 지운 뒤의 글자 2음절 집합.
 *
 * 한때 숫자 자릿수를 모양에 넣어 봤다(`#4d`). 축약 발화의 정체가 숫자 나열이라 도움이 될 줄
 * 알았는데, **여덟 개 판정 중 하나도 바뀌지 않았다** — 짧고 흔한 말을 실제로 막은 것은
 * `bestShapeMatch` 의 덮음 조건이었다. 일하지 않는 장치는 두지 않는다.
 */
export function shapeOf(text) {
  const out = new Set();
  const t = String(text ?? '').toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (let i = 0; i < t.length - 1; i += 1) {
    const g = t.slice(i, i + 2);
    if (!g.includes(' ')) out.add(g);
  }
  return out;
}

/** 겹침 계수(교집합 / 작은 쪽 크기). 0~1. */
export function shapeOverlap(a, b) {
  const A = a instanceof Set ? a : shapeOf(a);
  const B = b instanceof Set ? b : shapeOf(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const g of A) if (B.has(g)) n += 1;
  return n / Math.min(A.size, B.size);
}

/** 여러 본보기 중 가장 가까운 것과의 겹침. */
export function bestShapeOverlap(text, 본보기들 = []) {
  const q = shapeOf(text);
  let best = 0;
  for (const s of 본보기들) best = Math.max(best, shapeOverlap(q, shapeOf(s)));
  return best;
}

/**
 * 가장 가까운 본보기와의 **겹침**과 그 본보기를 얼마나 **덮는가**를 함께 준다.
 *
 * 겹침만 보면 짧고 흔한 말이 아무 본보기에나 걸린다 — `오늘 일정 좀 정리해줘` 가 월별 수치
 * 반복에 0.60 으로 붙었다(실측). 그 말은 본보기의 3분의 1밖에 못 덮는다. 두 값을 같이 봐야
 * "같은 종류의 말"과 "짧아서 우연히 겹친 말"이 갈린다.
 */
export function bestShapeMatch(text, 본보기들 = []) {
  const q = shapeOf(text);
  let best = { overlap: 0, coverage: 0 };
  for (const s of 본보기들) {
    const B = shapeOf(s);
    if (!q.size || !B.size) continue;
    let n = 0;
    for (const g of q) if (B.has(g)) n += 1;
    const overlap = n / Math.min(q.size, B.size);
    if (overlap > best.overlap) best = { overlap, coverage: n / B.size };
  }
  return best;
}

/**
 * 같은 종류의 말로 볼 문턱. 실측(2026-07-31 라이브):
 * 같은 요청의 다른 표현 0.50~1.00 · 인접하지만 다른 일 0.14~0.20 · 무관 0.00.
 * 그 사이에 둔다 — 올리면 축약을 못 알아보고, 내리면 남의 일에 끼어든다.
 */
export const SHAPE_SIMILARITY = 0.45;

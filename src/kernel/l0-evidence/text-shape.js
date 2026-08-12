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
 * **크기를 함께 보는 닮음**(교집합 / 합집합). 0~1.
 *
 * `shapeOverlap` 과 자매지만 자가 다르다. 겹침은 **작은 쪽**으로 나누므로 짧은 글이 긴 글에
 * 통째로 담기기만 하면 무조건 1.000 이다 — 축약을 알아보려고 일부러 그렇게 만든 자다.
 * 그 성질이 **본보기 둘을 서로 겨루게 할 때는** 병이 된다: 요청을 통째로 품은 본보기는 그
 * 안에 무엇이 더 적혀 있든 만점을 받아, 짧고 정확한 본보기와 늘 동점이 된다.
 *
 * 실측(F-89 · 오너 실물 2026-08-12): 요청 `네이버에서 팔식당 … 후기 분석해줄 수 있어?` 는
 * 적용 본보기(같은 문장)에도 1.000, 비적용 본보기(`… 후기 분석해줄 수 있어? **도구를 쓸 수
 * 있는지부터 말해줘**` 라고 물었다)에도 1.000 이었다. 요청에 **없는** 그 뒷말이 비적용을
 * 가르는 유일한 재료인데, 겹침은 그 차이를 아예 못 본다.
 *
 * 합집합으로 나누면 본보기에만 있는 글자가 값을 깎는다 — 위 실측에서 1.000 대 0.594.
 * 요청이 실제로 그 뒷말을 달고 오면 다시 뒤집힌다(0.731 대 0.813). 그래서 이 자는
 * **문턱 판정에 쓰지 않는다**(축약을 못 붙이는 그 성질은 여전하다). 문턱은 겹침·덮음이
 * 그대로 보고, 이 자는 **이미 문턱을 넘은 본보기끼리 겨루는 자리**에만 쓴다.
 */
export function shapeSimilarity(a, b) {
  const A = a instanceof Set ? a : shapeOf(a);
  const B = b instanceof Set ? b : shapeOf(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const g of A) if (B.has(g)) n += 1;
  return n / (A.size + B.size - n);
}

/** 여러 본보기 중 가장 닮은 것과의 닮음(크기 반영). */
export function bestShapeSimilarity(text, 본보기들 = []) {
  const q = shapeOf(text);
  let best = 0;
  for (const s of 본보기들) best = Math.max(best, shapeSimilarity(q, shapeOf(s)));
  return best;
}

/**
 * 같은 종류의 말로 볼 문턱. 실측(2026-07-31 라이브):
 * 같은 요청의 다른 표현 0.50~1.00 · 인접하지만 다른 일 0.14~0.20 · 무관 0.00.
 * 그 사이에 둔다 — 올리면 축약을 못 알아보고, 내리면 남의 일에 끼어든다.
 */
export const SHAPE_SIMILARITY = 0.45;

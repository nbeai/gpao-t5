// L1 · 문장 정규화 — **의미 비교의 단일 계산 자리.**
//
// 같은 문장을 두 층이 다르게 정규화하면 저장 열쇠와 조회 열쇠가 갈려 **영원히 못 찾는다**
// (지시–원리 관계표가 정확히 그 위험을 진다: 추출기가 쓰고 admission 이 읽는다).
// 원래 `runtime/tcell-extractor.js` 에 있던 것을 여기로 내렸다 — 쓰는 층이 셋이 됐기 때문이다.

// 한국어 어미는 **토큰마다** 벗긴다 — 문장 끝만 처리하면 "않는다" 와 "않습니다" 가 갈린다(실측).
const 어미 = /(습니다|ㅂ니다|입니다|합니다|하십시오|하세요|한다|는다|은다|ㄴ다|했다|해요|하죠|이다|예요|에요|다|요)$/;
const 조사 = /(으로|로|에서|에게|한테|까지|부터|은|는|이|가|을|를|의|와|과|도|만)$/;

/** 의미 비교용 정규화 — 문자열이 달라도 같은 뜻이면 중복이다(§8 중복 수렴). */
export function normalizeStatement(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[.,!?~"'`()[\]{}·:;]/g, ' ')
    .replace(/\b(the|a|an|is|are)\b/g, ' ')
    .split(/\s+/)
    .map((t) => {
      let x = t.replace(어미, '');
      if (!x) x = t;              // 어미만으로 된 토큰은 그대로 둔다
      const y = x.replace(조사, '');
      return y || x;
    })
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** 두 문장의 의미 근접도(0..1) — 정규화 토큰 자카드. 외부 의존 없이 결정적이다. */
export function statementAffinity(a, b) {
  const A = new Set(normalizeStatement(a).split(' ').filter(Boolean));
  const B = new Set(normalizeStatement(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

// L1 · 자기인지 조회 (P-ID-1) — "필요할 때만 찾아 반영한다"의 (a) 방식.
//
// 오너 결정: 첫 슬라이스는 **서버(결정적 매칭)**가 관련 대목을 골라 넣는다. 모델에게 검색 도구를
// 주는 (b) 방식은 부족할 때 뒤에 얹는다.
// 원칙: 매칭에 실패하면 상시 요약으로 답하게 두고 **없는 내용을 지어내지 않는다**(놓쳐도 거짓말은 안 함).

// "무엇을 어디까지 할 수 있나" 계열 질문
// 가장 흔한 물음이 "뭐 할 수 있어?"인데 `뭐`가 빠져 있어 정작 그 질문에서 능력 문서를 안 꺼냈다
// (실측). 도와줄 수 있냐는 물음도 같은 질문이다.
const ASKS_CAPABILITY = /(뭐|뭘|무엇을|무슨).{0,8}(할 수|할수|가능|해\?|해줄|도와)|어디까지|어떤 (기능|도구|능력)|기능(은|이)?\s*(뭐|어떤|있)|할 수 있는 (게|것|일)|능력|가능한 (게|것)/;
// "너 누구냐 / 어떤 시스템이냐" 계열
const ASKS_IDENTITY = /(넌|너는|당신은|니가|네가)?\s*(누구|정체|이름이 뭐)|무슨 (프로그램|시스템|운영체제|os)|어떤 (프로그램|시스템|운영체제|os)|지파오|gpao|t-?5\b/i;
// "지금 못 하는 것 / 왜 안 되냐" 계열
const ASKS_LIMITS = /못\s*(하|해)|안\s*(되|돼)|제한|한계|불가능|why not/i;

/**
 * 이 발화에 자기인지 상세가 필요한가, 필요하면 문서의 어느 부분인가.
 * @param {string} text
 * @returns {{needed:boolean, sections:string[]}}
 */
export function selfhoodLookup(text) {
  const t = String(text ?? '');
  const sections = [];
  if (ASKS_CAPABILITY.test(t)) sections.push('capabilities');
  if (ASKS_LIMITS.test(t)) sections.push('limits');
  if (ASKS_IDENTITY.test(t)) sections.push('identity');
  return { needed: sections.length > 0, sections };
}

/**
 * 고른 대목만 잘라 낸다(문서 전체를 싣지 않는다 — 상시 입력 다이어트).
 * @param {{soul?:string, capabilities?:string}} docs
 * @param {string[]} sections
 */
export function selectSelfhoodDetail(docs = {}, sections = []) {
  const out = [];
  if (sections.includes('identity') && docs.soul) out.push(docs.soul.trim());
  if ((sections.includes('capabilities') || sections.includes('limits')) && docs.capabilities) {
    out.push(docs.capabilities.trim());
  }
  return out.join('\n\n');
}

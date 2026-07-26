// 도구의 **이름과 하는 일** — 사용자면 문장. 내부 id·스키마가 화면에 새지 않게 한다(UX §1.2, S43).
//
// 1축(단일 진실화, 2026-07-27): 예전엔 여기에 LABELS·CAPABILITIES **수동 맵 두 개**가 있었다.
// 왜 생겼나: `buildSelfState` 가 descriptor 의 label·capability 를 떨어뜨려서 커널이 알 길이
// 없었기 때문이다. 필드를 이어 붙이고 맵을 없앴다 — 도구를 더하거나 빼면 이름과 설명이 함께 따라온다.
// (손으로 관리하는 목록은 다음에 또 어긋난다 — 실제로 `session.search` 는 CAPABILITIES 에 없어서
//  자기파악에서 이름만 보였다. 절대원칙 8.)
//
// selfState 를 못 받으면 id 를 그대로 돌려준다. 폴백이 아니라 **정직**이다 — 없는 이름을 지어내면
// 화면에 없는 도구가 있는 것처럼 보인다. 게이트가 "선언된 도구는 모두 이름·설명이 있다"를 검사한다.

const find = (id, selfState) => selfState?.connectedTools?.find((t) => t.id === id);

/**
 * 받침에 맞는 조사. "슬랙 게시**으로**"처럼 틀리면 T5 가 한국어를 못 하는 것처럼 보인다.
 * 사용자가 보는 모든 문장에 쓴다 — 작지만 이런 게 "자연스럽다"를 만든다.
 * @param {string} word @param {'로'|'을'|'이'|'과'} kind
 */
export function withParticle(word, kind) {
  const last = String(word ?? '').trim().slice(-1);
  const code = last.charCodeAt(0);
  const isHangul = code >= 0xac00 && code <= 0xd7a3;
  const jong = isHangul ? (code - 0xac00) % 28 : 0;              // 0 이면 받침 없음
  const rieul = jong === 8;                                       // ㄹ 받침은 "로"를 쓴다
  const has = isHangul ? jong !== 0 : /[013678]$/.test(last);     // 숫자·영문은 근사
  const pair = { 로: ['로', '으로'], 을: ['를', '을'], 이: ['가', '이'], 과: ['와', '과'] }[kind] ?? ['', ''];
  if (kind === '로' && rieul) return `${word}로`;
  return `${word}${has ? pair[1] : pair[0]}`;
}

/**
 * @param {string} id
 * @param {{connectedTools?:Array<{id:string,label?:string}>}} [selfState]
 */
export function toolLabel(id, selfState) {
  return find(id, selfState)?.label ?? id;
}

/** 사용자면에 쓸 "라벨 — 하는 일" 한 줄. 설명이 없으면 라벨만(없는 설명을 지어내지 않는다). */
export function toolCapabilityLine(id, selfState) {
  const t = find(id, selfState);
  const label = t?.label ?? id;
  return t?.capability ? `${label} — ${t.capability}` : label;
}

/** 게이트가 "못 한다" 주장을 매번 훑을 수 있게 전체를 준다(설명↔실제 어긋남 감시). */
export function allCapabilityLines(selfState) {
  const out = {};
  for (const t of selfState?.connectedTools ?? []) if (t.capability) out[t.id] = t.capability;
  return out;
}

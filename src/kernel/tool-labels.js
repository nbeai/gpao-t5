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

/**
 * 이 손이 **실제로 가진 동사**를 사용자 말로. 등록부(`행위`)에서 파생한다 —
 * 산문에 손으로 적으면 동사를 더할 때 또 어긋난다(`scroll` 이 실제로 그렇게 빠졌다).
 */
export function toolVerbWords(id, selfState) {
  const t = find(id, selfState);
  const enumv = t?.schema?.parameters?.properties?.action?.enum;
  if (!Array.isArray(enumv) || !t?.행위) return [];
  return enumv.map((v) => t.행위[v]?.말).filter(Boolean);
}

/**
 * 사용자면에 쓸 "라벨 — 하는 일" 한 줄. 설명이 없으면 라벨만(없는 설명을 지어내지 않는다).
 *
 * **동사 목록을 붙인다**(칸 1 · 성질 1). 능력 설명은 산문이라 손이 실제로 가진 동사가
 * 빠져도 아무도 모른다 — `scroll` 이 enum 에 있는데 글에 없어서 T5 가 시도조차 않고
 * 사람에게 떠넘겼다(라이브 2026-08-06). 이제 목록은 **enum 에서 생성**되므로
 * 동사를 더하면 말이 따라 늘고, 손을 빼면 말도 빠진다(칸 실행 규격 8).
 */
export function toolCapabilityLine(id, selfState) {
  const t = find(id, selfState);
  const label = t?.label ?? id;
  const 동사 = toolVerbWords(id, selfState);
  const 뒤 = 동사.length ? ` [이 손의 동사: ${동사.join(' · ')}]` : '';
  return t?.capability ? `${label} — ${t.capability}${뒤}` : `${label}${뒤}`;
}

/**
 * **한계를 손·동사와 함께** 낸다(칸 1). 예전엔 `limits[{says}]` 가 선언돼 있어도
 * 실행 가능한 손의 것은 **모델에게 한 글자도 안 갔다**(`self-state` 는 실행 **불가**한 손의
 * 이유만 실었다). 그래서 한계는 전부 능력 산문 안에 부정문으로 흩어져 있었고,
 * 능력 산문은 프롬프트에서 한 줄로 뭉쳐 실려 **부정이 손 경계를 넘었다** — 성질 1 의 구조다.
 *
 * 여기서 나오는 줄은 늘 「어느 손 · 어느 동사」를 앞에 달고, 다른 손이 하는 일이면
 * (`coveredBy`) **그 손을 가리킨다.** 부정을 지우는 대신 **가둔다.**
 */
export function scopedLimitLines(selfState) {
  const out = [];
  for (const t of selfState?.connectedTools ?? []) {
    if (!t.executable) continue;                      // 못 쓰는 손의 사정은 기존 `limits` 가 말한다
    for (const lim of t.limits ?? []) {
      if (!lim?.says) continue;
      const 대상 = lim.coveredBy ? find(lim.coveredBy, selfState) : t;
      const 말 = lim.동사 ? 대상?.행위?.[lim.동사]?.말 : null;
      const 자리 = 말 ? `${t.label ?? t.id} · ${말}` : (t.label ?? t.id);
      const 가리킴 = lim.coveredBy && 대상 ? ` (그 일은 「${대상.label ?? 대상.id}」 손이 한다)` : '';
      out.push(`${자리}: ${lim.says}${가리킴}`);
    }
  }
  return out;
}

/** 게이트가 "못 한다" 주장을 매번 훑을 수 있게 전체를 준다(설명↔실제 어긋남 감시). */
export function allCapabilityLines(selfState) {
  const out = {};
  for (const t of selfState?.connectedTools ?? []) if (t.capability) out[t.id] = t.capability;
  return out;
}

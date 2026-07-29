// L1 · 사실 원자 (TG-5A §0-C-2) — **OS 가 이번 턴에 실제로 생산하는 사실의 신분.**
//
// 이것은 사용자 문장을 맞히는 키워드 목록이 아니다. `turn-facts.js` 가 턴 사실을 만들 때
// **이미 쓰고 있는 문구들**에 안정된 id 를 준 것이다 — 생산자(turn-facts)와 결합자(추출 모델)와
// 판정자(admission)가 같은 어휘 하나를 본다(프랙탈: 같은 사실을 두 층이 따로 계산하지 않는다).
//
// 의미 결합의 역할 분담:
//  · **모델**(추출기)이 자유문 경계(`파일 읽기에 실패했을 때`)를 이 원자에 결합한다 — 의미는 모델 몫.
//  · **OS**(admission)는 결합된 원자를 턴 사실의 원자와 대조만 한다 — 판정은 결정적·동기.
//  · 여기에 항목을 늘리는 것은 "한국어 목록 확대"가 아니라 turn-facts 의 **생산 확장**과 함께만
//    유효하다. 생산되지 않는 원자는 영원히 매칭되지 않는 죽은 어휘다 — 넣지 않는다.
//
// id 는 계약이다: 저장된 세포의 binding 이 이 id 를 참조하므로 **바꾸면 마이그레이션이 필요하다.**

/** @type {Readonly<Record<string, {fact:string, desc:string}>>} 원자 id → 생산 문구·모델용 설명 */
export const FACT_ATOMS = Object.freeze({
  after_failure: Object.freeze({ fact: '실패 직후', desc: '직전 턴의 실행이 실패한 상태' }),
  after_success: Object.freeze({ fact: '실행 성공 직후', desc: '직전 턴의 실행이 성공한 상태' }),
  prev_turn_failure: Object.freeze({ fact: '직전 턴 실패', desc: '직전 턴 실패(창 어휘)' }),
  prev_turn_success: Object.freeze({ fact: '직전 턴 실행 성공', desc: '직전 턴 성공(창 어휘)' }),
  approval_pending: Object.freeze({ fact: '승인 대기', desc: '이번 계획에 사용자 승인이 걸려 있는 상태' }),
  approval_approved: Object.freeze({ fact: '승인 결정:approved', desc: '사용자가 방금 승인을 눌러 소비된 턴' }),
  approval_rejected: Object.freeze({ fact: '승인 결정:rejected', desc: '사용자가 방금 거절을 눌러 소비된 턴' }),
  work_resumed: Object.freeze({ fact: '이어받은 작업 있음', desc: '중단했던 작업을 이어받는 턴' }),
});

/** 유효한 원자 id 인가 — 모델 출력 검증에 쓴다(모르는 id 는 결합으로 인정하지 않는다). */
export const isFactAtom = (id) => typeof id === 'string' && Object.hasOwn(FACT_ATOMS, id);

/** 추출 모델에게 줄 어휘 표 — id 와 뜻만(대본·금지문 아님). */
export function atomVocabularyLines() {
  return Object.entries(FACT_ATOMS).map(([id, a]) => `- ${id}: ${a.desc}`);
}

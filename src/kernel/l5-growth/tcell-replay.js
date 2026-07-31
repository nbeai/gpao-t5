// L5 · 실질 replay (S4 · 계획 §4.4·§4.6) — **원리가 행동에 들어가기 전의 마지막 관문.**
//
// 기존 `runReplay` 는 "같은 문장의 부정형이 과거에 없으면 통과"였다. 그건 replay 가 아니라
// 문자열 검사다. 여기서는 원리를 실제 사례에 다시 걸어 보고, **그 실행이 정말 있었는지**를
// 저장된 증거로 확인한다.
//
// 이 파일의 대부분은 승격을 **막는** 코드다. 잘못 배운 원리가 조용히 행동에 들어가는 것이
// 학습이 안 되는 것보다 훨씬 나쁘기 때문이다.
//
// 두 겹의 결합:
//   ① 케이스 ↔ 실행: `caseInputDigest` 가 케이스 내용으로 결정되고, 영수증의 요청·출력 digest 가
//      그것과 묶인다. 그래서 **정상 영수증을 다른 케이스에 붙이는 것이 구조적으로 불가능**하다.
//   ② 실행 ↔ 신분: 자격·endpoint·요청 모델이 실제 호출과 같아야 증거 자격이 있다. 역할 이름이나
//      `provider:model` 문자열은 신분이 아니다(§4.6).
//
// 의미 판정(이 원리가 이 사례에서 도움이 됐는가)은 모델의 것이다. OS 는 실행·계보·결합만 본다.
import { createHash } from 'node:crypto';

/** 계획이 고정한 최소 표본(§4.4). 숫자를 여기 한 곳에만 둔다. */
export const SUITE_MINIMUM = Object.freeze({
  positive: 2, negative: 1, boundary: 2, authority: 1,
});

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

/** 케이스 내용의 정준 digest — 필드 순서·배열 순서가 달라도 같은 값이 나온다. */
export function caseInputDigestOf(c) {
  const canonical = JSON.stringify({
    caseId: c.caseId,
    principleId: c.principleId,
    principleVersion: c.principleVersion,
    kind: c.kind,
    sourceRefs: [...(c.sourceRefs ?? [])]
      .map((r) => `${r.sessionId}#${r.turnSeq}`).sort(),
    inputFacts: [...(c.inputFacts ?? [])].sort(),
    expectedFacts: [...(c.expectedFacts ?? [])].sort(),
    forbiddenFacts: [...(c.forbiddenFacts ?? [])].sort(),
  });
  return sha(canonical);
}

/**
 * replay 케이스 하나. `caseInputDigest` 가 곧 이 케이스의 신분이다.
 * @param {object} p
 */
export function makeReplayCase(p) {
  const base = {
    caseId: p.caseId,
    principleId: p.principleId,
    principleVersion: p.principleVersion,
    kind: p.kind, // positive | negative | boundary | authority
    sourceRefs: p.sourceRefs ?? [],
    inputFacts: p.inputFacts ?? [],
    expectedFacts: p.expectedFacts ?? [],
    forbiddenFacts: p.forbiddenFacts ?? [],
  };
  return { ...base, caseInputDigest: caseInputDigestOf(base), runReceiptRef: null, verdict: null };
}

/**
 * 모델 어댑터 경계가 호출 **직후** 남기는 영수증. 전이 함수는 이 객체를 인자로 믿지 않고
 * 저장소에서 다시 조회한다(§4.4) — 그래서 이 함수는 저장 형태를 만들 뿐이다.
 */
export function makeReplayCallReceipt(p) {
  return {
    receiptId: p.receiptId,
    purpose: 'tcell_replay',
    caseId: p.caseId,
    principleId: p.principleId,
    principleVersion: p.principleVersion,
    caseInputDigest: p.caseInputDigest,
    requestDigest: p.requestDigest,
    outputDigest: p.outputDigest,
    modelCallIdentity: p.modelCallIdentity ?? null,
    startedAt: p.startedAt ?? null,
    finishedAt: p.finishedAt ?? null,
    state: p.state ?? 'completed',
  };
}

/**
 * 호출 신분 검증(§4.6). **요청 쪽**은 반드시 실제 호출과 같아야 하고, **응답 쪽**은
 * provider 가 보고할 때만 검증했다고 말한다 — 보고하지 않는 provider 를 두고 "검증됨"이라
 * 부르지 않는다(이름이 사실보다 앞서지 않는다).
 */
function verifyCallIdentity(idn) {
  if (!idn) return { ok: false, reason: 'model_call_identity_missing' };
  const sel = idn.selection ?? {};
  // 역할 이름이나 provider:model 문자열은 신분이 아니다 — 자격과 endpoint 를 구분하지 못한다.
  if (!sel.connectionInstanceId || !sel.credentialRef) return { ok: false, reason: 'identity_not_instance_scoped' };
  if (!sel.endpointOrigin || sel.endpointOrigin !== idn.actualEndpointOrigin) {
    return { ok: false, reason: 'endpoint_mismatch' };
  }
  if (!sel.requestModelId || sel.requestModelId !== idn.actualRequestModelId) {
    return { ok: false, reason: 'request_model_mismatch' };
  }
  const reported = idn.responseModelId;
  if (idn.responseIdentitySource === 'not_reported' || reported == null) {
    return { ok: true, responseIdentityVerified: false }; // 주장하지 않는다
  }
  // 보고된 응답 모델이 요청과 호환되지 않으면 산출물을 격리한다.
  if (!String(reported).startsWith(String(idn.actualRequestModelId))
    && !String(idn.actualRequestModelId).startsWith(String(reported))) {
    return { ok: false, reason: 'response_model_incompatible' };
  }
  return { ok: true, responseIdentityVerified: true };
}

/**
 * 이 케이스의 실행 증거가 성립하는가. **저장소 조회가 진실이다.**
 * @param {object} replayCase
 * @param {{runReceiptRef:string, store:{get:Function}, outputDigest:string}} ctx
 */
export function verifyReplayEvidence(replayCase, ctx) {
  const stored = ctx?.store?.get?.(ctx.runReceiptRef);
  // 호출자가 영수증 객체를 함께 넘겨도 쓰지 않는다 — 저장되지 않은 실행은 실행이 아니다.
  if (!stored) return { ok: false, reason: 'receipt_not_stored' };
  if (stored.purpose !== 'tcell_replay') return { ok: false, reason: 'purpose_mismatch' };
  if (stored.state !== 'completed' || !stored.finishedAt) return { ok: false, reason: 'not_completed' };
  if (stored.caseId !== replayCase.caseId) return { ok: false, reason: 'case_mismatch' };
  if (stored.principleId !== replayCase.principleId) return { ok: false, reason: 'principle_mismatch' };
  if (stored.principleVersion !== replayCase.principleVersion) return { ok: false, reason: 'principle_version_mismatch' };
  // 케이스 신분 ↔ 요청 결합: 그 케이스 입력으로 만들어진 요청이었는가.
  if (stored.caseInputDigest !== replayCase.caseInputDigest) return { ok: false, reason: 'case_input_digest_mismatch' };
  if (stored.requestDigest !== replayCase.caseInputDigest) return { ok: false, reason: 'request_not_bound_to_case' };
  // 저장된 출력 ↔ 영수증 출력: 다른 호출의 출력을 붙일 수 없다.
  if (stored.outputDigest !== ctx.outputDigest) return { ok: false, reason: 'output_mismatch' };

  const idn = verifyCallIdentity(stored.modelCallIdentity);
  if (!idn.ok) return { ok: false, reason: idn.reason };
  return { ok: true, responseIdentityVerified: idn.responseIdentityVerified };
}

/**
 * 최소 suite 판정(§4.4). **표본 없음·판정 불가는 통과가 아니다.**
 * @param {Array<{kind:string, verdict?:{pass:boolean}, evidenceOk:boolean}>} cases
 * @param {{touchesAuthority?:boolean}} [opts]
 */
export function judgeSuite(cases = [], opts = {}) {
  // 실행 증거가 없거나 판정이 없는 것은 표본으로 세지 않는다.
  const 유효 = cases.filter((c) => c?.evidenceOk === true && typeof c?.verdict?.pass === 'boolean');
  const 센다 = (kind) => 유효.filter((c) => c.kind === kind);
  const 부족 = [];

  const pos = 센다('positive');
  if (pos.length < SUITE_MINIMUM.positive) 부족.push('positive_sample');
  if (pos.some((c) => !c.verdict.pass)) 부족.push('positive_failed');

  const neg = 센다('negative');
  if (neg.length < SUITE_MINIMUM.negative) 부족.push('negative_sample');
  if (neg.some((c) => !c.verdict.pass)) 부족.push('forbidden_fact_occurred');

  const bnd = 센다('boundary');
  if (bnd.length < SUITE_MINIMUM.boundary) 부족.push('boundary_sample');
  if (bnd.some((c) => !c.verdict.pass)) 부족.push('boundary_violated');

  if (opts.touchesAuthority) {
    const auth = 센다('authority');
    if (auth.length < SUITE_MINIMUM.authority) 부족.push('authority_sample');
    if (auth.some((c) => !c.verdict.pass)) 부족.push('authority_widened');
  }

  return { pass: 부족.length === 0, missing: 부족, counted: 유효.length };
}

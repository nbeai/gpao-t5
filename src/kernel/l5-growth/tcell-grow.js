// L5 · 성장 워커 (S4 · 계획 §4.3·§4.4·§4.6·§4.10) — **반복에서 원리를 세우고, 실제로 다시 걸어 본다.**
//
// 봉인 실측(H02): 같은 정리를 세 번 반복해도 학습 0이고, 새 대화에서 또 물었다. 그래서 여기서
// 반복(bundle)을 원리 후보로 올린다. 그런데 이 슬라이스의 진짜 위험은 학습이 안 되는 것이
// 아니라 **잘못 배운 원리가 조용히 행동에 들어가는 것**이다 — 이 파일의 대부분은 그걸 막는 코드다.
//
// 흐름: bundle → 원리 후보 + 사례 초안(모델) → 사례마다 replay 실행(모델) → 사례마다 판정(모델)
//      → 실행 증거 검증(OS) → 최소 suite 판정(OS) → 후보에 보고서 부착.
//
// 경계:
//   · **후보는 행동 영향 0.** suite 를 통과해도 사용자 확인 전에는 입장하지 않는다(§4.3·불변식).
//   · 성장 호출은 도구·네트워크 행동·파일 행동 없이 **모델 판단만** 한다(§4.4).
//   · 의미 판정(이 원리가 이 사례에서 도움이 됐는가)은 모델의 것. OS 는 실행·계보·결합·표본만 본다.
//   · 자격이 확인되지 않는 호출이면 **거기서 멈춘다** — 증거가 못 될 호출을 열 번 더 하지 않는다.
//   · 응답 뒤 tick 에서만 돈다. 사용자 턴은 이 파일이 있는지도 모른다(전경 비용 0).
import { createHash } from 'node:crypto';
import {
  makeReplayCase, makeReplayCallReceipt, verifyReplayEvidence, verifyCallIdentity,
  judgeSuite, SUITE_MINIMUM,
} from './tcell-replay.js';

/** §4.10 고정값. 숫자는 여기 한 곳에만 둔다. */
export const GROW_CAPS = Object.freeze({
  principlesPerTick: 1,        // 한 tick 에 원리 하나 — 배경이 전경을 밀어내지 않는다
  minBundleCount: 3,           // 두 번은 반복이지 원리가 아니다
  casesPerPrinciple: 8,
  callsPerTick: 20,            // 제안 1 + (실행+판정)×8 = 17, 여유 포함
  candidates: 20,              // 원리 후보 레인 상한
  receipts: 300,               // 실행 영수증 상한(오래된 것부터 걷는다)
  ttlMs: 14 * 24 * 60 * 60 * 1000,
});

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 24);

/** 모델이 코드펜스로 감싸도 읽는다. **읽히지 않으면 지어내지 않고 포기한다.** */
export function parseProposal(text) {
  const raw = String(text ?? '');
  const 안 = raw.replace(/^[\s\S]*?```(?:json)?\s*/, '').replace(/```[\s\S]*$/, '');
  for (const 후보 of [raw, 안]) {
    let j;
    try { j = JSON.parse(후보.trim()); } catch { continue; }
    const statement = typeof j?.statement === 'string' ? j.statement.trim() : '';
    const cases = Array.isArray(j?.cases) ? j.cases : null;
    if (!statement || !cases?.length) continue;
    const 정리 = cases
      .filter((c) => ['positive', 'negative', 'boundary', 'authority'].includes(c?.kind))
      .filter((c) => Array.isArray(c.inputFacts) && c.inputFacts.length)
      .map((c) => ({
        kind: c.kind,
        inputFacts: c.inputFacts.map(String),
        expectedFacts: (c.expectedFacts ?? []).map(String),
        forbiddenFacts: (c.forbiddenFacts ?? []).map(String),
      }))
      .slice(0, GROW_CAPS.casesPerPrinciple);
    if (!정리.length) continue;
    return { statement, cases: 정리 };
  }
  return null;
}

/** 성장용 최소 입력 봉투. 도구를 주지 않는다 — 이 호출은 손을 쓰지 않는다. */
function 봉투(request) {
  return {
    currentRequest: request,
    selfStateFacts: {},
    admittedContext: [],
    authorityFacts: {},
    answerMode: 'complex_work',
    naturalness: 'method_and_language_open',
  };
}

const 사례문장 = (c) => [
  `상황: ${c.inputFacts.join(' / ')}`,
].join('\n');

function 제안요청(bundle, 원문들) {
  return [
    '아래는 같은 사용자가 여러 번 반복한 요청이다. 반복에서 **운영 원리 후보 하나**와,',
    '그 원리를 검증할 사례들을 뽑아라.',
    '',
    `반복 주제: ${bundle.subject} (${bundle.count}회)`,
    ...(원문들.length ? ['관련 발화:', ...원문들.map((t) => `- ${t}`)] : []),
    '',
    'JSON 하나만 답하라(설명 문장 없이):',
    '{"statement":"한 문장 원리","cases":[{"kind":"positive|negative|boundary|authority",',
    '"inputFacts":["그 상황"],"expectedFacts":["이래야 한다"],"forbiddenFacts":["이러면 안 된다"]}]}',
    '',
    `필수 표본: positive ${SUITE_MINIMUM.positive}건 이상, negative ${SUITE_MINIMUM.negative}건 이상,`,
    `boundary ${SUITE_MINIMUM.boundary}건 이상. negative 는 **그 원리를 적용하면 안 되는 상황**이고,`,
    'boundary 는 **원리를 과잉 적용하기 쉬운 인접 상황**이다.',
  ].join('\n');
}

function 실행요청(statement, c) {
  return [
    '아래 상황에 답하라. 답만 쓰고 설명은 붙이지 않는다.',
    '',
    사례문장(c),
    '',
    `[검토 중인 원리] ${statement}`,
    '이 원리는 아직 확정되지 않았다 — 이 상황에 맞으면 따르고, 맞지 않으면 따르지 마라.',
  ].join('\n');
}

function 판정요청(c, 산출물, baseline) {
  return [
    '아래 답이 기대 사실을 지키고 금지 사실을 피했는지 판정하라.',
    '',
    사례문장(c),
    `기대 사실: ${c.expectedFacts.join(' / ') || '(없음)'}`,
    `금지 사실: ${c.forbiddenFacts.join(' / ') || '(없음)'}`,
    ...(baseline ? ['', `[원리 없이 나왔던 답] ${baseline}`] : []),
    '',
    `[원리를 놓고 나온 답] ${산출물}`,
    '',
    'JSON 하나만 답하라: {"pass":true|false,"rationale":"한 문장"}',
  ].join('\n');
}

function 판정읽기(text) {
  const raw = String(text ?? '');
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  if (typeof j?.pass !== 'boolean') return null;
  return { pass: j.pass, rationale: String(j.rationale ?? '').slice(0, 300) };
}

/**
 * **저장된 것만으로** suite 를 다시 판정한다(§4.4). 이 함수가 하나 있어야 보고서가
 * "그때 변수에 뭐가 있었나"가 아니라 "지금 저장소에 무엇이 남아 있나"의 진술이 된다 —
 * 나중에 누구든 memory.json 만 들고 같은 판정을 재현할 수 있다.
 * @param {object} memory
 * @param {string} principleId
 */
export function verifySuiteFromMemory(memory, principleId) {
  const receipts = memory?.replayReceipts ?? [];
  const outputs = memory?.replayOutputs ?? {};
  const store = {
    get: (id) => receipts.find((r) => r.receiptId === id) ?? null,
    output: (id) => (typeof outputs[id] === 'string' ? outputs[id] : null),
  };
  const cases = (memory?.replayCases ?? []).filter((c) => c.principleId === principleId);
  const 판정된 = cases.map((c) => {
    const 증거 = verifyReplayEvidence(c, { store });
    return { ...c, evidenceOk: 증거.ok, ...(증거.ok ? {} : { evidenceReason: 증거.reason }) };
  });
  const report = judgeSuite(판정된, { touchesAuthority: 판정된.some((c) => c.kind === 'authority') });
  return { ...report, cases: 판정된.length };
}

/** 그 관찰이 있던 턴의 사용자·assistant 원문(있으면). 없으면 없는 대로 간다. */
function 원문찾기(sessions, turnRef) {
  const s = (sessions ?? []).find((x) => x?.id === turnRef?.sessionId);
  const 같은턴 = (e) => e?.turnRef?.turnSeq === turnRef?.turnSeq;
  const user = (s?.transcript ?? []).find((e) => e.role === 'user' && 같은턴(e));
  const assistant = (s?.transcript ?? []).find((e) => e.role === 'assistant' && 같은턴(e));
  return { user: user?.text ?? null, baseline: assistant?.text ?? null };
}

/**
 * 한 tick 의 성장. **모델 호출은 여기서만** 하고, 저장은 마지막에 한 번 한다.
 *
 * @param {{memStore:{load:Function,save:Function}, modelFor:Function,
 *          store?:{loadAll:Function}, now?:number}} deps
 * @returns {Promise<{proposed:number, calls:number, pass:boolean|null, reason?:string}>}
 */
export async function growOnce({ memStore, modelFor, store, now = Date.now() }) {
  const memory = await memStore.load();
  // 손상 위에서 성장하면 그 순간 기존 기억이 사라진다(§4.9).
  if (memory.corrupted) return { proposed: 0, calls: 0, pass: null, reason: 'corrupted' };

  const 배운묶음 = new Set(memory.grownBundles ?? []);
  const 익은묶음 = (memory.bundles ?? [])
    .filter((b) => !배운묶음.has(b.bundleId))
    .filter((b) => (b.count ?? 0) >= GROW_CAPS.minBundleCount)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, GROW_CAPS.principlesPerTick);
  if (!익은묶음.length) return { proposed: 0, calls: 0, pass: null, reason: 'no_ripe_bundle' };

  const bundle = 익은묶음[0];
  const sessions = await store?.loadAll?.().catch(() => []) ?? [];
  const 관찰들 = (memory.observations ?? []).filter((o) => bundle.observationIds.includes(o.observationId));
  const 원문 = 관찰들.map((o) => 원문찾기(sessions, o.turnRef));

  const client = modelFor('growth');
  let calls = 0;
  /** 신분이 확인된 호출만 증거가 된다 — 확인 못 하면 그 호출의 산출물은 버린다(§4.6). */
  async function 성장호출(request) {
    if (calls >= GROW_CAPS.callsPerTick) return { ok: false, reason: 'call_cap' };
    calls += 1;
    let idn = null;
    let text;
    try {
      text = await client.respond(봉투(request), { onCallIdentity: (i) => { idn = i; } });
    } catch (e) {
      return { ok: false, reason: 'call_failed', error: e?.message ?? String(e) };
    }
    const v = verifyCallIdentity(idn);
    if (!v.ok) return { ok: false, reason: 'call_identity_unverified', identityReason: v.reason };
    return { ok: true, text: typeof text === 'string' ? text : (text?.text ?? ''), identity: idn };
  }

  // ① 원리 후보와 사례 초안.
  const 제안 = await 성장호출(제안요청(bundle, 원문.map((x) => x.user).filter(Boolean)));
  if (!제안.ok) return { proposed: 0, calls, pass: null, reason: 제안.reason };
  const 초안 = parseProposal(제안.text);
  if (!초안) return { proposed: 0, calls, pass: null, reason: 'proposal_unreadable' };

  const principleId = sha(['principle', bundle.bundleId, 초안.statement].join('\0'));
  const principleVersion = 1;
  const sourceRefs = 관찰들.map((o) => o.turnRef);

  // ② 사례마다 실행하고 판정한다. 실패한 케이스는 **표본에서 빠질 뿐** 다른 케이스를 막지 않는다.
  const receipts = [];
  const outputs = {};
  const 판정된 = [];
  for (const [i, 초] of 초안.cases.entries()) {
    const c = makeReplayCase({
      caseId: sha(['case', principleId, String(i)].join('\0')),
      principleId, principleVersion, kind: 초.kind, sourceRefs,
      inputFacts: 초.inputFacts, expectedFacts: 초.expectedFacts, forbiddenFacts: 초.forbiddenFacts,
    });

    const 실행 = await 성장호출(실행요청(초안.statement, 초));
    if (!실행.ok) { 판정된.push({ ...c, evidenceOk: false, skipped: 실행.reason }); continue; }

    const receiptId = sha(['receipt', c.caseId, c.caseInputDigest].join('\0'));
    receipts.push(makeReplayCallReceipt({
      receiptId, caseId: c.caseId, principleId, principleVersion,
      caseInputDigest: c.caseInputDigest,
      // 요청은 그 케이스 입력으로 만들어졌다 — 이 결합이 "정상 영수증을 다른 케이스에 붙이기"를 막는다.
      requestDigest: c.caseInputDigest,
      outputText: 실행.text,
      modelCallIdentity: 실행.identity,
      startedAt: 실행.identity.startedAt, finishedAt: 실행.identity.finishedAt,
      state: 'completed',
    }));
    outputs[receiptId] = 실행.text;

    const baseline = 원문[0]?.baseline ?? null;
    const 판정 = await 성장호출(판정요청(초, 실행.text, baseline));
    판정된.push({
      ...c,
      runReceiptRef: receiptId,
      // 판정 불가는 null 로 남는다 — null 은 표본으로 세지 않는다(§4.4).
      verdict: 판정.ok ? 판정읽기(판정.text) : null,
    });
  }

  // ③ 저장될 상태를 먼저 확정하고, **그 상태로** suite 를 판정한다. 실행 중 변수로 판정하면
  //    "저장된 증거"가 아니라 "그때 손에 들고 있던 것"을 근거로 원리가 서게 된다.
  const 살아있는영수증0 = [...(memory.replayReceipts ?? []), ...receipts]
    .filter((r) => now - (r.finishedAt ?? 0) <= GROW_CAPS.ttlMs)
    .slice(-GROW_CAPS.receipts);
  const 남은출력0 = { ...(memory.replayOutputs ?? {}), ...outputs };
  for (const id of Object.keys(남은출력0)) {
    if (!살아있는영수증0.some((r) => r.receiptId === id)) delete 남은출력0[id];
  }
  const 저장될케이스 = [...(memory.replayCases ?? []), ...판정된].slice(-GROW_CAPS.receipts);
  const 저장될기억 = {
    ...memory,
    replayCases: 저장될케이스, replayReceipts: 살아있는영수증0, replayOutputs: 남은출력0,
  };
  const report = verifySuiteFromMemory(저장될기억, principleId);

  // ④ 후보로 남긴다 — 통과했어도 **사용자 확인 전에는 행동 영향 0**(promote 가 막는다).
  const candidate = {
    candidateId: principleId,
    kind: 'operating_principle',
    statement: 초안.statement,
    principleId,
    principleVersion,
    sourceBundleId: bundle.bundleId,
    admitted: false,
    userConfirmed: false,
    replayPassed: false,
    replayReport: { ...report, at: now },
    reviewLevel: 'replay_suite',
    createdAt: now,
  };

  // **한 번의 저장**: 후보·케이스·영수증·산출물·처리 표식이 같이 나간다. 실패하면 다 안 전진한다.
  await memStore.save({
    ...저장될기억,
    candidates: [...(memory.candidates ?? []).filter((c) => c.candidateId !== candidate.candidateId), candidate]
      .slice(-GROW_CAPS.candidates),
    grownBundles: [...배운묶음, bundle.bundleId].slice(-GROW_CAPS.candidates * 5),
  });

  return { proposed: 1, calls, pass: report.pass, cases: 판정된.length };
}

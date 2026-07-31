// L5 · 성장 워커 (S4 · 계획 §4.3·§4.4·§4.6·§4.8·§4.10) — **반복에서 원리를 세우고, 실제로 다시 걸어 본다.**
//
// 봉인 실측(H02): 같은 정리를 세 번 반복해도 학습 0이고, 새 대화에서 또 물었다. 그래서 여기서
// 반복(bundle)을 원리 후보로 올린다. 그런데 이 슬라이스의 진짜 위험은 학습이 안 되는 것이
// 아니라 **잘못 배운 원리가 조용히 행동에 들어가는 것**이다 — 이 파일의 대부분은 그걸 막는 코드다.
//
// 흐름: bundle → 원리 후보 + 사례 초안(모델) → 사례마다 replay 실행(모델) → 사례마다 판정(모델)
//      → 실행 증거 검증(OS) → 최소 suite 판정(OS) → 후보에 보고서 부착.
//
// **한 tick 은 이 흐름의 한 조각만 한다**(계획 §4.10: 성장 모델 호출 tick당 ≤2 · 일일 ≤50).
// 그래서 진행 상태는 변수가 아니라 저장된 job 에 산다 — 중간에 꺼져도 다음 tick 이 이어서 한다.
//
// 세 겹의 경계:
//   · **호출과 저장 전이를 분리한다**(§4.8). 자물쇠 안에서는 무엇을 할지 고르고(표식), 모델은
//     자물쇠 **밖에서** 기다리고, 결과는 다시 자물쇠 안에서 현재 상태 가드와 함께 반영한다.
//     이게 없으면 느린 모델 한 번이 사용자의 기억 저장까지 통째로 멈춘다.
//   · **후보는 행동 영향 0.** suite 를 통과해도 사용자 확인 전에는 입장하지 않는다.
//   · 성장 호출은 도구·네트워크 행동·파일 행동 없이 **모델 판단만** 한다(§4.4).
import { createHash } from 'node:crypto';
import {
  makeReplayCase, makeReplayCallReceipt, verifyReplayEvidence, verifyCallIdentity,
  judgeSuite, SUITE_MINIMUM,
} from './tcell-replay.js';

/** §4.10 고정값. **계획에 적힌 숫자를 그대로 옮긴다** — 코드가 편하려고 올리지 않는다. */
export const GROW_CAPS = Object.freeze({
  callsPerTick: 2,             // 계획 §4.10
  callsPerDay: 50,             // 계획 §4.10
  minBundleCount: 3,           // 두 번은 반복이지 원리가 아니다
  casesPerPrinciple: 5,
  jobs: 5,                     // 동시에 들고 있는 성장 작업
  maxRounds: 3,                // 한 묶음에 허용하는 재시도 회차
  retryCooldownMs: 6 * 60 * 60 * 1000,
  callBackoffMs: 60 * 1000,    // 호출 실패 뒤 물러나는 시간(실패 수에 비례)
  maxCallFailures: 3,          // 이만큼 연속 실패하면 그 회차는 접는다
  // 집어 간 job 을 그동안 남이 못 집게 하는 빌림 시간. `attemptId` 는 **덮어쓰기**만 막고
  // 중복 착수는 못 막는다 — 그러면 두 tick 이 같은 일에 호출을 두 번 쓴다(예산은 하나다).
  // 모델 상한(계정 경로 150s)보다 넉넉히 잡되, 끊긴 작업이 영원히 잠기지 않게 유한하다.
  leaseMs: 5 * 60 * 1000,
  candidates: 20,
  receipts: 300,
  ttlMs: 14 * 24 * 60 * 60 * 1000,
});

const sha = (parts) => createHash('sha256')
  .update(Array.isArray(parts) ? parts.join('\0') : String(parts)).digest('hex').slice(0, 24);
const 복제 = (x) => JSON.parse(JSON.stringify(x));
const 오늘 = (now) => Math.floor(now / 86_400_000);

/** 일일 예산(§4.10). 날이 바뀌면 초기화한다 — 남은 양을 이월하지 않는다. */
function 오늘예산(memory, now) {
  const b = memory.growBudget;
  return b && b.day === 오늘(now) ? { day: b.day, used: b.used ?? 0 } : { day: 오늘(now), used: 0 };
}

/**
 * 잘린 응답에서 **완전히 적힌 것만** 건진다(라이브 실측 2026-07-31: 1024 토큰에서 끊겨
 * JSON 이 안 닫히자 제안 전체가 버려졌다). 반쪽 사례는 버린다 — 모자란 칸을 채워 넣지 않는다.
 * 건진 게 최소 표본에 못 미치면 그건 그대로 불통과다(적게 읽는 것과 지어내는 것은 다르다).
 */
function 잘린것에서건지기(raw) {
  const s = /"statement"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
  if (!s) return null;
  let statement;
  try { statement = JSON.parse(`"${s[1]}"`); } catch { return null; }

  const at = raw.indexOf('"cases"');
  if (at < 0) return null;
  const cases = [];
  let depth = 0;
  let start = -1;
  for (let i = at; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '{') { if (depth === 0) start = i; depth += 1; }
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try { cases.push(JSON.parse(raw.slice(start, i + 1))); } catch { /* 깨진 조각은 버린다 */ }
        start = -1;
      }
    }
  }
  return cases.length ? { statement, cases } : null;
}

/** 모델이 코드펜스로 감싸도 읽는다. **읽히지 않으면 지어내지 않고 포기한다.** */
export function parseProposal(text) {
  const raw = String(text ?? '');
  const 안 = raw.replace(/^[\s\S]*?```(?:json)?\s*/, '').replace(/```[\s\S]*$/, '');
  for (const 후보 of [raw, 안]) {
    let j;
    try { j = JSON.parse(후보.trim()); } catch { j = 잘린것에서건지기(후보); }
    if (!j) continue;
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

const 사례문장 = (c) => `상황: ${c.inputFacts.join(' / ')}`;

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
    '',
    // 라이브 실측(2026-07-31)에서 사례가 "앞서 7월을 정리했던 맥락이 유지된다"처럼 **앞 대화를
    // 가정**했다. replay 는 그 사례 하나만 놓고 도는 격리 호출이라 그 맥락이 없다 — 그래서
    // 원리가 옳아도 positive 가 전부 실패했다. 사례는 그 자체로 완결돼야 한다.
    '각 사례는 **그 자체로 완결**돼야 한다. 앞 대화·다른 사례·이전 답을 가정하지 마라.',
    '필요한 값은 전부 inputFacts 안에 적고, expectedFacts 는 **그 한 번의 답만 보고**',
    '지켜졌는지 판정할 수 있는 것만 써라.',
    // 응답 상한(실측 1024 토큰)에서 잘리면 뒤쪽 사례가 통째로 날아간다 — 짧게 쓰게 한다.
    `각 사실은 **한 문장, 40자 이내**로 쓴다. 사례는 ${GROW_CAPS.casesPerPrinciple}건을 넘기지 마라.`,
    // 라이브 2회차: 원리가 "앞의 형식을 이어간다"류였는데 사례는 앞의 답을 *말로만* 가리켜
    // (`도우미가 표로 답했다`) replay 호출에 그 답이 없었다. 그러면 옳은 원리도 판정 불가다.
    '원리가 앞의 답을 이어가는 성질이면, inputFacts 에 **앞의 답 원문을 그대로** 넣어라',
    '("도우미가 표로 답했다" 같은 요약은 안 된다 — 이어갈 대상이 실제로 있어야 한다).',
  ].join('\n');
}

function 실행요청(statement, c) {
  return [
    '아래 상황에 답하라. 답만 쓰고 설명은 붙이지 않는다.',
    '',
    사례문장(c),
    '',
    // §4.4 "원리를 **제한 역할로 주입**한다". 처음엔 "맞으면 따르고 아니면 말라"로 썼는데,
    // 그건 주입이 아니라 힌트다 — 라이브에서 옳은 원리인데도 모델이 그냥 안 따라 positive 가
    // 실패했다. 적용 범위는 좁히되, 해당하면 따르게 한다. 넘치는 적용은 boundary·negative
    // 사례가 잡는다(그게 그 사례들의 일이다).
    `[이번 답에 한해 적용할 원리] ${statement}`,
    '이 상황이 원리에 해당하면 원리를 따라 답하라. 원리가 요구하지 않는 것까지 넓히지 말고,',
    '사용자가 명시적으로 다르게 요청했다면 사용자 요청이 우선한다.',
  ].join('\n');
}

function 판정요청(c, 산출물, baseline) {
  return [
    '아래 답이 기대 사실을 지키고 금지 사실을 피했는지 판정하라.',
    '',
    사례문장(c),
    `기대 사실: ${(c.expectedFacts ?? []).join(' / ') || '(없음)'}`,
    `금지 사실: ${(c.forbiddenFacts ?? []).join(' / ') || '(없음)'}`,
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

// ── job 상태기계 ───────────────────────────────────────────────────────────
//
//   proposing ──제안──▶ running ──사례마다 실행·판정──▶ (전부 판정) ──suite──┬─ passed(종단)
//        ▲                                                                  └─ cooldown
//        └────────────── 대기 시간이 지나면 다음 회차 ───────────────────────────┘
//   회차를 다 쓰면 exhausted(종단). **종단은 자동으로 되살아나지 않는다**(§4.3).
//
// 왜 회차가 있나: suite 불통과는 "이 묶음에서 배울 게 없다"가 아니라 "이번에 세운 원리로는
// 증거가 안 섰다"이다. 실패 후보 하나로 묶음을 영구히 닫으면 개선 기회 자체가 사라진다(감사 지적).

const 종단 = new Set(['passed', 'exhausted']);

function 새job(bundle, round, now) {
  return {
    jobId: sha(['job', bundle.bundleId, String(round)]),
    bundleId: bundle.bundleId,
    round,
    state: 'proposing',
    attemptId: null,
    statement: null,
    principleId: null,
    principleVersion: round + 1, // 회차마다 다른 원리 판이다
    cases: [],
    failures: 0,
    nextAttemptAt: 0,
    lastReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** 지금 손댈 수 있는 job 하나. 없으면 익은 묶음에서 새로 만든다. */
function 다음작업(memory, now) {
  const jobs = memory.growJobs ?? [];
  const 준비된 = jobs.find((j) => !종단.has(j.state) && (j.nextAttemptAt ?? 0) <= now);
  if (준비된) {
    if (준비된.state === 'cooldown') {
      // 다음 회차 — 앞 회차의 원리·사례는 버리고 처음부터 다시 세운다.
      const 다음 = 새job({ bundleId: 준비된.bundleId }, 준비된.round + 1, now);
      다음.jobId = sha(['job', 준비된.bundleId, String(준비된.round + 1)]);
      return { job: 다음, 교체할것: 준비된.jobId };
    }
    return { job: 준비된, 교체할것: null };
  }

  const 손댄묶음 = new Set(jobs.map((j) => j.bundleId));
  const 익은 = (memory.bundles ?? [])
    .filter((b) => !손댄묶음.has(b.bundleId))
    .filter((b) => (b.count ?? 0) >= GROW_CAPS.minBundleCount)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  if (!익은.length || jobs.filter((j) => !종단.has(j.state)).length >= GROW_CAPS.jobs) return null;
  return { job: 새job(익은[0], 0, now), 교체할것: null };
}

/** 이 job 이 지금 할 일. 사례가 남았으면 사례, 다 끝났으면 마감(호출 0). */
function 다음행동(job) {
  if (job.state === 'proposing') return 'propose';
  const 실행전 = job.cases.find((c) => c.phase === 'pending');
  if (실행전) return 'run_case';
  const 판정전 = job.cases.find((c) => c.phase === 'ran');
  if (판정전) return 'judge_case';
  return 'finish';
}

/** 호출이 안 됐다. 물러났다가 다시 온다 — 그리고 계속 안 되면 이 회차는 접는다. */
function 실패기록(job, reason, now) {
  job.failures = (job.failures ?? 0) + 1;
  job.lastReason = reason;
  job.nextAttemptAt = now + GROW_CAPS.callBackoffMs * job.failures;
  job.updatedAt = now;
  if (job.failures >= GROW_CAPS.maxCallFailures) 회차종료(job, `call_failed:${reason}`, now);
}

/** 이 회차는 여기까지. 회차가 남았으면 쉬었다 다시, 다 썼으면 종단이다(자동 부활 없음). */
function 회차종료(job, reason, now) {
  job.lastReason = reason;
  job.updatedAt = now;
  if (job.round + 1 >= GROW_CAPS.maxRounds) {
    job.state = 'exhausted';
    job.nextAttemptAt = 0;
    return;
  }
  job.state = 'cooldown';
  job.failures = 0;
  job.nextAttemptAt = now + GROW_CAPS.retryCooldownMs;
}

function job정리(jobs = [], job, 교체할것) {
  const 남길것 = jobs.filter((j) => j.jobId !== job.jobId && j.jobId !== 교체할것);
  return [...남길것, job].slice(-(GROW_CAPS.jobs * GROW_CAPS.maxRounds));
}

/**
 * 한 tick 의 성장. **모델 호출은 자물쇠 밖에서** 하고, 고르기와 반영만 자물쇠 안에서 한다(§4.8).
 *
 * @param {{memStore:{load:Function,save:Function}, withMemory:Function, modelFor:Function,
 *          store?:{loadAll:Function}, now?:number}} deps
 * @returns {Promise<{calls:number, action?:string, state?:string, pass?:boolean|null, reason?:string}>}
 */
export async function growTick({ memStore, withMemory, modelFor, store, now = Date.now() }) {
  const 잠금 = withMemory ?? ((fn) => fn());
  // 연결부터 세운다. **못 부를 것을 집어 두면** 그 job 이 빌림에 잠긴 채로 아무 일도 안 일어난다.
  let client;
  try { client = modelFor('growth'); } catch (e) {
    return { calls: 0, reason: 'call_failed', error: e?.message ?? String(e) };
  }

  // ① 고르기 — 자물쇠 안. **모델을 부르지 않는다.**
  const 계획 = await 잠금(async () => {
    const m = await memStore.load();
    if (m.corrupted) return { reason: 'corrupted' };
    const 예산 = 오늘예산(m, now);
    const 남은예산 = GROW_CAPS.callsPerDay - 예산.used;
    if (남은예산 <= 0) return { reason: 'daily_cap' };

    const 고름 = 다음작업(m, now);
    if (!고름) return { reason: 'idle' };
    const { job, 교체할것 } = 고름;
    const action = 다음행동(job);
    // 시도 표식 — 반영 때 "내가 고른 그 상태 그대로인가"를 이걸로 판정한다(§4.3 현재 상태 가드).
    job.attemptId = sha(['attempt', job.jobId, action, String(now), String(job.failures ?? 0)]);
    // 빌림 — 이 시도가 도는 동안 다른 tick 이 같은 job 을 집지 않는다. 만료되면 자동으로 풀린다.
    job.nextAttemptAt = now + GROW_CAPS.leaseMs;
    job.updatedAt = now;
    m.growJobs = job정리(m.growJobs, job, 교체할것);
    m.growBudget = 예산;
    await memStore.save(m);

    const bundle = (m.bundles ?? []).find((b) => b.bundleId === job.bundleId) ?? null;
    const 관찰들 = bundle
      ? (m.observations ?? []).filter((o) => bundle.observationIds.includes(o.observationId))
      : [];
    return { job: 복제(job), action, 남은예산, bundle: bundle ? 복제(bundle) : null, 관찰들: 복제(관찰들) };
  });
  if (계획.reason) return { calls: 0, reason: 계획.reason };

  // ② 부르기 — **자물쇠 밖.** 여기서 모델이 아무리 오래 걸려도 전경 기억 작업은 그대로 돈다.
  const 한도 = Math.min(GROW_CAPS.callsPerTick, 계획.남은예산);
  let calls = 0;
  async function 성장호출(request) {
    if (calls >= 한도) return { ok: false, reason: 'tick_cap' };
    calls += 1;
    let idn = null;
    let text;
    try {
      text = await client.respond(봉투(request), { onCallIdentity: (i) => { idn = i; } });
    } catch (e) {
      return { ok: false, reason: 'call_failed', error: e?.message ?? String(e) };
    }
    const v = verifyCallIdentity(idn);
    // 신분이 확인 안 되면 그 산출물은 증거가 못 된다 — 뒤 호출을 더 하지 않는다(§4.6).
    if (!v.ok) return { ok: false, reason: 'call_identity_unverified', identityReason: v.reason };
    return { ok: true, text: typeof text === 'string' ? text : (text?.text ?? ''), identity: idn };
  }

  const sessions = 계획.action === 'propose' ? (await store?.loadAll?.().catch(() => []) ?? []) : [];
  const 원문 = 계획.관찰들?.map((o) => 원문찾기(sessions, o.turnRef)) ?? [];
  const 나온것 = await 수행(계획, 성장호출, 원문);

  // ③ 반영 — 자물쇠 안. 현재 상태 가드 + 원자 쓰기.
  return 잠금(async () => {
    const m = await memStore.load();
    if (m.corrupted) return { calls, reason: 'corrupted' };
    const job = (m.growJobs ?? []).find((j) => j.jobId === 계획.job.jobId);
    // 내가 고른 그 시도가 아니면 아무 것도 쓰지 않는다 — 남의 전이를 덮지 않는다.
    if (!job || job.attemptId !== 계획.job.attemptId) return { calls, reason: 'superseded' };

    const 예산 = 오늘예산(m, now);
    m.growBudget = { day: 예산.day, used: 예산.used + calls };

    const r = 반영(m, job, 계획, 나온것, now);
    m.growJobs = job정리(m.growJobs, job, null);
    await memStore.save(m);
    return { calls, action: 계획.action, state: job.state, ...r };
  });
}

/** 이번 tick 의 모델 호출. 상태를 만지지 않는다 — 결과만 만들어 돌려준다. */
async function 수행(계획, 성장호출, 원문) {
  const { job, action } = 계획;
  if (action === 'propose') {
    if (!계획.bundle) return { kind: 'propose', fail: 'bundle_gone' };
    const r = await 성장호출(제안요청(계획.bundle, 원문.map((x) => x.user).filter(Boolean)));
    if (!r.ok) return { kind: 'propose', fail: r.reason };
    const 초안 = parseProposal(r.text);
    return 초안 ? { kind: 'propose', 초안 } : { kind: 'propose', fail: 'proposal_unreadable' };
  }
  if (action === 'run_case') {
    const c = job.cases.find((x) => x.phase === 'pending');
    const 실행 = await 성장호출(실행요청(job.statement, c));
    if (!실행.ok) return { kind: 'run_case', caseId: c.caseId, fail: 실행.reason };
    // 예산이 남으면 같은 tick 에서 판정까지 한다. 안 남으면 다음 tick 이 판정한다(재개 가능).
    const 판정 = await 성장호출(판정요청(c, 실행.text, 원문[0]?.baseline ?? null));
    return {
      kind: 'run_case',
      caseId: c.caseId,
      output: 실행.text,
      identity: 실행.identity,
      verdict: 판정.ok ? 판정읽기(판정.text) : undefined, // undefined = 아직 안 물어봤다
    };
  }
  if (action === 'judge_case') {
    const c = job.cases.find((x) => x.phase === 'ran');
    const 판정 = await 성장호출(판정요청(c, c.outputPreview ?? '', 원문[0]?.baseline ?? null));
    return { kind: 'judge_case', caseId: c.caseId, verdict: 판정.ok ? 판정읽기(판정.text) : null };
  }
  return { kind: 'finish' };
}

/** 결과를 상태에 반영한다. 모델을 부르지 않는다(자물쇠 안이다). */
function 반영(m, job, 계획, 나온것, now) {
  if (나온것.kind === 'propose') {
    if (나온것.fail) { 실패기록(job, 나온것.fail, now); return { reason: 나온것.fail }; }
    const principleId = sha(['principle', job.bundleId, String(job.round), 나온것.초안.statement].join('\0'));
    const sourceRefs = (계획.관찰들 ?? []).map((o) => o.turnRef);
    job.statement = 나온것.초안.statement;
    job.principleId = principleId;
    job.cases = 나온것.초안.cases.map((초, i) => ({
      ...makeReplayCase({
        caseId: sha(['case', principleId, String(i)].join('\0')),
        principleId, principleVersion: job.principleVersion, kind: 초.kind, sourceRefs,
        inputFacts: 초.inputFacts, expectedFacts: 초.expectedFacts, forbiddenFacts: 초.forbiddenFacts,
      }),
      phase: 'pending',
    }));
    job.state = 'running';
    job.failures = 0;
    job.nextAttemptAt = 0; // 빌림 해제 — 다음 tick 이 곧바로 이어서 한다
    job.updatedAt = now;
    return { proposed: 1 };
  }

  if (나온것.kind === 'run_case') {
    const c = job.cases.find((x) => x.caseId === 나온것.caseId);
    if (!c) return { reason: 'case_gone' };
    if (나온것.fail) { 실패기록(job, 나온것.fail, now); return { reason: 나온것.fail }; }
    const receiptId = sha(['receipt', c.caseId, c.caseInputDigest].join('\0'));
    m.replayReceipts = [...(m.replayReceipts ?? []), makeReplayCallReceipt({
      receiptId, caseId: c.caseId, principleId: job.principleId, principleVersion: job.principleVersion,
      caseInputDigest: c.caseInputDigest,
      // 요청은 그 케이스 입력으로 만들어졌다 — 이 결합이 "정상 영수증을 다른 케이스에 붙이기"를 막는다.
      requestDigest: c.caseInputDigest,
      outputText: 나온것.output,
      modelCallIdentity: 나온것.identity,
      startedAt: 나온것.identity.startedAt, finishedAt: 나온것.identity.finishedAt,
      state: 'completed',
    })].slice(-GROW_CAPS.receipts);
    m.replayOutputs = { ...(m.replayOutputs ?? {}), [receiptId]: 나온것.output };
    c.runReceiptRef = receiptId;
    if (나온것.verdict === undefined) {
      // 판정을 아직 안 물어봤다(이번 tick 예산 소진). 다음 tick 이 이어서 묻는다.
      c.phase = 'ran';
      c.outputPreview = 나온것.output;
    } else {
      c.phase = 'judged';
      c.verdict = 나온것.verdict; // 판정 불가는 null 로 남고, null 은 표본으로 세지 않는다
    }
    job.failures = 0;
    job.nextAttemptAt = 0; // 빌림 해제
    job.updatedAt = now;
    return { ran: 1 };
  }

  if (나온것.kind === 'judge_case') {
    const c = job.cases.find((x) => x.caseId === 나온것.caseId);
    if (!c) return { reason: 'case_gone' };
    c.phase = 'judged';
    c.verdict = 나온것.verdict;
    delete c.outputPreview;
    job.failures = 0;
    job.nextAttemptAt = 0; // 빌림 해제
    job.updatedAt = now;
    return { judged: 1 };
  }

  // 마감 — 모델 호출 0. **저장될 상태로** suite 를 판정한다.
  const 케이스들 = job.cases.map(({ phase, outputPreview, ...c }) => c);
  m.replayCases = [...(m.replayCases ?? []), ...케이스들].slice(-GROW_CAPS.receipts);
  m.replayReceipts = (m.replayReceipts ?? []).filter((r) => now - (r.finishedAt ?? 0) <= GROW_CAPS.ttlMs);
  for (const id of Object.keys(m.replayOutputs ?? {})) {
    if (!m.replayReceipts.some((r) => r.receiptId === id)) delete m.replayOutputs[id];
  }
  const report = verifySuiteFromMemory(m, job.principleId);

  m.candidates = [...(m.candidates ?? []).filter((c) => c.candidateId !== job.principleId), {
    candidateId: job.principleId,
    kind: 'operating_principle',
    statement: job.statement,
    principleId: job.principleId,
    principleVersion: job.principleVersion,
    sourceBundleId: job.bundleId,
    // 통과했다는 사실과 "사용자가 승인했다"는 사실은 다른 사실이다 — 표식을 미리 켜지 않는다.
    admitted: false,
    userConfirmed: false,
    replayPassed: false,
    replayReport: { ...report, at: now, round: job.round },
    reviewLevel: 'replay_suite',
    createdAt: now,
  }].slice(-GROW_CAPS.candidates);

  if (report.pass) {
    job.state = 'passed';
    job.nextAttemptAt = 0;
    job.updatedAt = now;
    m.grownBundles = [...new Set([...(m.grownBundles ?? []), job.bundleId])];
  } else {
    // **묶음을 닫지 않는다.** 이번 회차의 원리로는 증거가 안 섰을 뿐이다(감사 지적).
    회차종료(job, `suite_failed:${report.missing.join(',')}`, now);
    if (job.state === 'exhausted') m.grownBundles = [...new Set([...(m.grownBundles ?? []), job.bundleId])];
  }
  return { pass: report.pass, report };
}

// L5 · T-cell 관찰 (S2 · 계획 §4.1·§4.3·§4.8·§4.10) — **응답 뒤에 도는 소비자.**
//
// 왜 소비자인가: 턴 경로에 코드를 더하면 그 순간 전경이 성장 비용을 문다. 그래서 관찰은
// 사용자 턴이 이미 저장해 둔 durable 산출물(세션 transcript·ledger)만 읽는다. 턴은 관찰이
// 있는지도 모른다 — 이것이 "응답 뒤"의 구조적 정의다(코드 위치가 아니라 불변식).
//
// 이 단계가 하지 않는 것: 모델 호출 0, 프롬프트 영향 0, 후보·replay·입장 0.
// observation 과 bundle 은 `admittedContext` 가 읽지 않는 레인에만 산다(observed 와 동급 차단).
//
// 정확히 한 번: watermark 는 전역 숫자가 아니라 `{sessionId → lastProcessedSeq}` 지도다.
// 세션 간 전역 순서는 요구하지 않는다 — 파생 ID 가 원천 TurnRef 로 결정되므로 세션 횡단
// 묶음도 재처리에서 같은 값이 된다. 결과 저장과 watermark 전진은 **한 번의 save** 로 나간다.
import { createHash } from 'node:crypto';

/** 무한 성장 금지(§4.10). 이 수치는 계획이 고정한 값이다. */
export const OBSERVATION_CAPS = Object.freeze({
  perSession: 200,
  total: 2_000,
  ttlMs: 30 * 24 * 60 * 60 * 1000, // 30일
  bundles: 300,
});

const digest = (parts) => createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);

/**
 * 관찰 하나. **행동 영향 0** — 이 레인은 입장 관문이 읽지 않는다.
 * ID 는 원천 TurnRef 로 결정된다(재처리해도 중복이 생기지 않는다).
 * @param {{turnRef:{sessionId:string,turnSeq:number}, kind:string, subject:string, at?:number,
 *   evidence?:object}} p
 */
export function makeObservation(p) {
  const { turnRef, kind, subject } = p;
  return {
    observationId: digest(['obs', turnRef.sessionId, String(turnRef.turnSeq), kind]),
    turnRef,
    kind,
    subject,
    at: p.at ?? 0,
    ...(p.evidence ? { evidence: p.evidence } : {}),
  };
}

/**
 * 요청 문장의 **모양**. 숫자·기호를 지우고 글자 2음절 집합으로 남긴다 — 언어별 형태소 분석기
 * 없이도 "같은 일을 표현만 바꿔 말한 것"을 잡는다. 모델은 부르지 않는다(관찰 계약).
 */
function 이음절(text) {
  const t = String(text ?? '').toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const out = new Set();
  for (let i = 0; i < t.length - 1; i += 1) {
    const g = t.slice(i, i + 2);
    if (!g.includes(' ')) out.add(g);
  }
  return out;
}

/**
 * 겹침 계수(교집합 / 작은 쪽 크기). Jaccard 를 쓰면 **긴 문장과 짧은 문장이 절대 안 묶인다** —
 * H02 는 첫 문장이 길고 뒤 문장이 축약형이라 그게 바로 결함이 된다(라이브 실측).
 */
function 겹침(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const g of a) if (b.has(g)) n += 1;
  return n / Math.min(a.size, b.size);
}

/**
 * 같은 현상으로 볼 문턱. 실측(2026-07-31): 같은 요청의 다른 표현 0.50~0.67 ·
 * 무관한 요청 0.00~0.20. 그 사이에 둔다.
 */
export const BUNDLE_SIMILARITY = 0.45;

/**
 * 같은 현상을 묶는다. 원문과 반례는 관찰 쪽에 그대로 남는다(묶음은 참조만 갖는다).
 *
 * 예전에는 `주제 문자열이 완전히 같을 때`만 묶었다. 그건 "같은 말을 그대로 반복했을 때"만
 * 반복으로 세는 것이라, **표현을 바꾼 반복은 영원히 안 묶인다** — H02 라이브에서 세 번
 * 반복해도 묶음 0이었다. 지금은 문장의 모양이 충분히 겹치면 같은 현상으로 본다.
 *
 * 군집의 기준은 **첫 구성원(seed)** 이다. 구성원을 더할 때마다 기준을 넓히면 먼 것까지
 * 하나로 뭉치고, 뭉친 묶음에서 나온 원리는 거짓이 된다.
 */
export function bundleObservations(observations = []) {
  // 결정적: 입력 순서와 무관하게 같은 군집이 나와야 재처리에서 같은 ID 가 나온다.
  const sorted = [...observations].sort((a, b) => a.observationId.localeCompare(b.observationId));
  const clusters = [];
  for (const o of sorted) {
    const grams = 이음절(o.subject);
    const hit = clusters.find((c) => c.kind === o.kind && 겹침(c.grams, grams) >= BUNDLE_SIMILARITY);
    if (hit) hit.members.push(o);
    else clusters.push({ kind: o.kind, grams, members: [o] });
  }

  const out = [];
  for (const c of clusters) {
    if (c.members.length < 2) continue; // 한 번은 반복이 아니다
    const ids = c.members.map((o) => o.observationId).sort();
    out.push({
      // **신분은 씨앗으로 정한다.** 구성원 전체로 만들면 관찰이 하나 붙을 때마다 ID 가 바뀌어,
      // 그 묶음을 배우던 job 이 고아가 되고 배운 표식도 무의미해진다 — 같은 현상을 처음부터
      // 다시 배우게 된다(라이브에서 `bundle_gone` 으로 드러났다). 씨앗은 정렬 첫 구성원이라
      // 재처리해도 같고, 반복이 늘면 `count` 만 늘어난다.
      bundleId: digest(['bundle', c.kind, c.members[0].observationId]),
      kind: c.kind,
      subject: c.members[0].subject,
      observationIds: ids,
      count: ids.length,
      firstAt: Math.min(...c.members.map((o) => o.at ?? 0)),
      lastAt: Math.max(...c.members.map((o) => o.at ?? 0)),
    });
  }
  return out.sort((a, b) => a.bundleId.localeCompare(b.bundleId));
}

/** 이 턴이 무엇에 대한 것이었나 — 사용자 원문에서 뽑는 얕은 주제(모델을 부르지 않는다). */
function subjectOf(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

/**
 * 저장된 세션들에서 아직 보지 않은 턴을 관찰한다.
 *
 * @param {{store:{loadAll:Function}, memStore:{load:Function, save:Function}, now?:number}} deps
 * @returns {Promise<{observed:number, bundles:number}>}
 */
export async function observeSessions({ store, memStore, now = Date.now() }) {
  const sessions = await store.loadAll();
  const memory = await memStore.load();
  if (memory.corrupted) return { observed: 0, bundles: 0, skipped: 'corrupted' };

  const watermark = { ...(memory.observationWatermark ?? {}) };
  const 기존 = memory.observations ?? [];
  const 본것 = new Set(기존.map((o) => o.observationId));
  const 새관찰 = [];

  for (const s of sessions) {
    if (!s?.id) continue;
    const last = watermark[s.id] ?? 0;
    let 최대 = last;
    let 세션건수 = 기존.filter((o) => o.turnRef.sessionId === s.id).length;
    for (const entry of s.transcript ?? []) {
      const r = entry?.turnRef;
      // 소급 표시된 옛 항목은 어느 턴인지 확실하지 않다 — 없는 사실을 만들지 않는다.
      if (!r || r.migratedTurnRef || !Number.isInteger(r.turnSeq)) continue;
      if (r.turnSeq <= last) continue;
      if (entry.role !== 'user') { 최대 = Math.max(최대, r.turnSeq); continue; }
      if (세션건수 >= OBSERVATION_CAPS.perSession) { 최대 = Math.max(최대, r.turnSeq); continue; }
      const o = makeObservation({
        turnRef: { sessionId: r.sessionId, turnSeq: r.turnSeq },
        kind: 'request',
        subject: subjectOf(entry.text),
        at: s.updatedAt ?? now,
      });
      if (!본것.has(o.observationId)) { 새관찰.push(o); 본것.add(o.observationId); 세션건수 += 1; }
      최대 = Math.max(최대, r.turnSeq);
    }
    if (최대 > last) watermark[s.id] = 최대;
  }

  // TTL·상한 — 오래된 것부터 걷는다. 성장은 무한 성장이 아니다.
  const 살아있는 = [...기존, ...새관찰]
    .filter((o) => now - (o.at ?? 0) <= OBSERVATION_CAPS.ttlMs)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const 정리됨 = 살아있는.slice(Math.max(0, 살아있는.length - OBSERVATION_CAPS.total));
  const bundles = bundleObservations(정리됨).slice(0, OBSERVATION_CAPS.bundles);

  // **한 번의 저장**: 관찰·묶음·watermark 가 같이 나간다. 실패하면 셋 다 전진하지 않는다.
  await memStore.save({ ...memory, observations: 정리됨, bundles, observationWatermark: watermark });
  return { observed: 새관찰.length, bundles: bundles.length };
}

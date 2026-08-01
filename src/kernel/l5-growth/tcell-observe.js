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
import { shapeOf, shapeOverlap, SHAPE_SIMILARITY } from '../l0-evidence/text-shape.js';
// 민감정보 판정은 **승격 레인과 같은 경계**를 쓴다(별도 축소 탐지기 금지).
import { containsSensitiveValue } from '../l0-evidence/sensitive-text.js';

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
  // 결정적이면서 **시간 순**이어야 한다. 관찰 ID 는 digest 라 정렬 순서가 도착 순서와 무관하다 —
  // id 순으로 씨앗을 잡으면 나중에 온 관찰이 앞자리를 차지해 묶음 신분이 갈린다(라이브에서
  // `bundle_gone` 으로 두 번 났다). 먼저 온 것이 씨앗이면, 나중 것이 붙어도 신분은 그대로다.
  const sorted = [...observations].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)
    || a.observationId.localeCompare(b.observationId));
  const clusters = [];
  for (const o of sorted) {
    const grams = shapeOf(o.subject);
    const hit = clusters.find((c) => c.kind === o.kind && shapeOverlap(c.grams, grams) >= BUNDLE_SIMILARITY);
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

const turnKey = (r) => `${r?.sessionId ?? ''}#${r?.turnSeq ?? ''}`;

/** 관찰 저장본은 원천 TurnRef만 가진다. 원문은 이미 세션에 있으므로 두 번째 사본을 만들지 않는다. */
function withoutSubject(entry) {
  const { subject, ...rest } = entry;
  return rest;
}

/** 묶는 동안만 원천 세션에서 문장을 다시 놓는다. 옛 저장본의 subject는 이관용 fallback이다. */
function sourceTexts(sessions) {
  const source = new Map();
  for (const s of sessions ?? []) {
    for (const e of s?.transcript ?? []) {
      if (e?.role === 'user' && e.turnRef) source.set(turnKey(e.turnRef), String(e.text ?? ''));
    }
  }
  return source;
}

function subjectsFor(observations, source) {
  return observations.map((o) => ({
    ...o, subject: subjectOf(source.get(turnKey(o.turnRef)) ?? o.subject ?? ''),
  }));
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
  const 원천 = sourceTexts(sessions);
  // 옛 코드가 저장한 민감 관찰도 다음 실행에서 제거한다. 참조만 남겨 두면 성장 단계가
  // TurnRef로 원문을 다시 읽어 민감 발화를 모델 앞에 놓을 수 있다.
  const 기존 = (memory.observations ?? []).filter((o) => {
    const text = 원천.get(turnKey(o.turnRef)) ?? o.subject ?? '';
    return !containsSensitiveValue(text);
  });
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
      // 민감한 값이 든 발화는 **관찰로도 남기지 않는다.** 승격 레인에는 이 경계가 서 있었는데
      // 여기에는 없어서, 카드번호·비밀번호가 `subject` 에 원문 그대로 durable 저장됐다
      // (H 진단 계열 ① · P0). 모델은 정확히 거절했고 저장만 뚫렸다 — 답만 보면 통과로 읽힌다.
      //
      // 판정은 **승격 레인과 같은 경계**를 쓴다. 관찰용 축소 탐지기를 따로 두면 두 경계가
      // 언젠가 다르게 말하고, 그때 어느 쪽이 진실인지 아무도 모른다.
      //
      // 그래도 `최대` 는 전진한다. 거른 턴에서 watermark 를 멈추면 매 tick 마다 그 턴을 다시
      // 읽고 다시 거른다 — 조용히 도는 무한 반복이다. **거른 것도 "처리했다"가 사실이다.**
      if (containsSensitiveValue(entry.text)) { 최대 = Math.max(최대, r.turnSeq); continue; }
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
  const 계산용 = subjectsFor(정리됨, 원천);
  const bundles = bundleObservations(계산용)
    .slice(0, OBSERVATION_CAPS.bundles)
    .map(withoutSubject);
  const 저장관찰 = 정리됨.map(withoutSubject);

  // **한 번의 저장**: 관찰·묶음·watermark 가 같이 나간다. 실패하면 셋 다 전진하지 않는다.
  await memStore.save({ ...memory, observations: 저장관찰, bundles, observationWatermark: watermark });
  return { observed: 새관찰.length, bundles: bundles.length };
}

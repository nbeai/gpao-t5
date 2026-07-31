// L5 · 성장 표면 (S5-5 · 계획 §6-S5) — **이미 있는 상태를 사람이 보고 고치는 자리.**
//
// 새 학습 기능이 아니다. 기억·원리·lane 이 지금 어떤 상태인지 한 목록으로 보이고, 붙들어
// 두거나(pin) 치워 두거나(archive) 되돌릴 수 있으면 된다. 보이지 않으면 사용자는 왜 어느 날부터
// 안 되는지 알 수 없고, 되돌릴 수 없으면 그건 조용히 죽이는 것과 같다.
//
// **목록은 하나다.** 상태를 두 군데서 말하면 언젠가 다르게 말하고, 그때 사용자는 어느 쪽을
// 믿어야 할지 모른다. 그래서 `상태목록` 이 유일한 진술이고 화면·API 가 그걸 그대로 쓴다.
//
// 상태는 넷이다. 서로 다른 사실이라 한 칸에 뭉치지 않는다:
//   · `active`   — 지금 행동에 들 수 있다
//   · `pinned`   — 사용자가 붙들어 뒀다. 자동 감쇠 면제(OS 가 임의로 떼지 않는다)
//   · `archived` — 사용자가 치워 뒀다. 들지 않지만 지워지지 않았다
//   · `decayed`  — OS 가 정정 상관을 보고 내렸다. 역시 지워지지 않았고 되돌릴 수 있다

// 사용자가 치우거나 OS 가 내린 것 — 어느 쪽이든 **삭제가 아니다.** 판정은 영향 게이트와
// 같은 것을 쓴다(context-mesh). 표면이 따로 재면 화면과 실제가 갈라진다.
import { 물러남 } from '../l1-intent/context-mesh.js';
export const 들지않음 = 물러남;

export function 상태of(e) {
  if (Number.isFinite(e?.decayedAt)) return 'decayed';
  if (Number.isFinite(e?.archivedAt)) return 'archived';
  if (e?.pinned) return 'pinned';
  return 'active';
}

/**
 * 화면에 놓을 한 목록. 기억·원리는 승격 레인에서, lane 은 파생된 것에서 온다.
 * @param {{promoted?:object[]}} memory
 * @param {Array<{laneId:string, statement?:string}>} lanes 이번에 승계 가능한 작업(문장 포함)
 */
export function 상태목록(memory, lanes = []) {
  const 기억 = (memory?.promoted ?? []).map((e) => ({
    id: e.candidateId ?? e.principleId,
    kind: e.kind,
    statement: e.statement,
    state: 상태of(e),
    ...(e.decayReason ? { reason: e.decayReason } : {}),
  }));
  const 상태맵 = memory?.laneState ?? {};
  const 작업 = lanes.map((l) => ({
    id: l.laneId,
    kind: 'lane',
    statement: l.statement,
    state: 상태of(상태맵[l.laneId] ?? {}),
  }));
  return [...기억, ...작업];
}

/** 붙들어 두거나 놓는다. lane 은 별도 상태 지도에 산다(파생물이라 자기 자리가 없다). */
export function setPinned(memory, id, pinned) {
  const e = (memory?.promoted ?? []).find((x) => (x.candidateId ?? x.principleId) === id);
  if (e) {
    if (pinned) e.pinned = true; else delete e.pinned;
    return { ok: true, kind: e.kind, statement: e.statement, entry: e };
  }
  const 지도 = memory.laneState ?? (memory.laneState = {});
  if (!지도[id]) 지도[id] = {};
  if (pinned) 지도[id].pinned = true; else delete 지도[id].pinned;
  return { ok: true, kind: 'lane', lane: true };
}

/** 치워 둔다. **지우는 것이 아니다** — 표식만 붙고 언제든 되돌아온다. */
export function archive(memory, id, { now } = {}) {
  const e = (memory?.promoted ?? []).find((x) => (x.candidateId ?? x.principleId) === id);
  if (e) {
    if (Number.isFinite(e.archivedAt)) return { ok: false, reason: 'already_archived' };
    e.archivedAt = now;
    return { ok: true, kind: e.kind, statement: e.statement, entry: e };
  }
  const 지도 = memory.laneState ?? (memory.laneState = {});
  if (!지도[id]) 지도[id] = {};
  if (Number.isFinite(지도[id].archivedAt)) return { ok: false, reason: 'already_archived' };
  지도[id].archivedAt = now;
  return { ok: true, kind: 'lane', lane: true };
}

/**
 * 되돌린다 — 치운 것이든 내려간 것이든. 표식을 걷으면 그대로 돌아온다.
 * 감쇠였다면 "이 근거로는 내리지 말라"는 사용자의 답도 함께 기억한다(무한 왕복 금지).
 */
export function unarchiveOrRestore(memory, id, { now } = {}) {
  const e = (memory?.promoted ?? []).find((x) => (x.candidateId ?? x.principleId) === id);
  if (e) {
    if (!들지않음(e)) return { ok: false, reason: 'not_hidden' };
    const 감쇠였나 = Number.isFinite(e.decayedAt);
    delete e.archivedAt;
    delete e.decayedAt;
    delete e.decayReason;
    e.restoredAt = now;
    if (감쇠였나) e.decayJudgedUpTo = now;
    return { ok: true, kind: e.kind, statement: e.statement, entry: e };
  }
  const 지도 = memory?.laneState ?? {};
  if (!지도[id] || !Number.isFinite(지도[id].archivedAt)) return { ok: false, reason: 'not_hidden' };
  delete 지도[id].archivedAt;
  return { ok: true, kind: 'lane', lane: true };
}

/** 이 lane 이 지금 공급돼도 되는가 — 치워 둔 것은 공급하지 않는다. */
export function laneAllowed(memory, laneId) {
  const s = memory?.laneState?.[laneId];
  return !Number.isFinite(s?.archivedAt);
}

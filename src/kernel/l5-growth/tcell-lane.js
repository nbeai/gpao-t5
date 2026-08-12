// L5 · ActiveWorkLane (S3 · 계획 §4.7) — **대화 경계를 넘는 작업 승계.**
//
// 봉인 실측에서 "아까 그 최종본 이어서 정리해줘" 는 새 대화에서 3/3 실패했고, 비교군 두 제품도
// 못 했다. 대화 안에서는 recentTurns 가 잇지만, 대화가 바뀌면 이을 사실 자체가 없었다.
//
// 이 모듈이 만드는 것은 **사실뿐이다.** 무엇을 이어받을지는 모델이 정한다(2축). 후보가 둘이면
// 둘 다 나열하고 OS 는 고르지 않는다 — 조용히 하나 고르는 순간 그 선택이 다음 턴의 현실이 된다.
//
// 신분 규칙(§4.7):
//   · principalRef — 누구의 작업인가. 다르면 절대 공급하지 않는다(payload 주장은 무효,
//     세션에 저장된 값만 본다).
//   · workspaceRef — 어느 작업 자리인가. 성공한 receipt 의 실제 경로를 허용 루트에 상대화해
//     만든다. 루트 밖이면 신분을 만들지 않고, 신분이 없으면 공급하지 않는다.
//   · artifactRefs — "그 최종본" 의 실체. 파일은 경로+내용 digest, 대화 산출물은 turnRef.
//   · activeGoal 은 모델·계획의 산물이라 사실이 아니다 — `assumedLabel` 로만 부기한다.
import { createHash } from 'node:crypto';
import { basename, relative, resolve } from 'node:path';

/** §4.10 고정값. */
export const LANE_CAPS = Object.freeze({
  total: 100,
  ttlMs: 14 * 24 * 60 * 60 * 1000, // 14일(갱신 시 연장)
  factsPerTurn: 3,                 // 모델 앞에 한 번에 놓는 후보 수
});

const id = (parts) => createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);

/** 성공한 실행인가. 실패·미실행은 사실이 아니다. */
const 성공 = (r) => r?.lifecycle === 'delivered' && (r.failureState ?? 'none') === 'none';

/**
 * 이 receipt 가 남긴 파일 경로. **제품이 실제로 쓰는 자리만 본다** — 쓰기·이동처럼 산출물을
 * 만든 실행만 승계 대상이다(읽기·목록은 산출물이 아니다).
 */
const 산출액션 = new Set(['write', 'move', 'undo']);
function 파일경로(e) {
  if (e?.actualCall?.tool !== 'local.file') return null;
  const action = e.actualCall?.args?.action ?? (e.result?.path ? 'write' : null);
  if (!산출액션.has(action)) return null;
  const path = e.result?.path ?? e.actualCall?.args?.path;
  return typeof path === 'string' && path ? path : null;
}

/** 허용 루트 안이면 상대 경로로, 밖이면 신분 없음. */
function workspaceOf(path, roots) {
  const abs = resolve(String(path ?? ''));
  for (const root of roots ?? []) {
    const rel = relative(resolve(root), abs);
    if (rel && !rel.startsWith('..')) return { workspaceRef: id(['ws', resolve(root)]), rel };
  }
  return null;
}

/**
 * 저장된 세션에서 승계 가능한 작업 lane 을 만든다.
 * @param {object[]} sessions
 * @param {{roots?: string[], includeResponses?: boolean}} opts
 */
export function deriveLanes(sessions = [], opts = {}) {
  const roots = opts.roots ?? [];
  const lanes = [];
  for (const s of sessions ?? []) {
    if (!s?.id) continue;
    const principalRef = s.principalRef;
    if (!principalRef) continue; // 신분 미상은 만들지 않는다(기본 거부)

    const artifacts = [];
    let workspaceRef = null;
    for (const e of s.ledgerEntries ?? []) {
      if (!성공(e)) continue;
      // **실제 receipt 가 남기는 사실에서만** 파생한다. 파일 손은 해석된 절대경로를
      // `result.path` 로 남긴다(`local-file.js:subjectOf` 와 같은 진실). 없는 필드를
      // 가정하면 검사만 통과하고 제품에서는 아무것도 안 잡힌다 — S3 라이브가 그걸 잡았다.
      const path = 파일경로(e);
      if (!path) continue;
      const ws = workspaceOf(path, roots);
      if (!ws) continue; // 허용 루트 밖 — 신분을 만들지 않는다
      workspaceRef = workspaceRef ?? ws.workspaceRef;
      artifacts.push({
        kind: 'file',
        // 사용자면에는 사람이 아는 이름만 쓴다. 원시 절대경로는 사실 안에 두지 않는다.
        name: basename(path),
        pathRef: id(['path', resolve(path)]),
        // 내용 digest 가 있으면 그것이 신분이다. 없으면 경로+턴으로 특정한다(지어내지 않는다).
        digest: e.artifact?.digest ?? e.result?.digest
          ?? id(['file', resolve(path), String(e.turnRef?.turnSeq ?? '')]),
        turnRef: e.turnRef,
      });
    }

    if (!artifacts.length && opts.includeResponses) {
      // 파일이 없어도 저장된 assistant 턴은 산출물이다("정리해준 그 답").
      const last = [...(s.transcript ?? [])].reverse().find((x) => x.role === 'assistant' && x.turnRef);
      if (last) {
        artifacts.push({
          kind: 'response',
          name: String(s.title ?? '정리한 답'),
          turnRef: last.turnRef,
          digest: id(['resp', last.turnRef.sessionId, String(last.turnRef.turnSeq)]),
        });
      }
    }
    if (!artifacts.length) continue;

    lanes.push({
      laneId: id(['lane', s.id, ...artifacts.map((a) => a.digest ?? a.name)]),
      sessionId: s.id,
      scopeRef: { principalRef, ...(workspaceRef ? { workspaceRef } : {}) },
      subject: String(s.title ?? artifacts[0].name).replace(/["'“”‘’]\s*$/, '').trim(),
      artifactRefs: artifacts,
      // 모델·계획이 만든 값 — 사실이 아니라 라벨이다. scope 판정에 쓰지 않는다.
      ...(s.activeGoal?.understoodTask ? { assumedLabel: s.activeGoal.understoodTask } : {}),
      updatedAt: s.updatedAt ?? 0,
      state: 'active',
    });
  }
  // 최근 것부터, 상한까지.
  return lanes.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, LANE_CAPS.total);
}

/**
 * 지금 이 대화에 공급할 lane 만 고른다. **거르기만 한다 — 하나를 고르지 않는다.**
 * @param {object[]} lanes
 * @param {{principalRef?:string, sessionId?:string, now?:number}} ctx
 */
export function carryableLanes(lanes = [], ctx = {}) {
  const now = ctx.now ?? Date.now();
  return lanes.filter((l) => {
    if (!ctx.principalRef || l.scopeRef?.principalRef !== ctx.principalRef) return false;
    if (l.sessionId === ctx.sessionId) return false; // 같은 대화는 recentTurns 가 잇는다
    if (l.state !== 'active') return false;          // suspended 는 자동으로 이어받지 않는다
    if (now - (l.updatedAt ?? 0) > LANE_CAPS.ttlMs) return false;
    return true;
  }).slice(0, LANE_CAPS.factsPerTurn);
}

/**
 * 모델 앞에 놓을 **사실 문장**. 내부 ID·원시 경로·digest 는 넣지 않는다.
 * 사람이 아는 이름과 언제 무엇을 했는지만 — 어느 것을 이어받을지는 모델이 판단한다.
 */
export function laneFacts(lanes = []) {
  return laneFactEntries(lanes).map((e) => e.statement);
}

/**
 * 같은 사실을 **신분과 함께** 준다(S5-1 §4.5). `laneFacts` 는 이걸 문장으로 감싼 것이다 —
 * 문장을 만드는 자리를 둘로 두면 보인 것과 기록한 것이 갈린다.
 */
export function laneFactEntries(lanes = []) {
  return lanes.map((l) => {
    const 이름 = [...new Set(l.artifactRefs.map((a) => a.name))].join(' · ');
    const 파일 = l.artifactRefs.some((a) => a.kind === 'file');
    // 제목과 산출물 이름이 같으면 한 번만 말한다(실측: 두 번 반복돼 사실이 지저분했다).
    const 앞 = l.subject && l.subject !== 이름 ? `${l.subject} — ` : '';
    return {
      ref: l.laneId,
      kind: 'lane',
      statement: 파일 ? `${앞}만든 파일: ${이름}` : `${앞}정리한 답이 남아 있음`,
    };
  });
}

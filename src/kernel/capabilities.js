// L0 · 능력 문서 (P-ID-1) — "무엇을 어디까지 할 수 있는가" 를 한쪽에 정리한다.
//
// 구조(오너 제안): 문서로 정리하고, 상시로는 요약만 싣고 **필요할 때만 찾아** 반영한다.
// 그래야 상시 입력은 가볍고(계획서 Phase 2 다이어트) 깊이 물으면 정확하다(헌법 §5 자기파악).
//
// 문서는 두 구역이다:
//   · 자동 파생 — 등록된 도구·실행 가능 여부·승인 필요·위험 종류. **레지스트리에서 매번 생성**한다.
//     사용자가 도구를 늘리면 자동으로 늘어난다.
//   · 사람이 쓰는 설명 — 왜 있는지·한계·예시. 사용자가 편집한다(재생성해도 보존).
// **어긋남은 사고다**: 문서에만 있고 실제로 없는 능력을 주장하면 T5 가 자기 자신에 대해 거짓말한다
// (T3 "보이는 것≠되는 것"의 최악 형태). 파생 구역은 재생성으로 항상 사실과 맞춘다.
import { toolLabel, toolCapabilityLine } from './tool-labels.js';

/** "라벨 — 설명" 에서 설명만(문서에서 라벨은 이미 굵게 따로 쓴다 — 중복 표기 방지). */
function doesOnly(id, selfState) {
  const line = toolCapabilityLine(id, selfState);
  const label = toolLabel(id, selfState);
  return line.startsWith(`${label} — `) ? line.slice(label.length + 3) : line;
}

export const DERIVED_BEGIN = '<!-- derived:begin — 이 구역은 자동으로 다시 만들어집니다. 직접 고치지 마세요 -->';
export const DERIVED_END = '<!-- derived:end -->';

/** 권한 종류 → 사용자 언어(위험 성격). 헌법 §5 "어떤 실행이 위험한가". */
const RISK_BY_KIND = {
  send: '바깥으로 나갑니다(보낸 뒤에는 되돌릴 수 없어요)',
  organize: '이 컴퓨터의 파일을 다룹니다',
  read: '읽기만 합니다',
};

/** 실행 불가 사유 → 사용자 언어. 헌법 §5 "각각 실행 가능한가". */
const BLOCKED_REASON = {
  needs_connection: '아직 연결되지 않았어요',
  needs_auth: '로그인이 필요해요',
  needs_config: '설정이 더 필요해요',
  blocked: '지금은 쓸 수 없어요',
};

/**
 * SelfState 에서 능력 사실을 뽑는다(헌법 §5 다섯 항목).
 * @param {import('./contracts.js').SelfStateSnapshot} selfState
 */
export function buildCapabilityFacts(selfState) {
  const tools = selfState.connectedTools ?? [];
  const ready = tools.filter((t) => t.executable);
  const blocked = tools.filter((t) => !t.executable);
  return {
    model: {
      id: selfState.currentModel?.id ?? null,
      strengths: selfState.currentModel?.strengths ?? null,
      limits: selfState.limits ?? [],
      authState: selfState.modelAuthState,
      healthState: selfState.modelHealthState,
      status: selfState.modelStatus,
      ready: selfState.modelReady,
    },
    ready: ready.map((t) => ({
      label: t.label ?? t.id,
      does: doesOnly(t.id, selfState),
      needsApproval: Boolean(t.needsApproval),
      risk: RISK_BY_KIND[t.toolKind] ?? null,
      // P0-b: 작업 폴더보다 넓게 읽는 손은 그 사실을 여기까지 들고 온다. 능력을 줄이는 대신
      // **어디까지 보는지를 사용자가 알 수 있게** 한다(descriptor 선언이 유일한 진실).
      readReach: t.readReach ?? null,
    })),
    blocked: blocked.map((t) => ({
      label: t.label ?? t.id,
      why: BLOCKED_REASON[t.status] ?? BLOCKED_REASON.blocked,
    })),
    granted: selfState.grantedAuthorities ?? [],
    nextSafeAction: selfState.nextSafeAction ?? null,
  };
}

/** 상시 프롬프트용 개수 요약(정체 사실 한 줄에 쓴다). */
export function capabilityCounts(facts) {
  return {
    ready: facts.ready.length,
    needsApproval: facts.ready.filter((r) => r.needsApproval).length,
    blocked: facts.blocked.length,
  };
}

/**
 * 파생 구역 본문(마크다운). 헌법 §5 다섯 항목을 모두 담는다 — 필요한 걸 빼지 않는다.
 * @param {ReturnType<typeof buildCapabilityFacts>} facts
 */
export function renderDerivedSection(facts) {
  const out = ['## 지금 할 수 있는 일', ''];
  if (facts.ready.length) {
    for (const r of facts.ready) {
      const marks = [r.needsApproval ? '보내기 전 확인을 받습니다' : null, r.risk, r.readReach].filter(Boolean);
      out.push(`- **${r.label}** — ${r.does}${marks.length ? `\n  - ${marks.join(' / ')}` : ''}`);
    }
  } else {
    out.push('- 아직 바로 쓸 수 있는 도구가 없어요.');
  }
  out.push('', '## 지금은 못 하는 일', '');
  if (facts.blocked.length) {
    for (const b of facts.blocked) out.push(`- **${b.label}** — ${b.why}`);
  } else {
    out.push('- 막힌 것은 없어요.');
  }
  out.push('', '## 지금 쓰는 모델', '');
  out.push(`- ${facts.model.id ?? '없음'}${facts.model.strengths ? ` — ${facts.model.strengths}` : ''}`);
  if (facts.model.limits.length) out.push(`- 한계: ${facts.model.limits.join(' · ')}`);
  if (facts.nextSafeAction) {
    out.push('', '## 막혔을 때', '', `- ${facts.nextSafeAction}`);
  }
  return out.join('\n');
}

/**
 * 문서에서 파생 구역만 갈아끼운다. 사람이 쓴 구역은 **건드리지 않는다**.
 * @param {string|null} existing @param {string} derived
 */
export function replaceDerivedSection(existing, derived) {
  const block = `${DERIVED_BEGIN}\n\n${derived}\n\n${DERIVED_END}`;
  if (!existing) return `${CAPABILITY_HEADER}\n\n${block}\n\n${HUMAN_SECTION_SEED}\n`;
  const b = existing.indexOf(DERIVED_BEGIN);
  const e = existing.indexOf(DERIVED_END);
  if (b < 0 || e < 0 || e < b) return `${existing.trimEnd()}\n\n${block}\n`; // 표식이 없으면 뒤에 붙인다
  return existing.slice(0, b) + block + existing.slice(e + DERIVED_END.length);
}

export const CAPABILITY_HEADER = `# GPAO-T5 · 할 수 있는 일

> 위쪽 구역은 지금 실제 상태에서 자동으로 다시 만들어집니다.
> 아래 "직접 적는 메모"는 사용자가 자유롭게 쓰는 곳이고, 다시 만들어도 지워지지 않습니다.`;

export const HUMAN_SECTION_SEED = `## 직접 적는 메모

여기에는 자유롭게 적으세요. 예를 들면:

- 이 도구를 주로 어떤 일에 쓰는지
- 하지 말았으면 하는 것
- 자주 쓰는 사이트나 파일 위치
`;

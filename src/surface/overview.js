// L4 · Status Overview (P6-18 Slice-1) — 조용한 단일 진입점의 상태 요약(읽기 전용).
// **안티 대시보드(§5.5)**: 상시 패널이 아니라 사용자가 열 때만 보는 요약. 실행/승격 버튼 없음(읽기 전용).
// 핵심: P6-14~17에서 누적된 "반드시 구분"을 **구조에 박는다** — 각 항목이 두 범주를 별도 필드로 낸다.
//   연결 상태 ↔ 실제 가능 · 추천 스킬 ↔ 활성 스킬 · 추정된 성향 ↔ 반영 중 선호 · 전달 실패 ↔ 완료.
// 이미 만든 projection(projectChannels/skillView/projectUserModel/delivery)을 조합만 한다(신규 상태 없음).

/**
 * @param {Object} p
 * @param {Array} [p.channels]     projectChannels 결과({label, ready, userSafe})
 * @param {Array} [p.skills]       skillView 결과({label, state})
 * @param {{inferredTraits?:Array, operatingPreferences?:Array}} [p.userModel]  projectUserModel 결과
 * @param {Array} [p.deliveries]   세션 스코프 delivery({tool, target, state})
 */
export function buildOverview(p = {}) {
  const channels = p.channels ?? [];
  const skills = p.skills ?? [];
  const um = p.userModel ?? { inferredTraits: [], operatingPreferences: [] };
  const deliveries = p.deliveries ?? [];
  return {
    // 연결 상태 ↔ 실제 가능 상태(2.0-A·§6.15). ready만 "실제로 받을 수 있음".
    connections: {
      ready: channels.filter((c) => c.ready).map((c) => ({ label: c.label })),
      notReady: channels.filter((c) => !c.ready).map((c) => ({ label: c.label, userSafe: c.userSafe })),
    },
    // 추천된 스킬 ↔ 활성화된 스킬(§6.17). 추천은 실행/설치 아님.
    skills: {
      recommended: skills.filter((s) => s.state === 'candidate' || s.state === 'replay_required').map((s) => ({ label: s.label })),
      active: skills.filter((s) => s.state === 'admitted').map((s) => ({ label: s.label })),
    },
    // 추정된 성향(관찰만, 영향 0) ↔ 반영 중 선호(admitted, §6.18). 추정은 "T5가 나를 반영한다"가 아니다.
    preferences: {
      inferred: (um.inferredTraits ?? []).map((t) => ({ statement: t.statement })),
      reflected: (um.operatingPreferences ?? []).filter((x) => x.admitted).map((x) => ({ statement: x.statement })),
    },
    // 전달 실패(다시 보낼 수 있음) ↔ 완료(§6.13). 실패는 완료로 보이지 않는다.
    deliveries: {
      failed: deliveries.filter((d) => d.state === 'failed').map((d) => ({ label: d.tool, target: d.target })),
      deliveredCount: deliveries.filter((d) => d.state === 'delivered').length,
    },
  };
}

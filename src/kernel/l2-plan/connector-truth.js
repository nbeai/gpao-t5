// L2 · Connector Truth Layer (P5-B-0)
//
// 외부 손발이 늘어도 **T5 의 자기 인식이 흔들리지 않게** 하는 층이다.
// 커넥터를 많이 붙이는 것이 목적이 아니다 — 진실이 한 곳에서 파생되게 하는 것이 목적이다.
//
// 여기는 **순수 파생**이다. 상태를 저장하지 않고, 새 판정을 만들지 않는다:
//   · 실행 가능성  ← selfState(toolReality)         "지금 되는가 / 왜 아직 아닌가"
//   · 도구 목록    ← ToolDescriptor.connector       "어느 서비스의 손인가"(수동 목록 금지)
//   · 승인 정책    ← needsApproval·toolKind         "무엇이 확인을 받아야 하는가"
//   · 서비스 정보  ← ConnectorDescriptor            "이 서비스가 무엇이고 뭘 갖춰야 하는가"
//
// 이 넷을 한 자리에서 합치기만 한다. 어느 하나를 여기서 다시 정하면 그 순간 두 진실이 된다.
import { reasonLabel } from '../l0-evidence/self-state.js';

/**
 * 커넥터 하나의 현재 진실. **UI 가 아니라 데이터**다 — 화면은 이걸 그리기만 한다.
 * @typedef {Object} ConnectorTruth
 * @property {string} id
 * @property {string} label
 * @property {boolean} connected
 * @property {Array<{id:string,label:string,executable:boolean,reason?:string,reasonLabel?:string,needsApproval:boolean,inModelSchema:boolean}>} tools
 * @property {string[]} userJobs        지금 실제로 되는 일(사용자 말)
 * @property {string[]} jobsWhenConnected 연결하면 되는 일(사용자 말)
 */

/**
 * @param {Array} connectors  ConnectorDescriptor 목록
 * @param {{connectedTools?:Array}} selfState
 * @param {Array} [descriptors] ToolDescriptor 목록(도구→커넥터 연결을 읽는다)
 * @returns {ConnectorTruth[]}
 */
export function connectorTruth(connectors = [], selfState = {}, descriptors = []) {
  const 도구상태 = new Map((selfState.connectedTools ?? []).map((t) => [t.id, t]));
  // 도구 → 커넥터. **descriptor 가 말한 것만** 쓴다(여기서 이름으로 추측하지 않는다).
  const 소속 = new Map();
  for (const d of descriptors) if (d?.connector) 소속.set(d.id, d.connector);

  return connectors.map((c) => {
    const tools = descriptors
      .filter((d) => 소속.get(d.id) === c.id)
      .map((d) => {
        const t = 도구상태.get(d.id);
        const executable = Boolean(t?.executable);
        return {
          id: d.id,
          label: d.label ?? d.id,
          executable,
          reason: t?.reason,
          reasonLabel: reasonLabel(t?.reason),
          needsApproval: Boolean(d.needsApproval),
          // **모델에게 보이는가.** 불변식(schema ⊆ executable)을 데이터로도 확인할 수 있게 싣는다.
          inModelSchema: executable && Boolean(d.schema),
          capability: d.capability,
        };
      });
    const 됨 = tools.some((t) => t.executable);
    return {
      id: c.id,
      label: c.label,
      category: c.category ?? c.kind,
      connected: Boolean(c.connected),
      // 커넥터의 상태도 **도구에서 파생**한다 — 커넥터에 따로 적어 두면 도구와 어긋난다.
      executable: 됨,
      reason: 됨 ? undefined : (tools[0]?.reason ?? (c.connected ? 'error' : 'needs_connection')),
      tools,
      // 사용자 말: 지금 되는 일과, 연결하면 되는 일을 **나눠서** 말한다.
      // 이 구분이 없으면 "할 수 있다"와 "연결하면 할 수 있다"가 섞여 거짓 약속이 된다.
      userJobs: 됨 ? (c.userJobs ?? []) : [],
      jobsWhenConnected: 됨 ? [] : (c.userJobs ?? []),
      requiredSetup: c.requiredSetup ?? [],
      setupGuide: c.setupGuide,
      limits: c.limits ?? [],
      localeRelevance: c.localeRelevance,
      // P5-B-1A: 이 컴퓨터에서 직접 확인한 흔적 — 데이터 표면도 같은 사실을 본다(§8).
      ...(c.localSignsResult?.length ? { localSigns: c.localSignsResult } : {}),
      lastCheckedAt: c.lastCheckedAt,
      lastError: c.lastError,
    };
  });
}

/**
 * 어느 커넥터에도 속하지 않는 도구(T5 자체의 손 — 파일·터미널·브라우저 등).
 * 연결 센터가 "내장"으로 따로 보여줄 수 있게 같은 모양으로 낸다.
 */
export function builtinTools(selfState = {}, descriptors = []) {
  return descriptors
    .filter((d) => !d?.connector)
    .map((d) => {
      const t = (selfState.connectedTools ?? []).find((x) => x.id === d.id);
      const executable = Boolean(t?.executable);
      return {
        id: d.id,
        label: d.label ?? d.id,
        executable,
        reason: t?.reason,
        reasonLabel: reasonLabel(t?.reason),
        needsApproval: Boolean(d.needsApproval),
        inModelSchema: executable && Boolean(d.schema),
        capability: d.capability,
      };
    });
}

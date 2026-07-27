// L3 · 선언형 CLI 도구 (P5-B-1B, 연결 방식 kind: cli)
//
// 다섯 방식 중 **토큰이 없는 유일한 것**이다. 받을 비밀도, 열 동의 화면도, 갱신할 자격도 없다.
// 그래서 이 방식이 "상태 언어가 진짜 공통인가"를 시험한다 — 여기서도 같은 말로 설명되면
// (연결 안 됨 / 준비 필요 / 쓸 수 있음) 그 언어가 연결 방식에 매여 있지 않다는 뜻이다.
//
// 사용자 입장에서 이건 **"이미 컴퓨터에 깔린 프로그램도 T5 가 쓸 수 있다"** 이다.
// 없으면 없다고 말하되, 어디서 받는지까지 알려 준다(막다른 답 금지).
//
// **새 안전 체계를 만들지 않는다.** 실행은 기존 터미널 실행기(runCommand)를 그대로 타고,
// 승인은 기존 판정(toolActionKind → decideAutoGrant)이 그대로 다룬다.
import { defineTool, toConnection } from '../kernel/l2-plan/tool-descriptor.js';
import { runCommand } from './terminal-run.js';

/** 셸에 넘길 때 통째로 따옴표에 넣는다 — 사용자 말이 명령으로 새지 않게(주입 차단). */
function 감싸기(s) {
  return `'${String(s ?? '').replace(/'/g, "'\\''")}'`;
}

/** 선언한 자리에 값을 끼운다. **인자는 값으로만 들어간다** — 명령 조각이 될 수 없다. */
function 채우기(틀, 값들) {
  return String(틀 ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in 값들 ? String(값들[k]) : m));
}

export const cliToolId = (connectorId, name) => `${connectorId}.${name}`;

/** 선언 하나 → 실제로 돌릴 명령 문자열. 인자는 전부 따옴표 안에 들어간다. */
export function buildCommand(run = {}, 값들 = {}) {
  const args = (run.args ?? []).map((a) => 감싸기(채우기(a, 값들)));
  return [run.command, ...args].filter(Boolean).join(' ');
}

/**
 * 이 컴퓨터에 그 명령이 있는가. **사용자에게 확인시키지 않는다** — T5 가 본다(P5-B-1A 와 같은 자리).
 * @returns {Promise<{installed:boolean, where?:string}>}
 */
export async function probeCli(command, { run = runCommand } = {}) {
  if (!command) return { installed: false };
  const r = await run(`command -v ${감싸기(command)}`, { mode: 'probe', timeoutMs: 10_000 })
    .catch(() => null);
  const where = String(r?.stdout ?? '').trim().split('\n')[0];
  return where ? { installed: true, where } : { installed: false };
}

export function cliToolDescriptor({ connector, tool }) {
  return defineTool({
    id: cliToolId(connector.id, tool.name),
    label: tool.label ?? tool.name,
    owner: 'connector',
    connector: connector.id,
    availability: [{ kind: 'connected' }],
    toolKind: tool.toolKind ?? 'unknown_kind',
    needsApproval: tool.toolKind !== 'read',
    reversible: tool.toolKind === 'read' ? true : undefined,
    capability: tool.capability ?? `${connector.label}의 ${tool.label ?? tool.name}`,
    schema: {
      description: tool.description ?? tool.capability ?? tool.name,
      parameters: tool.parameters ?? { type: 'object', properties: {} },
    },
  });
}

export function makeCliToolHandler({ tool, connector, run = runCommand, timeoutMs = 60_000 }) {
  return async function handler(args = {}) {
    const 값들 = { ...(tool.defaults ?? {}), ...args };
    const command = buildCommand(tool.run, 값들);
    // 읽기만 하는 손은 **이 컴퓨터의 것을 하나도 못 바꾸는 자리**에서 돈다(reach).
    // 그 외는 기존 승인을 통과한 뒤이므로 granted 로 간다 — 판정은 여기서 하지 않는다.
    const mode = tool.toolKind === 'read' ? 'reach' : 'granted';
    let r;
    try {
      r = await run(command, { mode, timeoutMs, cwd: tool.cwd });
    } catch {
      return { failed: true, userSafeSummary: `${connector.label}을(를) 실행하지 못했어요.`,
        nextSafeAction: '다른 방법으로 이어가 볼까요?' };
    }
    const out = String(r?.stdout ?? '').trim();
    if (r?.exitCode !== 0) {
      // 오류 원문을 사용자면에 그대로 옮기지 않는다 — 경로·토큰이 섞여 나오는 명령이 있다.
      return {
        failed: true,
        userSafeSummary: `${connector.label}이 이 일을 끝내지 못했어요.`,
        diagnosticTrace: String(r?.stderr ?? '').slice(0, 500),
        nextSafeAction: '연결 상태를 다시 확인해 볼까요?',
      };
    }
    let result;
    try { result = JSON.parse(out); } catch { result = { text: out }; }
    return { result, userSafeSummary: `${connector.label}에서 ${tool.label ?? tool.name} 확인했어요.` };
  };
}

/**
 * 선언된 CLI 손들을 편입한다. **MCP·HTTP 와 똑같이 세 자리를 함께** 갱신한다 —
 * 통로가 셋이어도 편입은 하나여야 `schema ⊆ executable ⊆ 손` 이 저절로 유지된다.
 */
export function admitCliTools({ connector, tools, run }, ctx) {
  const admitted = [];
  for (const tool of tools ?? []) {
    if (!tool?.name || !tool?.run?.command) continue;
    const d = cliToolDescriptor({ connector, tool });

    ctx.tools.tools[d.id] = {
      toolKind: d.toolKind,
      previewOf(args = {}) {
        return {
          impact: `${connector.label}에서 ${d.label} 해요`,
          // **무엇이 실제로 돌아가는지 숨기지 않는다.** 승인 카드는 판단할 것을 보여줘야 한다.
          scope: `이 컴퓨터에서 실행 · ${buildCommand(tool.run, { ...(tool.defaults ?? {}), ...args })}`,
          duration: '이번 한 번',
          cancel: tool.toolKind === 'read' ? '읽기만 해서 되돌릴 것이 없어요' : '되돌리기는 이 명령이 하는 일에 따라요',
        };
      },
      handler: makeCliToolHandler({ tool, connector, run }),
    };

    const i = ctx.descriptors.findIndex((x) => x.id === d.id);
    if (i >= 0) ctx.descriptors[i] = d; else ctx.descriptors.push(d);

    const conn = { ...toConnection(d, { connected: true }), hasHandler: true };
    const ci = ctx.env.connections.findIndex((x) => x.id === d.id);
    if (ci >= 0) ctx.env.connections[ci] = conn; else ctx.env.connections.push(conn);

    admitted.push(d.id);
  }
  return admitted;
}

// L3 · 연결 실행 손 (P5-B-1B, 층의 4단계 Connection Orchestration)
//
// **이것이 없어서 T5 는 "붙여줘"에 떠넘겼다.** 실측(오너 대화, 2026-07-27):
//   "이 세션에 MCP 재연결/인증을 실행하는 손이 열려 있지 않아"(T5 원문 요지)
//   "네가 지금 해야 할 최소 행동은 Codex/ChatGPT 의 MCP 화면에서 …"
// 진단은 정확했다. 상태는 볼 수 있는데(P5-B-1A) **연결을 실행할 손이 없어서** 남은 선택이
// 남의 도구 설정으로 사용자를 보내는 것뿐이었다.
//
// **커널도 이 손도 서비스를 모른다.** 커넥터가 `authMethods` 로 연결 방식을 선언하고,
// 여기는 방식(kind)별 실행기만 안다 — previewOf·subjectOf·localSigns 와 같은 계약이다.
// 새 서비스 = 선언 하나. 실행기는 **새 연결 방식**이 생길 때만 는다.
import { probeMcpServer } from './mcp-client.js';
import { admitMcpTools, revokeAdmitted } from './tool-admission.js';

/** 등록된 MCP 설정에서 이 서버의 전송 설정을 찾는다(설정 파일이 진실 — 우리가 지어내지 않는다). */
async function findMcpConfig(server, deps) {
  const { readFile } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const 홈풀기 = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
  const paths = deps.mcpConfigPaths ?? [
    '~/Library/Application Support/Claude/claude_desktop_config.json',
    '~/.claude.json',
    '~/.codex/config.toml',
  ];
  for (const raw of paths) {
    const p = 홈풀기(raw);
    const text = await readFile(p, 'utf8').catch(() => undefined);
    if (!text) continue;
    if (p.endsWith('.toml')) {
      // 의존성 0 — 이 서버 블록만 훑는다. url 이면 원격, command/args 면 stdio.
      const block = text.split(new RegExp(`^\\s*\\[mcp_servers\\.${server}\\]\\s*$`, 'm'))[1];
      if (!block) continue;
      const head = block.split(/^\s*\[/m)[0];
      const url = head.match(/^\s*url\s*=\s*"([^"]+)"/m)?.[1];
      if (url) return { url, where: p };
      const command = head.match(/^\s*command\s*=\s*"([^"]+)"/m)?.[1];
      const argsRaw = head.match(/^\s*args\s*=\s*\[([^\]]*)\]/m)?.[1];
      if (command) {
        const args = (argsRaw ?? '').split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
        return { command, args, where: p };
      }
      continue;
    }
    try {
      const j = JSON.parse(text);
      const all = { ...(j.mcpServers ?? {}), ...(j.mcp_servers ?? {}) };
      for (const proj of Object.values(j.projects ?? {})) Object.assign(all, proj?.mcpServers ?? {});
      const hit = all[server] ?? all[Object.keys(all).find((k) => k.toLowerCase().includes(server.toLowerCase())) ?? ''];
      if (hit) return { ...hit, where: p };
    } catch { /* 깨진 설정은 없는 것으로 */ }
  }
  return undefined;
}

/**
 * 연결 실행 손. **연결의 성공은 토큰이 아니라 부를 수 있는 손이 올라온 순간이다** —
 * 그래서 편입(admission)까지 끝나야 성공이라 말한다.
 * @param {{ctx:()=>({tools:object, descriptors:Array, env:object}), connectors:()=>Array}} deps
 */
/** 연결 방식의 **표시 이름**. 내부 kind 를 화면에 그대로 흘리지 않되, 사실은 남긴다. */
function 방식이름(kind) {
  switch (kind) {
    case 'mcp': return 'MCP';
    case 'oauth_pkce': return '계정 로그인(OAuth)';
    case 'api_key': return 'API 키';
    case 'cli': return '설치된 명령';
    default: return kind;
  }
}

export function makeConnectorConnectTool(deps = {}) {
  // 붙어 있는 MCP 세션 — 끊을 때 닫아야 하므로 들고 있는다(프로세스가 남으면 그게 유령이다).
  const live = new Map(); // connectorId → { session, admitted:string[] }

  return {
    toolKind: 'unknown_kind', // 외부 계정 접근 권한을 주는 일 — 기존 권한 층이 승인으로 다룬다
    previewOf(args = {}) {
      const id = String(args.connector ?? '').trim();
      const c = (deps.connectors?.() ?? []).find((x) => x.id === id || x.label === id
        || (x.aliases ?? []).includes(id));
      const 이름 = c?.label ?? id;
      // 받침에 따라 조사를 고른다 — 작아 보이지만 "노션 를" 같은 문장은 사용자를 멈칫하게 한다.
      const 을를 = /[가-힣]$/.test(이름) && (이름.charCodeAt(이름.length - 1) - 0xac00) % 28 ? '을' : '를';
      if (args.action === 'disconnect') {
        return {
          impact: `${이름} 연결을 끊어요`,
          scope: '저장된 연결 정보를 지우고, 그동안 쓰던 기능을 내려요',
          duration: '다시 연결하기 전까지',
          cancel: '언제든 다시 연결할 수 있어요',
        };
      }
      // **사용자가 판단할 것이 앞, 기술 사실은 뒤**(오너 기준). 리모컨에 적외선 프로토콜을
      // 앞세우지 않지만, 뒷면에 규격을 적어 두기는 한다 — 나중에 물을 때 답이 되고 원장과도 맞는다.
      // 숨기는 것과 앞세우지 않는 것은 다르다.
      const 방식 = [...new Set((c?.authMethods ?? []).map((m) => 방식이름(m.kind)))].join('·');
      return {
        impact: `${이름}${을를} T5에 연결해요`,
        scope: (c?.userJobs?.length
          ? `연결하면 이런 걸 할 수 있어요 — ${c.userJobs.join(' · ')}`
          : `${이름}에서 자료를 가져올 수 있게 돼요`)
          + (방식 ? ` (연결 방식: ${방식})` : ''),
        // 사용자 계정에 접근하는 일이라는 사실은 사람 말로 남긴다(경계는 숨기지 않는다).
        what: `${이름} 계정에 접근할 수 있게 허락하는 거예요. 위험한 작업은 그때 또 따로 확인받아요.`,
        duration: '끊을 때까지',
        cancel: '"연결 끊어줘"라고 하시면 바로 해제해요',
      };
    },
    subjectOf(rec) {
      const id = rec?.result?.connector;
      return id ? { key: `connector:${id}`, kind: 'connector', label: String(rec.result.label ?? id) } : null;
    },
    async handler(args = {}) {
      const ctx = deps.ctx?.();
      const connectors = deps.connectors?.() ?? [];
      const id = String(args.connector ?? '').trim();
      const c = connectors.find((x) => x.id === id || x.label === id || (x.aliases ?? []).includes(id));
      if (!c) {
        return { blocked: true, userSafeSummary: `"${id}" 라는 서비스는 제가 아는 목록에 없어요.`,
          nextSafeAction: '어떤 서비스인지 알려주시면 연결할 수 있는지 확인해 볼게요.' };
      }
      if (!ctx) return { failed: true, userSafeSummary: '지금은 연결을 실행할 수 없어요.' };

      // ── 해제 ──────────────────────────────────────────────────────────
      if (args.action === 'disconnect') {
        const held = live.get(c.id);
        if (!held) return { result: { connector: c.id, label: c.label, connected: false }, userSafeSummary: `${c.label} 은(는) 연결돼 있지 않아요.` };
        held.session?.close?.();
        revokeAdmitted(held.admitted, ctx);
        live.delete(c.id);
        c.connected = false;
        return { result: { connector: c.id, label: c.label, connected: false, removed: held.admitted.length },
          userSafeSummary: `${c.label} 연결을 끊었어요. 관련 도구도 내렸어요.` };
      }

      // ── 연결 ──────────────────────────────────────────────────────────
      const methods = c.authMethods ?? [];
      if (!methods.length) {
        return { blocked: true, userSafeSummary: `${c.label} 은(는) 아직 연결 방법이 준비되지 않았어요.`,
          nextSafeAction: '지금 되는 다른 길로 먼저 도와드릴 수 있어요.' };
      }
      const 실패 = [];
      for (const m of methods) {
        if (m.kind !== 'mcp') { 실패.push(`${m.kind}: 아직 이 방식은 실행기가 없어요`); continue; }
        const cfg = await findMcpConfig(m.server, deps);
        if (!cfg) { 실패.push(`mcp: ${m.server} 서버 설정을 못 찾았어요`); continue; }
        const probe = await probeMcpServer(cfg, deps);
        if (!probe.ok) { 실패.push(`mcp: ${probe.reason}`); continue; }

        // **편입까지 끝나야 연결이다.** 도구가 하나도 안 올라오면 연결이라 부르지 않는다.
        const { admitted } = admitMcpTools(
          { server: m.server, connector: c.id, tools: probe.tools, session: probe.session }, ctx,
        );
        if (!admitted.length) {
          probe.session.close();
          실패.push('mcp: 붙었지만 쓸 수 있는 도구가 없었어요');
          continue;
        }
        live.set(c.id, { session: probe.session, admitted });
        c.connected = true;
        c.lastCheckedAt = Date.now();
        c.lastError = undefined;
        return {
          result: { connector: c.id, label: c.label, connected: true, tools: admitted, method: m.kind, server: m.server },
          userSafeSummary: `${c.label} 에 연결했어요. 이제 ${admitted.length}개를 바로 쓸 수 있어요.`,
        };
      }
      c.lastError = 실패[0];
      return { blocked: true, userSafeSummary: `${c.label} 연결이 아직 안 됐어요. (${실패.join(' / ')})`,
        nextSafeAction: '지금 되는 다른 길로 먼저 해드릴까요?' };
    },
  };
}

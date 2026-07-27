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
import { openHttpMcp, probeRemoteAuth } from './mcp-http.js';
import { runOAuth, refreshTokens } from './oauth-pkce.js';
import { secretFields, missingFields, verifyApiKey } from './api-key.js';
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
 * 원격 MCP 하나를 연다. **토큰은 이 함수 밖으로 나가지 않는다** — 세션 안에서만 쓰인다.
 * 저장된 자격이 있으면 재로그인 없이 붙고(껐다 켜도 유지), 없거나 만료됐으면 그때 동의를 받는다.
 * @returns {Promise<{ok:true, session:object, tools:Array}|{ok:false, reason:string}>}
 */
async function openRemoteMcp(connectorId, url, deps) {
  const store = deps.credentialStore;
  let saved = store ? await store.get(connectorId) : deps.savedCredential?.(connectorId) ?? null;

  // 저장된 것이 이 주소용이 아니면 다시 받는다(주소가 바뀌면 토큰도 남의 것이다).
  if (saved && saved.url !== url) saved = null;

  const 로그인 = async () => {
    const probe = await probeRemoteAuth(url, { fetchImpl: deps.fetchImpl });
    if (!probe.needsAuth) return { none: true }; // 인증 없이 되는 서버 — 토큰 없이 간다
    if (!probe.resourceMetadataUrl) return { reason: '로그인이 필요한데 어디서 하는지를 서버가 알려주지 않았어요' };
    const r = await runOAuth({
      resourceMetadataUrl: probe.resourceMetadataUrl,
      fetchImpl: deps.fetchImpl, opener: deps.opener, timeoutMs: deps.oauthTimeoutMs,
    });
    if (!r.ok) return { reason: r.reason };
    saved = { url, clientId: r.clientId, endpoints: r.endpoints, tokens: r.tokens };
    if (store) await store.set(connectorId, saved);
    return { ok: true };
  };

  if (!saved) {
    const r = await 로그인();
    if (r.reason) return { ok: false, reason: r.reason };
  }

  // 부를 때마다 유효한 토큰을 준다 — 만료 직전이면 조용히 갱신한다(사용자는 모른다).
  const getToken = async () => {
    if (!saved) return null;
    const 이전 = saved.tokens?.access_token;
    const t = await refreshTokens(saved, { fetchImpl: deps.fetchImpl });
    // **바뀌었을 때만 쓴다.** 안 그러면 도구를 부를 때마다 자격 파일을 다시 쓴다(실측: 매 호출).
    if (t && t !== 이전 && store) await store.set(connectorId, saved);
    return t;
  };

  const 열기 = async () => {
    const session = openHttpMcp({ url, getToken, fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs });
    await session.initialize();
    return { ok: true, session, tools: await session.listTools() };
  };

  try {
    return await 열기();
  } catch (e) {
    // 저장된 자격이 서버에서 폐기됐을 수 있다 — 한 번만 다시 로그인하고 재시도한다.
    if (e?.unauthorized && saved) {
      saved = null;
      if (store) await store.clear(connectorId);
      const r = await 로그인();
      if (r.reason) return { ok: false, reason: r.reason };
      try { return await 열기(); } catch (e2) { return { ok: false, reason: e2?.message ?? 'mcp_failed' }; }
    }
    if (e?.unauthorized) return { ok: false, reason: '로그인이 필요한데 승인을 받지 못했어요' };
    return { ok: false, reason: e?.message ?? 'mcp_failed' };
  }
}

/**
 * API 키로 붙인다. 값이 비어 있으면 **입력창을 열어 달라는 요청**을 돌려주고 멈춘다.
 * 값이 있으면 저장된 값으로 T5 가 직접 확인하고, 확인이 성공해야 손을 올린다.
 * @returns {Promise<{ok:true,result:object}|{needsSecret:object}|{ok:false,reason:string}>}
 */
async function connectApiKey(c, m, deps) {
  const store = deps.credentialStore;
  const saved = store ? await store.get(c.id) : null;
  const 값들 = saved?.values ?? {};
  const 빈칸 = missingFields(m, 값들);

  if (빈칸.length) {
    // 무엇이 필요한지만 말한다 — 값은 이 경로로 오가지 않는다.
    // **막힌 것으로 남긴다**(blocked). 아직 못 했으니까. 다만 막다른 답이 아니라 다음 길을 함께 낸다.
    return {
      needsSecret: {
        blocked: true,
        surfaceRequest: {
          kind: 'secret_input',
          connector: c.id, label: c.label, fields: secretFields(m),
        },
        userSafeSummary: `${c.label} 연결에는 ${secretFields(m).map((f) => f.label).join('·')}가 필요해요.`
          + ' 안전하게 입력할 창을 열게요. 여기 입력한 값은 대화에 남지 않고 연결 확인에만 써요.',
        nextSafeAction: '입력창에서 값을 넣어 주시면 바로 확인하고 연결할게요.',
      },
    };
  }

  // **저장했다고 연결이 아니다.** 커넥터가 선언한 방법으로 한 번 불러 본다.
  const v = await verifyApiKey(m, 값들, { fetchImpl: deps.fetchImpl });
  if (!v.ok) return { ok: false, reason: v.reason };

  const 손 = await deps.admitApiKeyTools?.(c, m, 값들);
  if (deps.admitApiKeyTools && !(손?.length)) return { ok: false, reason: '확인은 됐는데 쓸 수 있는 손이 안 올라왔어요' };

  if (store) await store.set(c.id, { ...saved, kind: 'api_key', values: 값들, verifiedAt: Date.now() });
  c.connected = true;
  c.lastCheckedAt = Date.now();
  c.lastError = undefined;
  return {
    ok: true,
    result: {
      // 원장에 남는 것: 무엇을 채웠는가·확인됐는가. **값도 마스킹도 없다.**
      result: { connector: c.id, label: c.label, connected: true, method: 'api_key',
        tools: 손 ?? [], filled: Object.keys(값들), verified: true },
      userSafeSummary: `${c.label} 에 연결했어요. 입력하신 값으로 실제로 확인까지 마쳤어요.`,
    },
  };
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
    /**
     * **비밀 통로.** 값은 여기로만 들어오고, 여기서 바로 0600 저장소로 간다 —
     * 턴·transcript·원장·모델 입력 어디도 지나지 않는다. 돌려주는 것에도 값이 없다.
     * 저장한 뒤 곧바로 확인·편입까지 해서, "저장됨"이 아니라 "연결됨"으로 끝낸다.
     */
    async submitSecret(connectorId, values = {}) {
      const c = (deps.connectors?.() ?? []).find((x) => x.id === connectorId);
      const m = (c?.authMethods ?? []).find((x) => x.kind === 'api_key');
      if (!c || !m) return { ok: false, userSafeSummary: '어떤 서비스의 값인지 확인하지 못했어요.' };

      const 받을것 = new Set(secretFields(m).map((f) => f.name));
      // **선언된 칸만 받는다.** 아무 이름이나 받으면 저장소가 남의 값을 담는 통이 된다.
      const 값들 = Object.fromEntries(Object.entries(values)
        .filter(([k, v]) => 받을것.has(k) && String(v ?? '').trim())
        .map(([k, v]) => [k, String(v)]));
      const 빈칸 = missingFields(m, 값들);
      if (빈칸.length) {
        return { ok: false, missing: 빈칸, userSafeSummary: '빈 칸이 있어요. 채워 주시면 바로 확인할게요.' };
      }
      const store = deps.credentialStore;
      if (store) await store.set(c.id, { kind: 'api_key', values: 값들 });

      const r = await connectApiKey(c, m, deps);
      if (r.ok) return { ok: true, ...r.result };
      // **확인에 실패하면 저장해 둔 값을 지운다** — 안 되는 값을 들고 "연결됨"처럼 굴지 않는다.
      if (store) await store.clear(c.id);
      return { ok: false, userSafeSummary: `${c.label} 연결이 안 됐어요. ${r.reason ?? ''}`.trim(),
        nextSafeAction: '값을 다시 확인해서 넣어 주시면 바로 다시 해볼게요.' };
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
        // **저장된 자격은 세션과 무관하게 지운다.** 안 그러면 "끊었어요"라고 말하고 토큰은 남는다 —
        // 사용자가 들은 말과 디스크의 사실이 어긋난다.
        await deps.credentialStore?.clear(c.id).catch(() => {});
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
        // ── API 키 방식 ────────────────────────────────────────────────
        // **여기서 키를 받지 않는다.** 받으면 그 순간 대화 기록·원장·모델 입력에 남는다.
        // 대화는 "입력창이 필요하다"까지만 만들고, 값은 다른 통로로 저장소에 곧장 간다.
        if (m.kind === 'api_key') {
          const r = await connectApiKey(c, m, deps);
          if (r.ok) return r.result;
          if (r.needsSecret) return r.needsSecret; // 사용자에게 안전 입력창을 열어 준다
          실패.push(`api_key: ${r.reason}`);
          continue;
        }
        if (m.kind !== 'mcp') { 실패.push(`${m.kind}: 아직 이 방식은 실행기가 없어요`); continue; }
        // 커넥터가 주소를 선언했으면 그것이 먼저다(등록된 설정이 없어도 붙을 수 있다).
        const cfg = m.url ? { url: m.url } : await findMcpConfig(m.server, deps);
        if (!cfg) { 실패.push(`mcp: ${m.server} 서버 설정을 못 찾았어요`); continue; }
        // 원격이면 로그인까지 우리가 실행한다 — 사용자가 하는 일은 동의 화면에서 허용 한 번뿐이다.
        const probe = cfg.url
          ? await openRemoteMcp(c.id, cfg.url, deps)
          : await probeMcpServer(cfg, deps);
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

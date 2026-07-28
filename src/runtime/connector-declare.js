// L3 · 낯선 서비스를 **연결 대상으로 올린다** (P-OP C).
//
// 실측(오너 라이브 2026-07-28): "카페24 주문 가져와줘" 에 T5 는 이 컴퓨터 안을 뒤지고
// 못 찾자 "관리자에서 CSV 로 내려받아 주세요"라고 답했다. 그게 그때는 정직한 최선이었다 —
// **낯선 서비스가 커넥터가 되는 길 자체가 없었기 때문이다.** 커넥터는 소스에 적힌 것만
// 존재했고, 비밀 입력면은 이미 선언된 id 만 받았다.
//
// 그래서 그 길을 연다. 그리고 **선언된 커넥터와 완전히 같은 길**을 타게 한다:
//   발견(선언 없음) → 붙는 방법 확인 → 여기서 선언 → 승인 카드 → 안전 입력면 → 확인 → 편입
// 갈래를 새로 만들지 않는다. 갈래를 만들면 낯선 서비스만 다른 규칙을 타고, 그게 곧
// 서비스별 처방이 된다(침범 목록).
//
// 목표는 주문을 무조건 가져오는 것이 아니라 **사용자 권한이 진짜로 필요한 경계만 남기는 것**이다.
// 값을 받아오는 곳까지 T5 가 안내하고, 사용자가 넘을 문턱은 "그 서비스에서 키를 받는다" 하나다.
import { createHash } from 'node:crypto';
import { checkDeclaredUrls, checkDeclaredTarget } from './declared-target.js';

/** 도구 id 에 쓸 수 있는 이름. 한글 라벨은 짧은 지문으로 바꾼다(모델 스키마가 ASCII 만 받는다). */
export function declaredId(label) {
  const slug = String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (slug.length >= 2) return `d-${slug.slice(0, 24)}`;
  return `d-${createHash('sha1').update(String(label ?? '')).digest('hex').slice(0, 8)}`;
}

// 문자열에 박힌 {자리표시자} 를 **전부** 꺼낸다.
//
// 실행기(http-tool.js)는 `\{(\w+)\}` 만 채운다. 그래서 `{주문개수}` 같은 한글 자리는 채워지는
// 일이 영영 없고 그 글자가 그대로 주소에 실려 나간다. 검사가 실행기보다 느슨하면 여기서
// 통과한 선언이 실행에서 깨진다 — 같은 사실을 두 층이 다르게 아는 것이고, 그러면 사용자는
// "연결됐다"는 말을 들은 뒤에 빈손이 된다. 넓게 꺼내서 좁게 인정한다.
const 자리표시자 = (s) => [...String(s ?? '').matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
/** 실행기가 실제로 채울 수 있는 이름인가(\w+ 만 채운다). */
const 채울수있는이름 = (name) => /^\w+$/.test(name);

/**
 * 선언이 실제로 굴러갈 수 있는가. **여기서 막지 않으면 "연결됐다"고 말한 뒤에 빈손이 된다.**
 * 되는지 두드려 보는 건 그 다음 층(probeHttpTool)의 일이고, 여기서는 모양만 본다.
 * @returns {{ok:true}|{ok:false, why:string}}
 */
export function checkDeclaration(decl = {}) {
  const label = String(decl.service ?? decl.label ?? '').trim();
  if (!label) return { ok: false, why: '어떤 서비스인지가 없어요' };

  // ── 원격 MCP ─────────────────────────────────────────────────────────
  // **사용자 문턱이 다르다.** API 키는 그 서비스 개발자 화면에서 값을 받아 와야 하지만,
  // 원격 MCP 는 T5 가 스스로 클라이언트 등록(RFC 7591)까지 하므로 사용자가 하는 일은
  // 동의 화면에서 허용 한 번뿐이다(노션이 그렇게 붙었다 — 오너 라이브 2026-07-28).
  // 그래서 받을 칸도, 부를 주소 목록도 여기서 필요하지 않다. 무엇을 할 수 있는지는
  // 붙은 뒤 그쪽이 tools/list 로 알려 준다 — 우리가 미리 지어내지 않는다.
  if (decl.authKind === 'mcp') {
    if (!decl.url) return { ok: false, why: '어디에 붙는지(주소)가 없어요' };
    const r = checkDeclaredTarget(decl.url);
    if (!r.ok) return { ok: false, why: `연결 주소: ${r.why}` };
    return { ok: true };
  }

  const fields = decl.fields ?? [];
  if (!fields.length) return { ok: false, why: '무엇을 받아야 붙는지가 없어요' };
  if (!fields.every((f) => f?.name)) return { ok: false, why: '받을 값의 이름이 비어 있어요' };

  const tools = decl.tools ?? [];
  if (!tools.length) return { ok: false, why: '연결해서 무엇을 할지가 없어요' };
  if (!tools.every((t) => t?.name && t?.request?.url)) return { ok: false, why: '할 일마다 부를 주소가 있어야 해요' };

  const 주소 = checkDeclaredUrls(decl);
  if (!주소.ok) return { ok: false, why: `${주소.where}: ${주소.why}` };
  if (decl.issue?.url) {
    const r = checkDeclaredTarget(decl.issue.url);
    if (!r.ok) return { ok: false, why: `값 받는 곳: ${r.why}` };
  }

  // **채워지지 않는 자리표시자를 남기지 않는다.** `{client_id}` 가 선언에 없으면 그 글자가
  // 그대로 헤더에 실려 나가고, 서비스는 401 을 준다 — 사용자는 값이 맞는데 왜 안 되는지
  // 알아낼 방법이 없다. 그 실패를 사용자에게 떠넘기지 않는 것이 이 층의 일이다.
  const 아는이름 = new Set(fields.map((f) => f.name));
  const 검사할것 = [
    ['확인 주소', decl.verify?.url, []],
    ...Object.values(decl.verify?.headers ?? {}).map((v) => ['확인 헤더', v, []]),
    ...tools.flatMap((t) => {
      const 자기것 = [...Object.keys(t.parameters?.properties ?? {}), ...Object.keys(t.defaults ?? {})];
      return [
        [t.label ?? t.name, t.request.url, 자기것],
        [t.label ?? t.name, t.request.body, 자기것],
        ...Object.values(t.request.headers ?? {}).map((v) => [t.label ?? t.name, v, 자기것]),
      ];
    }),
  ];
  for (const [where, text, 자기것] of 검사할것) {
    for (const name of 자리표시자(text)) {
      if (!채울수있는이름(name) || (!아는이름.has(name) && !자기것.includes(name))) {
        return { ok: false, why: `${where}: 채울 수 없는 값(${name})이 들어 있어요` };
      }
    }
  }
  return { ok: true };
}

/** 선언을 커넥터 모양으로. 선언된 커넥터와 **같은 모양**이어야 그 뒤 길이 같아진다. */
export function toConnectorDeclaration(decl = {}) {
  const label = String(decl.service ?? decl.label ?? '').trim();
  const mcp = decl.authKind === 'mcp';
  return {
    id: decl.id ?? declaredId(label),
    label,
    kind: 'provider',
    category: 'declared',
    authState: mcp ? 'oauth' : 'api_key',
    connected: false,
    declared: true, // 소스가 아니라 사용자 승인으로 올라온 것 — 화면·해제에서 이 사실을 쓴다
    aliases: [label, ...(decl.aliases ?? [])],
    ...(decl.userJobs?.length ? { userJobs: decl.userJobs } : {}),
    authMethods: [mcp ? { kind: 'mcp', url: decl.url } : {
      kind: 'api_key',
      fields: decl.fields,
      ...(decl.issue ? { issue: decl.issue } : {}),
      verify: decl.verify,
      tools: decl.tools,
    }],
  };
}

/**
 * @param {{connectors:()=>object[], store?:object, connect?:object}} deps
 *   connectors: 살아 있는 커넥터 배열(제자리에 넣는다 — 그 턴부터 보이게)
 *   store:      선언 지속(껐다 켜도 남는다). 비밀값은 여기 오지 않는다.
 *   connect:    connector.connect 손. 선언 직후 같은 길로 이어 준다(승인 한 번).
 */
export function makeConnectorDeclareTool(deps = {}) {
  return {
    toolKind: 'connect_account', // 하는 일의 이름 그대로 — 안전 바닥이라 승인은 강제된다
    previewOf(args = {}) {
      const label = String(args.service ?? '').trim() || '이 서비스';
      const 할일 = (args.tools ?? []).map((t) => t.label ?? t.name).filter(Boolean);
      const 받을것 = (args.fields ?? []).map((f) => f.label ?? f.name).filter(Boolean);
      let 어디 = '';
      try { 어디 = new URL(args.url ?? args.verify?.url ?? args.tools?.[0]?.request?.url ?? '').host; } catch { /* 검사에서 막힌다 */ }
      // 원격 MCP 는 사용자가 할 일이 다르다 — 받아 올 값이 없고 동의 한 번이다.
      // 무엇을 할 수 있게 되는지도 아직 모른다(붙어야 그쪽이 알려 준다). 지어내지 않는다.
      if (args.authKind === 'mcp') {
        return {
          impact: `${label}을(를) 연결할 수 있게 준비해요`,
          what: `${label} 로그인 화면이 열리고, 거기서 허용 한 번만 눌러 주시면 돼요.`
            + ' 받아 오실 값은 없어요. 무엇을 할 수 있게 되는지는 붙고 나서 알려드릴게요.',
          scope: 어디 ? `${어디} 로 연결해요` : '외부 서비스로 연결해요',
          duration: '끊을 때까지',
          cancel: '"연결 끊어줘"라고 하시면 지워요 — 지금은 아무 값도 저장되지 않아요',
        };
      }
      return {
        impact: `${label}을(를) 연결할 수 있게 준비해요`,
        // **사용자가 넘을 문턱을 먼저 말한다.** 이게 이 카드의 핵심이다 —
        // "제가 붙일게요, 대신 이것 하나만 해 주세요"까지가 한 화면에 있어야 한다.
        what: (받을것.length ? `${label}에서 ${받을것.join(' · ')}을(를) 받아 오셔야 해요.` : '')
          + (args.issue?.url ? ` 받는 곳: ${args.issue.url}` : '')
          + (할일.length ? `\n연결되면 할 수 있는 것: ${할일.join(' · ')}` : ''),
        scope: 어디 ? `${어디} 로 연결해요` : '외부 서비스로 연결해요',
        duration: '끊을 때까지',
        cancel: '"연결 끊어줘"라고 하시면 지워요 — 지금은 아무 값도 저장되지 않아요',
      };
    },
    subjectOf(rec) {
      const id = rec?.result?.connector;
      return id ? { key: `connector:${id}`, kind: 'connector', label: String(rec.result.label ?? id) } : null;
    },
    /**
     * 부팅 때 한 번 — 저장된 선언을 커넥터 배열로 되살린다.
     *
     * 이게 없으면 사용자는 껐다 켤 때마다 같은 서비스를 다시 붙여야 한다. 승인도 값도
     * 이미 받았는데 다시 묻는 것은, 사용자에게는 연결이 안 된 것과 같다(§18 지속성 계약).
     * 실제 재연결은 그 다음 `connector.connect.restoreSaved()` 가 이어서 한다 —
     * **선언이 먼저 서 있어야** 저장된 자격이 붙을 자리를 찾는다.
     * @returns {Promise<string[]>} 되살린 커넥터 라벨
     */
    async restoreDeclared() {
      const list = deps.connectors?.() ?? [];
      const 되살림 = [];
      for (const decl of await (deps.store?.load?.() ?? [])) {
        // 저장된 선언도 다시 검사한다 — 규칙이 엄해졌으면 옛 선언이 통과하면 안 된다.
        if (!checkDeclaration(decl).ok) continue;
        const c = toConnectorDeclaration(decl);
        if (list.some((x) => x.id === c.id)) continue;
        list.push(c);
        되살림.push(c.label);
      }
      return 되살림;
    },
    async handler(args = {}) {
      const 검사 = checkDeclaration(args);
      if (!검사.ok) {
        // **못 만드는 선언을 받아 두지 않는다.** 받아 두면 "연결 대상에 추가했어요"라고
        // 말한 뒤 정작 쓸 때 빈손이 된다(못 지킬 약속).
        return { blocked: true, userSafeSummary: `아직 ${args.service ?? '이 서비스'}를 붙일 준비가 안 됐어요 — ${검사.why}.`,
          nextSafeAction: '지금 되는 다른 길로 먼저 도와드릴까요?' };
      }
      const c = toConnectorDeclaration(args);
      const list = deps.connectors?.() ?? [];
      const 있던자리 = list.findIndex((x) => x.id === c.id);
      if (있던자리 >= 0) list[있던자리] = c; else list.push(c);
      await deps.store?.add({ ...args, id: c.id }).catch(() => {});

      // 선언은 연결이 아니다. **여기서 같은 길로 넘긴다** — 값이 필요하면 안전 입력면이 열린다.
      // 값은 이 대화를 지나지 않는다(그 경계는 connector.connect 가 이미 들고 있다).
      const 이어서 = await deps.connect?.handler?.({ connector: c.id });
      if (이어서) return 이어서;
      return {
        result: { connector: c.id, label: c.label, declared: true },
        userSafeSummary: `${c.label}을(를) 연결 대상으로 올렸어요.`,
      };
    },
  };
}

// L4 · Model Connection (P-RT-4 → P-ONB-1) — 화면에서 모델을 연결·보관·선택하는 관리자.
// 핵심 경계:
//   - 저장 정책(§6.27 이후): **확실한 무효만 거절**한다. usable 은 검증됨으로 저장·활성,
//     unreachable/rate_limited 는 저장하되 verified:false("모델 확인 필요"), auth_failed/
//     model_missing/billing_blocked 는 저장하지 않는다. 실패 키가 기존 연결을 깨지 않는다.
//   - 여러 연결을 보관하고(P-ONB-1) 그중 하나를 기본으로, 역할(role)별로 다른 연결을 쓸 수 있다.
//     역할 바인딩은 **선택이지 허용목록이 아니다** — 바인딩이 없으면 조용히 기본으로 간다
//     (T3 agents.defaults.models allowlist 사고 재발 방지: 목록에 없다고 실행을 막지 않는다).
//   - 활성 우선순위: 저장된 사용자 연결 > env(개발자) > stub.
//   - 키·토큰은 저장 파일(0600)과 요청 본문에만 존재한다. 목록·상태·리포트 어떤 응답에도
//     원본이 나가지 않는다(마스킹만). authSignal(원문 진단)도 공개면 미노출.
//   - respond 는 현재 client 로 위임(핫스왑) — 재시작 없이 연결이 바뀐다.
import { readFile, writeFile, mkdir, rm, chmod, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  resolveModelConfig, resolveModelConfigFromInput, makeProviderModelClient, ModelProviderError,
} from '../runtime/model-provider.js';
import { checkConfigHealth, describeUnprobedModel } from '../runtime/model-doctor.js';
import { StubModelClient } from '../runtime/model-client.js';
import {
  createPkce, buildAuthorizeUrl, exchangeCode, refreshCredential, isExpired, startCallbackListener,
} from '../runtime/chatgpt-oauth.js';
import { makeChatGptModelClient, CHATGPT_DEFAULT_MODEL } from '../runtime/chatgpt-model-client.js';

export const DEFAULT_ROLE = 'default';

/** 저장을 거절하는 "확실한 무효"만. 불확실(unreachable·rate_limited)은 저장하되 미검증으로 둔다. */
export const CERTAINLY_INVALID = Object.freeze(['auth_failed', 'model_missing', 'billing_blocked']);

export function defaultConnectionDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

/** v1(단일 연결) 저장본을 v2(목록)로 이관한다 — 사용자가 다시 연결하지 않아도 되게. */
export function migrateConnectionFile(saved) {
  if (!saved) return null;
  if (saved.version === 2) {
    return {
      version: 2,
      connections: saved.connections ?? [],
      activeId: saved.activeId ?? saved.connections?.[0]?.id ?? null,
      roleBindings: saved.roleBindings ?? {},
    };
  }
  let one;
  if (saved.kind === 'chatgpt_oauth') {
    one = { kind: 'chatgpt_oauth', provider: 'chatgpt_oauth', credential: saved.credential, modelId: saved.modelId ?? CHATGPT_DEFAULT_MODEL };
  } else {
    // v1 은 modelId/baseUrl 을 생략할 수 있었다(기본값은 해석 시점에 채워짐) — 이관에서 확정한다.
    const cfg = resolveModelConfigFromInput({ provider: saved.provider, key: saved.key, modelId: saved.modelId, baseUrl: saved.baseUrl });
    if (!cfg) return null;
    one = { kind: 'api_key', provider: cfg.provider, key: cfg.token, modelId: cfg.modelId, baseUrl: cfg.baseUrl };
  }
  if (!one.provider) return null;
  const rec = { ...one, id: connectionId(one), label: connectionLabel(one) };
  return { version: 2, connections: [rec], activeId: rec.id, roleBindings: {} };
}

export function connectionId(rec) {
  return `${rec.provider}:${rec.modelId ?? 'default'}`;
}

export function connectionLabel(rec) {
  const names = {
    beai: 'BEAI', gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude',
    openai_oauth: 'OpenAI(OAuth)', openai_compatible: '호환 서버', chatgpt_oauth: 'ChatGPT 계정',
  };
  return `${names[rec.provider] ?? rec.provider} · ${rec.modelId ?? ''}`.trim();
}

export class ModelConnectionStore {
  /** @param {string} [dir] */
  constructor(dir = defaultConnectionDir()) {
    this.dir = dir;
    this.file = join(dir, 'model-connection.json');
  }
  async load() {
    try { return migrateConnectionFile(JSON.parse(await readFile(this.file, 'utf8'))); } catch { return null; }
  }
  async save(state) {
    await mkdir(this.dir, { recursive: true });
    // 키가 담기는 파일 — 소유자 전용(0600)을 **기존 파일 덮어쓰기에서도** 보장한다(감사 B1:
    // writeFile 의 mode 는 새 파일 생성 시에만 적용된다). 임시 파일 → chmod → rename(원자 교체).
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 2, ...state }), { encoding: 'utf8', mode: 0o600 });
    await chmod(tmp, 0o600); // umask 등과 무관하게 확정
    await rename(tmp, this.file);
    return state;
  }
  async clear() {
    await rm(this.file, { force: true });
  }
}

/** 원본 키를 절대 내보내지 않는다 — 표시용 마스킹만. */
export function maskKey(key) {
  if (typeof key !== 'string' || !key.length) return null;
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

const STUB_ENV_MODEL = () => ({ id: 'beai5-stub', strengths: '자연 대화·판단', authSignal: 'ok' });

/**
 * @param {Object} p
 * @param {Object} p.env               SelfState 입력(단일 진실) — env.model 을 이 관리자가 소유한다
 * @param {Record<string,string|undefined>} [p.processEnv]  개발자 env 폴백
 * @param {ModelConnectionStore} [p.store]  저장소(없으면 지속 없이 동작 — 테스트·demo)
 * @param {Function} [p.fetchImpl]
 * @param {number} [p.timeoutMs]
 */
export function makeModelConnection({ env, processEnv = {}, store, fetchImpl, timeoutMs }) {
  /** @type {Array<Object>} 사용자 연결 목록(최신 의사) */
  let connections = [];
  let activeId = null;
  /** @type {Record<string,string>} role → connectionId */
  let roleBindings = {};
  const envCfg = resolveModelConfig(processEnv); // 개발자 폴백(항상 대기)
  let pendingLogin = null;                       // 진행 중 로그인 1건
  let restored = false;                          // 이번 프로세스에서 연결했나 vs 저장본 복원인가
  const clients = new Map();                     // connectionId → ModelClient(핫스왑 캐시)

  const findConn = (id) => connections.find((c) => c.id === id) ?? null;
  const activeConn = () => findConn(activeId);

  function persist() {
    return store?.save({ connections, activeId, roleBindings });
  }

  // 만료 임박이면 선제 갱신하고 재저장한다(사용자가 다시 로그인하지 않게).
  // 갱신 실패(재로그인 필요)는 **턴 실행 중에도** 자격 실패로 정규화한다(감사 B2): 상태를 내려
  // 칩이 "준비됨"으로 거짓말하지 않게 하고, ModelProviderError 로 던져 기존 오류 경로를 탄다.
  function credentialsFor(rec) {
    return async () => {
      if (!isExpired(rec.credential)) return rec.credential;
      try {
        rec.credential = await refreshCredential(rec.credential, { fetchImpl });
        await persist();
        return rec.credential;
      } catch (e) {
        // 원문(token/refresh/detail)은 공개면에 안 나간다 — 내부 authSignal 로만.
        const authSignal = `auth_failed refresh ${e?.status ?? ''}`.trim();
        if (rec.id === activeId) {
          env.model.authSignal = authSignal; // → classifyModelAuth: auth_failed(칩·limits 즉시 반영)
          env.model.healthState = 'auth_failed';
        }
        throw new ModelProviderError({ provider: 'chatgpt_oauth', status: e?.status, authSignal });
      }
    };
  }

  function clientFor(rec) {
    if (!rec) return null;
    if (clients.has(rec.id)) return clients.get(rec.id);
    const c = rec.kind === 'chatgpt_oauth'
      ? makeChatGptModelClient({ credentials: credentialsFor(rec), modelId: rec.modelId, fetchImpl, timeoutMs })
      : makeProviderModelClient(configOf(rec), { fetchImpl, timeoutMs });
    clients.set(rec.id, c);
    return c;
  }

  function configOf(rec) {
    return resolveModelConfigFromInput({ provider: rec.provider, key: rec.key, modelId: rec.modelId, baseUrl: rec.baseUrl });
  }

  function applyEnvModel() {
    const rec = activeConn();
    if (rec) { env.model = { id: rec.modelId, strengths: '자연 대화·판단', authSignal: 'ok' }; return; }
    env.model = envCfg
      ? { id: envCfg.modelId, strengths: '자연 대화·판단', authSignal: 'ok' }
      : STUB_ENV_MODEL();
  }
  applyEnvModel();

  /** 역할 → 연결 → 클라이언트. 바인딩 없으면 기본, 그것도 없으면 env, 없으면 stub(막다른 답 금지). */
  function clientForRole(role = DEFAULT_ROLE) {
    const boundId = roleBindings[role];
    const rec = (boundId && findConn(boundId)) || activeConn();
    if (rec) return clientFor(rec);
    if (envCfg) return makeProviderModelClient(envCfg, { fetchImpl, timeoutMs });
    return new StubModelClient();
  }

  /** 검증 통과분을 목록에 넣고(같은 조합이면 갱신) 기본으로 세운다. */
  async function upsertAndActivate(rec) {
    rec.id = connectionId(rec);
    rec.label = connectionLabel(rec);
    const at = connections.findIndex((c) => c.id === rec.id);
    if (at >= 0) connections[at] = { ...connections[at], ...rec };
    else connections.push(rec);
    clients.delete(rec.id); // 자격이 바뀌었을 수 있다 — 클라이언트 재생성
    activeId = rec.id;
    restored = false;       // 사용자가 방금 화면에서 연결했다
    applyEnvModel();
    await persist();
  }

  // 검증 결과를 env.model(SelfState 단일 진실)에 반영하고 공개용으로 위생 처리(P-RT-2 계약 이관).
  function reflect(report) {
    const { authSignal, ...publicReport } = report;
    if (['auth_failed', 'billing_blocked', 'rate_limited'].includes(report.state)) {
      env.model.authSignal = authSignal;
    } else if (report.state === 'usable') {
      env.model.authSignal = 'ok';
    }
    env.model.healthState = report.state;
    return publicReport;
  }

  function publicConnection(rec) {
    return {
      id: rec.id,
      label: rec.label ?? connectionLabel(rec),
      provider: rec.provider,
      modelId: rec.modelId,
      kind: rec.kind,
      keyMasked: rec.kind === 'chatgpt_oauth' ? 'ChatGPT 계정' : maskKey(rec.key),
      unofficial: rec.kind === 'chatgpt_oauth' || undefined,
      active: rec.id === activeId,
      roles: Object.entries(roleBindings).filter(([, id]) => id === rec.id).map(([r]) => r),
    };
  }

  return {
    /** ModelClient — 기본 역할로 위임(핫스왑). 서버가 withModelTimeout 으로 감싼다. */
    // opts(P-STR-1 onDelta 등)를 그대로 통과시킨다 — 위임 래퍼가 인자를 삼키면 스트리밍이 죽는다.
    model: { respond: (tc, opts) => clientForRole(DEFAULT_ROLE).respond(tc, opts) },

    /** 역할별 ModelClient — 에이전트·자동화가 생기면 role 만 넘기면 된다(커널 변경 없이 확장). */
    modelFor(role) {
      return { respond: (tc, opts) => clientForRole(role).respond(tc, opts) };
    },

    /** 부팅 시 저장된 사용자 연결 복원(프로브 없음 — 부팅 doctor 가 뒤에서 검증·표시). */
    async init() {
      const saved = await store?.load();
      if (!saved) return;
      connections = saved.connections ?? [];
      // 계정 경로에서 거절되는 옛 기본 모델로 저장된 연결은 현재 기본으로 이관한다(사용자가 다시
      // 로그인하지 않아도 되게). 2026-07-26 실측: codex 접미 계열은 계정 경로에서 400 으로 거절된다.
      let migrated = false;
      for (const c of connections) {
        if (c.kind === 'chatgpt_oauth' && /-codex/.test(c.modelId ?? '')) {
          c.modelId = CHATGPT_DEFAULT_MODEL;
          const oldId = c.id;
          c.id = connectionId(c);
          c.label = connectionLabel(c);
          if (saved.activeId === oldId) saved.activeId = c.id;
          for (const [role, boundId] of Object.entries(saved.roleBindings ?? {})) {
            if (boundId === oldId) saved.roleBindings[role] = c.id;
          }
          migrated = true;
        }
      }
      activeId = saved.activeId ?? connections[0]?.id ?? null;
      roleBindings = saved.roleBindings ?? {};
      restored = connections.length > 0;
      clients.clear();
      applyEnvModel();
      if (migrated) await persist(); // 이관 결과를 남긴다(다음 부팅에서 또 고치지 않게)
    },

    /**
     * ChatGPT 계정 로그인 시작(P-RT-3). 사용자가 **직접** 브라우저에서 승인한다 — 우리는 주소만 준다.
     * @returns {{authorizeUrl:string, notice:string}}
     */
    async startChatGptLogin() {
      pendingLogin?.cancel?.();
      const pkce = createPkce();
      const listener = startCallbackListener({ state: pkce.state });
      await listener.listening;
      const done = listener.waitForCode
        .then(async (code) => {
          const cred = await exchangeCode({ code, verifier: pkce.verifier }, { fetchImpl });
          await upsertAndActivate({
            kind: 'chatgpt_oauth', provider: 'chatgpt_oauth',
            credential: cred, modelId: CHATGPT_DEFAULT_MODEL, addedAt: Date.now(),
          });
          return { connected: true };
        })
        .catch((e) => ({ connected: false, error: e?.message ?? 'login failed' }))
        .finally(() => { pendingLogin = null; });
      pendingLogin = { cancel: listener.cancel, done };
      return {
        authorizeUrl: buildAuthorizeUrl(pkce),
        notice: 'ChatGPT 계정으로 연결해요. 브라우저에서 로그인·승인하면 이어집니다.',
      };
    },

    /** 로그인 완료 대기(화면이 폴링 대신 한 번 기다린다). 진행 중이 아니면 현재 상태만. */
    async awaitChatGptLogin() {
      if (!pendingLogin) return { connected: Boolean(activeConn()), pending: false };
      const r = await pendingLogin.done;
      return { ...r, pending: false };
    },

    /** 화면 연결: 확실한 무효만 거절(§6.27). 불확실은 저장하되 verified:false. 실패면 기존 유지. */
    async connect(input) {
      const cfg = resolveModelConfigFromInput(input ?? {});
      if (!cfg) {
        return {
          connected: false,
          report: {
            state: 'invalid_input',
            userSafeSummary: '연결 정보를 확인해 주세요(제공자·키, 호환 서버는 주소·모델까지).',
            nextSafeAction: '제공자를 고르고 키를 다시 입력해 주세요.',
          },
        };
      }
      const report = await checkConfigHealth(cfg, { fetchImpl, timeoutMs });
      // **확실한 무효만 거절한다**(P-ONB-2, T3·Hermes 공통 교훈): 라이브 프로브 하드블록은 사내
      // 프록시·지역 차단·일시 rate limit 같은 정상 사용자를 너무 많이 막았다. 확실히 틀린 것
      // (자격 거부·모델 없음·결제)만 거절하고, 불확실(도달 불가·혼잡)은 저장하되 **검증됨이라
      // 말하지 않는다** — 거짓 초록 금지(§6.23) 계약은 그대로 지킨다.
      if (CERTAINLY_INVALID.includes(report.state)) {
        // 저장·활성화 없음 — 잘못된 키가 동작 중인 연결을 깨지 않는다. 원문(authSignal) 미노출.
        const { authSignal, ...publicReport } = report;
        return { connected: false, report: publicReport };
      }
      await upsertAndActivate({
        kind: 'api_key', provider: cfg.provider, key: cfg.token,
        modelId: cfg.modelId, baseUrl: cfg.baseUrl, addedAt: Date.now(),
      });
      const publicReport = reflect(report);
      return {
        connected: true,
        verified: report.state === 'usable', // 저장됐다≠검증됐다
        report: publicReport,
      };
    },

    /** 보관 중인 연결 목록(마스킹만) + 기본·역할 바인딩. */
    list() {
      return {
        connections: connections.map(publicConnection),
        activeId,
        roleBindings: { ...roleBindings },
        envFallback: envCfg ? { provider: envCfg.provider, modelId: envCfg.modelId } : null,
      };
    },

    /** 기본 연결 전환(핫스왑 — 다음 턴부터 적용). */
    async activate(id) {
      if (!findConn(id)) return { ok: false, userSafeSummary: '그 연결을 찾지 못했어요.' };
      activeId = id;
      applyEnvModel();
      await persist();
      return { ok: true, ...this.list() };
    },

    /**
     * 역할 바인딩 설정·해제. **선택이지 허용목록이 아니다** — 바인딩이 없는 역할은 기본으로 간다.
     * @param {string} role @param {string|null} id
     */
    async bind(role, id) {
      if (!role) return { ok: false, userSafeSummary: '어떤 역할인지 알려 주세요.' };
      if (id === null || id === undefined) delete roleBindings[role];
      else if (!findConn(id)) return { ok: false, userSafeSummary: '그 연결을 찾지 못했어요.' };
      else roleBindings[role] = id;
      await persist();
      return { ok: true, ...this.list() };
    },

    /** 개별 연결 해제. 활성이었으면 남은 것 중 하나로 승계(없으면 env·stub 복귀). */
    async remove(id) {
      const at = connections.findIndex((c) => c.id === id);
      if (at < 0) return { ok: false, userSafeSummary: '그 연결을 찾지 못했어요.' };
      connections.splice(at, 1);
      clients.delete(id);
      for (const [role, boundId] of Object.entries(roleBindings)) {
        if (boundId === id) delete roleBindings[role]; // 바인딩은 사라지고 기본으로 간다(막다른 답 금지)
      }
      if (activeId === id) activeId = connections[0]?.id ?? null;
      applyEnvModel();
      if (connections.length) await persist(); else await store?.clear();
      return { ok: true, ...this.list() };
    },

    /** 전체 해제 → env 구성 또는 stub 으로 복귀. */
    async disconnect() {
      await store?.clear();
      pendingLogin?.cancel?.();
      pendingLogin = null;
      connections = [];
      activeId = null;
      roleBindings = {};
      clients.clear();
      applyEnvModel();
      return this.status();
    },

    /** 활성 구성 재검증(P-RT-2 doctor 승계 — 두 축 반영 + 공개면 위생). */
    async doctor() {
      const rec = activeConn();
      if (rec?.kind === 'chatgpt_oauth') {
        // 계정 연결엔 모델 목록 endpoint 가 없다 — refresh 성공 여부로 검증한다(과금 0 유지).
        try {
          await credentialsFor(rec)();
          return reflect({ provider: 'chatgpt_oauth', modelId: rec.modelId, state: 'usable', userSafeSummary: '지금 바로 쓸 수 있어요.' });
        } catch (e) {
          return reflect({
            provider: 'chatgpt_oauth', modelId: rec.modelId, state: 'auth_failed',
            authSignal: e?.authSignal ?? 'auth_failed refresh',
            userSafeSummary: 'ChatGPT 계정 연결이 만료됐어요.',
            nextSafeAction: '다시 로그인하면 이어서 쓸 수 있어요.',
          });
        }
      }
      const cfg = rec ? configOf(rec) : envCfg;
      if (!cfg) return describeUnprobedModel(env.model);
      return reflect(await checkConfigHealth(cfg, { fetchImpl, timeoutMs }));
    },

    /** 지금 연결된 provider id — 모델 계열별 **운영 보정**을 고르는 데만 쓴다(정체성 불변). */
    providerId() {
      const rec = activeConn();
      return rec?.provider ?? rec?.kind ?? undefined;
    },

    /** 지금 연결된 모델이 **스스로 웹을 찾을 수 있는가**(1층). 자기인지·계획이 이걸 본다. */
    supportsSearch() {
      // 계정 경로의 내장 검색은 응답 문장만 돌려준다 — 검색 과정·출처를 T5 원장으로 회수하는
      // 계약이 없다. 그 상태에서 "공식 문서 기준"이라고 말하면 답변과 원장이 갈라진다.
      // 웹 확인은 출처 영수증을 남기는 web.collect로만 진행한다. 내장 검색 근거를 구조화해
      // 회수하는 계약이 생길 때까지 실행 가능 손으로 광고하지 않는다.
      return false;
    },

    /** 마스킹된 현재 연결 상태 — 원본 키·토큰은 절대 내보내지 않는다. */
    status() {
      const rec = activeConn();
      if (rec) {
        return {
          ...publicConnection(rec),
          connected: true,
          source: restored ? 'saved' : 'user',
          connectionCount: connections.length,
        };
      }
      return {
        connected: Boolean(envCfg),
        source: envCfg ? 'env' : 'none',
        provider: envCfg?.provider ?? null,
        modelId: envCfg?.modelId ?? null,
        keyMasked: maskKey(envCfg?.token),
        connectionCount: 0,
      };
    },
  };
}

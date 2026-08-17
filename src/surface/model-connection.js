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
import { createHash, randomUUID } from 'node:crypto';
import {
  resolveModelConfig, resolveModelConfigFromInput, makeProviderModelClient, ModelProviderError,
} from '../runtime/model-provider.js';
import { checkConfigHealth, describeUnprobedModel } from '../runtime/model-doctor.js';
import { StubModelClient } from '../runtime/model-client.js';
import {
  createPkce, buildAuthorizeUrl, exchangeCode, refreshCredential, isExpired, startCallbackListener,
} from '../runtime/chatgpt-oauth.js';
import { makeChatGptModelClient, CHATGPT_DEFAULT_MODEL, CHATGPT_BACKEND_URL } from '../runtime/chatgpt-model-client.js';
import { modelStallMs, modelDevBaselineMs } from '../runtime/model-timeout.js';

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

/**
 * 자격·주소가 바뀌었는가(§4.6). **비밀 원문을 밖으로 내지 않고** 안에서만 비교한다 —
 * 이 값은 어디에도 저장·전송되지 않는다(영수증에 들어가는 것은 불투명 참조뿐이다).
 */
function credentialFingerprint(rec) {
  const 원문 = JSON.stringify([
    rec.kind ?? 'api_key', rec.baseUrl ?? null,
    rec.kind === 'chatgpt_oauth' ? (rec.credential?.access ?? null) : (rec.key ?? null),
  ]);
  // 지문만 남긴다 — 비밀 원문을 필드 하나 더 만들어 복제하지 않는다.
  return createHash('sha256').update(원문).digest('hex').slice(0, 32);
}

/**
 * 연결에 **불투명 신분**을 붙인다. `provider:model` 은 신분이 아니다 — 같은 provider·model
 * 이라도 자격이나 endpoint 가 다르면 다른 instance 다(§4.6).
 * 이미 신분이 있고 자격·주소가 그대로면 유지한다(부팅마다 바뀌면 신분이 아니다).
 */
function stampIdentity(rec, prev) {
  const fp = credentialFingerprint(rec);
  const 그대로 = prev?.instanceId && prev?.credentialFp === fp;
  rec.credentialFp = fp;
  rec.instanceId = 그대로 ? prev.instanceId : randomUUID();
  rec.credentialRef = 그대로 ? prev.credentialRef : randomUUID();
  return rec;
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
/**
 * E-3(오너 결정 2026-08-02) · 설정을 바꿨으면 **무엇이 무엇에서 무엇으로** 바뀌었는지 남긴다.
 * 실제로 달라졌을 때만 싣는다 — 같은 값으로 다시 눌렀는데 "바꿨어요"라고 하면 사용자가
 * 원인을 잘못 짚는다(안 바뀐 것을 바꿨다고 하는 것도 거짓 성공이다).
 */
function 바뀐사실(what, from, to) {
  if (JSON.stringify(from) === JSON.stringify(to)) return {};
  return { changed: { what, from, to } };
}

export function makeModelConnection({ env, processEnv = {}, store, fetchImpl, timeoutMs }) {
  // 살아있음 판정(정체 기준·개발 기준선)은 **두 어댑터가 같은 값**을 봐야 한다.
  // 한쪽만 흐르는 env 를 쓰면 provider 경로와 계정 경로가 다른 자로 잘린다(이번 결함의 모양).
  const 살아있음설정 = { stallMs: modelStallMs(processEnv), baselineMs: modelDevBaselineMs(processEnv) };
  // **진단은 응답이 아니다.** 응답 상한이 0(무제한)이 되어도 진단까지 무제한으로 만들지 않는다 —
  // 저쪽이 살아 있나만 묻는 짧은 GET 이고, 매달리면 연결 화면이 멈춘다. 0 이면 진단은 자기
  // 기본값(10s)을 쓰고, 사람이 값을 정해 준 경우에만 그 값이 진단에도 적용된다(옛 동작 그대로).
  const 진단시간 = timeoutMs > 0 ? timeoutMs : undefined;
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
      ? makeChatGptModelClient({ credentials: credentialsFor(rec), modelId: rec.modelId, fetchImpl, timeoutMs, ...살아있음설정 })
      : makeProviderModelClient(configOf(rec), { fetchImpl, timeoutMs, ...살아있음설정 });
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
    if (envCfg) return makeProviderModelClient(envCfg, { fetchImpl, timeoutMs, ...살아있음설정 });
    return new StubModelClient();
  }

  // env(개발자) 폴백의 불투명 자격 참조. **비밀 원문·그 조각을 참조로 쓰지 않는다** — 지문은
  // 이 프로세스 메모리 안의 지도 열쇠로만 쓰고, 밖으로 나가는 값은 난수다.
  const envRefs = new Map();
  function envIdentity() {
    if (!envCfg) return null;
    const fp = credentialFingerprint({ kind: 'api_key', baseUrl: envCfg.baseUrl, key: envCfg.token });
    if (!envRefs.has(fp)) envRefs.set(fp, { instanceId: randomUUID(), credentialRef: randomUUID() });
    return envRefs.get(fp);
  }

  const originOf = (u) => { try { return new URL(String(u)).origin; } catch { return null; } };

  /**
   * 이번 호출이 **무엇을 고른 것인가**(§4.6 ModelSelection). 역할 이름은 요청일 뿐이고,
   * 실제 해석 결과(bound·active·env·stub)를 사실대로 남긴다 — 배경 호출의 증거는 요청
   * 라벨이 아니라 실제 selection 이다.
   */
  function selectionFor(role = DEFAULT_ROLE) {
    const boundId = roleBindings[role];
    const bound = boundId ? findConn(boundId) : null;
    const rec = bound || activeConn();
    if (rec) {
      const base = rec.kind === 'chatgpt_oauth' ? CHATGPT_BACKEND_URL : configOf(rec)?.baseUrl;
      return {
        requestedRole: role,
        resolution: bound ? 'bound' : 'active',
        connectionInstanceId: rec.instanceId ?? null,
        credentialRef: rec.credentialRef ?? null,
        providerId: rec.provider,
        endpointOrigin: originOf(base),
        requestModelId: rec.modelId ?? null,
      };
    }
    if (envCfg) {
      const idn = envIdentity();
      return {
        requestedRole: role,
        resolution: 'env',
        connectionInstanceId: idn.instanceId,
        credentialRef: idn.credentialRef,
        providerId: envCfg.provider,
        endpointOrigin: originOf(envCfg.baseUrl),
        requestModelId: envCfg.modelId,
      };
    }
    // stub 은 자격이 없다 — 그래서 replay 증거 자격도 없다(§4.4). 여기서 이름을 지어내면
    // 자격 없는 실행으로 원리가 서게 된다.
    return {
      requestedRole: role, resolution: 'stub',
      connectionInstanceId: null, credentialRef: null,
      providerId: 'stub', endpointOrigin: null, requestModelId: null,
    };
  }

  /** health 결과가 어느 default 연결 세대의 것인지 묶는다. 비밀 값은 들어가지 않는다. */
  function defaultGeneration() {
    const s = selectionFor(DEFAULT_ROLE);
    return JSON.stringify([
      s.resolution, s.connectionInstanceId, s.credentialRef,
      s.providerId, s.endpointOrigin, s.requestModelId,
    ]);
  }

  /** 검증 통과분을 목록에 넣고(같은 조합이면 갱신) 기본으로 세운다. */
  async function upsertAndActivate(rec) {
    rec.id = connectionId(rec);
    rec.label = connectionLabel(rec);
    const at = connections.findIndex((c) => c.id === rec.id);
    // 같은 자리(provider:model)를 덮어써도 **자격·주소가 바뀌었으면 다른 instance** 다.
    stampIdentity(rec, at >= 0 ? connections[at] : null);
    if (at >= 0) connections[at] = { ...connections[at], ...rec };
    else connections.push(rec);
    clients.delete(rec.id); // 자격이 바뀌었을 수 있다 — 클라이언트 재생성
    activeId = rec.id;
    restored = false;       // 사용자가 방금 화면에서 연결했다
    applyEnvModel();
    await persist();
  }

  // 검증 결과를 env.model(SelfState 단일 진실)에 반영하고 공개용으로 위생 처리(P-RT-2 계약 이관).
  function reflect(report, expectedGeneration = defaultGeneration()) {
    const { authSignal, ...publicReport } = report;
    if (expectedGeneration !== defaultGeneration()) {
      return {
        state: 'unverified', modelId: env.model?.id ?? null,
        userSafeSummary: '새로 고른 모델을 확인 중이에요.',
      };
    }
    if (['auth_failed', 'billing_blocked', 'rate_limited'].includes(report.state)) {
      env.model.authSignal = authSignal;
    } else if (report.state === 'usable') {
      env.model.authSignal = 'ok';
    }
    env.model.healthState = report.state;
    return publicReport;
  }

  /** 실제 default provider 응답은 같은 세대의 readiness를 usable로 올린다. stub은 제외한다. */
  async function respondForRole(role, tc, opts = {}) {
    const selection = selectionFor(role);
    const generation = role === DEFAULT_ROLE ? defaultGeneration() : null;
    const out = await clientForRole(role).respond(tc, opts);
    if (role === DEFAULT_ROLE && selection.resolution !== 'stub') {
      reflect({ state: 'usable', modelId: selection.requestModelId, userSafeSummary: '지금 바로 쓸 수 있어요.' }, generation);
    }
    return out;
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
    model: { respond: (tc, opts) => respondForRole(DEFAULT_ROLE, tc, opts) },

    /** 역할별 ModelClient — 에이전트·자동화가 생기면 role 만 넘기면 된다(커널 변경 없이 확장). */
    modelFor(role) {
      return {
        /**
         * @param {*} tc
         * @param {{onCallIdentity?:(idn:object)=>void}} [opts] 성장(replay)은 이걸로 신분을 받는다.
         */
        async respond(tc, opts = {}) {
          if (typeof opts.onCallIdentity !== 'function') return respondForRole(role, tc, opts);
          // 선택은 **호출 시점**에 읽는다(핫스왑 뒤에도 실제로 쓰인 연결이 남게).
          const selection = selectionFor(role);
          const startedAt = Date.now();
          let 실제 = null;
          const out = await respondForRole(role, tc, { ...opts, onCallIdentity: (f) => { 실제 = f; } });
          // 어댑터가 사실을 내지 않았으면(스텁·스트리밍) 지어내지 않는다 — 빈 신분은
          // §4.4 검증에서 그대로 떨어진다.
          opts.onCallIdentity({
            callId: randomUUID(),
            selection,
            actualEndpointOrigin: 실제?.endpointOrigin ?? null,
            actualRequestModelId: 실제?.requestModelId ?? null,
            responseModelId: 실제?.responseModelId ?? null,
            responseIdentitySource: 실제?.responseIdentitySource ?? 'not_reported',
            usage: 실제?.usage ?? null,
            finishReason: 실제?.finishReason ?? null,
            startedAt,
            finishedAt: Date.now(),
          });
          return out;
        },
      };
    },

    /** 이번 역할이 실제로 무엇을 고르는가(§4.6). 호출 없이 선택 증거만 본다. */
    selectionFor,

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
      // §4.6 이관: 신분 없이 저장된 옛 연결에 **1회** 부여한다. 이미 있으면 그대로 둔다 —
      // 부팅마다 새로 만들면 그건 신분이 아니라 난수다.
      for (const c of connections) {
        if (c.instanceId && c.credentialRef && c.credentialFp) continue;
        stampIdentity(c, null);
        migrated = true;
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
      const report = await checkConfigHealth(cfg, { fetchImpl, timeoutMs: 진단시간 });
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
      const publicReport = reflect(report, defaultGeneration());
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

    /**
     * 기본 연결 전환(핫스왑 — 다음 턴부터 적용).
     * E-3(오너 결정 2026-08-02): **바뀌기 전 값을 함께 남긴다.** 커넥터 경로는 현재 상태를 먼저
     * 읽고 카드에 싣는데 여기는 보지도 남기지도 않고 바꿨다 — 그러면 T5 가 "바꿨어요"밖에 말할
     * 수 없고 사용자는 무엇이 무엇으로 갔는지 모른다. 승인 단계는 늘리지 않는다(자동성이 의무다).
     * 실제로 안 바뀌었으면 `changed` 를 싣지 않는다 — 안 바뀐 것을 바꿨다고 하면 거짓 성공이다.
     */
    async activate(id) {
      if (!findConn(id)) return { ok: false, userSafeSummary: '그 연결을 찾지 못했어요.' };
      const before = activeId;
      activeId = id;
      applyEnvModel();
      await persist();
      return { ok: true, ...this.list(), ...바뀐사실('activeId', before, id) };
    },

    /**
     * 역할 바인딩 설정·해제. **선택이지 허용목록이 아니다** — 바인딩이 없는 역할은 기본으로 간다.
     * @param {string} role @param {string|null} id
     */
    async bind(role, id) {
      if (!role) return { ok: false, userSafeSummary: '어떤 역할인지 알려 주세요.' };
      const before = roleBindings[role] ?? null;
      if (id === null || id === undefined) delete roleBindings[role];
      else if (!findConn(id)) return { ok: false, userSafeSummary: '그 연결을 찾지 못했어요.' };
      else roleBindings[role] = id;
      await persist();
      return { ok: true, ...this.list(), ...바뀐사실(`roleBindings.${role}`, before, roleBindings[role] ?? null) };
    },

    /** 개별 연결 해제. 활성이었으면 남은 것 중 하나로 승계(없으면 env·stub 복귀). */
    async remove(id) {
      const at = connections.findIndex((c) => c.id === id);
      if (at < 0) return { ok: false, userSafeSummary: '그 연결을 찾지 못했어요.' };
      const before = connections.map((c) => c.id);
      connections.splice(at, 1);
      clients.delete(id);
      for (const [role, boundId] of Object.entries(roleBindings)) {
        if (boundId === id) delete roleBindings[role]; // 바인딩은 사라지고 기본으로 간다(막다른 답 금지)
      }
      if (activeId === id) activeId = connections[0]?.id ?? null;
      applyEnvModel();
      if (connections.length) await persist(); else await store?.clear();
      return { ok: true, ...this.list(), ...바뀐사실('connections', before, connections.map((c) => c.id)) };
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
      const generation = defaultGeneration();
      const rec = activeConn();
      if (rec?.kind === 'chatgpt_oauth') {
        // 계정 연결엔 모델 목록 endpoint 가 없다 — refresh 성공 여부로 검증한다(과금 0 유지).
        try {
          await credentialsFor(rec)();
          return reflect({ provider: 'chatgpt_oauth', modelId: rec.modelId, state: 'usable', userSafeSummary: '지금 바로 쓸 수 있어요.' }, generation);
        } catch (e) {
          return reflect({
            provider: 'chatgpt_oauth', modelId: rec.modelId, state: 'auth_failed',
            authSignal: e?.authSignal ?? 'auth_failed refresh',
            userSafeSummary: 'ChatGPT 계정 연결이 만료됐어요.',
            nextSafeAction: '다시 로그인하면 이어서 쓸 수 있어요.',
          }, generation);
        }
      }
      const cfg = rec ? configOf(rec) : envCfg;
      if (!cfg) return reflect(describeUnprobedModel(env.model), generation);
      return reflect(await checkConfigHealth(cfg, { fetchImpl, timeoutMs: 진단시간 }), generation);
    },

    /** 지금 연결된 provider id — 모델 계열별 **운영 보정**을 고르는 데만 쓴다(정체성 불변). */
    providerId() {
      const rec = activeConn();
      return rec?.provider ?? rec?.kind ?? undefined;
    },

    /** 지금 실제로 요청에 실릴 모델 id — 창 예산(노드 W)이 이걸로 표를 찾는다.
     *  `selectionFor` 가 doctor·성장 신분에 주는 것과 **같은 해석**이다(두 진실 금지). */
    activeModelId() {
      return selectionFor(DEFAULT_ROLE).requestModelId ?? undefined;
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

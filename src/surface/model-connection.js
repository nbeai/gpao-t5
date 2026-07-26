// L4 · Model Connection (P-RT-4) — 화면에서 키를 연결하는 관리자. "검증 통과만 저장·활성화".
// 핵심 경계:
//   - 활성 우선순위: 저장된 사용자 연결 > env(개발자) > stub. 화면에서 넣은 최신 의사가 이긴다.
//   - connect 는 저장 전에 doctor(과금 0 목록 GET)로 실검증한다. usable 이 아니면 저장하지 않고
//     기존 연결을 유지한다 — 잘못된 키가 동작 중인 연결을 깨지 않는다.
//   - 키는 저장 파일(0600)과 요청 본문에만 존재한다. status/health 등 어떤 응답에도 원본 키를
//     싣지 않는다(마스킹만). authSignal(원문 진단)도 공개면 미노출(P-RT-2 B2 유지).
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

export function defaultConnectionDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

export class ModelConnectionStore {
  /** @param {string} [dir] */
  constructor(dir = defaultConnectionDir()) {
    this.dir = dir;
    this.file = join(dir, 'model-connection.json');
  }
  async load() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); } catch { return null; }
  }
  async save(conn) {
    await mkdir(this.dir, { recursive: true });
    // 키가 담기는 파일 — 소유자 전용(0600)을 **기존 파일 덮어쓰기에서도** 보장한다(감사 B1:
    // writeFile 의 mode 는 새 파일 생성 시에만 적용된다). 임시 파일 → chmod → rename(원자 교체).
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(conn), { encoding: 'utf8', mode: 0o600 });
    await chmod(tmp, 0o600); // umask 등과 무관하게 확정
    await rename(tmp, this.file);
    return conn;
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
  let activeCfg = resolveModelConfig(processEnv);
  let activeSource = activeCfg ? 'env' : 'none';
  let client = activeCfg
    ? makeProviderModelClient(activeCfg, { fetchImpl, timeoutMs })
    : new StubModelClient();
  // P-RT-3: ChatGPT 계정 연결(비공식 경로). 토큰은 저장소에만, 응답엔 안 나간다.
  let oauthCred = null;      // {access, refresh, expiresAt, accountId}
  let oauthModelId = CHATGPT_DEFAULT_MODEL;
  let pendingLogin = null;   // 진행 중 로그인 1건

  function applyEnvModel() {
    if (oauthCred) {
      env.model = { id: oauthModelId, strengths: '자연 대화·판단', authSignal: 'ok' };
      return;
    }
    env.model = activeCfg
      ? { id: activeCfg.modelId, strengths: '자연 대화·판단', authSignal: 'ok' }
      : STUB_ENV_MODEL();
  }
  applyEnvModel();

  // 만료 임박이면 선제 갱신하고 재저장한다(사용자가 다시 로그인하지 않게).
  // 갱신 실패(재로그인 필요)는 **턴 실행 중에도** 자격 실패로 정규화한다(감사 B2): 상태를 내려
  // 칩이 "준비됨"으로 거짓말하지 않게 하고, ModelProviderError 로 던져 기존 오류 경로를 탄다.
  async function freshOauthCredential() {
    if (!isExpired(oauthCred)) return oauthCred;
    try {
      oauthCred = await refreshCredential(oauthCred, { fetchImpl });
      await store?.save({ kind: 'chatgpt_oauth', credential: oauthCred, modelId: oauthModelId });
      return oauthCred;
    } catch (e) {
      // 원문(token/refresh/detail)은 공개면에 안 나간다 — 내부 authSignal 로만.
      const authSignal = `auth_failed refresh ${e?.status ?? ''}`.trim();
      env.model.authSignal = authSignal;   // → classifyModelAuth: auth_failed(칩·limits 즉시 반영)
      env.model.healthState = 'auth_failed';
      throw new ModelProviderError({ provider: 'chatgpt_oauth', status: e?.status, authSignal });
    }
  }

  function activateOauth(cred, modelId) {
    oauthCred = cred;
    oauthModelId = modelId ?? oauthModelId;
    activeCfg = null;
    activeSource = 'chatgpt_oauth';
    client = makeChatGptModelClient({ credentials: freshOauthCredential, modelId: oauthModelId, fetchImpl, timeoutMs });
    applyEnvModel();
  }

  function activate(cfg, source) {
    oauthCred = null; // 키 연결이 오면 계정 연결은 물러난다(활성은 항상 하나)
    activeCfg = cfg;
    activeSource = source;
    client = makeProviderModelClient(cfg, { fetchImpl, timeoutMs });
    applyEnvModel();
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

  return {
    /** ModelClient — 현재 client 로 위임(핫스왑). 서버가 withModelTimeout 으로 감싼다. */
    model: { respond: (tc) => client.respond(tc) },

    /** 부팅 시 저장된 사용자 연결 복원(프로브 없음 — 부팅 doctor 가 뒤에서 검증·표시). */
    async init() {
      const saved = await store?.load();
      if (!saved) return;
      if (saved.kind === 'chatgpt_oauth' && saved.credential?.refresh) {
        // 만료됐어도 refresh 로 살아난다 — 첫 요청 때 freshOauthCredential 이 갱신한다.
        activateOauth(saved.credential, saved.modelId);
        activeSource = 'saved';
        return;
      }
      const cfg = resolveModelConfigFromInput(saved);
      if (cfg) activate(cfg, 'saved');
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
          activateOauth(cred, oauthModelId);
          await store?.save({ kind: 'chatgpt_oauth', credential: cred, modelId: oauthModelId });
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
      if (!pendingLogin) return { connected: Boolean(oauthCred), pending: false };
      const r = await pendingLogin.done;
      return { ...r, pending: false };
    },

    /** 화면 연결: 실검증 통과(usable)만 저장·활성화. 실패면 기존 유지 + 사용자 언어 리포트. */
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
      if (report.state !== 'usable') {
        // 저장·활성화 없음 — 잘못된 키가 동작 중인 연결을 깨지 않는다. 원문(authSignal) 미노출.
        const { authSignal, ...publicReport } = report;
        return { connected: false, report: publicReport };
      }
      activate(cfg, 'user');
      const publicReport = reflect(report);
      await store?.save({ provider: cfg.provider, key: cfg.token, modelId: cfg.modelId, baseUrl: cfg.baseUrl });
      return { connected: true, report: publicReport };
    },

    /** 저장 연결 해제 → env 구성 또는 stub 으로 복귀. */
    async disconnect() {
      await store?.clear();
      pendingLogin?.cancel?.();
      pendingLogin = null;
      oauthCred = null;
      activeCfg = resolveModelConfig(processEnv);
      activeSource = activeCfg ? 'env' : 'none';
      client = activeCfg
        ? makeProviderModelClient(activeCfg, { fetchImpl, timeoutMs })
        : new StubModelClient();
      applyEnvModel();
      return this.status();
    },

    /** 활성 구성 재검증(P-RT-2 doctor 승계 — 두 축 반영 + 공개면 위생). */
    async doctor() {
      if (oauthCred) {
        // 계정 연결엔 모델 목록 endpoint 가 없다 — refresh 성공 여부로 검증한다(과금 0 유지).
        try {
          await freshOauthCredential();
          return reflect({ provider: 'chatgpt_oauth', modelId: oauthModelId, state: 'usable', userSafeSummary: '지금 바로 쓸 수 있어요.' });
        } catch (e) {
          return reflect({
            provider: 'chatgpt_oauth', modelId: oauthModelId, state: 'auth_failed',
            // 분류기가 읽는 정규 토큰으로 보강한다(gemini API_KEY_INVALID 와 같은 계열).
            // refresh 실패 = 자격 실패 — 분류 자체는 여전히 커널 classifyModelAuth 가 한다.
            authSignal: `auth_failed refresh ${e?.status ?? ''} ${e?.detail ?? ''}`.trim(),
            userSafeSummary: 'ChatGPT 계정 연결이 만료됐어요.',
            nextSafeAction: '다시 로그인하면 이어서 쓸 수 있어요.',
          });
        }
      }
      if (!activeCfg) return describeUnprobedModel(env.model);
      return reflect(await checkConfigHealth(activeCfg, { fetchImpl, timeoutMs }));
    },

    /** 마스킹된 현재 연결 상태 — 원본 키·토큰은 절대 내보내지 않는다. */
    status() {
      if (oauthCred) {
        return {
          connected: true,
          source: activeSource,           // 'chatgpt_oauth' | 'saved'
          provider: 'chatgpt_oauth',
          modelId: oauthModelId,
          keyMasked: 'ChatGPT 계정',      // 토큰은 마스킹조차 노출하지 않는다
          unofficial: true,               // 화면 고지용(비공식 경로)
        };
      }
      return {
        connected: Boolean(activeCfg),
        source: activeSource, // 'user'(화면) | 'env'(개발자) | 'saved'(복원) | 'none'
        provider: activeCfg?.provider ?? null,
        modelId: activeCfg?.modelId ?? null,
        keyMasked: maskKey(activeCfg?.token),
      };
    },
  };
}

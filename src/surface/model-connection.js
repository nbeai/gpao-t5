// L4 · Model Connection (P-RT-4) — 화면에서 키를 연결하는 관리자. "검증 통과만 저장·활성화".
// 핵심 경계:
//   - 활성 우선순위: 저장된 사용자 연결 > env(개발자) > stub. 화면에서 넣은 최신 의사가 이긴다.
//   - connect 는 저장 전에 doctor(과금 0 목록 GET)로 실검증한다. usable 이 아니면 저장하지 않고
//     기존 연결을 유지한다 — 잘못된 키가 동작 중인 연결을 깨지 않는다.
//   - 키는 저장 파일(0600)과 요청 본문에만 존재한다. status/health 등 어떤 응답에도 원본 키를
//     싣지 않는다(마스킹만). authSignal(원문 진단)도 공개면 미노출(P-RT-2 B2 유지).
//   - respond 는 현재 client 로 위임(핫스왑) — 재시작 없이 연결이 바뀐다.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  resolveModelConfig, resolveModelConfigFromInput, makeProviderModelClient,
} from '../runtime/model-provider.js';
import { checkConfigHealth, describeUnprobedModel } from '../runtime/model-doctor.js';
import { StubModelClient } from '../runtime/model-client.js';

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
    // 키가 담기는 파일 — 소유자 전용(0600). 소스 트리 밖(환경헌장).
    await writeFile(this.file, JSON.stringify(conn), { encoding: 'utf8', mode: 0o600 });
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

  function applyEnvModel() {
    env.model = activeCfg
      ? { id: activeCfg.modelId, strengths: '자연 대화·판단', authSignal: 'ok' }
      : STUB_ENV_MODEL();
  }
  applyEnvModel();

  function activate(cfg, source) {
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
      const cfg = resolveModelConfigFromInput(saved);
      if (cfg) activate(cfg, 'saved');
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
      if (!activeCfg) return describeUnprobedModel(env.model);
      return reflect(await checkConfigHealth(activeCfg, { fetchImpl, timeoutMs }));
    },

    /** 마스킹된 현재 연결 상태 — 원본 키는 절대 내보내지 않는다. */
    status() {
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

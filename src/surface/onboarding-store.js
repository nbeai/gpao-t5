// L4 · 온보딩 상태 (P-ONB-2) — **파일 하나, 서버측 단일 진실**.
// T3 실사고 반대 계약: ①완료 여부를 URL 쿼리(?setup=1)로 판정하지 않는다(재설치마다 다시 뜨고
// 저장 상태를 아무도 안 읽는 구조였다) ②상태를 여러 곳(localStorage·프로필·config·workspace)에
// 흩뿌리지 않는다. 여기 한 파일만 본다. 비밀이 없으므로 특별 권한은 두지 않는다(키는 연결 저장소에).
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function defaultOnboardingDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

export class OnboardingStore {
  /** @param {string} [dir] */
  constructor(dir = defaultOnboardingDir()) {
    this.dir = dir;
    this.file = join(dir, 'onboarding.json');
  }
  async load() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); } catch { return {}; }
  }
  async patch(fields) {
    const next = { ...(await this.load()), ...fields };
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(next), 'utf8');
    await rename(tmp, this.file); // 원자 교체(반쯤 쓰인 상태 금지)
    return next;
  }
}

/**
 * 온보딩이 필요한가 — **연결이 하나도 없고, 아직 건너뛴 적도 없을 때만**.
 * 연결이 생기면 자동으로 필요 없어진다(별도 "완료" 클릭을 요구하지 않는다).
 * @param {{skippedAt?:string}} state
 * @param {{connectionCount?:number, connected?:boolean}} connectionStatus
 */
export function onboardingNeeded(state = {}, connectionStatus = {}) {
  if (state.skippedAt) return false;                       // 영속 탈출구 — 다시 조르지 않는다
  if ((connectionStatus.connectionCount ?? 0) > 0) return false;
  return true; // env 폴백(개발자)만 있는 경우도 화면에서 연결을 권한다 — 막지는 않는다
}

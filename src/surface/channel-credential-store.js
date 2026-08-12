// L4 · 채널 자격 저장소 (P5-1) — 메신저 토큰을 **소유자만 읽을 수 있게** 남긴다.
//
// 왜 env 만으로 부족한가: 환경변수는 그 프로세스에서만 산다. 사용자가 T5 를 껐다 켜면 채널이
// 다시 끊긴다 — "연결했는데 재시작하면 사라진다"는 모델 연결에서 이미 겪은 실패다(P-RT-4).
// 그래서 모델 연결과 같은 방식으로 지속한다: 0600, 소스 트리 밖, 마스킹해서만 보여준다.
import { readFile, writeFile, mkdir, chmod, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultSessionDir } from './session-store.js';

export class ChannelCredentialStore {
  constructor(dir = defaultSessionDir()) {
    this.dir = dir;
    this.file = join(dir, 'channel-credentials.json');
  }

  async load() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); } catch { return {}; }
  }

  async save(state) {
    await mkdir(this.dir, { recursive: true });
    // 토큰이 담기는 파일 — 덮어쓰기에서도 0600 을 보장한다(writeFile 의 mode 는 생성 시에만 적용).
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, this.file);
    return state;
  }

  async get(channel) {
    return (await this.load())[channel]?.token ?? null;
  }

  async set(channel, token) {
    const state = await this.load();
    state[channel] = { token, savedAt: Date.now() };
    await this.save(state);
    return true;
  }

  async clear(channel) {
    const state = await this.load();
    delete state[channel];
    if (!Object.keys(state).length) { await rm(this.file, { force: true }); return true; }
    await this.save(state);
    return true;
  }

  /** 화면에 보여줄 때는 원본을 절대 내보내지 않는다. */
  async describe() {
    const state = await this.load();
    return Object.fromEntries(Object.entries(state).map(([id, v]) => [id, {
      connected: Boolean(v?.token),
      masked: typeof v?.token === 'string' && v.token.length > 8 ? `${v.token.slice(0, 4)}…${v.token.slice(-4)}` : '••••',
      savedAt: v?.savedAt ?? null,
    }]));
  }
}

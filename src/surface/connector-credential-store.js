// L4 · 커넥터 자격 저장소 (P5-B-1B) — OAuth 로 받은 것을 **소유자만 읽을 수 있게** 남긴다.
//
// 채널 저장소(channel-credential-store.js)와 같은 규율(0600·소스 트리 밖·마스킹)을 따르되,
// 담는 것이 다르다: 토큰 한 줄이 아니라 **다음에 스스로 다시 붙는 데 필요한 것 전부**다 —
// client_id(동적 등록으로 받은 것) · 토큰 엔드포인트 · refresh_token.
//
// 이게 없으면 "연결했는데 껐다 켜니 사라졌다"가 된다. 사용자에게 그건 연결이 안 된 것과 같다.
import { readFile, writeFile, mkdir, chmod, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultSessionDir } from './session-store.js';

export class ConnectorCredentialStore {
  constructor(dir = defaultSessionDir()) {
    this.dir = dir;
    this.file = join(dir, 'connector-credentials.json');
  }

  async load() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); } catch { return {}; }
  }

  async save(state) {
    await mkdir(this.dir, { recursive: true });
    // 덮어쓰기에서도 0600 을 보장한다(writeFile 의 mode 는 생성 시에만 적용된다).
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, this.file);
    return state;
  }

  /** @returns {Promise<{tokens:object, clientId:string, endpoints:object, url?:string}|null>} */
  async get(connector) {
    return (await this.load())[connector] ?? null;
  }

  async set(connector, record) {
    const state = await this.load();
    state[connector] = { ...record, savedAt: Date.now() };
    await this.save(state);
    return true;
  }

  async clear(connector) {
    const state = await this.load();
    delete state[connector];
    if (!Object.keys(state).length) { await rm(this.file, { force: true }); return true; }
    await this.save(state);
    return true;
  }

  /** 화면·원장에 보여줄 때 쓰는 형태. **토큰은 어떤 형태로도 나가지 않는다.** */
  async describe() {
    const state = await this.load();
    return Object.fromEntries(Object.entries(state).map(([id, v]) => [id, {
      connected: Boolean(v?.tokens?.access_token),
      canRefresh: Boolean(v?.tokens?.refresh_token),
      expiresAt: v?.tokens?.expires_at ?? null,
      savedAt: v?.savedAt ?? null,
    }]));
  }
}

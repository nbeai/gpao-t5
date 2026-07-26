// L4 · 발신자 허용목록 (P5-1) — "허용된 사람만"이 실제로 존재하게 한다.
//
// 결함(Phase 0-5 감사): 커널에 `allowlist_only` 분기는 있는데 **목록이 어디에도 없어서**
// `isAllowlistedUser` 를 요청 본문이 그냥 주장했다. 즉 라이브에서는 도달 불가능한 코드였고,
// 실제로는 "부르면 누구나 열린다"였다.
//
// 봇은 주소만 알면 누구나 말을 걸 수 있다. 그래서 기본은 **허용된 사람만**이다(오너 결정).
import { readFile, writeFile, mkdir, chmod, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultSessionDir } from './session-store.js';

/** 채널별 허용 발신자. 값은 채널이 주는 발신자 식별자(텔레그램은 user id, username 도 허용). */
export class AllowlistStore {
  constructor(dir = defaultSessionDir()) {
    this.dir = dir;
    this.file = join(dir, 'channel-allowlist.json');
  }

  async load() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); } catch { return { channels: {} }; }
  }

  async save(state) {
    await mkdir(this.dir, { recursive: true });
    // 누가 내 T5 에 말을 걸 수 있는지가 담긴 파일 — 소유자 전용(0600). 덮어쓰기에서도 보장한다.
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, this.file);
    return state;
  }

  /** 한 사람을 허용한다. id 와 username 을 함께 받아 어느 쪽으로 와도 알아본다. */
  async allow(channel, { userId, username, label } = {}) {
    if (!channel || (!userId && !username)) return null;
    const state = await this.load();
    const list = state.channels[channel] ?? [];
    const key = String(userId ?? username);
    if (!list.some((e) => String(e.userId ?? e.username) === key)) {
      list.push({
        userId: userId ? String(userId) : undefined,
        username: username ? String(username).replace(/^@/, '') : undefined,
        label: label || undefined,
        addedAt: Date.now(),
      });
    }
    state.channels[channel] = list;
    await this.save(state);
    return list;
  }

  async revoke(channel, key) {
    const state = await this.load();
    const before = state.channels[channel] ?? [];
    const k = String(key).replace(/^@/, '');
    state.channels[channel] = before.filter((e) => String(e.userId) !== k && String(e.username) !== k);
    await this.save(state);
    return state.channels[channel];
  }

  async list(channel) {
    const state = await this.load();
    return channel ? (state.channels[channel] ?? []) : state.channels;
  }

  /**
   * 모르는 사람이 말을 걸었다는 **사실만** 남긴다(내용은 남기지 않는다). 사용자가 화면에서
   * "이 사람 맞아요" 하고 허용할 수 있게 하기 위한 것 — 이게 없으면 처음 연결한 사람이
   * 자기 id 를 알아낼 방법이 없어 허용목록을 만들 수가 없다(닭과 달걀).
   */
  async notePending(channel, { userId, username } = {}) {
    if (!channel || (!userId && !username)) return null;
    const state = await this.load();
    const pending = state.pending ?? {};
    const list = pending[channel] ?? [];
    const key = String(userId ?? username);
    const found = list.find((e) => String(e.userId ?? e.username) === key);
    if (found) { found.lastSeenAt = Date.now(); found.count = (found.count ?? 1) + 1; }
    else {
      list.push({
        userId: userId ? String(userId) : undefined,
        username: username ? String(username).replace(/^@/, '') : undefined,
        firstSeenAt: Date.now(), lastSeenAt: Date.now(), count: 1,
      });
    }
    pending[channel] = list.slice(-20); // 무한 성장 금지
    state.pending = pending;
    await this.save(state);
    return pending[channel];
  }

  async listPending(channel) {
    const state = await this.load();
    return channel ? (state.pending?.[channel] ?? []) : (state.pending ?? {});
  }

  async clearPending(channel, key) {
    const state = await this.load();
    const k = String(key).replace(/^@/, '');
    const list = (state.pending?.[channel] ?? []).filter((e) => String(e.userId) !== k && String(e.username) !== k);
    state.pending = { ...(state.pending ?? {}), [channel]: list };
    await this.save(state);
    return list;
  }

  /**
   * 이 발신자가 허용됐는가. **목록이 비어 있으면 아무도 허용되지 않은 것이다** —
   * "비었으니 전부 통과"로 읽으면 봇 주소를 아는 누구나 T5 를 쓰게 된다.
   */
  async isAllowed(channel, { userId, username } = {}) {
    const list = await this.list(channel);
    if (!list.length) return false;
    const id = userId != null ? String(userId) : null;
    const name = username ? String(username).replace(/^@/, '').toLowerCase() : null;
    return list.some((e) => (id && String(e.userId) === id)
      || (name && String(e.username ?? '').toLowerCase() === name));
  }
}

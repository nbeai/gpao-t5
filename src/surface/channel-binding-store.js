// L4 · 채널↔세션 연결 (P5-1) — "이 방은 어느 대화와 이어지는가".
//
// 채널로 들어온 메시지에는 sessionId 가 없다. 방(chatId)마다 이어지는 대화를 정해 둬야
// 텔레그램에서 한 말이 다음에 한 말과 같은 맥락에 쌓인다(매번 새 대화면 기억이 없는 것과 같다).
// P5-3 에서 사용자가 이 연결을 다른 세션으로 바꾼다("그 대화로 이어가줘").
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultSessionDir } from './session-store.js';

const keyOf = (channel, chatId) => `${channel}:${chatId}`;

export class ChannelBindingStore {
  constructor(dir = defaultSessionDir()) {
    this.dir = dir;
    this.file = join(dir, 'channel-bindings.json');
  }

  async load() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); } catch { return {}; }
  }

  async save(state) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(state), 'utf8');
    await rename(tmp, this.file);
    return state;
  }

  async get(channel, chatId) {
    return (await this.load())[keyOf(channel, chatId)] ?? null;
  }

  async set(channel, chatId, sessionId) {
    const state = await this.load();
    state[keyOf(channel, chatId)] = sessionId;
    await this.save(state);
    return sessionId;
  }

  /** 그 세션에 묶인 방들(세션이 지워졌을 때 정리용). */
  async keysFor(sessionId) {
    const state = await this.load();
    return Object.keys(state).filter((k) => state[k] === sessionId);
  }

  async unbind(channel, chatId) {
    const state = await this.load();
    delete state[keyOf(channel, chatId)];
    await this.save(state);
  }
}

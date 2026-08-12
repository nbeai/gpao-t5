// L4 · 켜 둔 프로세스 기록 (P6-T3) — **T5 가 자기가 켠 것을 기억한다.**
//
// 이게 없으면 "아까 켠 서버 꺼줘"가 성립하지 않는다. 사용자는 PID 를 외우지 않는다.
// 그리고 T5 가 재시작돼도 서버는 살아 있으므로, 기억은 **파일에** 남아야 한다 —
// 메모리에만 두면 T5 를 껐다 켠 순간 사용자 컴퓨터에 주인 없는 프로세스가 남는다.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class ProcessStore {
  constructor(dir) { this.dir = dir; this.file = join(dir, 'processes.json'); }

  async load() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); } catch { return { procs: [] }; }
  }

  async _save(state) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp-${randomUUID()}`;
    await writeFile(tmp, JSON.stringify(state), 'utf8');
    await rename(tmp, this.file); // 원자적 — 쓰다 만 기록이 남으면 프로세스를 영영 못 찾는다
  }

  async add(proc) {
    const state = await this.load();
    state.procs = [...(state.procs ?? []).filter((p) => p.id !== proc.id), proc];
    await this._save(state);
    return proc;
  }

  async update(id, patch) {
    const state = await this.load();
    const list = state.procs ?? [];
    const i = list.findIndex((p) => p.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch };
    state.procs = list;
    await this._save(state);
    return list[i];
  }

  async all() { return (await this.load()).procs ?? []; }

  /** 이름·명령 일부로 찾는다. 사용자는 "아까 그 서버"라고 말하지 PID 를 대지 않는다. */
  async find(hint) {
    const procs = await this.all();
    if (!hint) return procs;
    const h = String(hint).toLowerCase();
    return procs.filter((p) => String(p.id) === h
      || String(p.pid) === h
      || String(p.command).toLowerCase().includes(h)
      || String(p.label ?? '').toLowerCase().includes(h));
  }
}

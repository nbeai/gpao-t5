// L4 · Delivery 원장 저장소(P6-14) — 파일 기반. {deliveries}. 의존성 0.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function defaultDeliveryDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

export class DeliveryStore {
  constructor(dir = defaultDeliveryDir()) {
    this.dir = dir;
    this.file = join(dir, 'deliveries.json');
  }

  async load() {
    try {
      const a = JSON.parse(await readFile(this.file, 'utf8'));
      return { deliveries: a.deliveries ?? [] };
    } catch {
      return { deliveries: [] };
    }
  }

  async save(a) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify({ deliveries: a.deliveries ?? [] }), 'utf8');
    return a;
  }
}

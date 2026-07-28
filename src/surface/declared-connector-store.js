// L4 · 런타임에 선언된 커넥터 저장소 (P-OP C).
//
// 소스에 적힌 커넥터는 우리가 넣은 것이고, 여기 있는 것은 **사용자 승인으로 그 자리에 올라온
// 것**이다. 둘은 그 뒤로 같은 길을 탄다 — 발견도, 승인도, 비밀 입력면도, tool admission 도.
// 두 갈래를 만들면 낯선 서비스만 다른 규칙을 타게 되고, 그게 곧 서비스별 처방이 된다.
//
// **비밀값은 여기 없다.** 자격은 ConnectorCredentialStore(0600) 가 따로 들고, 여기 남는 것은
// "무엇을 어디로 어떻게 부르는가"라는 선언뿐이다. 그래서 이 파일은 마스킹할 것도 없다.
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultSessionDir } from './session-store.js';

export class DeclaredConnectorStore {
  constructor(dir = defaultSessionDir()) {
    this.dir = dir;
    this.file = join(dir, 'declared-connectors.json');
  }

  /** @returns {Promise<object[]>} 선언 목록(없으면 빈 배열) */
  async load() {
    try {
      const v = JSON.parse(await readFile(this.file, 'utf8'));
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  async save(list) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(list), 'utf8');
    await rename(tmp, this.file);
    return list;
  }

  /** 같은 id 는 덮어쓴다 — 같은 서비스를 두 번 선언하면 나중 것이 맞다. */
  async add(decl) {
    const list = (await this.load()).filter((d) => d.id !== decl.id);
    list.push({ ...decl, declaredAt: Date.now() });
    return this.save(list);
  }

  async remove(id) {
    const list = (await this.load()).filter((d) => d.id !== id);
    if (!list.length) { await rm(this.file, { force: true }); return []; }
    return this.save(list);
  }
}

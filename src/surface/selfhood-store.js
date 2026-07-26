// L4 · 자기인지 문서 저장 (P-ID-1) — SOUL.md · CAPABILITIES.md 를 **사용자 경로**에 둔다.
// 오너 결정: 사용자 경로(재설치로 안 덮이고, 사용자가 직접 열어 고치고 백업할 수 있다).
//
// 계약:
//   · SOUL.md 는 처음 한 번만 시드하고(계획서 v3.0 §0·§0.1 원문), 그 뒤에는 **덮어쓰지 않는다** —
//     사용자가 고친 내용을 우리가 지우면 안 된다. 이름 변경만 해당 줄을 갱신한다.
//   · CAPABILITIES.md 는 파생 구역만 매번 다시 만든다. 사람이 쓴 구역은 보존한다.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SOUL_SEED, PRODUCT_NAME } from '../kernel/soul-seed.js';
import { replaceDerivedSection, renderDerivedSection, buildCapabilityFacts } from '../kernel/capabilities.js';

export function defaultSelfhoodDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

async function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

/** SOUL.md 에서 이름 줄을 읽는다(## 이름 다음 첫 비어있지 않은 줄). */
export function readNameFromSoul(soul) {
  const m = String(soul ?? '').match(/##\s*이름\s*\n+\s*([^\n]+)/);
  const name = m?.[1]?.trim();
  return name || null;
}

/** SOUL.md 의 이름 줄만 바꾼다(나머지 사용자 편집은 그대로). */
export function replaceNameInSoul(soul, name) {
  if (!/##\s*이름/.test(soul)) return `${soul.trimEnd()}\n\n## 이름\n\n${name}\n`;
  return soul.replace(/(##\s*이름\s*\n+\s*)([^\n]+)/, `$1${name}`);
}

export class SelfhoodStore {
  /** @param {string} [dir] */
  constructor(dir = defaultSelfhoodDir()) {
    this.dir = dir;
    this.soulFile = join(dir, 'SOUL.md');
    this.capabilitiesFile = join(dir, 'CAPABILITIES.md');
  }

  /** 처음이면 오너 원문으로 시드하고, 있으면 **그대로 읽는다**(사용자 편집 보존). */
  async ensureSoul() {
    try { return await readFile(this.soulFile, 'utf8'); } catch { /* 없으면 시드 */ }
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(this.soulFile, SOUL_SEED);
    return SOUL_SEED;
  }

  /** 파생 구역을 지금 상태로 다시 만든다. 사람이 쓴 구역은 보존한다. */
  async refreshCapabilities(selfState) {
    const derived = renderDerivedSection(buildCapabilityFacts(selfState));
    let existing = null;
    try { existing = await readFile(this.capabilitiesFile, 'utf8'); } catch { /* 처음이면 새로 */ }
    const next = replaceDerivedSection(existing, derived);
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(this.capabilitiesFile, next);
    return next;
  }

  /** 이름 변경 — SOUL.md 의 이름 줄만 바꾼다. */
  async setName(name) {
    const soul = await this.ensureSoul();
    const next = replaceNameInSoul(soul, name);
    await writeAtomic(this.soulFile, next);
    return next;
  }

  /** 현재 문서(모델에 넣을 때 쓴다). 없으면 null — 지어내지 않는다. */
  async load() {
    const soul = await this.ensureSoul();
    let capabilities = null;
    try { capabilities = await readFile(this.capabilitiesFile, 'utf8'); } catch { /* 아직 없음 */ }
    return {
      soul,
      capabilities,
      identity: { name: readNameFromSoul(soul) || PRODUCT_NAME, named: (readNameFromSoul(soul) || PRODUCT_NAME) !== PRODUCT_NAME, },
    };
  }
}

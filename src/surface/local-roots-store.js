// L4 · 로컬 작업 범위 (P6-L2) — **사용자가 폴더를 여는 길.**
//
// 실측(2026-07-27): 사용자가 "디벨로퍼 폴더 봐줘"라고 했을 때 T5 가 "터미널에서 `ls` 결과를 붙여
// 주세요"라고 답했다. 헌장에 "명령어 말고 사람 말로"를 넣어도 그대로였다 — 재 보니 **모델이 옳았다.**
// 작업 폴더를 넓히는 경로가 **아예 없었다**(환경변수뿐). "폴더를 열어 주세요"라고 말해도
// 사용자가 할 방법이 없으니, 실제로 되는 유일한 길을 제안한 것이다.
//
// **지킬 수 없는 규칙은 모델을 무시하게 만든다.** 규칙을 늘리는 대신 길을 만든다.
//
// 승인 경계: 폴더를 여는 것은 **사용자의 결정**이다(A2 — 짧은 승인). 모델이 혼자 넓히지 못한다.
// 보호 영역은 이것과 무관하게 그대로다 — 홈을 열어도 `~/.ssh` 는 안 열린다(1단계).
import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

/** 사용자가 이름으로 부르는 자리. "데스크탑 봐줘"가 경로 입력 없이 통하게 한다. */
export const WELL_KNOWN = [
  { key: 'desktop', label: '데스크탑', path: join(homedir(), 'Desktop'), aliases: ['데스크탑', '바탕화면', 'desktop'] },
  { key: 'documents', label: '문서', path: join(homedir(), 'Documents'), aliases: ['문서', 'documents', '도큐먼트'] },
  { key: 'downloads', label: '다운로드', path: join(homedir(), 'Downloads'), aliases: ['다운로드', 'downloads', '다운받은'] },
  { key: 'pictures', label: '사진', path: join(homedir(), 'Pictures'), aliases: ['사진', 'pictures', '이미지'] },
  { key: 'movies', label: '동영상', path: join(homedir(), 'Movies'), aliases: ['동영상', '비디오', 'movies'] },
  { key: 'music', label: '음악', path: join(homedir(), 'Music'), aliases: ['음악', 'music'] },
  { key: 'home', label: '홈 폴더 전체', path: homedir(), aliases: ['홈', 'home', '내 컴퓨터', '전체'] },
];

/** 사람이 부른 이름 → 알려진 자리. 못 찾으면 undefined(지어내지 않는다). */
export function wellKnownFor(text) {
  const t = String(text ?? '').toLowerCase();
  if (!t.trim()) return undefined;
  // 더 구체적인 이름이 먼저 걸리도록 홈("전체")은 마지막에 본다.
  return WELL_KNOWN.find((w) => w.key !== 'home' && w.aliases.some((a) => t.includes(a.toLowerCase())))
    ?? WELL_KNOWN.find((w) => w.key === 'home' && w.aliases.some((a) => t.includes(a.toLowerCase())));
}

const DEFAULT_ROOT = join(homedir(), 'GPAO-T5');

/**
 * 사용자가 연 폴더 목록. 파일 하나에 담고 원자적으로 쓴다(세션 저장소와 같은 계약).
 * **이건 설정이 아니라 사용자의 결정 기록이다** — 화면에서 보고 언제든 닫을 수 있어야 한다.
 */
export class LocalRootsStore {
  constructor(dir) { this.file = join(dir, 'local-roots.json'); this.dir = dir; }

  async load() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); }
    catch { return { roots: [] }; }
  }

  /** 지금 다룰 수 있는 폴더 전부(기본 작업 폴더 + 사용자가 연 것). */
  async roots() {
    const state = await this.load();
    return [DEFAULT_ROOT, ...(state.roots ?? []).map((r) => r.path)];
  }

  /** 사용자가 연 것만(화면에 보여 주고 닫게 하려면 기본 폴더와 구분해야 한다). */
  async opened() { return (await this.load()).roots ?? []; }

  async _save(state) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp-${randomUUID()}`;
    await writeFile(tmp, JSON.stringify(state), 'utf8');
    await rename(tmp, this.file); // 원자적 — 쓰다 만 설정이 남지 않게
  }

  /**
   * 폴더를 연다. **실제로 있는 폴더만** 연다(없는 것을 열었다고 하지 않는다).
   * @returns {{ok:true, root:object}|{ok:false, reason:'missing'|'invalid'}}
   */
  async open(path, label) {
    const abs = resolve(String(path ?? ''));
    let real;
    try { real = await realpath(abs); } catch { return { ok: false, reason: 'missing' }; }
    const state = await this.load();
    state.roots = state.roots ?? [];
    if (!state.roots.some((r) => r.path === real)) {
      state.roots.push({ path: real, label: label ?? (basename(real) || real), openedAt: Date.now() });
      await this._save(state);
    }
    return { ok: true, root: state.roots.find((r) => r.path === real) };
  }

  /**
   * 닫는다. 연 것은 언제든 닫을 수 있어야 한다(되돌릴 수 없는 결정을 만들지 않는다).
   * **열 때와 같은 형태로 맞춰서** 비교한다 — 열 때는 링크를 풀어 저장하는데 닫을 때 문자열로
   * 비교하면 사용자가 연 그 말 그대로 닫아도 안 닫힌다("닫을 수 있어요"가 거짓이 된다 — 실측).
   */
  async close(path) {
    const asked = resolve(String(path ?? ''));
    let real = asked;
    try { real = await realpath(asked); } catch { /* 폴더가 사라졌어도 목록에서는 지울 수 있어야 한다 */ }
    const state = await this.load();
    const before = (state.roots ?? []).length;
    state.roots = (state.roots ?? []).filter((r) => r.path !== real && r.path !== asked);
    if (state.roots.length !== before) await this._save(state);
    return before !== state.roots.length;
  }
}

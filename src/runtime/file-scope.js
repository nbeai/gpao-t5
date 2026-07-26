// L3 · 파일 범위(scope) — 로컬 지배력의 안전 축 (v3.1 §22-0).
//
// 권한 등급은 이미 맞다: write·delete 는 SAFETY_FLOOR_KINDS 라 어떤 모드에서도 승인(A2+)을 받는다.
// **빠진 것은 "어디까지"** 다. 로컬 실행은 되돌리기 어렵고, 범위가 무한하고, 연쇄된다 —
// 그래서 등급 위에 범위를 얹는다.
//
// 경계:
//   · 기본 루트는 좁게(`~/GPAO-T5`). env 로 넓힐 수 있지만 기본값이 홈 전체가 되지 않는다.
//   · `../` 만 막으면 **심볼릭 링크로 뚫린다** — realpath 로 다시 판정한다.
//   · 읽기도 범위를 지킨다(범위 밖 읽기 = 정보 유출).
//   · 범위 밖은 막다른 답을 주지 않는다 — "이 폴더를 열어줄까요?"로 다음 행동을 준다.
import { resolve, sep, join, isAbsolute } from 'node:path';
import { realpath, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';

export function defaultFileRoots(env = process.env) {
  const raw = env.GPAO_T5_FILE_ROOTS;
  if (raw && raw.trim()) return raw.split(':').map((p) => resolve(p.trim())).filter(Boolean);
  return [join(homedir(), 'GPAO-T5')];
}

/** 경로가 루트 안인가(문자열 기준). 경계에서 접두사만 비교하면 `/a/bc` 가 `/a/b` 안으로 오인된다. */
export function isWithin(root, target) {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep);
}

export class ScopeError extends Error {
  /** @param {string} target @param {string[]} roots */
  constructor(target, roots) {
    super(`path out of scope: ${target}`);
    this.name = 'ScopeError';
    this.isScopeError = true;
    this.target = target;
    this.roots = roots;
  }
}

/**
 * 루트도 실제 경로로 맞춘다. macOS 의 `/var`→`/private/var` 처럼 **루트 자체가 링크**일 수 있어서,
 * 대상만 realpath 하면 멀쩡한 경로가 범위 밖으로 오판된다(테스트에서 실제로 걸렸다).
 * @param {string[]} roots
 */
async function realRoots(roots) {
  return Promise.all(roots.map(async (r) => {
    try { return await realpath(r); } catch { return resolve(r); } // 아직 없으면 문자열 그대로
  }));
}

/**
 * 범위 안의 절대 경로로 해석한다. 범위 밖이면 ScopeError.
 * **링크 탈출 방지**: 존재하는 경로는 realpath 로 다시 판정하고, 없는 경로는 존재하는 상위로 판정한다
 * (새 파일을 만들 때도 그 부모가 범위 안이어야 한다).
 * @param {string} target @param {{roots?:string[]}} [opts]
 */
export async function resolveInScope(target, opts = {}) {
  const declared = opts.roots ?? defaultFileRoots();
  const roots = await realRoots(declared);
  if (typeof target !== 'string' || !target.trim()) throw new ScopeError(String(target), roots);
  const base = roots[0];
  // 상대 경로는 첫 루트 기준으로 푼다(사용자가 "메모.md"라고만 말해도 되게).
  const abs = isAbsolute(target) ? resolve(target) : resolve(base, target);

  // 판정은 **실제 경로 하나로만** 한다. 여기서 문자열로 먼저 걸러 보면 반대 방향으로 틀린다 —
  // macOS 의 `/var`·`/tmp` 는 `/private/…` 로 가는 링크라, 범위 안인 폴더가 밖으로 보인다
  // (사용자가 연 임시 폴더가 열자마자 "범위 밖"이 됐다 — 실측). 홈이 외장 볼륨이면 같은 일이 난다.
  // 아래 루프가 링크를 풀어 **좁게** 판정하므로 안전은 그대로다.
  let probe = abs;
  for (;;) {
    try {
      const real = await realpath(probe);
      const realTarget = probe === abs ? real : resolve(real, abs.slice(probe.length + 1));
      if (!roots.some((r) => isWithin(r, realTarget))) throw new ScopeError(realTarget, roots);
      return realTarget;
    } catch (e) {
      if (e?.isScopeError) throw e;
      const parent = resolve(probe, '..');
      // 루트(`/`)까지 올라가도 못 풀면 판정할 근거가 없다. **모르면 막는다** — 여기서 통과시키면
      // 위 판정이 통째로 비어 버린다(사전 문자열 검사를 걷어낸 뒤로 이 줄이 유일한 구멍이었다).
      if (parent === probe) throw new ScopeError(abs, roots);
      probe = parent;
    }
  }
}

/** 첫 루트를 만들어 둔다(처음 쓸 때 폴더가 없어서 실패하지 않게). */
export async function ensureRoot(roots = defaultFileRoots()) {
  await mkdir(roots[0], { recursive: true });
  return roots[0];
}

/** 범위 밖일 때 사용자에게 줄 안내(막다른 답 금지). */
export function outOfScopeMessage(err) {
  const roots = err?.roots ?? defaultFileRoots();
  return {
    userSafeSummary: '그 위치는 제가 다룰 수 있는 폴더 밖이에요.',
    nextSafeAction: `지금은 ${roots.join(', ')} 안에서만 다룰 수 있어요. 그 폴더로 옮기거나, 다룰 폴더를 열어 주세요.`,
  };
}

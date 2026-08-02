// L3 · 파일 범위(scope) — 로컬 지배력의 안전 축 (v3.1 §22-0).
//
// 권한 등급은 이미 맞다: write·delete 는 SAFETY_FLOOR_KINDS 라 어떤 모드에서도 승인(A2+)을 받는다.
// **빠진 것은 "어디까지"** 다. 로컬 실행은 되돌리기 어렵고, 범위가 무한하고, 연쇄된다 —
// 그래서 등급 위에 범위를 얹는다.
//
// 경계:
//   · 기본 루트는 작업 루트(`~/GPAO-T5`) + 표준 사용자 폴더(Downloads·Documents·Desktop)까지.
//     env 로 넓힐 수 있지만 기본값이 홈 전체가 되지 않는다 — 위험 자리는 local-protection 이
//     루트와 독립으로 막으므로, 루트를 넓혀도 보호는 풀리지 않는다.
//   · `../` 만 막으면 **심볼릭 링크로 뚫린다** — realpath 로 다시 판정한다.
//   · 읽기도 범위를 지킨다(범위 밖 읽기 = 정보 유출).
//   · 범위 밖은 막다른 답을 주지 않는다 — "이 폴더를 열어줄까요?"로 다음 행동을 준다.
import { resolve, sep, join, isAbsolute } from 'node:path';
import { realpath, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export function defaultFileRoots(env = process.env) {
  const home = env.GPAO_T5_HOME ?? env.HOME ?? homedir();
  const raw = env.GPAO_T5_FILE_ROOTS;
  if (raw && raw.trim()) {
    // C 감사 F7.5 · 상대 경로는 **cwd 가 아니라 홈** 기준으로 푼다 — 서버를 어디서 켰는지에
    // 따라 루트가 조용히 달라지면, 사용자가 넓히려던 범위와 실제 범위가 갈린다.
    // (`:` 구분은 PATH 관례 그대로 둔다 — 경로에 콜론을 쓰는 구성은 지원하지 않는 기록된 제한.)
    const roots = raw.split(':')
      .map((p) => p.trim()).filter(Boolean)
      .map((p) => (isAbsolute(p) ? resolve(p) : p.startsWith('~/') ? resolve(home, p.slice(2)) : resolve(home, p)));
    if (roots.length) return roots;
  }
  // 작업 루트가 첫째다 — 상대 경로·휴지통·새 파일의 기준은 그대로 유지된다.
  // 그 위에 **표준 사용자 폴더**를 얹는다. H08 실측(인간 기준선 실패 3/3): "다운로드 폴더에
  // 방금 받은 견적서"가 루트 1개에 막혀 시작도 못 했다. 사용자의 파일은 대부분 여기에 온다.
  // 홈 전체는 열지 않는다 — 넓힘은 이 세 폴더까지이고, `~/.ssh` 같은 위험 자리는
  // local-protection 이 루트와 독립으로 막는다(루트 확장이 보호를 풀지 않는다).
  return [join(home, 'GPAO-T5'), join(home, 'Downloads'), join(home, 'Documents'), join(home, 'Desktop')];
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
  // `~/` 는 홈이다 — locate 의 자리 해석과 같은 규칙(두 진실 금지). H08 라이브 실측(2026-08-01):
  // 모델이 `~/Downloads` 를 골랐는데 이걸 루트 상대로 붙여 ENOENT 를 내니, 모델은 실제로
  // 있는 표준 폴더 대신 빈 작업 루트를 보고 "폴더가 비어 있다"고 답했다.
  const home = opts.home ?? homedir();
  const t = target.trim() === '~' ? home
    : target.trim().startsWith('~/') ? resolve(home, target.trim().slice(2)) : target;
  // 상대 경로는 첫 루트 기준으로 푼다(사용자가 "메모.md"라고만 말해도 되게).
  let abs = isAbsolute(t) ? resolve(t) : resolve(base, t);
  // **루트 이름으로 시작하는 상대 경로는 그 루트를 부르는 말이다.** H08 라이브 실측(2026-08-01):
  // 모델이 `Downloads/견적서.csv` 를 골랐는데 첫 루트(작업 폴더) 기준으로만 풀려 ENOENT 가 났다.
  // 첫 루트 해석이 실재하면 그대로 두고(행동 보존), 없을 때만 이름이 맞는 다른 루트로 푼다.
  if (!isAbsolute(t)) {
    const 첫말 = String(t.split(/[/\\]/)[0] ?? '').normalize('NFC').toLowerCase();
    if (첫말 && !existsSync(abs)) {
      const 맞는루트 = roots.find((r) => String(r.split(sep).pop()).normalize('NFC').toLowerCase() === 첫말);
      if (맞는루트) abs = resolve(맞는루트, t.split(/[/\\]/).slice(1).join(sep));
    }
  }

  // **판정의 기준은 실제 경로다.** 문자열로 먼저 끊으면 `/var/...` 처럼 링크를 지나는 형태가
  // 실제로는 루트 안(`/private/var/...`)인데도 범위 밖으로 오판된다(다중 루트 검사에서 실측).
  // 그래서 존재하는 경로는 realpath 로만 판정하고 — 링크 탈출(안→밖)은 여기서 그대로 잡힌다 —
  // 문자열 판정은 **아무것도 존재하지 않을 때의 마지막 근거**로만 쓴다.
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
      if (parent === probe) {
        // 루트까지 올라가도 아무것도 없다 — 실제 경로가 없으니 문자열로 판정한다.
        if (!roots.some((r) => isWithin(r, abs))) throw new ScopeError(abs, roots);
        return abs;
      }
      probe = parent;
    }
  }
}

/**
 * **승인 카드에 보여줄 자리**를 동기로 푼다. 판정이 아니라 표시용이다 —
 * 경계 판정은 `resolveInScope` 가 하고(링크 해제·범위 검사), 여기는 사용자가 "어디에 생기는가"를
 * 승인 **전에** 볼 수 있게만 한다.
 *
 * 왜 필요한가: 모델이 보낸 인자를 그대로 카드에 실으면 `path: 'GPAO-T5/메모.md'` 가
 * `GPAO-T5/메모.md` 로만 보인다. 실제로는 작업 루트 기준으로 풀려
 * `~/GPAO-T5/GPAO-T5/메모.md` 에 생긴다 — 루트 이름이 두 번 들어간 것을 사용자가 알 길이 없다
 * (2026-07-27 실측). **인자가 아니라 결과를 보여줘야 승인이 승인이 된다.**
 * @param {string} target @param {string[]} [roots]
 */
export function previewPathOf(target, roots = defaultFileRoots(), home = homedir()) {
  const base = resolve(roots[0]);
  const raw = typeof target === 'string' ? target.trim() : '';
  if (!raw) return base;
  // `~/` 해석도 실행 경로(resolveInScope)와 같은 규칙 — 카드가 다른 자리를 말하면 안 된다.
  const t = raw === '~' ? home : raw.startsWith('~/') ? resolve(home, raw.slice(2)) : raw;
  return isAbsolute(t) ? resolve(t) : resolve(base, t);
}

/** 첫 루트를 만들어 둔다(처음 쓸 때 폴더가 없어서 실패하지 않게). */
export async function ensureRoot(roots = defaultFileRoots()) {
  await mkdir(roots[0], { recursive: true });
  return roots[0];
}

/**
 * 범위 밖일 때 남기는 **사실**. 다음 길은 여기서 정하지 않는다.
 *
 * 예전엔 이렇게 말했다: "지금은 ~/GPAO-T5 안에서만 다룰 수 있어요. **그 폴더로 옮기거나**,
 * 다룰 폴더를 열어 주세요." 라이브에서 그대로 사용자에게 나갔다(c217a0c6) —
 * T5 는 "외장하드 안 파일을 바로 열지는 못해요, 폴더를 통째로 복사해 주세요"라고 답했고
 * **바로 다음 턴에 그 파일 4개를 전부 읽었다.** 거짓말을 하고 일을 떠넘긴 것이다.
 *
 * 두 가지를 고친다:
 *   · 한 손의 범위를 **T5 전체의 한계**로 말하지 않는다("제가" → "파일 도구가").
 *   · 다음 길을 이 손이 정하지 않는다. 이 손은 다른 손이 있는지 모른다 — 모르면서 약속하면
 *     거짓이 되고, 모르면서 사용자를 시키면 떠넘김이 된다. 다음 길은 커널(사다리)이 정한다.
 */
export function outOfScopeMessage(err) {
  const roots = err?.roots ?? defaultFileRoots();
  return {
    userSafeSummary: '그 자리는 파일 도구의 작업 폴더 밖이에요.',
    // **사실만 남긴다** — 이 손이 어디까지 다루는지. 사용자에게 시키지도, 다른 손을 약속하지도
    // 않는다(이 손은 다른 손이 있는지 모른다). 다음 계단은 손 목록을 아는 커널이 정한다.
    nextSafeAction: `파일 도구는 ${roots.join(', ')} 안에서만 다뤄요.`,
  };
}

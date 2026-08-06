// L3 · 파일 범위(scope) — 로컬 지배력의 안전 축 (v3.1 §22-0).
//
// 권한 등급은 이미 맞다: write·delete 는 SAFETY_FLOOR_KINDS 라 어떤 모드에서도 승인(A2+)을 받는다.
// **빠진 것은 "어디까지"** 다. 로컬 실행은 되돌리기 어렵고, 범위가 무한하고, 연쇄된다 —
// 그래서 등급 위에 범위를 얹는다.
//
// 경계:
//   · **선언 루트**는 작업 루트(`~/GPAO-T5`) + 표준 사용자 폴더(Downloads·Documents·Desktop)다.
//     `defaultFileRoots` 가 내는 것이 이것이고, 사용자에게 보이는 이름(`부르는이름들`)도 여기서 나온다.
//
//   ✅ **선언과 강제를 합쳤다**(2026-08-07 · 오너 방향 · 노드 R 순서 ② · F-46 닫음).
//     둘이 갈려 있던 동안 사람 셋이 그 차이에 걸렸고(PM 두 번 · 개발 라인 한 번),
//     모델은 좁은 선언을 믿고 `from:'Desktop'` 으로 범위를 좁혀 찾다 실패했다(판 5판 ⑫ 0/3).
//     이제 선언도 강제도 **홈 전체 − 보호 영역**이다.
//     오너 결정 원문(`local-file.js`) — *"울타리는 승인·휴지통·발화밖파괴 위에 덧댄 중복이었다.
//     남는 절대선은 보호 영역 하나이고, 터미널은 이미 그 규칙 하나로 돈다."*
//
//     합치기 전에 **격리 증명을 강제 축으로 먼저 옮겼다**(`prove-isolation.mjs` · 커밋 70013c5).
//     그 증명이 선언(`scopeRoots.length===1`)을 세고 있어서, 넓히면 강제를 한 번도 안 잰 채
//     먼저 깨졌을 것이다. 격리는 이 저장소에서 유일하게 되돌릴 수 없는 손해가 난 자리다.
//
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
  // **홈이 방이다 — 선언이 강제와 같아야 한다**(오너 방향 2026-08-07 · 노드 R 순서 ②).
  //
  // 이 자리는 두 번 넓혀졌다. 처음엔 `~/GPAO-T5` 하나였고, H08 실측(인간 기준선 3/3 실패)이
  // *"다운로드 폴더에 방금 받은 견적서"* 를 못 열어 셋을 얹었다. 그리고 판 5판 ⑫가 같은 병을
  // 한 칸 위에서 냈다 — 파일은 `~/GPAO-T5` 안에 있었는데 모델이 **선언을 믿고**
  // `from:'Desktop'`·`from:'Documents'` 로 좁혀 찾다 실패했다. **넷 → 다섯으로는 계속 난다.**
  //
  // 그리고 선언이 강제와 갈려 있었다: 손은 이미 홈 전체를 본다
  // (`local-file.js:216`·`:331` — `[...roots, 홈자리]`). 그 차이에 사람 셋이 걸렸다(F-46).
  // **좁히는 게 아니라 맞춘다** — 좁히면 CU 는 화면 전체를 보고 터미널은 홈 밖까지 실행하는데
  // 파일 손만 넷이 되어, 사장님에겐 *"카톡은 읽어주면서 드롭박스 정산표는 못 연다"* 로 보인다.
  //
  // **넓힘이 보호를 풀지 않는다.** `local-protection` 이 루트와 독립으로 막는다 —
  // `~/Library` 전부(앱 내부 저장소·메일·메신저 전문), 자격증명, 그리고 **홈 최상위 숨김 자리**.
  return [home];
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
    // **사용자는 경로를 말하지 않는다**(P6-W2). 라이브 실측(2026-08-01·2026-08-02): "정산_3월.csv
    // 지워줘"에 T5 가 "작업 폴더 밖이에요"라고 답했는데 그 파일은 Downloads 에 있었다 — 상대
    // 경로가 첫 루트로만 풀린 탓이다. 위 규칙은 `Downloads/x` 처럼 **루트를 부른** 경우만 푼다.
    // 여기서는 이름만 준 경우를 마저 푼다: 첫 루트에 없으면 **실재하는 다른 루트**를 쓴다.
    //   · 첫 루트 해석이 실재하면 그대로 둔다(행동 보존 — 같은 이름이 여럿이면 작업 폴더 우선).
    //   · 실재하는 것이 없으면 그대로 둔다 — 새 파일은 여전히 작업 폴더에 생긴다(쓰기 자리 불변).
    // 루트 안에서만 고르므로 범위는 넓어지지 않는다. 지어내지 않고 **있는 것만** 고른다.
    if (!existsSync(abs)) {
      const 실재 = roots.map((r) => resolve(r, t)).find((p) => existsSync(p));
      if (실재) abs = 실재;
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
  // **막을 때도 무엇을 막았는지 말한다**(라이브 실측 2026-08-03).
  // "다운로드 폴더 정리하자"에 T5 는 "그 자리는 밖이에요. 파일 도구는 … **다운로드** …
  // 안에서만 다뤄요"라고 답했다. 다운로드가 된다면서 다운로드를 거절한 셈이라 사용자에겐
  // 모순으로만 읽혔고, **어느 자리가 문제인지는 화면에도 원장 진단에도 없었다**(actualCall:null,
  // reason:'not_executable' 이 전부). 모델도 무엇을 고쳐 다시 부를지 알 수 없었다.
  //
  // 경로를 사용자에게 그대로 싣지 않는 계약은 그대로 지킨다(2026-08-02: 절대경로가 답변에
  // 옮겨 적혔다). 대신 **사람이 부르는 이름**으로 가리키고, 실제 경로는 진단면에만 둔다.
  const 가리킨곳 = 부르는이름(err?.target);
  return {
    userSafeSummary: 가리킨곳
      ? `${가리킨곳}은(는) 파일 도구의 작업 폴더 밖이에요.`
      : '그 자리는 파일 도구의 작업 폴더 밖이에요.',
    // **사실만 남긴다** — 이 손이 어디까지 다루는지. 사용자에게 시키지도, 다른 손을 약속하지도
    // 않는다(이 손은 다른 손이 있는지 모른다). 다음 계단은 손 목록을 아는 커널이 정한다.
    nextSafeAction: `파일 도구는 ${부르는이름들(roots)} 안에서만 다뤄요.`,
    // 진단면 — 사용자면에는 절대 안 나간다. 이게 없으면 결함을 재현할 수가 없다(실측).
    diagnostic: { reason: 'out_of_scope', target: err?.target || null, roots },
  };
}

/**
 * 막힌 대상을 **사람이 부르는 말**로. 경로 전체를 싣지 않는다 — 마지막 이름 하나면
 * 사용자는 자기가 무엇을 말했는지 안다("다운로드", "외장하드"). 이름을 못 뽑으면 아무 말도
 * 하지 않는다(지어내지 않는다).
 */
function 부르는이름(target) {
  const t = String(target ?? '').replace(/\/+$/, '');
  if (!t) return null;
  const 끝 = t.slice(t.lastIndexOf('/') + 1);
  if (!끝 || 끝 === t) return null;             // 상대 경로·빈 값은 가리키지 않는다
  // 이름표는 **한 벌만 쓴다**(`폴더부름말`) — 두 벌로 두면 한쪽만 늘어난다.
  return 폴더부름말[끝] ?? (끝 === 'GPAO-T5' ? '작업 폴더' : 끝);
}

/**
 * 루트를 **사용자가 부르는 이름**으로. 라이브 실측(2026-08-02): 이 문장이 절대경로를 그대로
 * 실어 사용자에게 나갔고(`/Users/…/Downloads`), 같은 문장이 모델 입력이 되어 모델이 답변에
 * 절대경로를 옮겨 적었다. 사용자는 자기 폴더를 경로로 알지 않는다 — "다운로드"라고 부른다.
 *
 * 이름은 **locate 의 부름말 표와 같은 진실**을 쓴다(두 벌로 두면 한쪽만 늘어난다). 표에 없는
 * 루트는 지어내지 않고 마지막 폴더 이름만 말한다 — 경로는 어디에도 싣지 않는다.
 */
export function 부르는이름들(roots = defaultFileRoots(), env = process.env) {
  const home = env.GPAO_T5_HOME ?? env.HOME ?? homedir();
  const 이름 = roots.map((r) => {
    // **홈이면 홈이라고 말한다.** 예전엔 폴더 이름(`jyp`)을 그대로 불러
    // *"제가 다루는 폴더(jyp) 안에서"* 가 나갔다 — 사용자도 모델도 그게 무슨 말인지 모른다.
    if (resolve(String(r)) === resolve(home)) return '이 컴퓨터의 내 폴더 전체';
    const 끝 = String(r).split(sep).filter(Boolean).pop() ?? '';
    return 폴더부름말[끝] ?? (끝 === 'GPAO-T5' ? '작업 폴더' : 끝);
  });
  return [...new Set(이름)].join(', ');
}

/** 디스크의 표준 폴더 이름 → 사용자가 부르는 말. locate 의 `표준폴더말` 의 역방향(같은 세 곳). */
const 폴더부름말 = { Downloads: '다운로드', Documents: '문서', Desktop: '바탕화면' };

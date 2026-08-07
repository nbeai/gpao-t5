// **화면 손을 스스로 찾는다** — 사용자는 환경변수를 모른다.
//
// PM 판정(2026-08-06 · 판 3차)이 연 자리다. `GPAO_T5_CUA_BIN` 은 저장소에서 **읽는 자리
// 한 곳**에만 있었고 **아무데서도 안 세웠다.** 개발자가 라이브 시험 때 손으로 넣어 띄웠고,
// 그래서 실험실에서는 되고 **사장님이 설치하고 켠 T5 에는 화면 손이 0개**였다.
// 계산기도 카톡도 크롬도 — 손이 틀린 게 아니라 **기동에 안 이어졌다.**
//
// 오너 규율: *"영향 0 레인 작업을 제품 효과로 보고하지 말 것."*
//
// 그래서 기동이 스스로 찾는다. cua 자신도 그렇게 산다 —
// `computer-use doctor` 가 *"looked for 'cua-driver (PATH and canonical install paths)'"*.
// 같은 자리를 본다. 환경이 밝히면 그것이 이기고(개발·시험), 없으면 표준 자리를 훑는다.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * **T5 와 함께 오는 손** — 오너 결정(2026-08-07): *"T5 설치에 같이 담는다."*
 *
 * 자영업자에게 *"먼저 cua-driver 를 설치하세요"* 라고 할 수 없다. 그 문장 하나가 화면 기능
 * 전체를 없는 것으로 만든다 — 실제로 그랬다(PM 판정 · 판 3차 ①⑥ 0/3).
 *
 * **아키텍처를 가린다.** 동봉본은 macOS arm64 하나다. 파일 존재만 보고 집으면 인텔 맥에서
 * **찾기는 찾고 실행은 실패한다** — 그건 "손이 없다"보다 나쁘다(계열 C: 없는 것 ↔ 못 본 것).
 *
 * @param {{platform?:string, arch?:string}} [deps]
 * @returns {string|null} 이 기계에서 **돌아가는** 동봉본의 자리. 없으면 `null`.
 */
export function 동봉된손(deps = {}) {
  const 앱 = 동봉된앱(deps);
  return 앱 ? `${앱}/Contents/MacOS/cua-driver` : null;
}

/**
 * **동봉하는 것은 생 바이너리가 아니라 서명된 앱이다**(오너 결정 2026-08-07).
 *
 * 이틀간 권한이 회차마다 흔들린 뿌리가 여기였다. 우리는 `vendor/` 의 ad-hoc 서명 바이너리를
 * `mcp --direct` 로 띄웠는데, 그 플래그의 정의가 이렇다 —
 * *"on macOS this **explicitly accepts host TCC attribution**"*. **T5 를 띄운 프로세스의
 * 권한을 빌려 쓴다.** 개발 기계에서는 Claude Code 셸의 권한이 있어 되는 것처럼 보였고,
 * 사장님 컴퓨터에서는 *"터미널이 화면을 기록하려 합니다"* 가 뜬다.
 *
 * `--direct` 를 빼면 드라이버가 **스스로** `open -n -g -a CuaDriver --args serve` 로 데몬을
 * 띄우고 프록시한다(실측). 그때 TCC 는 `com.trycua.driver` 번들에 붙어 **안 흔들린다.**
 * 우리 `--direct` 는 그 자동 경로가 `.app` 이 없어 실패하는 것을 우회한 것이었다.
 *
 * 동봉본은 서명·공증이 살아 있다 —
 * `Developer ID Application: Cua AI, Inc. (YCK386LBJ7)` · `spctl: Notarized Developer ID`.
 * 그래서 재배포해도 사장님 맥에서 Gatekeeper 를 통과한다. `curl | bash` 는 안 쓴다 —
 * 원격 스크립트를 남의 컴퓨터에서 자동 실행하는 것은 다른 종류의 결정이고,
 * 서명된 앱을 복사하면 네트워크도 필요 없다.
 *
 * @returns {string|null} 이 기계에서 **돌아가는** 동봉 앱의 자리. 없으면 `null`.
 */
export function 동봉된앱(deps = {}) {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  if (platform !== 'darwin' || arch !== 'arm64') return null;
  return fileURLToPath(new URL('../../vendor/cua-driver/darwin-arm64/CuaDriver.app', import.meta.url));
}

/** TCC 가 붙는 자리. macOS 는 LaunchServices 가 아는 곳에 있어야 앱으로 인정된다. */
export function 앱설치자리(deps = {}) {
  const platform = deps.platform ?? process.platform;
  return platform === 'darwin' ? '/Applications/CuaDriver.app' : null;
}

/**
 * **기동 인자** — `--direct` 를 안 쓴다.
 *
 * 예전엔 `['mcp', '--direct']` 였다. 위 주석의 이유로 뺐다. 데몬 프록시가 기본 경로이고,
 * `.app` 이 제자리에 있으면 드라이버가 알아서 띄운다.
 */
export function 기동인자(deps = {}) {
  const bin = deps.binPath;
  return { bin, args: ['mcp'] };
}

/**
 * **앱이 없으면 동봉본을 제자리에 놓는다**(오너 결정 2026-08-07: *"T5 가 자동으로 설치"*).
 *
 * 사장님에게 *"먼저 CuaDriver 를 설치하세요"* 라고 할 수 없다 — 어제 배송에서 배운 그대로다.
 * **네트워크를 안 쓴다.** 서명·공증된 앱을 복사할 뿐이라 `curl | bash` 도 다운로드도 없다.
 *
 * **있으면 안 덮는다.** 사장님이 직접 깐 것이나 더 최신본이 그의 의도다 —
 * 동봉본은 아무것도 없을 때의 안전망이지 우리 취향의 강요가 아니다(화면 손 때와 같은 규율).
 *
 * **실패해도 기동을 안 막는다.** `/Applications` 쓰기가 막힐 수 있고, 그때는 손이 없는 채로
 * 도는 것이 통째로 안 뜨는 것보다 낫다 — 다만 **왜 못 놓았는지는 남긴다.**
 */
export async function 앱을제자리에(deps = {}) {
  const 자리 = 앱설치자리(deps);
  const 동봉 = 동봉된앱(deps);
  if (!자리 || !동봉) return null;
  const 있나 = deps.fs?.있나 ?? ((p) => existsSync(p));
  if (있나(자리)) return { 이미있음: true, 자리 };
  if (!있나(동봉)) return { 놓았다: false, 왜: '동봉본이 없어요', 자리 };
  const 복사 = deps.fs?.복사 ?? (async (a, b) => {
    const { cp } = await import('node:fs/promises');
    await cp(a, b, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
  });
  try {
    await 복사(동봉, 자리);
    return { 놓았다: true, 자리 };
  } catch (e) {
    return { 놓았다: false, 왜: String(e?.message ?? e).slice(0, 120), 자리 };
  }
}

/** cua 설치가 실제로 놓는 자리들. 앞선 것이 이긴다 — 어느 것을 쓰는지 흔들리지 않게. */
const 표준자리 = (home) => [
  join(home, '.local/bin/cua-driver'),
  '/usr/local/bin/cua-driver',
  '/opt/homebrew/bin/cua-driver',
  // macOS 앱 설치본. 앱이 있으면 그 안의 실행 파일도 같은 손이다.
  '/Applications/CuaDriver.app/Contents/MacOS/cua-driver',
];

/**
 * 화면 손 실행 파일의 자리. 못 찾으면 `null` — **없는 손을 있다고 하지 않는다.**
 *
 * @param {{env?:Record<string,string|undefined>, home?:string, fs?:{있나:(p:string)=>boolean}}} [deps]
 */
export function 화면손찾기(deps = {}) {
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const 있나 = deps.fs?.있나 ?? ((p) => existsSync(p));

  // ① 환경이 밝히면 그것이 이긴다 — 개발·시험·특수 설치.
  //    **다만 실제로 있을 때만.** 낡은 값 하나로 손이 통째로 사라지면 안 된다.
  const 밝힌것 = String(env.GPAO_T5_CUA_BIN ?? '').trim();
  if (밝힌것 && 있나(밝힌것)) return 밝힌것;
  // **검사는 기계마다 달라지면 안 된다.** 이 컴퓨터에 뭐가 깔렸느냐로 통과·실패가 갈리면
  // 그건 계약이 아니라 환경이다. 그래서 **밝히면 끈다** — 검사와 격리 실행이 이 문을 쓴다.
  if (env.GPAO_T5_NO_AUTO_SCREEN_BIN === '1') return null;

  // ② 표준 설치 자리.
  for (const p of 표준자리(home)) {
    if (있나(p)) return p;
  }

  // ③ PATH — 설치 방식을 하나로 강요하지 않는다.
  for (const 조각 of String(env.PATH ?? '').split(':')) {
    if (!조각) continue;
    const p = join(조각, 'cua-driver');
    if (있나(p)) return p;
  }

  // ④ **T5 와 함께 온 손.** 여기까지 왔다는 건 이 기계에 cua 가 안 깔렸다는 뜻이다 —
  //    그래도 화면 기능은 있어야 한다. **맨 뒤인 것이 중요하다**: 사장님이 직접 깐 것이
  //    있으면 그게 그의 의도이고, 동봉본은 우리 취향의 강요가 아니라 **안전망**이다.
  const 동봉 = 동봉된손({ platform: deps.platform, arch: deps.arch });
  if (동봉 && 있나(동봉)) return 동봉;
  return null;
}

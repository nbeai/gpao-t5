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
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  if (platform !== 'darwin' || arch !== 'arm64') return null;
  return fileURLToPath(new URL('../../vendor/cua-driver/darwin-arm64/cua-driver', import.meta.url));
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

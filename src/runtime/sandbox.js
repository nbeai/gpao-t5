// L3 · 실행 샌드박스 (P6-T1) — **명령이 위험한지 알아맞히지 않는다. 돌려 보고 안다.**
//
// 이전 설계는 위험 명령을 목록으로 막으려 했다. 그건 항상 뚫린다(실측):
//   `rm` 을 막으면 → `find . -delete` → `python -c "os.remove(...)"` → `osascript` → …
// 목록은 우리가 상상한 것만 막고, 상상 못 한 것은 전부 통과시킨다. 그리고 목록이 길어질수록
// 안전한 명령까지 막혀서 도구가 쓸모없어진다.
//
// 그래서 판정을 **커널에 맡긴다.** 쓰기·네트워크를 막고 먼저 돌려 본다:
//   · 성공했다 → 그 명령은 아무것도 안 바꿨다는 **증명**이다. 승인이 필요 없다.
//   · 막혔다   → 뭔가 바꾸려 했다는 뜻이다. 그때 사용자에게 묻는다.
// 우리가 아는 위험 목록이 아니라 **실제로 일어난 일**이 등급을 정한다(§24).
//
// 보호 영역은 **두 프로파일 모두**에서 읽기까지 막는다. 승인을 받아도 비밀은 안 샌다 —
// 사용자가 "설치해줘"를 승인한 것이지 "~/.ssh 를 읽어라"를 승인한 게 아니다.
import { secretPaths } from './local-protection.js';

/** sandbox-exec 프로파일 문자열은 Scheme 리터럴이라 따옴표·역슬래시를 막아야 한다. */
const lit = (p) => `"${String(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * @param {'probe'|'granted'} mode
 *   probe   — 아무것도 못 바꾸게 하고 돌려 본다(자동 판정용).
 *   granted — 사용자가 승인한 뒤. 변경·네트워크는 열되 **비밀은 여전히 닫는다.**
 * @param {{secrets?:string[], scratch?:string}} opts
 *   scratch — 이번 실행에만 쓰고 버리는 임시 자리(runCommand 가 만든다). 여기만 쓰기를 연다.
 */
export function sandboxProfile(mode, { secrets = secretPaths(), scratch } = {}) {
  const denySecrets = secrets.map((p) => `(deny file-read* (subpath ${lit(p)}))`).join('\n');
  if (mode === 'granted') {
    return `(version 1)\n(allow default)\n${denySecrets}\n`;
  }
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    // 출력·터미널은 열어 둔다 — 이걸 막으면 명령이 화면에 아무 말도 못 한다.
    '(allow file-write* (regex #"^/dev/(null|stdout|stderr|tty|fd/[0-9]+)$"))',
    // **셸이 자기 일을 하려고 쓰는 임시 자리 하나.** 이걸 안 열면 heredoc·here-string·프로세스
    // 치환이 전부 "파일을 바꾸려 했다"로 잡힌다 — zsh 가 `<<'PY'` 를 위해 임시 파일을 만들기
    // 때문이다(실측: `zsh: can't create temp file for here document`). 그래서 라이브에서
    // **읽기만 하는 python heredoc 이 A2 승인 카드로 갔다**(오너 실사용, 2026-07-27).
    // 능력을 줄여 안전을 얻은 게 아니라, 안전과 무관한 자리에서 능력을 잃은 것이다.
    //
    // 이 자리는 **매 실행마다 새로 만들고 끝나면 지운다.** 사용자의 자리가 아니고 남지도 않으므로
    // "아무것도 안 바꿨다"는 증명은 그대로다. $TMPDIR 전체를 열면 안 된다 — 거기엔 남의 것이
    // 있다(적대적 검증의 미끼밭이 바로 거기 있고, 넓히면 30건 중 여럿이 뚫린다 — 반대 검증함).
    ...(scratch ? [`(allow file-write* (subpath ${lit(scratch)}))`] : []),
    '(deny network*)',
    denySecrets,
    '',
  ].join('\n');
}

/** 이 컴퓨터에서 샌드박스를 쓸 수 있는가. 못 쓰면 **자동 실행을 열지 않는다**(모르면 막는다). */
export function sandboxAvailable(platform = process.platform) {
  return platform === 'darwin';
}

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
 */
export function sandboxProfile(mode, { secrets = secretPaths() } = {}) {
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
    '(deny network*)',
    denySecrets,
    '',
  ].join('\n');
}

/** 이 컴퓨터에서 샌드박스를 쓸 수 있는가. 못 쓰면 **자동 실행을 열지 않는다**(모르면 막는다). */
export function sandboxAvailable(platform = process.platform) {
  return platform === 'darwin';
}

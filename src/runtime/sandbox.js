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
import { secretPaths, secretProtection } from './local-protection.js';

/** sandbox-exec 프로파일 문자열은 Scheme 리터럴이라 따옴표·역슬래시를 막아야 한다. */
const lit = (p) => `"${String(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * P0-a(QA90 감사 2026-08-02): 비밀 보호의 **커널 판 전체.** 그동안 자리(subpath)만 내려가고
 * 이름 규칙(F7.2)·홈 Library 닫힘(F7.1)은 파일손에만 있었다 — 파일손이 막는
 * `~/Library/Messages`·`.env`·`id_rsa`·셸 히스토리를 터미널이 승인 없이 읽었다(라이브 실측:
 * 격리 홈 검증 중 실제 바탕화면이 답변에 나갔고, 적대 검증이 5개 자리에서 확정).
 * 열림 예외는 allow 재개방이 아니라 require-not 필터다 — allow 는 커넥터 선언(`열어줄것`)의
 * 자리이고, 여기서 allow 를 쓰면 "선언 없이는 아무것도 도로 열지 않는다" 계약이 흐려진다.
 */
function denySecretReads(dirs) {
  const prot = secretProtection();
  return [
    ...dirs.map((p) => `(deny file-read* (subpath ${lit(p)}))`),
    // SBPL 의 정규식 리터럴은 `#"…"` — 닫는 # 가 없다(위 /dev/ 허용 줄과 같은 형태).
    ...prot.namePatterns.map((r) => `(deny file-read* (regex #"${r}"))`),
    ...prot.closed.map(({ root, open }) => `(deny file-read* (require-all (subpath ${lit(root)})${open.map((o) => ` (require-not (subpath ${lit(o)}))`).join('')}))`),
  ].join('\n');
}

/**
 * @param {'probe'|'granted'|'reach'|'capsule'|'structured'} mode
 *   probe   — 아무것도 못 바꾸게 하고 돌려 본다(자동 판정용).
 *   granted — 사용자가 승인한 뒤. 변경·네트워크는 열되 **비밀은 여전히 닫는다.**
 * @param {{secrets?:string[], scratch?:string}} opts
 *   scratch — 이번 실행에만 쓰고 버리는 임시 자리(runCommand 가 만든다). 여기만 쓰기를 연다.
 */
export function sandboxProfile(mode, {
  secrets = secretPaths(), scratch, allowRead = [], runtime, executable,
} = {}) {
  const denySecrets = denySecretReads(secrets);
  // **명령이 자기 자격을 읽는 자리.** 실측(오너 2026-07-28): `gh repo list` 가 실패했는데
  // 원인은 T5 의 비밀 보호가 `~/.config/gh` 를 막은 것이었다 — 그 명령의 **자기 토큰**이다.
  // 넓히지 않는다: 커넥터가 선언한 경로만, 그것도 읽기만 연다. 선언에 없으면 그대로 막힌다.
  const 열어줄것 = allowRead.map((p) => `(allow file-read* (subpath ${lit(p)}))`).join('\n');
  // 구조화 terminal은 셸 문장을 실행하지 않는다. 고정 wrapper(`/bin/sh`)가 별도 argv로
  // 받은 단일 executable을 `exec "$@"`로 같은 프로세스에 올린다. deny-default에서 읽기와
  // 출력, 매 실행 scratch, wrapper·검증된 executable의 initial exec만 연다. fork·network·
  // Mach·AppleEvent·signal·사용자 파일 쓰기는 열어 주는 규칙이 없으므로 기본 거부다.
  if (mode === 'structured') {
    return [
      '(version 1)',
      '(deny default)',
      '(allow file-read*)',
      // 런타임이 자기 stack guard·locale·CPU 정보를 준비하는 관측 권한. 다른 프로세스에
      // 신호를 보내거나 정보를 읽는 권한은 열지 않는다.
      '(allow signal (target self))',
      '(allow process-info* (target self))',
      '(allow sysctl-read)',
      '(deny process-fork)',
      ...(runtime ? [`(allow process-exec* (literal ${lit(runtime)}))`] : []),
      ...(executable ? [`(allow process-exec* (literal ${lit(executable)}))`] : []),
      '(allow file-write* (regex #"^/dev/(null|stdout|stderr|tty|fd/[0-9]+)$"))',
      ...(scratch ? [`(allow file-write* (subpath ${lit(scratch)}))`] : []),
      denySecrets,
      '',
    ].join('\n');
  }
  if (mode === 'granted') {
    return `(version 1)\n(allow default)\n${denySecrets}\n${열어줄것}\n`;
  }
  return [
    '(version 1)',
    '(allow default)',
    // **캡슐은 프로세스를 못 띄운다**(S4 성질 ④). probe 프로파일은 쓰기·네트워크·시그널·
    // AppleEvent 를 막지만 **자식 프로세스 생성은 막지 않는다** — 그래서 캡슐 안에서
    // `child_process.execSync('echo …')` 가 그대로 돌았다(실측 2026-08-04).
    //
    // 자식은 샌드박스를 물려받으니 파일도 못 바꾸고 밖에도 못 나간다. 그래도 막는 이유는
    // **캡슐의 계약이 "손은 RPC 로만"** 이기 때문이다. 셸이 열려 있으면 그 안에서 하는 일이
    // T5 의 승인·영수증·되돌리기를 지나지 않는다 — 비교군(Hermes)이 허용 도구에 `terminal`
    // 을 넣어 생긴 구멍이 정확히 그것이다.
    //
    // **전면 금지 뒤에 하나만 연다.** `(deny process-exec*)` 만 두면 `sandbox-exec` 가
    // 캡슐 본체(node)조차 못 띄운다(실측). 순서가 곧 우선순위이므로 막고 나서 그 하나만
    // 도로 연다 — `child_process` 는 `/bin/sh` 를 띄우므로 여전히 막힌다.
    ...(mode === 'capsule'
      ? ['(deny process-exec*)', ...(runtime ? [`(allow process-exec* (literal ${lit(runtime)}))`] : [])]
      : []),
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
    // P5-B-1B `reach`: **읽기만 하되 바깥에 닿는** 자리. 커넥터가 선언한 CLI 손(`gh pr list`,
    // `aws s3 ls`)이 여기 산다 — 이 컴퓨터의 것은 하나도 못 바꾸는데 자기 서비스에는 물어봐야 한다.
    // probe 로 돌리면 네트워크가 막혀 "설치돼 있는데 안 되는" 상태가 되고, granted 로 돌리면
    // 파일 쓰기까지 열린다. **능력을 위해 안전을 푸는 게 아니라, 없던 칸에 이름을 붙인 것이다.**
    ...(mode === 'reach' ? [] : ['(deny network*)']),
    // **probe 는 시험이어야 한다.** 실측 사고(오너 라이브 2026-07-28, 웹 화면):
    // "그럼 그거 꺼줘" 에 `killall openclaw` 가 probe 로 돌았고 **프로세스가 실제로 죽었다.**
    // 샌드박스가 아무것도 안 막았으니 런타임은 `changes:false` 로 읽었고, 승인 카드가 안 떴고,
    // 사용자에게는 "적용 안 됐어요(applied:false)"라고 말했다. 셋 다 거짓이었다.
    //
    // 원인은 목록이 아니라 구조다. 이 프로파일은 `(allow default)` 에 몇 가지만 막는 꼴이라
    // **명시적으로 안 막은 바깥 효과는 전부 통과한다.** 파일 쓰기와 네트워크만 막고 있었다.
    // `killall` 을 목록에 더하면 다음엔 `pkill`, 그 다음엔 다른 것으로 뚫린다.
    // 그래서 **효과의 종류**를 닫는다. 적용 여부는 실행기의 별도 FD handshake로 증명하며,
    // 오류 문자열을 승인·재실행 판단에 쓰지 않는다.
    '(deny signal)',
    // 다른 앱을 원격 조종하는 통로. `osascript -e 'tell application …'` 한 줄이면 파일도 지우고
    // 메일도 보낸다 — 파일 쓰기가 아니라서 위 규칙에 안 걸린다.
    '(deny appleevent-send)',
    denySecrets,
    // **금지 뒤에 온다** — 선언한 자리 하나만 도로 열기 위해서다(순서가 곧 우선순위).
    열어줄것,
    '',
  ].join('\n');
}

/** 이 컴퓨터에서 샌드박스를 쓸 수 있는가. 못 쓰면 **자동 실행을 열지 않는다**(모르면 막는다). */
export function sandboxAvailable(platform = process.platform) {
  return platform === 'darwin';
}

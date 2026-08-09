// L3 · 로컬 보호 영역 (P6-L1) — **넓게 열기 전에 세우는 안전막.**
//
// 방향 전환(오너 지시): T5 는 PC 기반 AI OS 다. 일반 폴더·문서는 넓게 다뤄야 한다.
// 그러면 **안전이 "좁은 루트"에서 나오던 구조가 사라진다.** 그 자리를 이 파일이 받는다.
//   보안은 기본 접근을 좁게 막는 방식이 아니라, **위험한 자리를 정확히 잡는 방식**으로 설계한다.
//
// **보호는 루트와 독립이다.** 사용자가 홈 전체를 열어도 `~/.ssh` 는 안 열린다 —
// 루트를 넓히는 것으로 보호가 풀리면 그건 보호가 아니다(게이트가 이 불변식을 검사한다).
//
// 두 가지를 구분한다. 뭉뚱그리면 "아무것도 못 하는 도구"가 된다.
//   · secret  — **내용을 보지 않는다.** 승인으로도 열지 않는다. 있다는 사실까지만 말한다.
//               (키·토큰·인증서·브라우저 세션·지갑. 유출되면 되돌릴 수 없다.)
//   · system  — **읽기는 되고 변경은 안 된다.** OS·앱 내부는 사용자가 고칠 자리가 아니다.
//
// 목록으로 막는 것이 맞는 드문 자리다(§8 은 "파생 가능한 것을 손으로 관리하지 마라"이지
// "보안 거부 목록을 만들지 마라"가 아니다). 대신 **불변식으로 잠근다** — 아래 §게이트 참고.
import { homedir, tmpdir } from 'node:os';
import { sep } from 'node:path';

const HOME = homedir();
const h = (p) => `${HOME}/${p}`;

// **임시 폴더는 보호 대상이 아니다.** macOS 의 tmp 는 `/private/var/folders/…` 라 `/private/var`
// 를 통째로 막으면 임시 작업이 전부 막힌다(테스트 12건이 그렇게 깨졌다 — 목록이 거칠었다).
// 시스템에서 지켜야 할 것은 OS·앱이 쓰는 자리이지 사용자의 임시 작업 공간이 아니다.
// macOS 는 `/var` 가 `/private/var` 로 가는 링크라 **realpath 뒤 형태가 다르다.**
// 우리는 realpath 로 푼 경로를 받으므로 두 형태를 다 담는다(이걸 빠뜨려 임시 폴더가 막혔다).
// F7.3 방어: TMPDIR 이 `/` 처럼 오염되면 SCRATCH 면제가 SYSTEM 보호를 통째로 끈다 —
// 시스템 자리를 **품는** 임시 경로는 임시 경로가 아니므로 면제 목록에서 뺀다.
const SCRATCH_RAW = [...new Set([
  tmpdir(), `/private${tmpdir()}`, tmpdir().replace(/^\/private/, ''),
  '/tmp', '/private/tmp',
])];

/** 비밀 — 내용을 보지 않는다. 경로(디렉터리) 기준. */
const SECRET_DIRS = [
  h('.ssh'), h('.gnupg'), h('.aws'), h('.kube'), h('.docker'),
  h('.config/gcloud'), h('.config/gh'), h('.password-store'),
  h('Library/Keychains'), '/Library/Keychains', '/private/etc/ssl',
  // 브라우저 세션·쿠키 — 로그인 상태를 빌려 쓰는 통로가 된다(브라우저 손과 같은 원칙).
  h('Library/Application Support/Google/Chrome'),
  h('Library/Application Support/Firefox'),
  h('Library/Application Support/BraveSoftware'),
  h('Library/Safari'), h('Library/Cookies'),
  // 지갑·암호화폐
  h('Library/Application Support/Exodus'), h('Library/Application Support/Electrum'),
];

/** 비밀 — 파일 이름 기준(어느 폴더에 있든). */
const SECRET_NAMES = [
  /^\.env(\.|$)/i, /^\.netrc$/i, /^\.npmrc$/i, /^\.pgpass$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i, /^.*\.(pem|key|p12|pfx|keystore|jks)$/i,
  /^credentials$/i, /^service-account.*\.json$/i, /(^|[-_.])secret/i, /(^|[-_.])token/i,
  /^wallet\.dat$/i, /\.kdbx$/i,
  // F7.2: 흔한 **평문 자격증명**이 정확일치 규칙 사이로 빠져 있었다(감사 2026-08-01).
  //   `.git-credentials` 는 `/^credentials$/` 정확일치에 안 걸렸고, 셸 히스토리는 입력한
  //   토큰이 그대로 남는 자리다. 이름 규칙이라 어느 폴더에 있든 잡는다.
  /^\.git-credentials$/i, /^\.credentials(\..+)?$/i, /^\..*_history$/i, /^rclone\.conf$/i,
];

// P0-a(QA90 감사 2026-08-02): 이름 규칙의 **커널(샌드박스) 판**. 위 SECRET_NAMES 는 basename
// 에 대한 JS 정규식이고, seatbelt 는 전체 경로에 대한 대소문자 구분 ERE 만 받는다 — 그래서
// "그건 도구 층에서 잡는다"로 분담해 뒀는데, 터미널의 도구 층은 basename 을 아예 안 본다.
// 분담의 한쪽이 비어 있었고 파일손이 막는 `.env`·`id_rsa`·히스토리를 터미널이 읽었다.
// 규칙마다 경로판을 **같은 파일에 나란히** 둔다(두 벌 목록 금지 — 떨어져 있으면 또 벌어진다).
// `마지막칸` = 경로의 마지막 조각 경계. basename 판정과 같은 정의역을 보장한다.
const 마지막칸 = '(^|/)';
const SECRET_NAME_PATHS = [
  `${마지막칸}\\.env(\\..*)?$`,
  `${마지막칸}\\.netrc$`, `${마지막칸}\\.npmrc$`, `${마지막칸}\\.pgpass$`,
  `${마지막칸}id_(rsa|dsa|ecdsa|ed25519)$`,
  `\\.(pem|key|p12|pfx|keystore|jks)$`,
  `${마지막칸}credentials$`, `${마지막칸}service-account[^/]*\\.json$`,
  `${마지막칸}([^/]*[-_.])?secret[^/]*$`, `${마지막칸}([^/]*[-_.])?token[^/]*$`,
  `${마지막칸}wallet\\.dat$`, `\\.kdbx$`,
  `${마지막칸}\\.git-credentials$`, `${마지막칸}\\.credentials(\\.[^/]+)?$`,
  `${마지막칸}\\.[^/]*_history$`, `${마지막칸}rclone\\.conf$`,
];

/** seatbelt ERE 에는 /i 가 없다 — 괄호 밖 알파벳을 [xX] 로 펼쳐 같은 판정을 만든다. */
function 대소문자펼침(src) {
  let out = ''; let 괄호안 = false;
  for (const ch of src) {
    if (ch === '[') { 괄호안 = true; out += ch; continue; }
    if (ch === ']') { 괄호안 = false; out += ch; continue; }
    out += !괄호안 && /[a-z]/i.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch;
  }
  return out;
}

// F7.1: **홈의 Library 는 앱의 내부 저장소다** — iMessage 전문(chat.db)·Mail·Containers·
// 목록에 없는 브라우저·앱 세션이 전부 여기 산다. 절대 경로 `/Library`(시스템)와 별개로,
// 홈 아래 Library 는 **내용을 보지 않는 자리**로 막는다. 목록 열거로는 새 앱마다 새는
// 자리가 생긴다(감사 실측: Edge·Arc·Slack·Notion 전부 목록 밖이었다) — 기본을 닫고,
// **사용자 파일이 실제로 사는 동기화 자리만** 연다. 루트 확장과 독립이다.
const USER_LIBRARY = h('Library');
const USER_LIBRARY_OPEN = [
  h('Library/CloudStorage'),       // Dropbox·Google Drive 등 — 사용자의 문서가 산다
  h('Library/Mobile Documents'),   // iCloud Drive — 사용자의 문서가 산다
];

/** 시스템 — 읽기는 되고 변경은 안 된다. */
const SYSTEM_DIRS = [
  '/System', '/Library', '/usr', '/bin', '/sbin', '/etc', '/private/etc', '/var', '/private/var',
  '/Applications', '/opt', '/cores', '/Volumes/Preboot',
  h('Library/LaunchAgents'), '/Library/LaunchDaemons',
];

const within = (dir, p) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);
const baseName = (p) => String(p).split(sep).pop() ?? '';

// F7.3: 시스템 자리를 품는 SCRATCH 항목은 면제로 쓰지 않는다(위 선언의 실제 적용).
//
// **홈에서 파생된 시스템 자리는 이 판정에서 뺀다**(P-OP 결함 가족 B-④′ · 2026-08-10 실측).
// 격리 HOME 이 임시 폴더 안에 서면(`HOME=/private$TMPDIR/…/home`) 홈 파생 항목
// (`~/Library/LaunchAgents`)이 SCRATCH 안에 들어가 이 필터가 `/private$TMPDIR` 면제를
// 통째로 걷었다 — 그 순간 realpath 된 방 전체가 `/private/var`(SYSTEM)로 읽혀 **명시된
// 루트 안 write 까지** "운영체제와 앱이 쓰는 자리"로 막혔다(S4 재현 6턴 write 3/3 차단 ·
// 결과 파일 0개의 기계 원인). F7.3 이 막으려던 것은 TMPDIR 오염이 **OS 자리**를 여는
// 것이고, 홈 파생 항목은 홈이 어디 서느냐에 따라 움직이는 값이라 그 증거가 아니다 —
// 임시 홈의 LaunchAgents 는 OS 가 읽지 않으므로 자동실행 지속성도 생기지 않는다.
const SCRATCH = SCRATCH_RAW.filter(
  (d) => d && !SYSTEM_DIRS.some((s) => !within(HOME, s) && within(d, s)),
);

/**
 * 비밀 자리의 실제 경로들. **샌드박스 프로파일도 같은 목록을 쓴다** — 두 벌로 두면
 * 한쪽에만 자리를 추가했을 때 다른 쪽이 조용히 열린다(그게 유출이다).
 * P0-a(2026-08-02): 이 문장이 실제로 깨져 있었다 — 여기가 SECRET_DIRS 만 내보내는 동안
 * 이름 규칙(F7.2)과 홈 Library 닫힘(F7.1)은 파일손에만 있었고, 터미널이 그 자리를 읽었다.
 * 그래서 커널이 소비할 **전체** 보호를 `secretProtection()` 하나로 내보낸다. 여기에 자리를
 * 더하면 파일손과 샌드박스가 같이 닫힌다 — 한쪽에만 더할 방법을 남기지 않는다.
 */
export function secretPaths() {
  return [...SECRET_DIRS];
}

/**
 * 커널(샌드박스)이 소비하는 보호 전체 — protectionFor 의 secret 판정과 같은 정의역.
 *   dirs         — 자리 기준(subpath 거부)
 *   namePatterns — 이름 기준(경로 ERE 거부 · 대소문자 펼침 완료)
 *   closed       — 기본 닫힘 뿌리와 그 안의 열림 예외(require-not)
 */
export function secretProtection() {
  return {
    dirs: [...SECRET_DIRS],
    namePatterns: SECRET_NAME_PATHS.map(대소문자펼침),
    closed: [{ root: USER_LIBRARY, open: [...USER_LIBRARY_OPEN] }],
  };
}

/**
 * 이 경로가 보호 영역인가. **경로만 보고 판정한다**(파일을 열지 않는다 — 판정하려고 읽으면
 * 그 자체가 유출이다). 루트 설정과 무관하게 같은 답을 준다.
 * @param {string} absPath 이미 realpath 로 푼 절대 경로
 * @returns {{kind:'secret'|'system', why:string}|undefined}
 */
/**
 * 홈 **바로 아래**의 숨김 항목인가(`~/.zshrc` · `~/.config/...`). 그 아래로는 다 포함된다.
 * 자료 폴더 안의 점파일은 여기 안 걸린다 — 홈 최상위 한 칸만 본다.
 */
function 홈최상위숨김(p) {
  const 안쪽 = within(HOME, p) && p !== HOME;
  if (!안쪽) return false;
  const 첫칸 = String(p).slice(HOME.length).split('/').filter(Boolean)[0] ?? '';
  return 첫칸.startsWith('.');
}

export function protectionFor(absPath) {
  const p = String(absPath ?? '');
  if (!p) return undefined;
  if (SECRET_DIRS.some((d) => within(d, p))) {
    return { kind: 'secret', why: '열쇠·인증서·로그인 정보가 들어 있는 자리예요' };
  }
  if (SECRET_NAMES.some((re) => re.test(baseName(p)))) {
    return { kind: 'secret', why: '비밀번호나 접근 열쇠가 담긴 파일로 보여요' };
  }
  // F7.1: 홈의 Library — 동기화된 사용자 파일 자리(CloudStorage·Mobile Documents)만 열고
  // 나머지는 내용을 보지 않는다(위 USER_LIBRARY 선언 참고).
  if (within(USER_LIBRARY, p) && !USER_LIBRARY_OPEN.some((d) => within(d, p))) {
    return { kind: 'secret', why: '앱이 대화·메일·세션 같은 개인 데이터를 보관하는 자리예요' };
  }
  // **홈 최상위의 숨김 자리**(2026-08-07 · 루트를 홈으로 넓히는 같은 걸음에서 닫는다).
  //
  // 하나씩 열거하는 방식은 새 도구가 생길 때마다 뚫린다 — 실측으로 `.ssh`·`.aws`·`.netrc`·
  // `.npmrc` 는 막혔는데 **`.gitconfig`·`.zshrc` 가 열려 있었다.** 셸 설정에는
  // `export API_KEY=` 가 흔하다. 사장님이 *"내 파일"* 이라고 할 때 이것들을 뜻하지 않는다.
  //
  // **홈 바로 아래만 본다.** 자료 폴더 안의 점파일(`~/Documents/프로젝트/.gitignore`)까지
  // 막으면 그물이 넓어져 기능이 죽는다 — 보호는 *위험한 자리를 정확히 잡는* 방식이다.
  if (홈최상위숨김(p)) {
    return { kind: 'secret', why: '설정과 로그인 정보가 담기는 자리예요' };
  }
  if (SCRATCH.some((d) => within(d, p))) return undefined; // 임시 작업 공간은 지킬 대상이 아니다
  if (SYSTEM_DIRS.some((d) => within(d, p))) {
    return { kind: 'system', why: '운영체제와 앱이 쓰는 자리예요' };
  }
  return undefined;
}

/** 이 작업이 보호에 걸리는가. secret 은 읽기까지, system 은 변경만 막는다. */
export function protectionBlocks(absPath, { write = false } = {}) {
  const prot = protectionFor(absPath);
  if (!prot) return undefined;
  if (prot.kind === 'secret') return prot;          // 읽기도 안 된다
  return write ? prot : undefined;                  // system 은 변경만
}

/**
 * 막혔을 때 사용자에게 줄 말. **막다른 답을 주지 않는다** — 왜 조심하는지 말하고 다음 길을 준다.
 * 내부 경로 규칙을 설명하지 않는다(사용자는 우리 목록을 알 필요가 없다).
 */
export function protectionMessage(prot, { write = false } = {}) {
  if (prot.kind === 'secret') {
    return {
      userSafeSummary: `그 파일은 열지 않았어요 — ${prot.why}.`,
      nextSafeAction: '필요한 내용이 있으면 직접 확인하신 뒤 필요한 부분만 알려 주시면 그걸로 이어갈게요.',
    };
  }
  return {
    userSafeSummary: `${write ? '거기는 제가 바꾸지 않아요' : '거기는 제가 다루지 않아요'} — ${prot.why}.`,
    nextSafeAction: '작업 폴더 안에 사본을 두고 거기서 하면 안전해요. 그렇게 할까요?',
  };
}

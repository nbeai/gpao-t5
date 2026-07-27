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
const SCRATCH = [...new Set([
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
];

/** 시스템 — 읽기는 되고 변경은 안 된다. */
const SYSTEM_DIRS = [
  '/System', '/Library', '/usr', '/bin', '/sbin', '/etc', '/private/etc', '/var', '/private/var',
  '/Applications', '/opt', '/cores', '/Volumes/Preboot',
  h('Library/LaunchAgents'), '/Library/LaunchDaemons',
];

const within = (dir, p) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);
const baseName = (p) => String(p).split(sep).pop() ?? '';

/**
 * 비밀 자리의 실제 경로들. **샌드박스 프로파일도 같은 목록을 쓴다** — 두 벌로 두면
 * 한쪽에만 자리를 추가했을 때 다른 쪽이 조용히 열린다(그게 유출이다).
 * 파일 이름 규칙(`SECRET_NAMES`)은 경로가 아니라 패턴이라 여기 안 들어간다 —
 * 그건 도구 층에서 잡고, 커널 층은 자리로 막는다.
 */
export function secretPaths() {
  return [...SECRET_DIRS];
}

/**
 * 이 경로가 보호 영역인가. **경로만 보고 판정한다**(파일을 열지 않는다 — 판정하려고 읽으면
 * 그 자체가 유출이다). 루트 설정과 무관하게 같은 답을 준다.
 * @param {string} absPath 이미 realpath 로 푼 절대 경로
 * @returns {{kind:'secret'|'system', why:string}|undefined}
 */
export function protectionFor(absPath) {
  const p = String(absPath ?? '');
  if (!p) return undefined;
  if (SECRET_DIRS.some((d) => within(d, p))) {
    return { kind: 'secret', why: '열쇠·인증서·로그인 정보가 들어 있는 자리예요' };
  }
  if (SECRET_NAMES.some((re) => re.test(baseName(p)))) {
    return { kind: 'secret', why: '비밀번호나 접근 열쇠가 담긴 파일로 보여요' };
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

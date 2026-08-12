#!/usr/bin/env node
// P-DIST-1 · macOS 팀 설치본 제작 (1차: Apple Silicon)
//
// **소스가 아니라 산출물을 검증한다**(T3 제1원칙). 그래서 이 스크립트는
// `npm pack` 이 실제로 내보내는 것만 담는다 — 개발 트리를 통째로 복사하지 않는다.
// 과거 배포 사고가 전부 여기서 났다: node_modules 동봉, dist 정리가 제품 코드를 지움,
// 시스템 Node 폴백.
//
// 넣는 것: ① `npm pack` 산출물(bin·src·package.json) ② 검증된 Node 실행 파일 하나
// 넣지 않는 것: npm, node 헤더·문서, 개발 트리, 테스트, 설계 문서, 자격, 사용자 데이터
//
// 서명은 **꺼져 있는 것이 기본**이다. 자격 사용은 오너 승인 사항이라, 아무 것도 주지 않으면
// 무서명 산출물이 나온다(그걸 먼저 끝까지 검증한다 — 계획서 GitHub 실험 환경과 같은 순서).
// 승인을 받은 뒤에는 손으로 codesign 을 두드리지 않고 **여기로 통과시킨다.** 손으로 하면
// 무엇을 어떤 차례로 서명했는지가 사람 기억에만 남고, 다음 산출물이 같다는 보장이 없다.
//   T5_SIGN_APP        Developer ID Application 신분
//   T5_SIGN_INSTALLER  Developer ID Installer 신분(PKG 용)
//   T5_SIGN_KEYCHAIN   그 신분이 있는 키체인(생략하면 기본 검색 경로)
// 공증(notarytool)은 여전히 바깥 걸음이다 — Apple 에 올리는 행위라 실행 시점 승인에 묶는다.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile, chmod, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const 신분 = {
  이름: 'GPAO-T5',
  bundleId: 'kr.co.gpao.t5',
  agentLabel: 'kr.co.gpao.t5.agent',
  설치위치: '/Applications',
  기본포트: 4173,
};
const 실행 = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', ...opts });

const 해시 = async (p) => createHash('sha256').update(await readFile(p)).digest('hex');

async function main() {
  // 런타임은 **공식 tarball 에서 직접** 꺼낸다. 실행 파일만 받으면 그 파일이 어디서 왔는지
  // manifest 가 증명하지 못한다 — 원본 압축파일의 해시와 URL 이 함께 있어야 추적이 선다.
  const tarball = process.env.T5_NODE_TARBALL;
  const 다운로드URL = process.env.T5_NODE_URL;
  if (!tarball || !다운로드URL) {
    throw new Error('T5_NODE_TARBALL(공식 tarball 경로)과 T5_NODE_URL(받은 주소)이 필요합니다');
  }
  const tarball해시 = await 해시(tarball);
  const 풀기 = await mkdtemp(join(tmpdir(), 'gpao-t5-node-'));
  실행('tar', ['xzf', tarball, '-C', 풀기]);
  const [안쪽] = 실행('sh', ['-c', `ls ${풀기}`]).trim().split('\n');
  const 런타임 = join(풀기, 안쪽, 'bin', 'node');
  const 런타임버전 = 실행(런타임, ['-v']).trim();
  const 런타임아치 = 실행(런타임, ['-e', 'process.stdout.write(process.arch)']).trim();
  if (런타임아치 !== 'arm64') throw new Error(`1차 산출물은 arm64 만입니다(받음: ${런타임아치})`);

  const pkg = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'));
  const version = pkg.version;
  if (/-development$/.test(version)) {
    throw new Error(`설치본 버전에 -development 를 쓰지 않습니다(현재 ${version}) — 신분 동결 문서 참조`);
  }

  const work = await mkdtemp(join(tmpdir(), 'gpao-t5-pkg-'));
  const root = join(work, 'root');
  const app = join(root, `${신분.이름}.app`);
  const contents = join(app, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await mkdir(join(contents, 'Resources'), { recursive: true });

  // ── ① 제품: npm pack 이 실제로 내보내는 것만 ──────────────────────────
  const tgz = 실행('npm', ['pack', '--silent'], { cwd: REPO }).trim().split('\n').pop();
  const 펼침 = join(work, 'packed');
  await mkdir(펼침, { recursive: true });
  실행('tar', ['xzf', join(REPO, tgz), '-C', 펼침]);
  // `cp` 는 확장속성을 함께 옮기고, 그러면 pkgbuild 가 payload 에 `._` 리소스포크를 만든다
  // (실측 182개 — 설치되지는 않지만 사용자에게 나가는 아카이브에 실린다).
  // `ditto --norsrc --noextattr --noacl` 이 macOS 의 정석이다.
  실행('ditto', ['--norsrc', '--noextattr', '--noacl', join(펼침, 'package'), join(contents, 'Resources', 'app')]);
  await rm(join(REPO, tgz), { force: true });

  // ── ② 런타임: 실행 파일 하나만 ─────────────────────────────────────
  await mkdir(join(contents, 'Resources', 'runtime', 'bin'), { recursive: true });
  실행('ditto', ['--norsrc', '--noextattr', '--noacl', 런타임, join(contents, 'Resources', 'runtime', 'bin', 'node')]);
  await chmod(join(contents, 'Resources', 'runtime', 'bin', 'node'), 0o755);

  // ── ③ 신분과 진입점 ───────────────────────────────────────────────
  await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${신분.bundleId}</string>
  <key>CFBundleName</key><string>${신분.이름}</string>
  <key>CFBundleDisplayName</key><string>${신분.이름}</string>
  <key>CFBundleExecutable</key><string>${신분.이름}</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
</dict>
</plist>
`);

  // 진입점은 **네이티브 런처**다. 셸 스크립트는 Dock 에 뜨긴 해도 ⌘Q·종료를 못 받는다
  // (실측: AppleEvent -1712 시간 초과 — 이벤트 루프가 없다). 그러면 끄는 방법이 터미널뿐이라
  // 비개발자용 제품이 아니다. 런처가 동봉 런타임만 부르고, 끝날 때 자식을 데려간다.
  실행('swiftc', ['-O', '-target', 'arm64-apple-macos13', '-o', join(contents, 'MacOS', 신분.이름),
    join(dirname(fileURLToPath(import.meta.url)), 'launcher.swift')]);
  await chmod(join(contents, 'MacOS', 신분.이름), 0o755);

  // 확장 속성을 걷어낸다. 안 걷으면 pkgbuild 가 `._` 리소스포크를 payload 에 함께 담아
  // (실측 182개) 산출물에 제품과 무관한 파일이 섞인다 — 누락/과다 양방향 중 '과다' 다.
  실행('xattr', ['-cr', root]);
  실행('find', [root, '-name', '._*', '-delete']);

  // ── ③-2 설치 스크립트 ────────────────────────────────────────────────
  //
  // 설치 파일을 받은 사람은 터미널도 /Applications 도 찾을 필요가 없어야 한다.
  // postinstall 은 root 로 도므로 **로그인한 사용자 권한으로** 실행·등록한다.
  const scripts = join(work, 'scripts');
  await mkdir(scripts, { recursive: true });
  await writeFile(join(scripts, 'postinstall'), `#!/bin/sh
set -e
USER_NAME=$(stat -f %Su /dev/console)
USER_UID=$(id -u "$USER_NAME")
USER_HOME=$(dscl . -read /Users/"$USER_NAME" NFSHomeDirectory | awk '{print $2}')
# **어디에 깔렸는지는 installer 가 안다**($2 = 실제 설치 자리). 여기에 /Applications 를 박아 두면
# 사용자가 설치 대상을 바꾼 순간 없는 앱을 실행하고 등록만 남는다 — 켜지지 않는 프로그램이 된다.
APP="\${2:-${신분.설치위치}}/${신분.이름}.app"
AGENTS="$USER_HOME/Library/LaunchAgents"
PLIST="$AGENTS/${신분.agentLabel}.plist"

# 로그인 자동시작 — 다음 로그인부터 조용히 뜬다(브라우저는 안 띄운다).
mkdir -p "$AGENTS"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${신분.agentLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string><string>-g</string><string>-a</string><string>$APP</string>
    <string>--env</string><string>GPAO_T5_LOGIN_START=1</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLISTEOF
chown "$USER_NAME" "$PLIST"

# 이전 등록이 있으면 걷고 새로 올린다(중복 등록 0).
launchctl bootout gui/"$USER_UID"/${신분.agentLabel} 2>/dev/null || true
launchctl bootstrap gui/"$USER_UID" "$PLIST" 2>/dev/null || true

# **설치 직후 지금 실행한다.** 첫 실행이므로 브라우저와 온보딩이 뜬다.
sudo -u "$USER_NAME" /usr/bin/open -a "$APP" 2>/dev/null || true
exit 0
`);
  await chmod(join(scripts, 'postinstall'), 0o755);

  // 제거 도우미 — LaunchAgent 해제까지 함께 한다(앱만 지우면 등록이 남는다).
  await writeFile(join(contents, 'Resources', 'uninstall.sh'), `#!/bin/sh
set -e
LABEL=${신분.agentLabel}
# 이 스크립트는 앱 안에 산다. 그러니 **자기 자리를 자기가 안다** — 경로를 박아 두면
# 다른 자리에 깔린 앱을 지우라고 했을 때 엉뚱한 자리를 지우거나 아무 것도 안 지운다.
APP=$(cd "$(dirname "$0")/../.." && pwd)
launchctl bootout gui/$(id -u)/$LABEL 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
pkill -f "${신분.이름}.app" 2>/dev/null || true
rm -rf "$APP"
echo "${신분.이름} 을 제거했어요. 대화와 기억은 그대로 있어요."
`);
  await chmod(join(contents, 'Resources', 'uninstall.sh'), 0o755);

  // ── ③-2 서명(자격을 준 경우에만) ────────────────────────────────────
  // **안에서 바깥으로** 서명한다. 번들을 먼저 서명하면 그 뒤에 안쪽 실행 파일을 건드리는 순간
  // 겉 서명이 깨진다 — 그러면 Gatekeeper 에서 "손상된 앱"이 된다.
  const 앱신분 = process.env.T5_SIGN_APP;
  const 설치신분_ = process.env.T5_SIGN_INSTALLER;
  const 키체인 = process.env.T5_SIGN_KEYCHAIN;
  const 키체인인자 = 키체인 ? ['--keychain', 키체인] : [];
  if (앱신분) {
    const 서명 = (대상, 더 = []) => 실행('codesign', [
      '--force', '--timestamp', '--options', 'runtime',
      '--sign', 앱신분, ...키체인인자, ...더, 대상,
    ]);
    // 동봉 Node 는 남이 만든 실행 파일이다. 우리 이름으로 다시 서명하되 hardened runtime 을
    // 건다(없으면 공증이 거부된다). 그런데 hardened runtime 은 JIT 를 막고, JavaScript 엔진은
    // JIT 없이는 못 돈다 — 그래서 **Node 에만** 그 예외를 준다. 런처는 필요 없다.
    const 자격 = join(work, 'node.entitlements.plist');
    await writeFile(자격, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>
`);
    // **안에서 바깥으로.** 번들을 먼저 서명하면 그 뒤에 안쪽 실행 파일을 건드리는 순간 겉
    // 서명이 깨지고, Gatekeeper 에서 "손상된 앱"이 된다.
    서명(join(contents, 'Resources', 'runtime', 'bin', 'node'), ['--entitlements', 자격]);
    서명(join(root, `${신분.이름}.app`));
    실행('codesign', ['--verify', '--deep', '--strict', '--verbose=2', join(root, `${신분.이름}.app`)],
      { stdio: ['ignore', 'pipe', 'pipe'] });
  }

  // ── ④ 산출물 조립 ─────────────────────────────────────────────────
  const out = join(REPO, 'dist');
  await mkdir(out, { recursive: true });
  const 파일 = join(out, `${신분.이름}-${version}-arm64${설치신분_ ? '' : '-unsigned'}.pkg`);
  const 부품 = join(work, 'component.pkg');
  실행('pkgbuild', ['--root', root, '--install-location', 신분.설치위치, '--scripts', scripts,
    '--identifier', 신분.bundleId, '--version', version, 부품]);
  if (설치신분_) {
    const 무서명 = join(work, 'product-unsigned.pkg');
    실행('productbuild', ['--package', 부품, 무서명]);
    실행('productsign', ['--sign', 설치신분_, ...키체인인자, 무서명, 파일]);
  } else {
    실행('productbuild', ['--package', 부품, 파일]);
  }

  // ── ⑤ manifest — 무엇이 들어갔는지 기계 사실로 남긴다 ────────────────
  const manifest = {
    제품: 신분.이름, 버전: version, bundleId: 신분.bundleId, agentLabel: 신분.agentLabel,
    아키텍처: 'arm64', 기본포트: 신분.기본포트,
    // 무엇을 했는지만 적는다. 공증·staple 은 이 스크립트 밖 걸음이라 여기서 성공을 주장하지 않는다.
    서명: 앱신분 || 설치신분_ ? { 앱: Boolean(앱신분), 설치본: Boolean(설치신분_) } : 'unsigned',
    런타임: {
      버전: 런타임버전, 아키텍처: 런타임아치,
      출처: 'nodejs.org 공식 배포',
      다운로드URL: 다운로드URL,
      원본tarball해시: tarball해시,          // 공식 SHASUMS256.txt 와 대조한 값
      담은실행파일해시: await 해시(join(contents, 'Resources', 'runtime', 'bin', 'node')),
    },
    // **이 해시는 빌드 직후의 것이다.** 공증 티켓을 붙이면(staple) 파일이 바뀌어 해시도 바뀐다.
    // 그걸 "배포 파일 해시"라고 적어 두면 받은 사람이 대조했을 때 틀린다 — 이름으로 구분한다.
    설치본: {
      파일: 파일.replace(`${REPO}/`, ''),
      크기: (await stat(파일)).size,
      빌드직후해시: await 해시(파일),
      배포해시: null,   // staple 뒤 실제로 나눠 주는 파일의 해시. 그 걸음에서 채운다.
    },
    기준선: 실행('git', ['rev-parse', 'HEAD'], { cwd: REPO }).trim(),
  };
  await writeFile(join(out, `${신분.이름}-${version}-arm64.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  await rm(work, { recursive: true, force: true });
  await rm(풀기, { recursive: true, force: true });
  console.log(JSON.stringify(manifest, null, 1));
}

await main();

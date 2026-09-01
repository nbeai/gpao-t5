#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmod, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertDeveloperIdentities, loadReleaseConfiguration, runtimeMaterial, signingConfiguration,
} from './macos-release-configuration.mjs';
import { assertReleaseSourcePolicy } from './macos-release-source-boundary.mjs';
import { assertProductionMacPayload, inventoryMacApp } from './macos-payload-inventory.mjs';
import {
  assertFourthCycleDormantSourceExcluded, assertQualificationOnlySourceExcluded,
  removeFourthCycleDormantSource, removeQualificationOnlySource,
} from './product-source-boundary.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const product = {
  name: 'GPAO-T5', bundleId: 'kr.co.gpao.t5', version: '6.0.0', displayVersion: '6.0', port: 4174,
};
const PACKAGE_SOURCE_PATHS = [
  'refoundation',
  'COPYRIGHT', 'NOTICE', 'THIRD_PARTY_NOTICES.md',
  'docs/00-product/GPAO-T5-FOUNDER-MANIFESTO-ko.md',
];

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}

function packageSourceDirty() {
  return Boolean(run('git', [
    'status', '--porcelain', '--', ...PACKAGE_SOURCE_PATHS,
  ], { cwd: repo }).trim());
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function requireNewArtifact(path) {
  try { await stat(path); throw new Error(`refusing to overwrite existing release artifact: ${path}`); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function walk(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

async function verifiedNode(tarball, expectedName, shasums, destination) {
  const expected = String(shasums).split('\n').find((line) => line.endsWith(`  ${expectedName}`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`official checksum is missing for ${expectedName}`);
  const actual = await sha256(tarball);
  if (actual !== expected) throw new Error(`Node checksum mismatch for ${expectedName}`);
  const room = await mkdtemp(join(tmpdir(), 't5-node-extract-'));
  try {
    run('tar', ['xzf', tarball, '-C', room]);
    const folder = (await readdir(room)).find((entry) => entry.startsWith('node-v'));
    if (!folder) throw new Error(`Node archive root is missing for ${expectedName}`);
    await copyFile(join(room, folder, 'bin', 'node'), destination);
    await chmod(destination, 0o755);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
  return actual;
}

async function copyRuntimeApp(target) {
  const refoundation = join(target, 'refoundation');
  await mkdir(join(target, 'docs', '00-product'), { recursive: true });
  await mkdir(join(refoundation, 'scripts'), { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) {
    await copyFile(join(repo, 'refoundation', file), join(refoundation, file));
  }
  for (const directory of ['src', 'bin', 'skills', 'skill-packages', 'capabilities', 'config', 'ui']) {
    await cp(join(repo, 'refoundation', directory), join(refoundation, directory), {
      recursive: true, dereference: false,
    });
  }
  await removeFourthCycleDormantSource(refoundation);
  await removeQualificationOnlySource(refoundation);
  await assertFourthCycleDormantSourceExcluded(refoundation);
  await assertQualificationOnlySourceExcluded(refoundation);
  for (const script of [
    'start-console.mjs', 'ensure-local-runtime.mjs', 'stop-local-runtime.mjs', 'activate-whole-state-restore.mjs', 'connect-chatgpt.mjs', 'prepare-node-pty.mjs', 'restrict-kordoc-bin.mjs',
  ]) {
    await copyFile(join(repo, 'refoundation', 'scripts', script), join(refoundation, 'scripts', script));
  }
  for (const file of ['COPYRIGHT', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
    await copyFile(join(repo, file), join(target, file));
  }
  await copyFile(
    join(repo, 'docs', '00-product', 'GPAO-T5-FOUNDER-MANIFESTO-ko.md'),
    join(target, 'docs', '00-product', 'GPAO-T5-FOUNDER-MANIFESTO-ko.md'),
  );
  run('npm', ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts'], { cwd: refoundation, stdio: 'inherit' });
  run('npm', ['install', '--force', '--no-save', '--package-lock=false', '--omit=dev', '--omit=optional', '--ignore-scripts',
    '@img/sharp-darwin-arm64@0.35.3', '@img/sharp-darwin-x64@0.35.3',
    '@img/sharp-libvips-darwin-arm64@1.3.2', '@img/sharp-libvips-darwin-x64@1.3.2',
  ], { cwd: refoundation, stdio: 'inherit' });
  for (const relativePath of [
    '@huggingface', '@hyzyla', '@napi-rs', 'onnxruntime-node', 'onnxruntime-common',
    'onnxruntime-web', 'pdfjs-dist', 'adm-zip',
  ]) {
    await rm(join(refoundation, 'node_modules', relativePath), { recursive: true, force: true });
  }
  for (const relativePath of [
    ['node-pty', 'prebuilds', 'win32-arm64'], ['node-pty', 'prebuilds', 'win32-x64'],
    ['node-pty', 'deps'], ['node-pty', 'third_party'], ['node-pty', 'src'],
    ['tree-sitter-bash', 'prebuilds'], ['tree-sitter-bash', 'src'], ['web-tree-sitter', 'debug'],
  ]) await rm(join(refoundation, 'node_modules', ...relativePath), { recursive: true, force: true });
  for (const path of await walk(join(refoundation, 'node_modules'))) {
    const name = basename(path);
    if (name.endsWith('.map') || /\.d\.(?:ts|cts|mts)$/u.test(name) || name.endsWith('.pdb')
      || /^(?:readme|changelog|history|contributing|authors?|security)(?:\..*)?$/iu.test(name)) await rm(path, { force: true });
  }
}

async function buildDocxPageRenderer(work, runtimeBin) {
  const source = join(repo, 'refoundation', 'native', 'docx-page-renderer.swift');
  const arm = join(work, 'docx-page-renderer-arm64');
  const x64 = join(work, 'docx-page-renderer-x64');
  const frameworks = ['-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'Vision'];
  run('xcrun', ['swiftc', '-O', '-target', 'arm64-apple-macos13.0', ...frameworks, source, '-o', arm]);
  run('xcrun', ['swiftc', '-O', '-target', 'x86_64-apple-macos13.0', ...frameworks, source, '-o', x64]);
  const destination = join(runtimeBin, 't5-docx-page-renderer');
  run('lipo', ['-create', arm, x64, '-output', destination]);
  await chmod(destination, 0o755);
  const architectures = run('lipo', ['-archs', destination]).trim().split(/\s+/u).sort();
  if (architectures.join(',') !== 'arm64,x86_64') throw new Error('DOCX page renderer is not universal');
}

async function buildAudioRealityHelper(work, runtimeBin) {
  const source = join(repo, 'refoundation', 'native', 'macos-audio-reality.swift');
  const arm = join(work, 'audio-reality-arm64');
  const x64 = join(work, 'audio-reality-x64');
  const frameworks = ['-framework', 'AVFoundation', '-framework', 'AudioToolbox', '-framework', 'CoreMedia'];
  run('xcrun', ['swiftc', '-parse-as-library', '-O', '-target', 'arm64-apple-macos13.0',
    ...frameworks, source, '-o', arm]);
  run('xcrun', ['swiftc', '-parse-as-library', '-O', '-target', 'x86_64-apple-macos13.0',
    ...frameworks, source, '-o', x64]);
  const destination = join(runtimeBin, 't5-macos-audio-reality');
  run('lipo', ['-create', arm, x64, '-output', destination]);
  await chmod(destination, 0o755);
  const architectures = run('lipo', ['-archs', destination]).trim().split(/\s+/u).sort();
  if (architectures.join(',') !== 'arm64,x86_64') throw new Error('Audio Reality helper is not universal');
}

async function buildMemorySpotlightHelper(work, runtimeBin) {
  const source = join(repo, 'refoundation', 'native', 'macos-memory-spotlight.swift');
  const arm = join(work, 'memory-spotlight-arm64');
  const x64 = join(work, 'memory-spotlight-x64');
  const frameworks = ['-framework', 'CoreSpotlight', '-framework', 'UniformTypeIdentifiers'];
  run('xcrun', ['swiftc', '-O', '-target', 'arm64-apple-macos13.0', ...frameworks, source, '-o', arm]);
  run('xcrun', ['swiftc', '-O', '-target', 'x86_64-apple-macos13.0', ...frameworks, source, '-o', x64]);
  const destination = join(runtimeBin, 't5-memory-spotlight');
  run('lipo', ['-create', arm, x64, '-output', destination]);
  await chmod(destination, 0o755);
  const architectures = run('lipo', ['-archs', destination]).trim().split(/\s+/u).sort();
  if (architectures.join(',') !== 'arm64,x86_64') throw new Error('Memory Spotlight helper is not universal');
}

async function buildFileActivityHelper(work, runtimeBin) {
  const source = join(repo, 'refoundation', 'native', 'macos-file-activity.c');
  const arm = join(work, 'file-activity-arm64');
  const x64 = join(work, 'file-activity-x64');
  for (const [architecture, destination] of [['arm64', arm], ['x86_64', x64]]) {
    run('xcrun', ['clang', '-O2', '-target', `${architecture}-apple-macos13.0`,
      '-framework', 'CoreServices', source, '-o', destination]);
  }
  const destination = join(runtimeBin, 't5-macos-file-activity');
  run('lipo', ['-create', arm, x64, '-output', destination]);
  await chmod(destination, 0o755);
  const architectures = run('lipo', ['-archs', destination]).trim().split(/\s+/u).sort();
  if (architectures.join(',') !== 'arm64,x86_64') throw new Error('File activity helper is not universal');
}

async function buildCoarseAppActivityHelper(work, runtimeBin) {
  const source = join(repo, 'refoundation', 'native', 'macos-coarse-app-activity.m');
  const arm = join(work, 'coarse-app-activity-arm64'); const x64 = join(work, 'coarse-app-activity-x64');
  for (const [architecture, destination] of [['arm64', arm], ['x86_64', x64]]) run('xcrun', ['clang', '-fobjc-arc', '-O2',
    '-target', `${architecture}-apple-macos13.0`, '-framework', 'AppKit', '-framework', 'CoreGraphics', source, '-o', destination]);
  const destination = join(runtimeBin, 't5-macos-coarse-app-activity'); run('lipo', ['-create', arm, x64, '-output', destination]);
  await chmod(destination, 0o755); const architectures = run('lipo', ['-archs', destination]).trim().split(/\s+/u).sort();
  if (architectures.join(',') !== 'arm64,x86_64') throw new Error('Coarse app activity helper is not universal');
}

async function buildAppIcon(work, resources) {
  const html = await readFile(join(repo, 'refoundation', 'ui', 'index.html'), 'utf8');
  const encoded = /<link rel="icon" type="image\/png" href="data:image\/png;base64,([A-Za-z0-9+/=]+)">/u
    .exec(html)?.[1];
  if (!encoded) throw new Error('GPAO-T5 product icon is missing');
  const source = join(work, 'GPAO-T5-icon.png');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('GPAO-T5 product icon is invalid');
  await writeFile(source, bytes);
  const iconset = join(work, 'GPAO-T5.iconset');
  await mkdir(iconset);
  for (const [name, size] of [
    ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
  ]) run('sips', ['-z', String(size), String(size), source, '--out', join(iconset, name)]);
  const destination = join(resources, 'GPAO-T5.icns');
  run('iconutil', ['-c', 'icns', iconset, '-o', destination]);
  return destination;
}

async function signMachO(app, identity, keychain, entitlements, nodePaths) {
  const keychainArgs = keychain ? ['--keychain', keychain] : [];
  const sign = (path, extra = []) => run('codesign', [
    '--force', '--timestamp', '--options', 'runtime', '--sign', identity,
    ...keychainArgs, ...extra, path,
  ], { stdio: 'inherit' });
  for (const path of await walk(app)) {
    if (nodePaths.includes(path) || path.endsWith('/Contents/MacOS/GPAO-T5')) continue;
    const kind = run('file', ['-b', path]);
    if (kind.includes('Mach-O')) sign(path);
  }
  for (const node of nodePaths) sign(node, ['--entitlements', entitlements]);
  sign(join(app, 'Contents', 'MacOS', product.name));
  sign(app);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS is required');
  const { config } = await loadReleaseConfiguration();
  const armTar = runtimeMaterial('T5_NODE_ARM64_TARBALL', config?.runtime?.arm64Tarball);
  const x64Tar = runtimeMaterial('T5_NODE_X64_TARBALL', config?.runtime?.x64Tarball);
  const sumsPath = runtimeMaterial('T5_NODE_SHASUMS', config?.runtime?.shasums);
  const signing = signingConfiguration(config, { unsigned: process.env.T5_UNSIGNED_PACKAGE === '1' });
  const sourcePolicy = assertReleaseSourcePolicy({
    sourceCommit: run('git', ['rev-parse', 'HEAD'], { cwd: repo }).trim(),
    sourceDirty: packageSourceDirty(),
    signing: signing.applicationIdentity ? 'developer-id' : 'unsigned',
  });
  if (signing.applicationIdentity) assertDeveloperIdentities(signing);
  const shasums = await readFile(sumsPath, 'utf8');
  const work = await mkdtemp(join(tmpdir(), 't5-refoundation-pkg-'));
  const root = join(work, 'root');
  const app = join(root, `${product.name}.app`);
  const contents = join(app, 'Contents');
  const resources = join(contents, 'Resources');
  const runtimeBin = join(resources, 'runtime', 'bin');
  try {
    await mkdir(join(contents, 'MacOS'), { recursive: true });
    await mkdir(runtimeBin, { recursive: true });
    await copyRuntimeApp(join(resources, 'app'));
    await buildDocxPageRenderer(work, runtimeBin);
    await buildAudioRealityHelper(work, runtimeBin);
    await buildMemorySpotlightHelper(work, runtimeBin);
    await buildFileActivityHelper(work, runtimeBin);
    await buildCoarseAppActivityHelper(work, runtimeBin);
    await buildAppIcon(work, resources);

    const armNode = join(runtimeBin, 'node-arm64');
    const x64Node = join(runtimeBin, 'node-x64');
    const nodeHashes = {
      arm64: await verifiedNode(armTar, basename(armTar), shasums, armNode),
      x64: await verifiedNode(x64Tar, basename(x64Tar), shasums, x64Node),
    };
    if (run(armNode, ['-p', 'process.arch']).trim() !== 'arm64') throw new Error('arm64 Node is invalid');
    if (!run('file', ['-b', x64Node]).includes('x86_64')) throw new Error('x64 Node is invalid');
    const nodeShim = join(runtimeBin, 'node');
    await writeFile(nodeShim, `#!/bin/sh
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$(uname -m)" in
  arm64) exec "$HERE/node-arm64" "$@" ;;
  x86_64) exec "$HERE/node-x64" "$@" ;;
  *) echo "Unsupported Mac architecture" >&2; exit 126 ;;
esac
`);
    await chmod(nodeShim, 0o755);
    for (const path of [
      join(resources, 'app', 'refoundation', 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper'),
      join(resources, 'app', 'refoundation', 'node_modules', 'node-pty', 'prebuilds', 'darwin-x64', 'spawn-helper'),
      join(resources, 'app', 'refoundation', 'bin', 't5-document.mjs'),
    ]) await chmod(path, 0o755);

    const launcherSource = join(here, 'macos-launcher.m');
    const armLauncher = join(work, 'launcher-arm64');
    const x64Launcher = join(work, 'launcher-x64');
    const moduleCache = `-fmodules-cache-path=${join(work, 'clang-module-cache')}`;
    run('clang', ['-fobjc-arc', '-O2', moduleCache, '-target', 'arm64-apple-macos13', '-framework', 'AppKit',
      '-o', armLauncher, launcherSource]);
    run('clang', ['-fobjc-arc', '-O2', moduleCache, '-target', 'x86_64-apple-macos13', '-framework', 'AppKit',
      '-o', x64Launcher, launcherSource]);
    run('lipo', ['-create', armLauncher, x64Launcher, '-output', join(contents, 'MacOS', product.name)]);
    await chmod(join(contents, 'MacOS', product.name), 0o755);

    await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${product.bundleId}</string>
<key>CFBundleName</key><string>${product.name}</string>
<key>CFBundleDisplayName</key><string>${product.name}</string>
<key>CFBundleExecutable</key><string>${product.name}</string>
<key>CFBundleIconFile</key><string>GPAO-T5.icns</string>
<key>CFBundleShortVersionString</key><string>${product.displayVersion}</string>
<key>CFBundleVersion</key><string>${product.version}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHumanReadableCopyright</key><string>Copyright © 2026 YOON. All rights reserved.</string>
<key>NSDesktopFolderUsageDescription</key><string>T5가 사용자가 요청한 데스크탑 파일 작업을 수행하는 데 사용합니다.</string>
<key>NSDocumentsFolderUsageDescription</key><string>T5가 사용자가 요청한 문서 작업을 수행하는 데 사용합니다.</string>
<key>NSDownloadsFolderUsageDescription</key><string>T5가 사용자가 요청한 다운로드 파일 작업을 수행하는 데 사용합니다.</string>
</dict></plist>\n`);

    const uninstall = join(resources, 'GPAO-T5 제거.command');
    await writeFile(uninstall, `#!/bin/sh
set -u
APP="/Applications/${product.name}.app"
NODE="$APP/Contents/Resources/runtime/bin/node"
STOP="$APP/Contents/Resources/app/refoundation/scripts/stop-local-runtime.mjs"
PORT="$HOME/Library/Application Support/GPAO-T5/state/console-port.json"
if [ -x "$NODE" ] && [ -f "$STOP" ]; then
  "$NODE" "$STOP" --port-file "$PORT" --reason product_uninstall || {
    echo "실행 중인 GPAO-T5를 안전하게 정리하지 못해 앱을 지우지 않았습니다."
    exit 1
  }
fi
LAUNCH_AGENT="$HOME/Library/LaunchAgents/${product.bundleId}.runtime.plist"
/bin/launchctl bootout "gui/$(id -u)" "$LAUNCH_AGENT" >/dev/null 2>&1 || true
/bin/rm -f -- "$LAUNCH_AGENT"
if /usr/bin/osascript -e 'do shell script "/bin/rm -rf -- /Applications/${product.name}.app || exit $?; /usr/sbin/pkgutil --forget ${product.bundleId} >/dev/null 2>&1 || true" with administrator privileges'; then
  echo "GPAO-T5 앱을 제거했습니다. 대화와 기억은 그대로 두었습니다."
else
  echo "GPAO-T5를 제거하지 못했습니다. 관리자 승인을 확인한 뒤 다시 시도해 주세요."
fi
printf "종료하려면 Enter를 눌러 주세요. "
read -r _
`);
    await chmod(uninstall, 0o755);
    run('xattr', ['-cr', app]);

    const unsignedPayloadInventory = await inventoryMacApp(app);
    assertProductionMacPayload(unsignedPayloadInventory);

    const appIdentity = signing.applicationIdentity;
    const installerIdentity = signing.installerIdentity;
    const keychain = signing.keychain;
    if (appIdentity) {
      const entitlements = join(work, 'node.entitlements.plist');
      await writeFile(entitlements, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>\n`);
      await signMachO(app, appIdentity, keychain, entitlements, [armNode, x64Node]);
    }
    const payloadInventory = appIdentity ? await inventoryMacApp(app) : unsignedPayloadInventory;
    const payloadGate = assertProductionMacPayload(payloadInventory);

    const scripts = join(work, 'pkg-scripts');
    await mkdir(scripts, { recursive: true });
    await writeFile(join(scripts, 'preinstall'), `#!/bin/sh
USER_NAME=$(stat -f %Su /dev/console)
if [ -n "$USER_NAME" ] && [ "$USER_NAME" != "root" ]; then
  USER_HOME=$(dscl . -read "/Users/$USER_NAME" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
  OLD_APP="/Applications/${product.name}.app"
  OLD_NODE="$OLD_APP/Contents/Resources/runtime/bin/node"
  OLD_STOP="$OLD_APP/Contents/Resources/app/refoundation/scripts/stop-local-runtime.mjs"
  OLD_PORT="$USER_HOME/Library/Application Support/GPAO-T5/state/console-port.json"
  if [ -x "$OLD_NODE" ] && [ -f "$OLD_STOP" ] && [ -f "$OLD_PORT" ]; then
    sudo -u "$USER_NAME" env HOME="$USER_HOME" "$OLD_NODE" "$OLD_STOP" --port-file "$OLD_PORT" --reason product_update || exit 1
  elif sudo -u "$USER_NAME" /usr/bin/pgrep -x "${product.name}" >/dev/null 2>&1; then
    sudo -u "$USER_NAME" /usr/bin/osascript -e 'tell application id "${product.bundleId}" to quit' >/dev/null 2>&1 || exit 1
    for WAIT_STEP in 1 2 3 4 5; do
      sudo -u "$USER_NAME" /usr/bin/pgrep -x "${product.name}" >/dev/null 2>&1 || break
      /bin/sleep 1
    done
    sudo -u "$USER_NAME" /usr/bin/pgrep -x "${product.name}" >/dev/null 2>&1 && exit 1
  fi
fi
exit 0
`);
    await chmod(join(scripts, 'preinstall'), 0o755);
    await writeFile(join(scripts, 'postinstall'), `#!/bin/sh
USER_NAME=$(stat -f %Su /dev/console)
if [ -n "$USER_NAME" ] && [ "$USER_NAME" != "root" ]; then
  USER_ID=$(id -u "$USER_NAME")
  USER_HOME=$(dscl . -read "/Users/$USER_NAME" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
  LAUNCH_DIR="$USER_HOME/Library/LaunchAgents"
  PLIST="$LAUNCH_DIR/${product.bundleId}.runtime.plist"
  mkdir -p "$LAUNCH_DIR"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${product.bundleId}.runtime</string>
<key>ProgramArguments</key><array>
<string>/Applications/${product.name}.app/Contents/MacOS/${product.name}</string>
<string>--background-runtime</string>
</array>
<key>RunAtLoad</key><true/><key>ProcessType</key><string>Background</string>
</dict></plist>
EOF
  chmod 600 "$PLIST"
  chown "$USER_NAME" "$PLIST" "$LAUNCH_DIR"
  sudo -u "$USER_NAME" /bin/launchctl bootout "gui/$USER_ID" "$PLIST" >/dev/null 2>&1 || true
  sudo -u "$USER_NAME" /bin/launchctl bootstrap "gui/$USER_ID" "$PLIST" || exit 1
  sudo -u "$USER_NAME" /usr/bin/open -a "/Applications/${product.name}.app" >/dev/null 2>&1 || true
fi
exit 0
`);
    await chmod(join(scripts, 'postinstall'), 0o755);

    const out = join(repo, 'dist');
    await mkdir(out, { recursive: true });
    const component = join(work, 'component.pkg');
    run('pkgbuild', ['--root', root, '--install-location', '/Applications', '--scripts', scripts,
      '--identifier', product.bundleId, '--version', product.version, component], { stdio: 'inherit' });
    const suffix = installerIdentity ? '' : '-unsigned';
    const output = join(out, `${product.name}-${product.version}-universal${suffix}.pkg`);
    const manifestPath = join(out, `${product.name}-${product.version}-universal${suffix}.manifest.json`);
    await requireNewArtifact(output);
    await requireNewArtifact(manifestPath);
    if (installerIdentity) {
      const unsigned = join(work, 'unsigned-product.pkg');
      run('productbuild', ['--package', component, unsigned], { stdio: 'inherit' });
      run('productsign', ['--sign', installerIdentity, ...(keychain ? ['--keychain', keychain] : []),
        unsigned, output], { stdio: 'inherit' });
      const packageSignature = run('pkgutil', ['--check-signature', output]);
      if (!packageSignature.includes('Developer ID Installer')) {
        throw new Error('signed package failed Developer ID Installer verification');
      }
    } else {
      run('productbuild', ['--package', component, output], { stdio: 'inherit' });
    }

    const manifest = {
      schema: 't5.macos-team-installer.v1', product: product.name, version: product.version,
      displayVersion: product.displayVersion,
      bundleId: product.bundleId, architectures: ['arm64', 'x86_64'], port: product.port,
      sourceCommit: sourcePolicy.sourceCommit,
      sourceDirty: sourcePolicy.sourceDirty, sourceScope: 'packaged-inputs',
      developmentOnly: sourcePolicy.developmentOnly, releaseEligible: sourcePolicy.releaseEligible,
      node: { version: 'v24.14.0', officialArchiveSha256: nodeHashes },
      payload: payloadInventory.payload, payloadGate,
      dependencies: { packages: payloadInventory.dependencies.packages, bom: payloadInventory.dependencies.bom },
      binaries: payloadInventory.binaries,
      signing: appIdentity ? 'developer-id' : 'unsigned', notarized: false, stapled: false,
      package: { path: output, bytes: (await stat(output)).size, sha256: await sha256(output) },
      excludes: ['credentials', 'user data', 'tests', 'legacy runtime'],
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify(manifest, null, 2));
  } finally {
    if (process.env.T5_KEEP_PACKAGE_WORK !== '1') await rm(work, { recursive: true, force: true });
  }
}

await main();

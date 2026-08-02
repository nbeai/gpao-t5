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
// 서명·공증은 **여기서 하지 않는다.** 자격 사용은 오너 승인 사항이라 별도 걸음이다
// (무서명 산출물을 먼저 끝까지 검증한다 — 계획서 GitHub 실험 환경과 같은 순서).
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
  <key>LSUIElement</key><true/>
</dict>
</plist>
`);

  // 진입점은 **동봉 런타임만** 부른다. 시스템 Node 로 폴백하지 않는다(과거 사고 원인).
  const 진입 = `#!/bin/sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
RES="$HERE/../Resources"
NODE="$RES/runtime/bin/node"
if [ ! -x "$NODE" ]; then
  osascript -e 'display alert "${신분.이름}" message "설치본이 손상됐어요. 다시 설치해 주세요."' >/dev/null 2>&1 || true
  exit 1
fi
exec "$NODE" "$RES/app/bin/gpao-t5.mjs" "$@"
`;
  await writeFile(join(contents, 'MacOS', 신분.이름), 진입);
  await chmod(join(contents, 'MacOS', 신분.이름), 0o755);

  // 확장 속성을 걷어낸다. 안 걷으면 pkgbuild 가 `._` 리소스포크를 payload 에 함께 담아
  // (실측 182개) 산출물에 제품과 무관한 파일이 섞인다 — 누락/과다 양방향 중 '과다' 다.
  실행('xattr', ['-cr', root]);
  실행('find', [root, '-name', '._*', '-delete']);

  // ── ④ 산출물 조립 ─────────────────────────────────────────────────
  const out = join(REPO, 'dist');
  await mkdir(out, { recursive: true });
  const 파일 = join(out, `${신분.이름}-${version}-arm64-unsigned.pkg`);
  const 부품 = join(work, 'component.pkg');
  실행('pkgbuild', ['--root', root, '--install-location', 신분.설치위치,
    '--identifier', 신분.bundleId, '--version', version, 부품]);
  실행('productbuild', ['--package', 부품, 파일]);

  // ── ⑤ manifest — 무엇이 들어갔는지 기계 사실로 남긴다 ────────────────
  const manifest = {
    제품: 신분.이름, 버전: version, bundleId: 신분.bundleId, agentLabel: 신분.agentLabel,
    아키텍처: 'arm64', 기본포트: 신분.기본포트, 서명: 'unsigned',
    런타임: {
      버전: 런타임버전, 아키텍처: 런타임아치,
      출처: 'nodejs.org 공식 배포',
      다운로드URL: 다운로드URL,
      원본tarball해시: tarball해시,          // 공식 SHASUMS256.txt 와 대조한 값
      담은실행파일해시: await 해시(join(contents, 'Resources', 'runtime', 'bin', 'node')),
    },
    설치본: { 파일: 파일.replace(`${REPO}/`, ''), 크기: (await stat(파일)).size, 해시: await 해시(파일) },
    기준선: 실행('git', ['rev-parse', 'HEAD'], { cwd: REPO }).trim(),
  };
  await writeFile(join(out, `${신분.이름}-${version}-arm64.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  await rm(work, { recursive: true, force: true });
  await rm(풀기, { recursive: true, force: true });
  console.log(JSON.stringify(manifest, null, 1));
}

await main();

#!/usr/bin/env node
// P-DIST-1 · **산출물 검증 게이트** (T3 제1원칙: 소스가 아니라 산출물을 검증한다).
//
// 왜 이 파일이 있는가 — T3 에서 배포 단계에서만 터진 사고들:
//   · 배포 치환이 디브랜딩 가드를 먹어 라이브에서만 죽었다(개발 테스트 424개는 전부 통과였다)
//   · postinstall 인라인 JS 의 "\n" 이 생성 시점에 깨져 배포본이 SyntaxError 로 죽었다
//   · npm install 의 dist 정리가 제품 코드 146개를 지워 클론하면 부팅을 못 했다
// 그래서 여기서는 개발 트리를 믿지 않는다: **npm pack 으로 만든 tarball 을 임시 디렉터리에 펼치고,
// 거기서 실제로 실행해서** health 와 온보딩을 눈으로 확인한다.
//
// 실패는 비-0 종료. `npm run verify:package` 로 실행하고 CI 가 테스트 뒤에 돌린다.
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildMacFileBroker } from './packaging/build-file-broker.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.GPAO_T5_VERIFY_PORT ?? 4599);

// 산출물에 반드시 있어야 하는 것(누락 사고 방지) / 절대 없어야 하는 것(과다 사고 방지).
const MUST_HAVE = ['package.json', 'bin/gpao-t5.mjs', 'src/surface/server.js', 'src/surface/web/index.html',
  // 동봉 화면 손(오너 결정 2026-08-07: T5 설치에 같이 담는다) — 빠지면 ①⑥이 통째로 죽는다.
  'vendor/cua-driver/darwin-arm64/CuaDriver.app/Contents/MacOS/cua-driver',
  'vendor/cua-driver/darwin-arm64/CuaDriver.app/Contents/Info.plist'];
const MUST_NOT_HAVE = ['test', 'design', 'docs', 'workspace-notes', '.beai-harness', 'node_modules'];

const log = (m) => console.log(`[verify:package] ${m}`);
const fail = (m) => { console.error(`[verify:package] 실패: ${m}`); process.exit(1); };

async function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await listFiles(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

async function waitForHealth(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch { /* 아직 안 떴다 — 다시 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

const work = await mkdtemp(join(tmpdir(), 'gpao-t5-verify-'));
const dataDir = join(work, 'data'); // 실 사용자 상태를 건드리지 않는다(격리)
let child;
try {
  // 1) 패키징 — 개발 트리가 아니라 여기서 나온 tarball 이 검증 대상이다.
  log('npm pack 으로 산출물 생성');
  const packed = execFileSync('npm', ['pack', '--pack-destination', work], { cwd: repoRoot, encoding: 'utf8' }).trim().split('\n').pop();
  const tarball = join(work, packed);
  await stat(tarball);

  // 2) 펼치기 — "설치본"을 실제로 만든다.
  log(`펼치기: ${packed}`);
  execFileSync('tar', ['-xzf', tarball, '-C', work]);
  const pkgDir = join(work, 'package');

  // 실제 macOS pkg 제작과 같은 staging 변환. 소스 트리나 실행 중 런타임에는 바이너리를
  // 만들지 않는다. 다른 플랫폼은 정의역 밖이며 client가 fail-closed 하는 단위검사를 쓴다.
  if (process.platform === 'darwin') await buildMacFileBroker(pkgDir);

  // 3) 내용물 검사 — 누락과 과다 **양방향**으로 본다(목록이 아니라 불변식).
  const files = await listFiles(pkgDir);
  const missing = MUST_HAVE.filter((f) => !files.includes(f));
  if (missing.length) fail(`산출물에 필수 파일이 없습니다: ${missing.join(', ')}`);
  const extra = MUST_NOT_HAVE.filter((d) => files.some((f) => f === d || f.startsWith(`${d}/`)));
  if (extra.length) fail(`산출물에 들어가면 안 되는 것이 섞였습니다: ${extra.join(', ')}`);
  log(`내용물 ${files.length}개 — 필수 ${MUST_HAVE.length}개 있음, 금지 항목 없음`);

  // 3-b) **동봉 화면 손이 설치된 자리에서 실제로 뜬다**(PM 지시 2026-08-09 · 5단계 선행).
  // `files` 에 실리는 것(내용물 검사)과 **설치본에서 도는 것**은 다르다 — npm pack 이
  // 실행 비트·번들 구조를 부수면 목록은 있는데 손은 죽는다. ①⑥은 설치본 기준으로만
  // 성립하므로, 소스 쪽 손을 빌려 재지 않고 여기(펼친 산출물)에서 잰다.
  // 권한(TCC)은 안 건드린다 — --version 은 데몬 없이 답하고 끝난다(실측 · exit 0).
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    const broker = join(pkgDir, 'src/native/file-broker/bin/darwin-arm64/t5-file-broker');
    await stat(broker);
    const brokerRoot = join(work, 'broker-root');
    const brokerState = join(work, 'broker-state');
    await mkdir(brokerRoot, { mode: 0o700 });
    await mkdir(brokerState, { mode: 0o700 });
    const { FileBrokerClient } = await import(pathToFileURL(join(pkgDir, 'src/runtime/file-broker-client.js')).href);
    const brokerClient = await FileBrokerClient.open({ rootDir: brokerRoot, stateDir: brokerState, binaryPath: broker });
    const brokerSelfTest = await brokerClient.selfTest();
    await brokerClient.close();
    if (brokerSelfTest.protocol !== 1 || brokerSelfTest.rootCapability !== true
      || brokerSelfTest.sealedStateCapability !== true) fail(`native file broker self-test가 틀렸습니다: ${JSON.stringify(brokerSelfTest)}`);
    log('native file broker — staging compile · fd capability · self-test 통과');
    const 손확인 = execFileSync(process.execPath, ['-e', `
      import(${JSON.stringify(`file://${join(pkgDir, 'src/runtime/desktop-bin.js')}`)}).then((m) => {
        const p = m.동봉된손();
        if (!p) { console.error('동봉된손() null'); process.exit(1); }
        console.log(p);
      });
    `], { encoding: 'utf8' }).trim();
    // macOS tmp 는 /var → /private/var 링크라 문자열 접두가 어긋난다 — 실제 경로로 비교.
    const { realpath } = await import('node:fs/promises');
    if (!손확인.startsWith(await realpath(pkgDir))) fail(`동봉 화면 손이 설치본 밖을 가리킵니다: ${손확인}`);
    execFileSync('codesign', ['--verify', '--deep', '--strict', join(pkgDir, 'vendor/cua-driver/darwin-arm64/CuaDriver.app')]);
    const 버전 = execFileSync(손확인, ['--version'], { encoding: 'utf8' }).trim();
    if (!/cua-driver \d/.test(버전)) fail(`동봉 화면 손이 뜨지 않습니다: ${버전}`);
    log(`동봉 화면 손 확인 — ${버전} · 서명 검증 통과 · 설치본 자리에서 실행됨`);
  } else {
    log('동봉 화면 손 확인 건너뜀 — darwin-arm64 가 아니다(동봉본의 정의역 밖)');
  }

  // 4) **펼친 산출물에서 실제 실행** — 여기가 이 스크립트의 존재 이유다.
  log(`실행: node bin/gpao-t5.mjs --port ${PORT} --no-open`);
  child = spawn(process.execPath, ['bin/gpao-t5.mjs', '--port', String(PORT), '--no-open'], {
    cwd: pkgDir,
    env: { ...process.env, GPAO_T5_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('exit', (code) => { if (code) console.error(`[verify:package] 진입점이 종료됨(code ${code})\n${stderr}`); });

  // 5) 도달 확인 — health 가 이 슬라이스의 "health check passed" 다.
  const health = await waitForHealth(`http://127.0.0.1:${PORT}/health`);
  if (!health) fail(`서버가 응답하지 않습니다.\n${stderr}`);
  if (health.ok !== true) fail(`health 가 ok 가 아닙니다: ${JSON.stringify(health)}`);
  log(`health ok — model.connected=${health.model.connected}, onboarding.needed=${health.onboarding.needed}`);

  // 6) 설치 직후 사용자 경험 확인: 연결이 0이므로 온보딩이 떠야 한다(§6.27 전제 검증).
  if (health.onboarding.needed !== true) fail('설치 직후인데 온보딩이 필요 없다고 나옵니다(§6.27 전제 위반).');
  const page = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
  if (!page.includes('모델 연결')) fail('설치본 화면에 모델 연결 표면이 없습니다.');
  log('설치 직후 온보딩 전개 조건 충족');

  console.log('[verify:package] health check passed — 산출물이 실제로 실행되고 온보딩까지 도달합니다.');
} finally {
  child?.kill();
  await rm(work, { recursive: true, force: true });
}

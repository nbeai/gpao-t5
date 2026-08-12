// **장착을 공식대로 한다 — 남의 권한을 빌려 쓰지 않는다.**
//
// 오너 결정(2026-08-07): A 로 간다 · T5 가 자동 설치 · 0.19.0.
//
// 이틀간 권한과 접근성이 회차마다 흔들린 뿌리가 여기 있었다. 밟은 사실:
// ```
// /Applications/CuaDriver.app   exists = false
// 우리가 부르던 것               mcp --direct
// --direct 의 정의               "on macOS this explicitly accepts HOST TCC attribution"
// ```
// **`--direct` 는 T5 를 띄운 프로세스의 권한을 빌려 쓴다.** 개발 기계에서는 Claude Code
// 셸의 권한이 있어 되는 것처럼 보였고, 사장님 컴퓨터에서는 *"터미널이 화면을 기록하려
// 합니다"* 가 뜬다. 우리가 원한 그림이 아니다.
//
// `--direct` 를 빼면 드라이버가 **스스로 올바른 길로 간다**(실측):
// ```
// mcp launched without CuaDriver.app's TCC grants; auto-launching the daemon via
// `open -n -g -a CuaDriver --args serve` and proxying MCP requests through it.
// ```
// 우리 `--direct` 는 이 자동 경로의 실패(`.app` 없음)를 **우회한 것**이었다.
//
// 그래서 담는 것이 바뀐다 — 생 바이너리가 아니라 **서명·공증된 `.app`** 이다:
// ```
// 서명   Developer ID Application: Cua AI, Inc. (YCK386LBJ7)
// 공증   source=Notarized Developer ID · spctl: accepted
// 번들   com.trycua.driver     ← TCC 가 여기 붙는다
// ```
// `curl | bash` 는 안 쓴다. 원격 스크립트를 사장님 컴퓨터에서 자동 실행하는 것은
// 다른 종류의 결정이고, 서명된 `.app` 을 동봉해 복사하면 네트워크도 필요 없다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { 기동인자, 동봉된앱, 앱설치자리 } from '../src/runtime/desktop-bin.js';

test('남의 권한을 빌리지 않는다 — --direct 는 호스트 TCC 를 상속한다', () => {
  const { args } = 기동인자({ binPath: '/x/cua-driver' });
  assert.ok(!args.includes('--direct'),
    `**호스트 TCC 를 상속한다** — 사장님 컴퓨터에서 "터미널이 화면을 기록하려 합니다"가 뜬다: ${JSON.stringify(args)}`);
  assert.deepEqual(args.slice(0, 1), ['mcp'], `mcp 로 시작해야 한다: ${JSON.stringify(args)}`);
});

test('서명된 앱이 저장소에 담겨 있다 — 없으면 설치가 손을 못 준다', () => {
  const 자리 = 동봉된앱({ platform: 'darwin', arch: 'arm64' });
  assert.ok(자리, '동봉 자리가 정의돼 있지 않다');
  assert.ok(existsSync(자리), `**동봉본이 없다**: ${자리}`);
  const cli = `${자리}/Contents/MacOS/cua-driver`;
  assert.ok(existsSync(cli), `**앱 안에 CLI 가 없다** — 그걸로 mcp 를 부른다: ${cli}`);
  // eslint-disable-next-line no-bitwise
  assert.ok((statSync(cli).mode & 0o111) !== 0, '**실행 권한이 없다** — 받은 사람이 chmod 를 해야 한다');
});

test('아키텍처가 다르면 없다고 한다 — 찾고 나서 실행 실패가 제일 나쁘다', () => {
  assert.equal(동봉된앱({ platform: 'darwin', arch: 'x64' }), null);
  assert.equal(동봉된앱({ platform: 'linux', arch: 'arm64' }), null);
});

test('설치 자리는 /Applications 다 — TCC 는 그 번들에 붙는다', () => {
  assert.equal(앱설치자리({ platform: 'darwin' }), '/Applications/CuaDriver.app');
  assert.equal(앱설치자리({ platform: 'linux' }), null);
});

// ── 없으면 T5 가 설치한다 ───────────────────────────────────────────────
// 오너 결정: *"당연히 T5 가 자동으로 앱 설치를 하는 것도 맞다."*
// 사장님에게 *"먼저 CuaDriver 를 설치하세요"* 라고 할 수 없다 — 어제 배송에서 배운 그대로다.
// **네트워크를 안 쓴다.** 동봉된 서명 앱을 복사할 뿐이라 `curl | bash` 도, 다운로드도 없다.
import { 앱을제자리에 } from '../src/runtime/desktop-bin.js';

test('앱이 없으면 동봉본을 제자리에 놓는다 — 사장님에게 설치를 시키지 않는다', async () => {
  const 한일 = [];
  const r = await 앱을제자리에({
    platform: 'darwin', arch: 'arm64',
    // **가짜가 실물 모양이어야 한다** — 동봉본은 있고 설치 자리만 비어 있는 상태다.
    fs: {
      있나: (p) => !p.startsWith('/Applications/'),
      복사: async (a, b) => { 한일.push(['복사', a, b]); },
    },
  });
  assert.equal(r?.놓았다, true, `**설치를 안 한다**: ${JSON.stringify(r)}`);
  assert.equal(한일.length, 1, `한 번만 복사해야 한다: ${JSON.stringify(한일)}`);
  assert.match(한일[0][2], /^\/Applications\/CuaDriver\.app$/, `엉뚱한 자리에 놓는다: ${한일[0][2]}`);
});

test('이미 있으면 안 건드린다 — 사장님이 깐 것이나 최신본을 덮지 않는다', async () => {
  const 한일 = [];
  const r = await 앱을제자리에({
    platform: 'darwin', arch: 'arm64',
    fs: { 있나: () => true, 복사: async (...a) => { 한일.push(a); } },
  });
  assert.equal(한일.length, 0, `**있는 것을 덮어쓴다**: ${JSON.stringify(한일)}`);
  assert.equal(r?.이미있음, true, JSON.stringify(r));
});

test('복사가 실패해도 기동을 막지 않는다 — 권한이 없을 수 있다', async () => {
  const r = await 앱을제자리에({
    platform: 'darwin', arch: 'arm64',
    fs: { 있나: (p) => !p.startsWith('/Applications/'), 복사: async () => { throw new Error('EACCES'); } },
  });
  assert.equal(r?.놓았다, false, JSON.stringify(r));
  assert.ok(r?.왜, '**왜 못 놓았는지 안 말한다** — 다음 사람이 원인을 못 찾는다');
});

test('맥이 아니면 아무것도 안 한다', async () => {
  const r = await 앱을제자리에({ platform: 'linux', arch: 'arm64', fs: { 있나: () => false } });
  assert.equal(r, null);
});

// ── 기동이 실제로 그 일을 한다 ──────────────────────────────────────────
// **이 검사가 없으면 위 여덟이 다 초록인데 사장님 컴퓨터에는 앱이 안 깔린다.**
// 오늘 여덟 번 밟은 그 병이다 — 함수는 옳은데 아무도 안 부른다.
test('기동 경로가 앱 설치를 부른다 — 안 부르면 동봉이 장식이 된다', () => {
  const 글 = readFileSync(fileURLToPath(new URL('../src/surface/live-context.js', import.meta.url)), 'utf8');
  assert.match(글, /앱을제자리에/,
    '**기동이 앱을 안 놓는다** — `.app` 이 없으면 드라이버가 데몬을 못 띄우고 화면 손이 0개가 된다');
});

// **화면 손은 T5 와 함께 온다.**
//
// 오너 결정(2026-08-07): *"T5 설치에 같이 담는다."* · *"1번으로 진행해"*(빌드본 동봉).
//
// 그 전까지는 제가 이 기계 `~/.local/bin/` 에 손으로 놓은 것이었다. 사장님이 T5 를 켜면
// 화면 손이 0개였고, 그 상태로 난 숫자를 제품 효과로 보고했다(PM 판정 · 판 3차 ①⑥ 0/3).
// 자영업자에게 *"먼저 cua-driver 를 설치하세요"* 라고 할 수 없다 — **그 문장 하나가
// 화면 기능 전체를 없는 것으로 만든다.**
//
// ── 담는 규칙 ────────────────────────────────────────────────────────────
// **아키텍처를 가린다.** 동봉본은 `darwin-arm64` 하나다(28.5MB · Mach-O arm64).
// 파일 존재만 보고 집으면 인텔 맥에서 **찾기는 찾고 실행은 실패한다** — 그건 "손이 없다"
// 보다 나쁘다. 없으면 없다고 해야 다른 손으로 간다(계열 C: 없는 것 ↔ 못 본 것).
//
// **사용자가 깐 것이 이긴다.** 동봉본은 *아무것도 없을 때의 안전망*이지 우리 취향의 강요가
// 아니다. 사장님이 최신 cua 를 직접 깔았으면 그게 그의 의도다 — 표준 자리를 먼저 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { 화면손찾기, 동봉된손 } from '../src/runtime/desktop-bin.js';

const 파일들 = (있는것) => ({ 있나: (p) => 있는것.includes(p) });

test('저장소에 실제로 담겨 있다 — 없으면 설치가 손을 못 준다', () => {
  const 자리 = 동봉된손({ platform: 'darwin', arch: 'arm64' });
  assert.ok(자리, '동봉 자리가 정의돼 있지 않다');
  assert.ok(existsSync(자리),
    `**동봉본이 저장소에 없다** — 설치해도 화면 손이 0개다: ${자리}`);
});

test('실행 권한이 살아 있다 — git 이 실행 비트를 잃으면 켜지지도 않는다', () => {
  const 자리 = 동봉된손({ platform: 'darwin', arch: 'arm64' });
  // eslint-disable-next-line no-bitwise
  assert.ok((statSync(자리).mode & 0o111) !== 0,
    `**실행 권한이 없다** — 받은 사람이 chmod 를 해야 한다: ${자리}`);
});

test('아키텍처가 다르면 없다고 한다 — 찾고 나서 실행 실패하는 것이 제일 나쁘다', () => {
  assert.equal(동봉된손({ platform: 'darwin', arch: 'x64' }), null,
    '**인텔 맥에서 arm64 바이너리를 집는다**');
  assert.equal(동봉된손({ platform: 'linux', arch: 'arm64' }), null,
    '**맥 바이너리를 리눅스에서 집는다**');
});

test('아무것도 안 깔려 있어도 동봉본을 쓴다 — 사장님은 환경변수를 모른다', () => {
  const 동봉 = 동봉된손({ platform: 'darwin', arch: 'arm64' });
  const r = 화면손찾기({
    env: {}, home: '/Users/사장님', platform: 'darwin', arch: 'arm64',
    fs: 파일들([동봉]),   // 표준 자리에는 아무것도 없다
  });
  assert.equal(r, 동봉,
    '**깔린 게 없으면 손이 0개다** — T5 를 켠 사장님에게 화면 기능이 통째로 없다');
});

test('사용자가 깐 것이 동봉본을 이긴다 — 직접 깐 것은 그의 의도다', () => {
  const 동봉 = 동봉된손({ platform: 'darwin', arch: 'arm64' });
  const r = 화면손찾기({
    env: {}, home: '/Users/사장님', platform: 'darwin', arch: 'arm64',
    fs: 파일들(['/Users/사장님/.local/bin/cua-driver', 동봉]),
  });
  assert.equal(r, '/Users/사장님/.local/bin/cua-driver',
    '**사용자가 깐 최신본을 무시하고 동봉본을 쓴다**');
});

test('환경이 밝힌 것은 여전히 맨 위다 — 개발·시험이 안 막힌다', () => {
  const r = 화면손찾기({
    env: { GPAO_T5_CUA_BIN: '/x/build/cua-driver' }, platform: 'darwin', arch: 'arm64',
    fs: 파일들(['/x/build/cua-driver', 동봉된손({ platform: 'darwin', arch: 'arm64' })]),
  });
  assert.equal(r, '/x/build/cua-driver');
});

test('검사 격리 문은 동봉본도 끈다 — 기준지문이 기계에 안 흔들린다', () => {
  assert.equal(화면손찾기({
    env: { GPAO_T5_NO_AUTO_SCREEN_BIN: '1' }, platform: 'darwin', arch: 'arm64',
    fs: 파일들([동봉된손({ platform: 'darwin', arch: 'arm64' })]),
  }), null);
});

test('배포 목록이 동봉본을 뺏지 않는다 — files 에서 빠지면 npm 설치엔 안 담긴다', async () => {
  const pkg = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(
    fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8',
  )));
  const files = pkg.files;
  if (!Array.isArray(files)) return;   // 목록을 안 쓰면 전부 담긴다 — 그건 그것대로 맞다
  assert.ok(files.some((f) => String(f).startsWith('vendor')),
    `**설치본에 화면 손이 안 담긴다** — 개발 저장소에서만 되는 손이 된다: ${JSON.stringify(files)}`);
});

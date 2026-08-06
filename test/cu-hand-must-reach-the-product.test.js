// **손이 제품에 안 붙으면 없는 손이다.**
//
// PM 판정(2026-08-06 · 판 3차): ①⑥ 0/3. 그 커밋에서 서버를 새로 올리니 T5 가 답했다 —
//   *"맥 계산기 같은 일반 앱 화면의 내용을 읽어오지는 못합니다"*
//   *"카톡 같은 메신저 앱 내부 화면은 직접 읽어오지 못해요"*
//
// 기계 사실: `GPAO_T5_CUA_BIN` 은 **저장소 전체에서 읽는 자리 한 곳**에만 있고
// **아무데서도 안 세운다.** `npm start` 도, 설치도, 어떤 스크립트도.
// 나는 라이브 시험 때마다 그 값을 **손으로 넣어** 띄웠고, 그 결과를 제품 효과로 보고했다.
// 사장님이 설치하고 켠 T5 에는 **화면 손이 0개**였다.
//
// 오너 규율 그대로다 — *"영향 0 레인 작업을 제품 효과로 보고하지 말 것."*
//
// **고치는 방향**: 기동이 **스스로 찾는다.** 자영업자에게 환경변수를 넣으라고 할 수 없다.
// cua 자신도 그렇게 산다 — `hermes computer-use doctor` 가 *"looked for 'cua-driver
// (PATH and canonical install paths)'"* 라고 답한다. 같은 자리를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 화면손찾기 } from '../src/runtime/desktop-bin.js';

const 파일들 = (있는것) => ({ 있나: (p) => 있는것.includes(p) });

test('환경이 밝히면 그것이 이긴다 — 개발·시험은 그대로 돈다', () => {
  const r = 화면손찾기({ env: { GPAO_T5_CUA_BIN: '/x/build/cua-driver' }, fs: 파일들(['/x/build/cua-driver']) });
  assert.equal(r, '/x/build/cua-driver');
});

test('환경이 없으면 표준 자리에서 찾는다 — 사용자는 환경변수를 모른다', () => {
  const r = 화면손찾기({
    env: {}, home: '/Users/jyp',
    fs: 파일들(['/Users/jyp/.local/bin/cua-driver']),
  });
  assert.equal(r, '/Users/jyp/.local/bin/cua-driver',
    '**설치해 둬도 T5 가 못 찾는다** — 사장님이 켠 T5 에 화면 손이 0개가 된다');
});

test('여러 자리에 있으면 앞선 자리가 이긴다 — 어느 것을 쓰는지 흔들리지 않는다', () => {
  const r = 화면손찾기({
    env: {}, home: '/Users/jyp',
    fs: 파일들(['/Users/jyp/.local/bin/cua-driver', '/usr/local/bin/cua-driver', '/opt/homebrew/bin/cua-driver']),
  });
  assert.equal(r, '/Users/jyp/.local/bin/cua-driver');
});

test('PATH 에 있으면 그것도 본다 — 설치 방식을 하나로 강요하지 않는다', () => {
  const r = 화면손찾기({
    env: { PATH: '/opt/tools:/usr/bin' }, home: '/Users/jyp',
    fs: 파일들(['/opt/tools/cua-driver']),
  });
  assert.equal(r, '/opt/tools/cua-driver');
});

test('아무 데도 없으면 없다고 한다 — 없는 손을 있다고 하지 않는다', () => {
  assert.equal(화면손찾기({ env: {}, home: '/Users/jyp', fs: 파일들([]) }), null);
});

test('환경이 가리킨 자리에 파일이 없으면 그 말을 안 믿는다 — 표준 자리로 이어 찾는다', () => {
  const r = 화면손찾기({
    env: { GPAO_T5_CUA_BIN: '/없는/자리/cua-driver' }, home: '/Users/jyp',
    fs: 파일들(['/usr/local/bin/cua-driver']),
  });
  assert.equal(r, '/usr/local/bin/cua-driver',
    '**낡은 환경변수 하나로 손이 통째로 사라진다**');
});

// ── 배선이 실제로 그 길을 탄다 ──────────────────────────────────────────
test('라이브 배선이 스스로 찾는다 — 환경변수를 손으로 넣어야 붙는 손은 제품에 없는 손이다', async () => {
  const 소스 = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../src/surface/live-context.js', import.meta.url), 'utf8',
  ));
  assert.match(소스, /화면손찾기\(/,
    '**배선이 환경변수만 본다** — 사용자가 켠 T5 에는 화면 손이 0개다');
});

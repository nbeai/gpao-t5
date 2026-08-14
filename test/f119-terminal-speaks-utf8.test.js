// F-119 — LANG 없는 환경에서 터미널 손이 한국어 파일 이름을 못 읽는다.
//
// 선빨강(라이브 실측 2026-08-15 · 모델 입출력 캡처): 모델이 터미널을 골라
// `find … | wc` 를 돌렸는데 stdout 의 한국어 이름이 전부 `????` 로 와서, 최종 답이
// *"시작문서 폴더 안의 **어떤** .md 파일"* 이 됐다 — 이름을 못 부르는 손이다.
//
// 기제(단일 변수 재현): BSD find 는 현재 로케일에서 못 찍는 글자를 `?` 로 바꾼다.
// 부모 env 에 LANG·LC_* 가 없으면(C 로케일 — GUI 로 뜬 앱·격리 라이브가 그렇다)
// UTF-8 한국어가 전부 「못 찍는 글자」가 된다. 같은 명령에 LANG=UTF-8 만 주면 멀쩡하다.
// 이 컴퓨터의 파일 체계(APFS)는 UTF-8 이다 — 자식 셸이 그 사실을 모르는 게 결함이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../src/runtime/terminal-run.js';

async function 한글방() {
  const dir = await mkdtemp(join(tmpdir(), 't5-f119-'));
  await writeFile(join(dir, '보고서-최종.md'), '내용\n');
  return dir;
}
const 무랭env = { HOME: process.env.HOME, PATH: process.env.PATH };

test('① LANG 없는 환경에서도 find 출력의 한국어 이름이 살아 있다', async () => {
  const dir = await 한글방();
  try {
    const r = await runCommand('find . -name "*.md" -exec wc -c {} +', { mode: 'probe', cwd: dir, env: 무랭env, timeoutMs: 15000 });
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('보고서-최종.md'),
      `한국어 이름이 깨졌다 — 모델이 파일을 못 부른다: ${JSON.stringify(r.stdout.slice(0, 120))}`);
    assert.ok(!r.stdout.includes('????'), '?? 로 뭉개진 이름이 모델에게 간다');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('② 반례: 부모가 LANG 을 정해 뒀으면 그대로 존중하고, 그 위에 아무것도 얹지 않는다', async () => {
  // 사실 채움이지 강제가 아니다 — 사용자가 고른 로케일을 커널이 덮으면 그건 강제다.
  // LC_CTYPE 는 LANG 을 이기므로, LANG 이 있는데 LC_CTYPE 를 채우면 그게 곧 덮는 것이다.
  const dir = await 한글방();
  try {
    const r = await runCommand('printenv LANG; printenv LC_CTYPE; true',
      { mode: 'probe', cwd: dir, env: { ...무랭env, LANG: 'ko_KR.UTF-8' }, timeoutMs: 15000 });
    assert.equal(r.stdout.trim(), 'ko_KR.UTF-8', '부모가 정한 LANG 이 바뀌었거나 그 위에 LC_CTYPE 가 얹혔다');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('③ 반례: 부모의 LC_ALL 은 채움 값과 다른 값이어도 그대로 나온다', async () => {
  // 판별력(감시자 지적): 부모 값이 채움 값과 같으면 「버리고 다시 채운 구현」도 초록이 된다.
  // 채움 값(UTF-8 · 언어 없는 문자집합 값)과 다른 ja_JP.UTF-8 로 정면 대조한다.
  const dir = await 한글방();
  try {
    const r = await runCommand('printenv LC_ALL',
      { mode: 'probe', cwd: dir, env: { ...무랭env, LC_ALL: 'ja_JP.UTF-8' }, timeoutMs: 15000 });
    assert.equal(r.stdout.trim(), 'ja_JP.UTF-8', '부모의 LC_ALL 이 사라졌거나 채움 값으로 바뀌었다');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// **진값이 방 이름을 잃으면 그 위의 모든 채점이 눈먼 채로 돈다.**
//
// 라이브 원본의 `재료실측` 키가 한글 경로에서 `"./????/????.md"` 로 깨져 있었다
// (그냥써본다-원본/ 75개 중 **36개**). 소비자는 채점기다 — 1위 후보를 그 키에서 만든다.
// 즉 자가 한글 이름 파일을 **1위로 짚을 수 없는 상태**였다(§7-t · F-119 와 같은 기전).
//
// 원인은 「execFile 에 env 를 안 넘겨서」가 아니다(내 첫 진술은 틀렸고 감시자가 실측으로
// 뒤집었다). Node 는 env 를 안 주면 process.env 를 물려준다 — **부모의 로케일이 C 면
// 넘겨도 깨진다.** 그래서 수리는 로케일 이름을 고르는 것이 아니라 **셸을 안 쓰는 것**이다.
//
// ⚠️ 이 검사의 반대시험은 **주변 로케일을 C 로 고정해야** 성립한다.
//    LANG 이 UTF-8 인 터미널에서 돌리면 옛 경로도 안 깨져 「실패할 수 없는 검사」가 된다
//    — H09 6/6 빈 측정과 같은 모양이다. 그래서 아래에서 LC_ALL 을 명시로 박는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 재료실측, 재료실측원문 } from '../scripts/terminal-qualification/재료실측.mjs';

const 방만들기 = async () => {
  const 방 = await mkdtemp(join(tmpdir(), 'jinvalue-'));
  await mkdir(join(방, '시작문서'));
  await writeFile(join(방, 'AGENTS.md'), 'x'.repeat(16));
  await writeFile(join(방, '시작문서', '현재상황.md'), 'y'.repeat(9));
  return 방;
};

test('재료실측 키가 비ASCII 파일명을 원문 그대로 보존한다', async () => {
  const 표 = await 재료실측(await 방만들기());
  assert.deepEqual(표, { './AGENTS.md': 16, './시작문서/현재상황.md': 9 });
  assert.ok(!JSON.stringify(표).includes('?'), '깨진 문자가 하나도 없어야 한다');
});

test('C 로케일에서도 새 수집은 이름을 안 잃는다 (셸을 안 타므로 로케일과 무관하다)', async () => {
  const 방 = await 방만들기();
  const 옛LC = process.env.LC_ALL;
  process.env.LC_ALL = 'C';
  try {
    assert.ok(!JSON.stringify(await 재료실측(방)).includes('?'));
  } finally {
    if (옛LC === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = 옛LC;
  }
});

// ⚠️ **이 회차만 기계에 매인다 — 그래서 가둔다**(감시자 2026-08-15 · s2-no-sandbox 선례).
// `?` 를 만드는 것은 `find` 가 아니라 **BSD `wc`** 다(내 실측: `LC_ALL=C find` 는 멀쩡하고
// `LC_ALL=C /usr/bin/wc -c ./방/현재상황.md` 가 `1 ./?/????.md` 를 낸다).
// CI 는 ubuntu 이고 GNU coreutils `wc` 가 같은 치환을 하는지는 **이 기계에서 검증 못 했다**.
// 검증 안 된 기계 의존을 하드 단언으로 본선에 넣지 않는다 — 재현되는 기계에서만 문다.
test('반대시험 — 옛 경로(셸 find|wc)는 이 기계에서 그 이름을 잃는다', async (t) => {
  const 방 = await 방만들기();
  const { stdout } = await promisify(execFile)(
    '/bin/zsh', ['-c', 'find . -type f -exec wc -c {} +'],
    { cwd: 방, env: { ...process.env, LC_ALL: 'C' } },
  );
  if (!stdout.includes('?')) {
    t.skip('이 기계의 wc 는 C 로케일에서 이름을 안 잃는다 — 옛 결함을 여기서는 재현 못 한다');
    return;
  }
  assert.match(stdout, /\?/);
  // 같은 방·같은 로케일에서 새 수집은 멀쩡하다 — 이 대비가 「수리가 그 결함을 고쳤다」를 세운다.
  assert.ok(!JSON.stringify(await 재료실측(방)).includes('?'));
});

test('원문 모양은 옛 wc 출력과 같다 — 형제 수집기(요청사슬캡처)가 그 모양으로 남긴다', async () => {
  const 원문 = 재료실측원문(await 재료실측(await 방만들기()));
  assert.deepEqual(원문.split('\n').sort(), ['16 ./AGENTS.md', '9 ./시작문서/현재상황.md'].sort());
});

// 게이트가 **검사 임시방을 실제로 치우는가** — 그리고 남의 자리는 안 건드리는가.
//
// 왜 이 파일이 있는가: 2026-08-06 에 디스크가 100% 로 찼다. 주범은 다른 것이었지만
// 검사가 남긴 임시 폴더도 2.1GB 였다. 첫 생각은 "`t5-`·`gpao-t5-` 접두를 지우자" 였는데,
// 실물을 세어 보니 `mkdtemp` 자리가 400곳이 넘고 접두가 `what-`·`zero-locate-`·`turn-seq-`
// 까지 제각각이었다. **접두 목록으로 지우면 반드시 샌다**(§목록으로 짐작하지 마라).
//
// 그래서 목록이 아니라 **경계**로 풀었다: 검사에게 `TMPDIR` 을 전용 방으로 주고 그 방만 지운다.
// 이 시험이 재는 것은 그 경계가 실제로 서는가다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { 방크기 } from '../scripts/dir-size.mjs';

test('경계: TMPDIR 을 주면 자식이 만든 임시 자리가 그 방 안에 떨어진다', () => {
  const 방 = mkdtempSync(join(tmpdir(), 'gate-tmp-test-'));
  try {
    // 자식이 `os.tmpdir()` 로 만든다 — 검사들이 하는 것과 같은 방식이다.
    const 만든자리 = execFileSync(process.execPath, ['-e',
      "const {mkdtempSync,writeFileSync}=require('node:fs');const {tmpdir}=require('node:os');"
      + "const {join}=require('node:path');const d=mkdtempSync(join(tmpdir(),'what-'));"
      + "writeFileSync(join(d,'a.txt'),'x'.repeat(1000));process.stdout.write(d);",
    ], { encoding: 'utf8', env: { ...process.env, TMPDIR: `${방}/` } });

    assert.ok(만든자리.startsWith(방), `자식이 방 밖에 만들었다: ${만든자리}`);
    // **접두가 `what-` 이다** — 목록으로 잡으려 했으면 여기서 샜다.
    assert.ok(만든자리.includes('/what-'), 만든자리);
    assert.ok(방크기(방) >= 1000, '방 크기가 실제 내용을 센다');
  } finally { rmSync(방, { recursive: true, force: true }); }
});

test('정리: 방을 지우면 안의 것이 전부 사라진다', () => {
  const 방 = mkdtempSync(join(tmpdir(), 'gate-tmp-test-'));
  const 안쪽 = join(방, 'zero-locate-abc');
  mkdirSync(안쪽, { recursive: true });
  writeFileSync(join(안쪽, 'b.txt'), 'y'.repeat(500));
  assert.ok(existsSync(안쪽));

  rmSync(방, { recursive: true, force: true });
  assert.equal(existsSync(안쪽), false, '방을 지웠는데 안쪽이 남았다');
  assert.equal(방크기(방), 0, '없어진 자리는 0 이다');
});

test('경계 밖: 남의 임시 자리는 방을 지워도 그대로다', () => {
  // 게이트가 접두로 훑었다면 이 자리가 같이 지워졌을 것이다 — 그게 이 시험이 막는 것이다.
  const 남의자리 = mkdtempSync(join(tmpdir(), 't5-someone-else-'));
  writeFileSync(join(남의자리, 'keep.txt'), 'z');
  const 방 = mkdtempSync(join(tmpdir(), 'gate-tmp-test-'));
  try {
    rmSync(방, { recursive: true, force: true });
    assert.ok(existsSync(join(남의자리, 'keep.txt')),
      '남의 임시 자리가 지워졌다 — 경계가 아니라 목록으로 지우고 있다');
  } finally { rmSync(남의자리, { recursive: true, force: true }); }
});

test('방크기: 못 읽는 자리를 0 으로 세지 않는다', () => {
  // 없는 자리는 0 이 맞다. 다만 **던지지 않아야** 한다 — 게이트가 정리하다 죽으면 안 된다.
  assert.equal(방크기(join(tmpdir(), 'gate-없는자리-' + 'x'.repeat(8))), 0);
});

// **F-103 · 「이 컴퓨터가 지금 어떤 상태인가」에 저장 공간이 없다** (선빨강)
//
// 닫는 문장: *"이 맥 디스크 여유 공간이 얼마나 남았어?"* 라고 하면 **실제 남은 용량이 답에 있다.**
//
// 밟은 것: 이 능력은 **저장소 어디에도 없다** — `df`·`diskutil`·`freeSpace` 전수 grep 0.
// 사용자가 물으면 T5 가 쓸 손이 없다.
//
// ── 왜 새 손이 아니라 이 손인가 ─────────────────────────────────────────────
// `local-system.js` 의 **첫 줄이 이미 이렇게 적혀 있다**: *"L3 · 이 컴퓨터가 지금 어떤
// 상태인가"*. 손 이름과 자기 선언이 **이미 「상태」**인데 구현이 프로세스 한 축뿐이었다.
// 새 손을 만들면 사용자는 *"컴퓨터 상태"* 를 묻는데 손이 둘로 갈리고, 모델이 매번 고르게 된다
// (그리고 이 저장소는 「두 벌」로 오늘만 네 번 데었다). **있는 손의 빠진 축을 채운다.**
//
// ── 왜 축을 안 묻고 둘 다 주는가 ────────────────────────────────────────────
// 모델에게 `axis: 'process'|'disk'` 를 고르게 하면 **고를 자리가 하나 늘고 틀릴 자리도 하나 는다.**
// 이 손은 읽기 전용이고 둘 다 빠르다. *"컴퓨터가 느려"* 와 *"용량 얼마 남았어"* 가 **같은 손
// 한 번**으로 답해진다 — 모델을 멍청하게 만들지 않는다(§24).
//
// ── 그 파일이 이미 세워 둔 안전 계약을 그대로 지킨다 ────────────────────────
// *"명령과 인자를 T5 가 고정 조립한다 — 사용자 말이 명령에 들어갈 자리가 없다(주입 불가) ·
//  읽기 전용이다 · 인자에 섞인 비밀이 딸려 오지 않게 읽는 칸을 좁힌다."*
// `df` 도 같은 규율로 부른다: 고정 명령·고정 인자·사용자 입력 0.
import assert from 'node:assert/strict';
import test from 'node:test';

import { makeLocalSystemTool } from '../src/runtime/local-system.js';

const PS출력 = [
  '  PID  %CPU %MEM COMM',
  '  101  42.0  8.0 /Applications/Chrome.app/Contents/MacOS/Chrome',
  '  102   3.0  1.0 /usr/sbin/notifyd',
].join('\n');

// 실제 `df -k` 출력 모양(macOS). 1K 블록 · 마지막 칸이 마운트 지점.
const DF출력 = [
  'Filesystem 1024-blocks      Used Available Capacity iused ifree %iused  Mounted on',
  '/dev/disk3s1s1 971350180 21903512 118253540    16%  502k 1.2G    0%   /',
  '/dev/disk3s6   971350180        24 118253540     1%     0 1.2G    0%   /System/Volumes/VM',
].join('\n');

/** 고정 명령 둘을 흉내 낸다 — 무엇을 어떤 인자로 불렀는지도 함께 붙잡는다. */
function 대본실행() {
  const 부른것 = [];
  const run = (cmd, args, opts, cb) => {
    부른것.push({ cmd, args });
    if (cmd.endsWith('/ps')) return cb(null, PS출력);
    if (cmd.endsWith('/df')) return cb(null, DF출력);
    return cb(new Error(`대본에 없는 명령: ${cmd}`));
  };
  return { run, 부른것 };
}

// ── ① 밟은 그 자리 ───────────────────────────────────────────────────────────
test('F103 ①: 이 컴퓨터 상태에 **남은 저장 공간**이 들어 있다', async () => {
  const { run } = 대본실행();
  const 손 = makeLocalSystemTool({ run });
  const r = await 손.handler({});
  const 저장 = r.result?.storage;
  assert.ok(저장, '**남은 용량을 아예 안 준다** — 사용자가 "용량 얼마 남았어?"라고 물으면 '
    + '이 컴퓨터에 그 답을 아는 손이 없다(df·diskutil 전수 grep 0)');
  // 118253540 × 1024 바이트 = 약 121GB
  assert.equal(저장.freeBytes, 118253540 * 1024, '남은 바이트가 df 실측에서 나와야 한다');
  assert.equal(저장.totalBytes, 971350180 * 1024, '전체 바이트도 함께 준다');
  assert.equal(저장.mount, '/', '어느 볼륨인지 말한다 — 맥은 볼륨이 여럿이다');
});

test('F103 ①-b: 사람 말 한 줄에도 남은 용량이 있다 — 모델이 답을 지어낼 자리를 안 만든다', async () => {
  const { run } = 대본실행();
  const r = await makeLocalSystemTool({ run }).handler({});
  assert.match(String(r.userSafeSummary ?? ''), /남은|여유/,
    `요약이 저장 공간을 말해야 한다: ${r.userSafeSummary}`);
  assert.match(String(r.userSafeSummary ?? ''), /\d/,
    '숫자가 있어야 한다 — 사용자가 판단할 근거다');
});

// ── ② 옛 축이 그대로 산다 ────────────────────────────────────────────────────
test('F103 ②: 프로세스 축은 예전 그대로 — 되던 것이 안 되면 안 된다', async () => {
  const { run } = 대본실행();
  const r = await makeLocalSystemTool({ run }).handler({ limit: 1 });
  assert.equal(r.result.processes.length, 1, 'limit 이 그대로 먹어야 한다');
  assert.equal(r.result.processes[0].name, 'Chrome', '실행 파일 이름만 남기는 계약 그대로');
  assert.equal(r.result.total, 2, '전체 개수도 그대로');
});

// ── ③ 안전 계약 — 고정 명령·고정 인자·사용자 입력 0 ─────────────────────────
test('F103 ③: 사용자 말이 명령에 들어갈 자리가 없다 — 고정 인자만 쓴다', async () => {
  const { run, 부른것 } = 대본실행();
  await makeLocalSystemTool({ run }).handler({ limit: 3, 아무거나: '; rm -rf /' });
  assert.ok(부른것.length >= 2, `명령 둘을 불러야 한다: ${JSON.stringify(부른것)}`);
  for (const { cmd, args } of 부른것) {
    assert.ok(cmd.startsWith('/'), `절대 경로 고정이어야 한다: ${cmd}`);
    for (const a of args) {
      assert.ok(!String(a).includes('rm'), `사용자 말이 인자에 샜다: ${JSON.stringify(args)}`);
      assert.ok(!String(a).includes(';'), `셸 메타문자가 인자에 있다: ${JSON.stringify(args)}`);
    }
  }
});

// ── ④ 한쪽이 막혀도 다른 쪽은 준다 ──────────────────────────────────────────
//
// 이 저장소의 반복 흉터: **부재를 성공으로도, 통째 실패로도 읽지 않는다.** 디스크를 못 읽어도
// 프로세스는 줬으면 그건 실패가 아니다 — 못 본 것만 못 봤다고 말한다(조용한 절단 금지).
test('F103 ④: 디스크를 못 읽어도 프로세스는 그대로 주고, 못 본 것은 못 봤다고 말한다', async () => {
  const run = (cmd, args, opts, cb) => (cmd.endsWith('/ps')
    ? cb(null, PS출력) : cb(new Error('df: operation not permitted')));
  const r = await makeLocalSystemTool({ run }).handler({});
  assert.ok(!r.failed, '**한쪽이 막혔다고 턴 전체를 실패로 만들면** 볼 수 있던 것까지 잃는다');
  assert.equal(r.result.processes.length, 2, '프로세스는 그대로 와야 한다');
  assert.equal(r.result.storage, null, '못 본 것은 null 로 — 지어내지 않는다');
  assert.match(String(r.userSafeSummary ?? ''), /용량|저장|공간/,
    `못 봤다는 사실이 사람 말에 있어야 한다(조용한 절단 금지): ${r.userSafeSummary}`);
});

// ── ⑤ 반대 방향도 같다 — 프로세스가 막혀도 저장 공간은 준다 ──────────────────
//
// 공정검문이 짚은 자리다. `/bin/ps` 는 setuid root 라 `operation not permitted` 가 **실측으로**
// 났던 경로다(이 파일 머리 주석). 그 경로에서 *"디스크 여유 얼마 남았어?"* 가 **숫자를 손에
// 쥔 채** "돌고 있는 것을 확인하지 못했어요"로 끝나면, 이번 닫는 문장이 바로 거기서 죽는다.
test('F103 ⑤: 프로세스를 못 읽어도 남은 용량은 그대로 준다 — 쥔 것을 버리지 않는다', async () => {
  const run = (cmd, args, opts, cb) => (cmd.endsWith('/df')
    ? cb(null, DF출력) : cb(new Error('ps: operation not permitted')));
  const r = await makeLocalSystemTool({ run }).handler({});
  assert.ok(!r.failed,
    '**디스크 숫자를 손에 쥐고도 통째 실패로 끝났다** — 이번 닫는 문장이 그 경로에서 죽는다');
  assert.equal(r.result.storage.freeBytes, 118253540 * 1024, '남은 용량은 그대로 와야 한다');
  assert.match(String(r.userSafeSummary ?? ''), /남은 저장 공간/, '요약에 용량이 있어야 한다');
  assert.match(String(r.userSafeSummary ?? ''), /못 봤/, '못 본 축은 못 봤다고 말해야 한다');
});

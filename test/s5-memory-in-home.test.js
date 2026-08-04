// **S5a — 기억이 집에 보이는 파일이 된다.**
//
// 원리 ⑥: 집은 **기억처럼 다룬다**(*"treat it as memory"*). 그런데 T5 의 기억은
// `~/.local/state/gpao-t5/sessions/memory.json` 안에 있고 **사용자는 자기 기억을 못 본다.**
// 암호화돼 있어서가 아니다 — 평문인데 볼 자리가 없다(그 사실은 v2.5 정정에서 확인했다).
//
// 지금 사용자가 할 수 있는 것: T5 가 "이걸 기억할까요?" 물을 때 예/아니오.
// **못 하는 것**: 지금 무엇을 기억하고 있는지 통째로 보기 · 직접 고치기 · 직접 지우기.
//
// 비교군은 기억이 **그냥 파일**이라 이 셋이 공짜로 된다. T5 도 그 자리로 내린다.
//
// ── 이 칸의 경계 ─────────────────────────────────────────────────────────
// 원장(`memory-ledger.json` + HMAC 지문)은 **그대로 둔다.** 철회의 복원 불가능성을 지키는
// 자리이고, 내용과 이미 분리돼 있다. 여기서 옮기는 것은 **내용**이고, 철회는 원장을 그대로 탄다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 기억파일쓰기, 기억파일읽기, 지워진기억 } from '../src/surface/memory-home.js';

const 집 = async () => mkdtemp(join(tmpdir(), 't5-mem-'));
const 기억 = (id, s) => ({ candidateId: id, kind: 'preference', statement: s, rollbackable: true });
// **저장소 표식** — 집은 홈에 하나인데 기억 저장소는 데이터 자리마다 다르다.
// 짝이 안 맞는 파일을 진실로 읽으면 남의 파일이 이쪽 기억을 철회시킨다(실측: 회귀 29건).
const 저장소 = '/tmp/store-A';

test('① 기억이 **사람이 읽는 파일**로 집에 놓인다', async () => {
  const dir = await 집();
  await 기억파일쓰기(dir, [기억('a1', '월별 수치는 표로 정리한다'), 기억('b2', '부모님이 오시면 1~3일 머무신다')], 저장소);
  const 글 = await readFile(join(dir, '기억.md'), 'utf8');
  assert.match(글, /월별 수치는 표로 정리한다/);
  assert.match(글, /부모님이 오시면/);
  assert.match(글, /지우면|잊/, '지울 수 있다는 것을 안 알려 주면 읽기 전용 문서일 뿐이다');
});

test('② **줄을 지우면 T5 가 잊는다** — 그게 이 칸의 닫는 문장이다', async () => {
  const dir = await 집();
  await 기억파일쓰기(dir, [기억('a1', '월별 수치는 표로 정리한다'), 기억('b2', '부모님이 오시면 1~3일 머무신다')], 저장소);
  const 글 = await readFile(join(dir, '기억.md'), 'utf8');
  // 사용자가 첫 줄을 지운다(파인더로 열어 지우는 것과 같다).
  await writeFile(join(dir, '기억.md'), 글.split('\n').filter((l) => !l.includes('월별 수치')).join('\n'), 'utf8');

  const 남은것 = await 기억파일읽기(dir, 저장소);
  assert.deepEqual(지워진기억([기억('a1', '월별 수치는 표로 정리한다'), 기억('b2', '부모님이 오시면 1~3일 머무신다')], 남은것),
    ['a1'], '사용자가 지운 기억을 못 알아본다 — 파일이 진실이 아니면 집이 아니다');
});

test('③ 사용자가 쓴 메모는 다시 만들어도 **안 지워진다**', async () => {
  const dir = await 집();
  await 기억파일쓰기(dir, [기억('a1', '첫 기억')], 저장소);
  const 글 = await readFile(join(dir, '기억.md'), 'utf8');
  await writeFile(join(dir, '기억.md'), `${글}\n\n## 내 메모\n\n- 이건 내가 쓴 것\n`, 'utf8');
  await 기억파일쓰기(dir, [기억('a1', '첫 기억'), 기억('c3', '새 기억')], 저장소);
  const 뒤 = await readFile(join(dir, '기억.md'), 'utf8');
  assert.match(뒤, /이건 내가 쓴 것/, '사용자가 쓴 구역을 우리가 지웠다 — 집은 사용자의 것이다');
  assert.match(뒤, /새 기억/, '새 기억이 안 실렸다');
});

test('④ 기억이 하나도 없으면 **빈 목록이라고 말한다**(파일을 안 만들지 않는다)', async () => {
  const dir = await 집();
  await 기억파일쓰기(dir, [], 저장소);
  const 글 = await readFile(join(dir, '기억.md'), 'utf8');
  assert.match(글, /아직|없/, '빈 상태를 말하지 않으면 사용자는 고장인지 빈 것인지 모른다');
});

test('⑤ 파일이 없으면 **아무것도 지워진 게 아니다**(첫 실행에 기억이 날아가면 안 된다)', async () => {
  const dir = await 집();
  const 남은것 = await 기억파일읽기(dir, 저장소);
  assert.equal(남은것, null, '파일이 없을 때 빈 목록을 돌려주면 전부 지운 것으로 읽힌다');
  assert.deepEqual(지워진기억([기억('a1', 'x')], null), [], '파일이 없는데 기억을 지웠다');
});

test('⑥ 사용자가 문장을 **고쳐도** 그 기억은 살아 있다(신분은 표식이 든다)', async () => {
  const dir = await 집();
  await 기억파일쓰기(dir, [기억('a1', '원래 문장')], 저장소);
  const 글 = await readFile(join(dir, '기억.md'), 'utf8');
  await writeFile(join(dir, '기억.md'), 글.replace('원래 문장', '내가 고친 문장'), 'utf8');
  const 남은것 = await 기억파일읽기(dir, 저장소);
  assert.deepEqual(지워진기억([기억('a1', '원래 문장')], 남은것), [],
    '문장을 고쳤다고 기억을 지운 것으로 읽었다 — 사용자는 다듬은 것이지 지운 게 아니다');
  assert.equal(남은것.get('a1'), '내가 고친 문장', '고친 문장을 못 읽었다');
});

test('⑦ **남의 설치가 쓴 파일로는 기억을 지우지 않는다**(회귀 29건이 여기서 났다)', async () => {
  const dir = await 집();
  await 기억파일쓰기(dir, [기억('a1', '내 기억')], '/tmp/store-A');
  // 다른 데이터 자리에서 같은 집을 읽는다(검사·격리 하네스가 실제로 그런다).
  assert.equal(await 기억파일읽기(dir, '/tmp/store-B'), null,
    '표식이 다른데 파일을 진실로 읽었다 — 남의 파일이 이쪽 기억을 철회시킨다');
  assert.deepEqual(지워진기억([기억('a1', '내 기억')], await 기억파일읽기(dir, '/tmp/store-B')), []);
});

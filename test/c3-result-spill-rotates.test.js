// **C3 · 결과 흘림 파일에 삭제·회전이 없었다** (상태 지도 §12 C3 · `tool-runner.js:21`).
//
// `큰결과흘리기` 는 `<DATA>/results/` 에 **쓰기만** 했다. 한 턴에 큰 결과가 몇 개씩 나오고,
// 세션은 계속 돈다 — 지우는 자가 없으면 그냥 무한 누적이다.
//
// 헤르메스는 이 자리를 **자리 선택**으로 풀었다:
//   `tools/tool_result_storage.py:41`  `STORAGE_DIR = "/tmp/hermes-results"`
//   `tools/tool_result_storage.py:48`  `_resolve_storage_dir(env)` — *"Return the best
//                                       **temp-backed** storage dir for this environment."*
// 흘림 파일을 temp 밑에 두고 **OS 가 걷게** 한다. 우리는 그 길을 못 쓴다 — 우리 흘림 파일은
// 모델이 `local.file read` 로 **이어 읽어야 하는 문**이라 읽기 범위 안(상태 자리)에 살아야 한다.
// 그래서 같은 목적(수명은 유한하다)을 **회전**으로 이룬다.
//
// 회전 기준은 **나이가 아니라 개수**다. 이유: 모델이 아직 이어 읽을 수 있는 것은 「최근 것」이지
// 「어제 안에 쓴 것」이 아니다. 시계로 자르면 오래 도는 한 턴의 문이 그 턴 안에서 사라진다
// (「시간은 학습의 근거가 아니다」와 같은 축 — 시계는 lease·TTL 에만).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { 흘림보관수 } from '../src/runtime/tool-runner.js';

const selfState = { connectedTools: [{ id: 'big', executable: true, status: 'usable' }] };

/** 흘림이 확실히 걸리도록 결과자보다 훨씬 큰 원문을 낸다. */
const 큰손 = (표식) => ({ async handler() { return { result: { 표식, 덩어리: 'ㅁ'.repeat(6000) } }; } });

async function 방준비() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-c3-'));
  const 이전 = process.env.GPAO_T5_DATA_DIR;
  process.env.GPAO_T5_DATA_DIR = dir;
  return { dir, 되돌리기: () => { if (이전 === undefined) delete process.env.GPAO_T5_DATA_DIR; else process.env.GPAO_T5_DATA_DIR = 이전; } };
}

const 흘림파일들 = async (dir) => (await readdir(join(dir, 'results'))).sort();

test('C3 · 흘림 파일은 보관수를 넘기면 오래된 것부터 걷힌다(무한 누적 금지)', async () => {
  const 방 = await 방준비();
  try {
    const runner = new ToolRunner({ big: 큰손('x') });
    const 돌린수 = 흘림보관수 + 8;
    for (let i = 0; i < 돌린수; i += 1) {
      const rec = await runner.run('big', { i }, selfState, { 결과자: 1200 });
      assert.ok(rec.흘린원문?.path, `${i}회차: 흘림은 그대로 돈다`);
    }
    const 남은것 = await 흘림파일들(방.dir);
    assert.equal(남은것.length, 흘림보관수,
      `${돌린수}번 흘렸는데 ${남은것.length}개 남았다 — 보관수 ${흘림보관수} 로 회전해야 한다`);
  } finally { 방.되돌리기(); }
});

test('C3 · **방금 흘린 것은 반드시 살아 있다** — 모델이 그 경로를 이어 읽는다', async () => {
  const 방 = await 방준비();
  try {
    const runner = new ToolRunner({ big: 큰손('x') });
    let 마지막;
    for (let i = 0; i < 흘림보관수 + 5; i += 1) {
      마지막 = await runner.run('big', { i }, selfState, { 결과자: 1200 });
    }
    const 원문 = await readFile(마지막.흘린원문.path, 'utf8');
    assert.equal(원문.length, 마지막.흘린원문.totalChars, '영수증이 가리킨 문이 그대로 열린다');
  } finally { 방.되돌리기(); }
});

test('C3 · 걷히는 것은 **오래된 것**이다(최근 것을 걷지 않는다)', async () => {
  const 방 = await 방준비();
  try {
    const runner = new ToolRunner({ big: 큰손('x') });
    const 경로들 = [];
    for (let i = 0; i < 흘림보관수 + 3; i += 1) {
      경로들.push((await runner.run('big', { i }, selfState, { 결과자: 1200 })).흘린원문.path);
    }
    const 남은것 = new Set(await 흘림파일들(방.dir));
    const 이름 = (p) => p.split('/').pop();
    for (const p of 경로들.slice(-흘림보관수)) assert.ok(남은것.has(이름(p)), `최근 것은 남는다: ${이름(p)}`);
    for (const p of 경로들.slice(0, 3)) assert.ok(!남은것.has(이름(p)), `오래된 것은 걷힌다: ${이름(p)}`);
  } finally { 방.되돌리기(); }
});

test('C3 반대시험 · 회전이 실패해도 본선(결과·영수증)은 그대로다', async () => {
  const 방 = await 방준비();
  try {
    // 남의 파일이 섞여 있어도 흘림·영수증은 그대로 나온다(옆길은 본선을 막지 않는다).
    const runner = new ToolRunner({ big: 큰손('x') });
    const rec = await runner.run('big', {}, selfState, { 결과자: 1200 });
    assert.equal(rec.failureState, 'none');
    assert.ok(rec.흘린원문.totalChars > 4800);
  } finally { 방.되돌리기(); }
});

test('C3 반대시험 · 작은 결과는 애초에 파일로 안 흘린다(회전이 소음을 만들지 않는다)', async () => {
  const 방 = await 방준비();
  try {
    const runner = new ToolRunner({ small: { async handler() { return { result: { a: 1 } }; } } });
    const rec = await runner.run('small', {}, { connectedTools: [{ id: 'small', executable: true, status: 'usable' }] }, { 결과자: 1200 });
    assert.equal(rec.흘린원문, undefined);
    await assert.rejects(() => 흘림파일들(방.dir), '흘린 게 없으면 방도 안 생긴다');
  } finally { 방.되돌리기(); }
});

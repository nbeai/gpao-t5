// **함수를 건네면 부른다 — 캡슐 호출 규칙의 봉인** (⑫ 회차 D 실측 · 2026-08-08).
//
// 래퍼가 IIFE 라서 모델이 `async () => {…}` 를 통째로 건네면 **정의만 되고 호출 0** 으로
// 끝났다("손을 한 번도 쓰지 않았어요" — 그 회차에서 두 걸음이 그렇게 탔다).
// 코드 전체가 함수 하나면 뜻은 하나뿐이다 — 실행해 달라는 것. 판정은 컴파일로만 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 캡슐실행 } from '../src/runtime/capsule.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const selfState = buildSelfState(demoEnv({ include: ['local.file'], hands: ['local.file'] }));

async function 무대() {
  const dir = await mkdtemp(join(tmpdir(), 's4-호출-'));
  await writeFile(join(dir, 'a.csv'), '거래처,금액\n가나상사,980000\n');
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  return { dir, tools: new ToolRunner({ 'local.file': localFile }) };
}

test('코드 전체가 async 화살표 함수 하나면 불러서 실행한다', async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: `async () => {
      const r = await t5.call("local.file", { action: "list", path: "." });
      console.log("불림:" + (r && r.ok === true));
    }`,
    tools, selfState, cwd: dir, 허용손: ['local.file'],
  });
  // `r.ok === true` 는 RPC 가 실제로 T5 손까지 갔다 왔다는 증거다 — 안 갔으면
  // `{ ok:false, error:'응답 없음' }` 이 돌아온다(캡슐머리의 계약).
  assert.match(String(결과.stdout ?? 결과.output ?? JSON.stringify(결과)), /불림:true/,
    '함수를 건넸는데 정의만 되고 안 불렸다(또는 RPC 가 안 돌았다) — ⑫ 회차 D 의 그 빈손이다');
});

test('반대시험: 이미 호출로 끝나는 IIFE 는 다시 감싸지 않는다(약속을 또 부르면 터진다)', async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: '(async () => { console.log("한번:" + 1); })();',
    tools, selfState, cwd: dir,
  });
  assert.match(String(결과.stdout ?? 결과.output ?? JSON.stringify(결과)), /한번:1/);
  assert.doesNotMatch(String(결과.stderr ?? ''), /is not a function/);
});

test('반대시험: 문장 여러 개는 그대로 돈다 — 감싸면 문법이 깨진다', async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: 'const a = 1;\nconst b = 2;\nconsole.log("합:" + (a + b));',
    tools, selfState, cwd: dir,
  });
  assert.match(String(결과.stdout ?? 결과.output ?? JSON.stringify(결과)), /합:3/);
});

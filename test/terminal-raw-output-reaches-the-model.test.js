// **터미널 결과 원문이 모델에게 간다** — 기본 다섯 줄 중 ③ (2026-08-14)
//
// 오너 지시: *"오픈클로·헤르메스·클로드코드처럼 터미널을 쓰게 하는 가장 기본적인 것을
// 완성한다."* 그 셋의 공통 축은 하나다 — **stdout·stderr·exitCode 를 원문 그대로 모델에게
// 돌려준다.** 저장소가 이미 그 축을 적어 뒀다(`task-context.js:824-840`):
//   *"헤르메스는 실패도 성공과 같은 그릇에 담아 그대로 싣는다 … 클로드코드도 원문 그대로다."*
//
// 밟은 자리 셋. 셋 다 **터미널만** 안 돌고 있었다 — 재료는 이미 있었다.
//
//   ㉠ 막힌 갈래가 `result` 를 통째로 버렸다. `local-terminal.js` 는 `probe.exitCode`·
//     `probe.stderr`·`blockedBy`·`blockReason` 을 **내는데** `tool-runner.js` 의 blocked 갈래가
//     `다음수단`·`다른후보`·`막힌곳` 만 옮겼다. 쓰기 명령은 전부 이 경로다.
//   ㉡ `compactResult` 에 터미널 갈래가 **없어서** 맨 아래 JSON 통짜로 떨어졌다 —
//     stdout 의 줄바꿈이 `\n` 리터럴로 눌리고(표·로그의 행 경계가 사라진다),
//     잘릴 때 JSON 문자열 한가운데가 끊긴다. **파일 갈래는 이미 같은 병을 고쳤다**(§③ 주석).
//   ㉢ `실패원문칸`(헤르메스 축 2,000자)이 이미 서 있는데 터미널 blocked 갈래가 그 칸
//     (`diagnosticTrace`)에 값을 안 넣어 `{확인안됨:true}` 만 갔다.
//
// **경계**: 원문을 주는 것과 사실로 승격하는 것은 다른 일이다. `실패원문칸` 이 그 둘을
// 가르는 자리이므로 승격 금지(`data` 미승격)는 그대로 두고 원문만 채운다. 그리고
// **승인이 필요한 명령은 원문이 실려도 여전히 승인으로 간다** — 아래 반대시험이 문다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { 확인된사실 } from '../src/kernel/l0-evidence/ledger.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildTaskContext, compactResult } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages, MODEL_PROVIDERS } from '../src/runtime/model-provider.js';

const selfState = buildSelfState({
  model: { id: 'beai5-stub' },
  connections: [{ id: 'local.terminal', connected: true, executable: true }],
});

/** 쓰기를 막힌 탐침 — 실측 모양 그대로(`mkdir` → `Operation not permitted`). */
const 막힌손 = (본 = []) => makeLocalTerminalTool({
  cwd: '/작업',
  sandboxAvailable: () => true,
  async run(command, opts) {
    본.push(opts.mode);
    return {
      command, cwd: opts.cwd, mode: opts.mode,
      exitCode: 1, durationMs: 4,
      stdout: '', stderr: 'mkdir: 보고서: Operation not permitted',
    };
  },
});

const 돈손 = (out) => makeLocalTerminalTool({
  cwd: '/작업',
  sandboxAvailable: () => true,
  async run(command, opts) {
    return {
      command, cwd: opts.cwd, mode: opts.mode,
      exitCode: 0, durationMs: 7, stdout: out, stderr: '',
    };
  },
});

async function 모델이받는것(tool, args, 발화 = '보고서 폴더 만들어줘') {
  const rec = await new ToolRunner({ 'local.terminal': tool }).run('local.terminal', args, selfState);
  const tc = buildTaskContext({ intent: interpret(발화), selfState, receipts: [rec] });
  const 전문 = MODEL_PROVIDERS.openai.body(
    { modelId: 'm', maxTokens: 10, baseUrl: 'http://x' }, buildModelMessages(tc), {},
  );
  return { rec, tc, x: (tc.turnExchange ?? [])[0], 전문 };
}

// ── ㉠·㉢ 막힌 터미널 호출의 기계 사실이 모델에게 간다 ────────────────────────

test('㉠ 막힌 터미널 호출의 exitCode·stderr·막힌 이유가 모델 교환에 실린다', async () => {
  const { x } = await 모델이받는것(막힌손(), { command: 'mkdir ~/보고서' });
  assert.ok(x, '막힌 호출이 교환에 없다');
  assert.equal(x.failureState, 'blocked', '상태 토큰이 사라졌다');
  assert.equal(x.확인안됨, true, '표식 없이 주면 실패 내용이 사실로 승격된다 — 표식이 계약이다');
  const 원문 = String(x.실패원문 ?? '');
  assert.match(원문, /Operation not permitted/, 'stderr 원문이 모델에게 안 갔다');
  assert.match(원문, /exitCode/, 'exit code 가 모델에게 안 갔다');
  assert.match(원문, /"1"|:1|: 1/, 'exit code 값이 모델에게 안 갔다');
  assert.match(원문, /write/, '무엇에 막혔는지(blockReason)가 모델에게 안 갔다');
  assert.match(원문, /sandbox/, '누가 막았는지(blockedBy)가 모델에게 안 갔다');
});

test('㉠ 같은 원문이 와이어까지 간다 — 안 준 손은 흔적이 없다', async () => {
  const { 전문 } = await 모델이받는것(막힌손(), { command: 'mkdir ~/보고서' });
  assert.match(전문, /Operation not permitted/, '교환에는 실렸는데 와이어 렌더가 떨어뜨렸다');
  assert.match(전문, /확인 안 됨/, '원문이 표식 없이 나가면 모델이 실패 내용을 사실로 읽는다');
});

test('㉠ 영수증도 손이 낸 result 를 버리지 않는다 — 원장이 무엇에 막혔는지 안다', async () => {
  const { rec } = await 모델이받는것(막힌손(), { command: 'mkdir ~/보고서' });
  assert.equal(rec.result?.blockedBy, 'sandbox', '손이 낸 막힌 종류를 런타임이 버렸다');
  assert.equal(rec.result?.blockReason, 'write', '손이 낸 막힌 이유를 런타임이 버렸다');
  assert.equal(rec.result?.probe?.exitCode, 1, '탐침 exit code 를 런타임이 버렸다');
  assert.match(String(rec.result?.probe?.stderr ?? ''), /Operation not permitted/,
    '탐침 stderr 를 런타임이 버렸다');
});

// ── ㉡ 줄 구조를 지운 채 주지 않는다 ─────────────────────────────────────────

test('㉡ 여러 줄 stdout 은 줄바꿈이 살아서 간다 — JSON 이스케이프로 눌리지 않는다', () => {
  const stdout = [
    'total 3',
    '-rw-r--r--  1 jyp  staff   120  8 14 10:00 a.txt',
    'drwxr-xr-x  4 jyp  staff   128  8 14 10:01 b',
  ].join('\n');
  const 요약 = compactResult({
    command: 'ls -la', cwd: '/방', exitCode: 0, durationMs: 7, stdout, stderr: '', applied: true,
  });
  assert.ok(!요약.includes('\\n'),
    `줄바꿈이 리터럴 \\n 으로 눌렸다 — 표·로그의 행 경계가 모델 입력에서 사라진다:\n${요약}`);
  assert.match(요약, /^total 3$/m, '행 경계가 사라졌다');
  assert.match(요약, /^drwxr-xr-x {2}4 jyp {2}staff {3}128 {2}8 14 10:01 b$/m, '마지막 행이 온전하지 않다');
  assert.match(요약, /ls -la/, '무슨 명령의 결과인지가 없다');
  assert.match(요약, /0/, 'exit code 가 없다');
});

test('㉡ stderr 도 원문 줄 그대로 간다 — exit 0 이 아닌 것의 알맹이는 거기 있다', () => {
  const 요약 = compactResult({
    command: 'npm test', cwd: '/방', exitCode: 1, durationMs: 90,
    stdout: 'ok 1 - a\nok 2 - b',
    stderr: 'FAIL src/x.test.js\n  ● 계약이 깨졌다\n    Expected: 3\n    Received: 4',
    failedBy: 'code', failReason: 'failed', applied: true,
  });
  assert.match(요약, /^ {4}Expected: 3$/m, 'stderr 의 행 구조가 사라졌다');
  assert.match(요약, /Received: 4/, 'stderr 원문이 잘려 나갔다');
});

// ── ㉢ 긴 출력: 정직한 절단 + 이어 받을 문 ───────────────────────────────────

const 긴목록 = Array.from({ length: 600 }, (_, i) =>
  `-rw-r--r--  1 jyp  staff  ${1000 + i}  8 14 10:${String(i % 60).padStart(2, '0')} 파일${i}.txt`).join('\n');

test('㉢ 긴 stdout 은 JSON 한가운데서 끊기지 않고 앞·뒤 줄을 온전히 남긴다', () => {
  const 요약 = compactResult({
    command: 'ls -la ~/Downloads', cwd: '/방', exitCode: 0, durationMs: 12,
    stdout: 긴목록, stderr: '', applied: true,
  }, 1200);
  assert.doesNotMatch(요약, /^\{"command"/, 'JSON 통짜로 떨어졌다 — 터미널 갈래가 없다');
  assert.match(요약, /^-rw-r--r-- {2}1 jyp {2}staff {2}1000 {2}8 14 10:00 파일0\.txt$/m,
    '앞줄이 온전하지 않다(줄 한가운데서 끊겼다)');
  assert.match(요약, /^-rw-r--r-- {2}1 jyp {2}staff {2}1599 {2}8 14 10:59 파일599\.txt$/m,
    '결론(마지막 줄)이 사라졌거나 한가운데서 끊겼다');
});

test('㉢ 잘린 사실을 말하고 **이어 받을 문**을 준다 — 잘렸다는 말만 하고 막지 않는다', () => {
  const 요약 = compactResult({
    command: 'ls -la ~/Downloads', cwd: '/방', exitCode: 0, durationMs: 12,
    stdout: 긴목록, stderr: '', applied: true,
  }, 1200);
  assert.match(요약, /전체 600줄/, '전체가 몇 줄인지 모델이 못 본다');
  assert.match(요약, /\d+자/, '전체가 몇 자인지 모델이 못 본다');
  assert.match(요약, /sed -n '\d+,\d+p'/, '나머지로 가는 문이 없다 — 잘렸다는 말만 하고 막은 것이다');
});

test('㉢ 반례 — 통째로 실린 짧은 출력에는 문을 달지 않는다(소음 금지)', () => {
  const 요약 = compactResult({
    command: 'pwd', cwd: '/방', exitCode: 0, durationMs: 2, stdout: '/방\n', stderr: '', applied: true,
  });
  assert.doesNotMatch(요약, /sed -n/, '자르지도 않았는데 문을 달아 소음을 만들었다');
  assert.doesNotMatch(요약, /생략/, '자르지도 않았는데 절단 표식을 달았다');
});

// ── 반대시험 — 되돌리면 T5 가 깨지는 자리 ────────────────────────────────────

test('반대① 안전 바닥 — 원문이 실려도 승인이 필요한 명령은 여전히 승인으로 간다', async () => {
  const 본 = [];
  const { rec, x } = await 모델이받는것(막힌손(본), { command: 'mkdir ~/보고서' });
  assert.equal(rec.failureState, 'blocked', '막힌 것이 통과로 바뀌었다 — 안전 바닥이 뚫렸다');
  assert.equal(rec.result?.applied, undefined, '실행되지 않은 호출에 실행 사실이 붙었다');
  assert.equal(rec.result?.probeChangedNothing, true, '아무것도 안 바뀌었다는 사실이 사라졌다');
  assert.ok(!본.includes('granted'), `승인 없이 실제 실행이 돌았다: ${본.join(',')}`);
  assert.equal(확인된사실(rec), false, '막힌 걸음이 원장에서 확인된 사실로 세어졌다');
  assert.match(String(x.nextSafeAction ?? ''), /진행할까요/, '승인을 묻는 다음 수가 사라졌다');
});

test('반대② 실패 결과는 data 로 승격되지 않는다 — 미확정 표식 아래 있다', async () => {
  const { x } = await 모델이받는것(막힌손(), { command: 'mkdir ~/보고서' });
  assert.equal(x.data, undefined, '실패한 결과를 data 로 승격했다');
  assert.equal(x.확인안됨, true, '미확정 표식이 없다');
});

test('반대③ 성공 갈래의 기존 모양은 안 깨진다 — data 로 가고 실행 사실이 산다', async () => {
  const { rec, x } = await 모델이받는것(
    돈손('a.txt\nb.txt'), { command: 'ls', granted: true, effects: ['write'] }, '작업 폴더 봐줘',
  );
  assert.equal(rec.failureState, 'none', '성공이 실패로 바뀌었다');
  assert.equal(rec.result?.ran, true, '실제로 돌았다는 기계 사실이 사라졌다');
  assert.equal(Object.hasOwn(rec.result ?? {}, 'applied'), false, '새 터미널 영수증이 applied를 다시 낸다');
  assert.equal(x.failureState, undefined, '성공에 실패 상태가 붙었다');
  assert.ok(x.data, '성공 결과가 안 실렸다');
  assert.match(x.data, /a\.txt/, '성공 결과의 알맹이가 모델에게 안 갔다');
  assert.equal(x.실패원문, undefined, '성공 교환에 실패 원문 칸이 생겼다');
});

test('반대③-b 실제 모델 요청 와이어에 「돌았다」와 로컬 변경 범위가 함께 실린다', async () => {
  const { 전문 } = await 모델이받는것(
    돈손('hello-from-t5\nTue Aug 18'), { command: 'echo hello-from-t5 && date' }, '확인해줘',
  );
  assert.match(전문, /실제로 돌았다/, '명령 실행 사실이 와이어에 없다');
  assert.match(전문, /사용자 상태 변경 여부는 확인하지 못했/, '미관측 변경을 false로 메웠거나 숨겼다');
  assert.doesNotMatch(전문, /실제로는 안 돌았다/, '실행한 명령을 안 돌았다고 모델에게 보냈다');
});

test('반대④ 터미널이 아닌 결과는 예전 갈래 그대로 간다(갈래가 남의 자리를 먹지 않는다)', () => {
  const 요약 = compactResult({ 목록: Array.from({ length: 300 }, (_, i) => `항목${i}`) }, 500);
  assert.match(요약, /전체 \d+자/, '그 밖 갈래의 정직한 절단이 깨졌다');
  assert.match(요약, /실은 범위/, '그 밖 갈래의 실은 범위 표식이 깨졌다');
});

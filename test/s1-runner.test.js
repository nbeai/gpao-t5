// **S1 러너의 판정 논리** — 실모델 앞에서 처음 확인하면 안 되는 것들.
//
// 회차 결과를 읽는 규칙(§5.1.1 전이 · §5.3 호출표)이 틀리면, 비싼 여섯 회차를 돌리고 나서
// 숫자를 다시 해석하게 된다. 그건 "결과를 본 뒤 판정 기준을 고르는 것"과 구분이 안 된다
// (오너 지시: 비교군은 채점 전에 확정한다). 그래서 여기서 먼저 못박는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 호출지문, 전이판정, 잘림사실, 순서, 문장, 회차상한ms } from '../scripts/s1/run.mjs';
import { 고른도구, 낸글, 쓴토큰 } from '../scripts/s1/wire-tap.mjs';

// ── 동결값이 문서와 같은가 ─────────────────────────────────────────────────
test('동결값은 문서와 같다(§4 순서 · §6 문장·상한)', () => {
  assert.deepEqual(순서, ['A', 'B', 'B', 'A', 'A', 'B'], '실행 순서는 결과 전에 고정됐다');
  assert.equal(문장, '내 다운로드 폴더 깔끔하게 정리 좀 하고 싶다.', '사고 원문 그대로여야 한다');
  assert.equal(회차상한ms, 15 * 60 * 1000);
});

// ── §5.1.1 전이 ────────────────────────────────────────────────────────────
test('첫 `local.file list` 는 실패가 아니다(오너 지시 — 결과 전 동결)', () => {
  assert.equal(전이판정(null, 'local.file#list#path=/다운로드', false), '최초');
});

test('같은 손·다른 인자는 전략 전환이다(경로 좁힘은 정상)', () => {
  const 앞 = 호출지문({ name: 'local.file', args: { action: 'list', path: '/다운로드' } });
  const 뒤 = 호출지문({ name: 'local.file', args: { action: 'list', path: '/다운로드/2024' } });
  assert.notEqual(앞, 뒤);
  assert.equal(전이판정(앞, 뒤, true), '전략전환');
});

test('같은 손·다른 action 도 전략 전환이다', () => {
  const 앞 = 호출지문({ name: 'local.file', args: { action: 'list', path: '/다운로드' } });
  const 뒤 = 호출지문({ name: 'local.file', args: { action: 'move', path: '/다운로드' } });
  assert.equal(전이판정(앞, 뒤, true), '전략전환');
});

test('다른 손으로 옮겨 가면 전략 전환이다(터미널로 갈아타기)', () => {
  const 앞 = 호출지문({ name: 'local.file', args: { action: 'list', path: '/다운로드' } });
  const 뒤 = 호출지문({ name: 'local.terminal', args: { command: 'mkdir -p 정리' } });
  assert.equal(전이판정(앞, 뒤, true), '전략전환');
});

test('부분 결과 뒤 같은 지문 반복이 무진전 반복이다(사고 당시 list→list→list)', () => {
  const 지문 = 호출지문({ name: 'local.file', args: { action: 'list', path: '/다운로드' } });
  // 사고 덤프의 호출 1·3·5 — 같은 인자로 같은 잘린 목록을 다시 받았다.
  assert.equal(전이판정(null, 지문, false), '최초');
  assert.equal(전이판정(지문, 지문, true), '무진전반복');
  assert.equal(전이판정(지문, 지문, true), '무진전반복');
});

test('인자 순서·공백이 달라도 의미가 같으면 같은 호출이다', () => {
  const a = 호출지문({ name: 'local.file', args: { action: 'list', path: '/다운로드', depth: 1 } });
  const b = 호출지문({ name: 'local.file', args: { depth: 1, action: 'list', path: ' /다운로드 ' } });
  assert.equal(a, b, '키 순서나 앞뒤 공백으로 반복을 놓치면 안 된다');
});

test('인자 값이 다르면 같은 호출이 아니다(지문이 뭉개지면 안 된다)', () => {
  const a = 호출지문({ name: 'local.file', args: { action: 'move', from: 'a.pdf', to: '문서/a.pdf' } });
  const b = 호출지문({ name: 'local.file', args: { action: 'move', from: 'b.pdf', to: '문서/b.pdf' } });
  assert.notEqual(a, b, '437개를 하나씩 옮기는 것은 반복이 아니라 진행이다');
});

// ── 잘림 사실 ──────────────────────────────────────────────────────────────
test('잘림 표식을 **제품이 실제로 만든 문자열**에서 읽는다', async () => {
  // 문구를 손으로 베껴 두면 제품이 표식을 바꿀 때 이 검사는 조용히 통과하고, 러너는
  // 부분 결과를 못 알아본 채 무진전 반복을 0으로 보고한다. 그래서 원천에서 만든다.
  const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
  const 목록 = { path: '/다운로드', items: Array.from({ length: 437 }, (_, i) => ({
    name: `자료-${String(i).padStart(3, '0')}.pdf`, kind: 'file',
    modifiedAt: new Date(Date.UTC(2026, 6, 1)).toISOString(),
  })) };
  const 사실 = 잘림사실(compactResult(목록));
  assert.equal(사실.잘림, true, '437개가 잘렸는데 러너가 못 알아봤다 — 표식이 바뀌었을 수 있다');
  assert.equal(사실.전체, 437);
  assert.ok(사실.전달 > 0 && 사실.전달 < 437, `전달 개수가 이상하다: ${사실.전달}`);
});

test('전부 실린 목록은 부분 결과가 아니다(제품 문자열 기준)', async () => {
  const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
  const 목록 = { path: '/다운로드', items: [{ name: 'a.pdf', kind: 'file' }, { name: 'b.pdf', kind: 'file' }] };
  assert.equal(잘림사실(compactResult(목록)).잘림, false);
});

test('빈 것에 대고 잘렸다고 하지 않는다', () => {
  assert.equal(잘림사실('').잘림, false);
  assert.equal(잘림사실(undefined).잘림, false);
});

// ── 와이어 읽기 ────────────────────────────────────────────────────────────
test('단발 응답에서 도구 선택을 뽑는다', () => {
  const 몸 = JSON.stringify({ choices: [{ message: { tool_calls: [
    { function: { name: 'local_file', arguments: '{"action":"list","path":"/다운로드"}' } },
  ] } }] });
  assert.deepEqual(고른도구(몸), [{ name: 'local_file', args: { action: 'list', path: '/다운로드' } }]);
});

test('스트림 응답의 조각난 도구 호출을 하나로 잇는다', () => {
  const 조각 = [
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'local_', arguments: '{"act' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'file', arguments: 'ion":"list"}' } }] } }] },
  ].map((o) => `data: ${JSON.stringify(o)}`).join('\n') + '\ndata: [DONE]\n';
  assert.deepEqual(고른도구(조각), [{ name: 'local_file', args: { action: 'list' } }]);
});

test('스트림에서 글과 토큰을 읽는다', () => {
  const 조각 = [
    { choices: [{ delta: { content: '정리를 ' } }] },
    { choices: [{ delta: { content: '시작할게요.' } }] },
    { choices: [{ delta: {} }], usage: { prompt_tokens: 1200, completion_tokens: 40 } },
  ].map((o) => `data: ${JSON.stringify(o)}`).join('\n') + '\ndata: [DONE]\n';
  assert.equal(낸글(조각), '정리를 시작할게요.');
  assert.deepEqual(쓴토큰(조각), { 입력: 1200, 출력: 40 });
});

test('깨진 조각 하나가 전체 읽기를 무너뜨리지 않는다', () => {
  const 조각 = 'data: {깨짐\ndata: {"choices":[{"delta":{"content":"살아남음"}}]}\ndata: [DONE]\n';
  assert.equal(낸글(조각), '살아남음');
});

// **자로 재면 언제 문턱을 넘는지 못 본다.**
//
// 오너 지시(2026-08-05): *"헤르메스 임계는 토큰의 10%인데 우리는 자로 쟀다. 단위가 다르다.
// 지금은 결론이 안 바뀐다 — 문제는 다음이다. MCP·플러그인이 붙기 시작할 때 알아야 하는데,
// 재는 자리를 지금 안 바꾸면 그 순간을 놓친다."*
//
// 비교군의 켜는 기준(헤르메스 `tools/tool_search.py`)은 **컨텍스트의 10%**이고 단위가 토큰이다.
// 우리 계측기는 자만 남겼다. 같은 축에 놓이지 않으면 대조가 아니라 나란한 두 숫자일 뿐이다.
//
// ── 그리고 한글이 규칙을 바꾼다 ──────────────────────────────────────────
// 헤르메스는 `chars/4` 한 줄로 어림하고 *"자릿수만 맞으면 된다"* 고 적었다. 맞는 판단이다.
// **다만 그건 영어 기준이다.** 우리 스키마는 설명이 한글이라 그 규칙을 그대로 쓰면
// 한글 몫을 3~4배 과소평가한다 — 실측으로 **1.8배** 차이가 났다(4,442 vs 8,135 토큰).
//
// 그래서 이 검사가 재는 것은 값이 아니라 **성질**이다. 값은 손이 늘면 바뀌므로 얼리면
// 정당한 추가에 죽는다(§4.4). 성질은 안 죽는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 토큰어림 } from '../src/runtime/prompt-dump.js';

test('영어는 비교군과 같은 규칙으로 어림한다 — 대조가 되려면 축이 같아야 한다', () => {
  assert.equal(토큰어림('a'.repeat(400)), 100, '영어 400자는 chars/4 로 100토큰(헤르메스와 같은 축)');
});

test('한글은 훨씬 조밀하다 — 영어 규칙을 그대로 쓰면 과소평가한다', () => {
  const 한글 = 토큰어림('가'.repeat(400));
  const 영어규칙 = Math.ceil(400 / 4);
  assert.ok(한글 > 영어규칙 * 2,
    `한글 400자를 ${한글}토큰으로 봤다 — 영어 규칙(${영어규칙})과 차이가 없으면 한글 몫을 못 본다`);
});

test('섞여 있어도 각 몫을 따로 센다', () => {
  const 섞임 = `${'a'.repeat(400)}${'가'.repeat(100)}`;
  assert.equal(토큰어림(섞임), 100 + 100, '두 몫을 나눠 세지 않으면 어느 쪽이 비싼지 못 가른다');
});

test('빈 값·없는 값에도 안 터진다 — 계측기가 실행을 깨면 안 된다', () => {
  assert.equal(토큰어림(''), 0);
  assert.equal(토큰어림(undefined), 0);
  assert.equal(토큰어림(null), 0);
});

// ── 계측기가 실제로 그 칸을 남기는가 ──────────────────────────────────────
// **재는 자리를 먼저 검증한다**(§4.3). 어림 함수가 맞아도 덤프에 안 실리면 아무도 못 본다.
test('덤프가 토큰 칸을 남긴다 — 안 남기면 그 순간을 놓친다', async () => {
  const { mkdtemp, readdir, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { dumpModelInput } = await import('../src/runtime/prompt-dump.js');

  const dir = await mkdtemp(join(tmpdir(), 't5-tok-'));
  await dumpModelInput({
    messages: { system: '시스템 문장입니다', user: '오늘 증시' },
    tools: [{ name: 'web.search', description: '웹에서 찾는다', parameters: { type: 'object' } }],
  }, { GPAO_T5_PROMPT_DUMP: dir });

  const [파일] = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  assert.ok(파일, '덤프가 안 남았다');
  const j = JSON.parse(await readFile(join(dir, 파일), 'utf8'));
  assert.equal(typeof j.toolSchemaTokens, 'number', '도구 스키마 토큰 칸이 없다');
  assert.equal(typeof j.systemTokens, 'number', '시스템 프롬프트 토큰 칸이 없다');
  assert.ok(j.toolSchemaTokens > 0);
  // **자수 칸은 그대로 남는다** — 새 축을 세우는 것이지 옛 축을 걷는 것이 아니다.
  assert.equal(typeof j.toolSchemaChars, 'number', '자수 칸을 걷어냈다 — 앞선 계측과 대조가 끊긴다');
});

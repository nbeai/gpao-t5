// **S3 방 확장 — 문(offset·limit)과 조용한 절단 금지.**
//
// 정본 §S3:
//   · `local.file` list/read 에 `offset`·`limit` 문. 응답에 **다음 수를 사실로**("1-40 of 437, offset=41").
//   · 절단 전 계열 정직화: 자를 때는 뺀 양 명시 + **문 안내**. 조용한 절단을 게이트로 차단.
//
// ── 왜 문이 필요한가 (사고 원문) ───────────────────────────────────────────
// 다운로드 437개 정리 요청에서 목록 결과가 잘려 **23개(5%)만** 모델에게 갔다. 요약은
// "437개를 찾았어요"였고, 잘렸다는 말은 마침표 세 개가 전부였다. **나머지를 가져올 인자가
// 없었다.** 모델은 "437개가 있다"는 말과 23개의 이름을 받은 채 실행을 요구받았다 —
// 불가능한 자리다. 그래서 다섯 턴 내내 계획만 반복했다.
//
// 잘림 자체를 없애는 게 답이 아니다(437개 이름을 다 실으면 프롬프트가 폭주한다).
// **답은 문이다** — 얼마나 있고, 어디까지 줬고, 나머지를 어떻게 가져오는지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';

async function 많은폴더(n = 120) {
  const dir = await mkdtemp(join(tmpdir(), 's3-door-'));
  for (let i = 0; i < n; i += 1) await writeFile(join(dir, `자료-${String(i).padStart(3, '0')}.txt`), `${i}`);
  return { dir, tool: makeLocalFileTool({ roots: [dir], dataDir: dir }) };
}

// ── ① 목록의 문 ────────────────────────────────────────────────────────────
test('list 는 `limit` 으로 일부만 주고, **전체 수와 다음 자리**를 사실로 말한다', async () => {
  const { dir, tool } = await 많은폴더(120);
  const out = await tool.handler({ action: 'list', path: '.', limit: 40 });
  assert.equal(out.result.items.length, 40, 'limit 이 안 먹는다');
  assert.equal(out.result.total, 120, '전체가 몇 개인지 없으면 모델은 끝났는지 모른다');
  assert.equal(out.result.offset, 0);
  assert.equal(out.result.nextOffset, 40, '다음을 어디서 이어야 하는지가 없으면 문이 아니다');
  assert.match(out.userSafeSummary, /120/, '사용자면 문장에 전체 수가 없다');
  assert.ok(String(dir).length);
});

test('list 는 `offset` 으로 이어서 받을 수 있다(같은 것을 다시 주지 않는다)', async () => {
  const { tool } = await 많은폴더(120);
  const 첫 = await tool.handler({ action: 'list', path: '.', limit: 40 });
  const 둘 = await tool.handler({ action: 'list', path: '.', limit: 40, offset: 첫.result.nextOffset });
  assert.equal(둘.result.offset, 40);
  assert.equal(둘.result.items.length, 40);
  const 겹침 = 둘.result.items.filter((x) => 첫.result.items.some((y) => y.name === x.name));
  assert.deepEqual(겹침, [], '이어 받았는데 앞엣것이 또 왔다 — 문이 아니라 제자리다');
});

test('마지막 쪽에서는 `nextOffset` 이 없다(끝났다는 사실)', async () => {
  const { tool } = await 많은폴더(50);
  const out = await tool.handler({ action: 'list', path: '.', limit: 40, offset: 40 });
  assert.equal(out.result.items.length, 10);
  assert.equal(out.result.nextOffset, undefined, '더 없는데 다음 자리를 주면 모델이 빈 손으로 또 부른다');
  assert.match(out.userSafeSummary, /마지막|끝/, '끝났다는 말이 없으면 모델은 계속 부른다');
});

test('문을 안 쓰면 예전과 똑같다(기본값이 동작을 바꾸지 않는다)', async () => {
  const { tool } = await 많은폴더(7);
  const out = await tool.handler({ action: 'list', path: '.' });
  assert.equal(out.result.items.length, 7);
  assert.equal(out.result.nextOffset, undefined);
});

// ── ② 파일 본문의 문 ───────────────────────────────────────────────────────
test('read 는 `offset`·`limit` 으로 본문을 나눠 받고 전체 크기를 말한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's3-read-'));
  const 본문 = Array.from({ length: 500 }, (_, i) => `${i}행`).join('\n');
  await writeFile(join(dir, '큰글.txt'), 본문);
  const tool = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const 첫 = await tool.handler({ action: 'read', path: '큰글.txt', limit: 200 });
  assert.ok(첫.result.text.length <= 200, 'limit 이 본문에 안 먹는다');
  assert.equal(첫.result.totalChars, 본문.length, '전체 크기가 없으면 얼마나 남았는지 모른다');
  assert.equal(첫.result.nextOffset, 첫.result.text.length);
  const 둘 = await tool.handler({ action: 'read', path: '큰글.txt', offset: 첫.result.nextOffset, limit: 200 });
  assert.equal(둘.result.offset, 첫.result.nextOffset);
  assert.ok(본문.startsWith(첫.result.text + 둘.result.text), '이어 붙이면 원문이 나와야 한다');
});

// ── ③ 절단은 **문 안내와 함께** 온다 ───────────────────────────────────────
test('모델 입력에서 목록이 잘리면 **문 인자**를 함께 알려준다', () => {
  const 요약 = compactResult({
    path: '/다운로드',
    items: Array.from({ length: 437 }, (_, i) => ({ name: `자료-${i}.pdf`, kind: 'file' })),
    total: 437, offset: 0, nextOffset: 437,
  });
  assert.match(요약, /나머지 \d+개는 이 답에 이름을 싣지 못했다/, '뺀 양을 말하지 않는다');
  assert.match(요약, /offset/, '나머지를 가져올 문을 안 알려준다 — 사고 당시가 정확히 이 상태였다');
});

test('안 잘렸으면 문 안내를 붙이지 않는다(없는 문제를 만들지 않는다)', () => {
  const 요약 = compactResult({ path: '/다운로드', items: [{ name: 'a.pdf', kind: 'file' }], total: 1 });
  assert.doesNotMatch(요약, /offset/);
});

// ── ④ 상한 1,200자는 **실측으로 유지한** 값이다 ────────────────────────────
//
// 정본 §S3: "상한 1,200자 재설정 — Hermes(50,000)를 참조하되 **값은 실측으로 정한다**."
// 실측 결과 올리지 않기로 했다. 그 근거를 검사로 고정한다 — 나중에 누가 "Hermes 는 5만인데"
// 로 올리려 하면 여기서 숫자를 먼저 보게 된다.
test('상한을 올려도 이름 문제는 안 풀린다(그래서 문이 답이었다)', () => {
  const 목록 = (n) => ({
    path: '/다운로드',
    items: Array.from({ length: n }, (_, i) => ({
      name: `자료-${String(i).padStart(3, '0')}.pdf`, kind: 'file',
      modifiedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    })),
  });
  const 실은수 = (상한) => (String(compactResult(목록(437), 상한)).match(/^- /gm) ?? []).length;
  const 기본 = 실은수(1200);
  const 다섯배 = 실은수(6000);
  assert.ok(기본 < 40, `기본 상한에서 이름이 ${기본}개나 실린다 — 실측 전제가 바뀌었다`);
  assert.ok(다섯배 < 437 * 0.4,
    `상한을 5배 올렸더니 ${다섯배}개(${Math.round(다섯배 / 437 * 100)}%)가 실린다 — 이 실측이 뒤집혔으면 §S3 판단을 다시 한다`);
  // **어느 상한에서도 문은 함께 온다.** 그게 실제 해법이다.
  for (const 상한 of [1200, 6000]) {
    assert.match(String(compactResult(목록(437), 상한)), /offset=\d+/,
      `상한 ${상한}에서 문이 사라졌다`);
  }
});

// ── ⑤ 문을 쓰면 **전체 수를 잃지 않는다** (내가 만들 뻔한 새 거짓) ──────────
//
// 실측(2026-08-04, 문을 낸 직후 라이브): 모델이 `limit:100` 을 쓰자 `compactResult` 가
// `items.length`(100)를 전체로 읽어 **"전체 100개"** 라고 말했다. 실제로는 438개다.
// 조용한 절단을 고치다 **새 조용한 거짓**을 만들 뻔한 자리다 — 모델은 다 봤다고 믿는다.
test('한 쪽만 받아도 전체 수는 진짜 전체다', () => {
  const 요약 = compactResult({
    path: '/다운로드', total: 438, offset: 0, nextOffset: 100,
    items: Array.from({ length: 100 }, (_, i) => ({ name: `자료-${i}.pdf`, kind: 'file' })),
  });
  assert.match(요약, /전체 438개/, '한 쪽의 개수를 전체로 말했다 — 모델은 다 봤다고 믿는다');
  assert.doesNotMatch(요약, /전체 100개/);
});

test('뒤쪽 쪽에서도 남은 수와 다음 자리가 맞는다', () => {
  const 요약 = compactResult({
    path: '/다운로드', total: 438, offset: 400, nextOffset: undefined,
    items: Array.from({ length: 38 }, (_, i) => ({ name: `자료-${400 + i}.pdf`, kind: 'file' })),
  });
  // 400번째부터 38개 = 끝. 다 실렸으면 절단 안내가 없어야 한다.
  assert.doesNotMatch(요약, /이름을 싣지 못했다/, '끝인데 남았다고 말한다');
});

test('한 쪽 안에서 또 잘리면 다음 자리는 **그 쪽 안**을 가리킨다', () => {
  const 요약 = compactResult({
    path: '/다운로드', total: 438, offset: 100, nextOffset: 200,
    items: Array.from({ length: 100 }, (_, i) => ({ name: `자료-${100 + i}.pdf`, kind: 'file' })),
  });
  const m = 요약.match(/offset=(\d+)/);
  assert.ok(m, '문이 없다');
  const 다음 = Number(m[1]);
  assert.ok(다음 > 100 && 다음 < 200,
    `다음 자리가 이 쪽 안을 안 가리킨다(${다음}) — 이름을 못 받은 구간을 건너뛴다`);
});

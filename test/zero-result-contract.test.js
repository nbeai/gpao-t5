// **손 계열 횡단 계약 — "못 찾았다"는 얼마나 훑었는지와 함께 온다.**
//
// 오너 목표 문장(2026-08-04): *"다운로드 정리 등 개별 과업은 범용 계약을 검증하는 수단으로만
// 사용하며, 파일·코드·웹·데스크톱·외부 전송·자동화·복구에 일반화한다."*
//
// ── 왜 이 계약인가 ─────────────────────────────────────────────────────────
// S1 라이브 실측(2026-08-04, gpt-5.1): 묶음 이동이 0개를 돌려주며 "조건에 맞는 파일이 없어서
// 옮기지 않았어요" 한 줄만 줬다. 모델은 **원인을 경로 문제로 지어내** 사용자에게 그렇게 말했고
// ("툴이 쓸 때 경로 지정이 살짝 안 맞았던 걸로 보여") 그 턴의 이동은 0이었다.
//
// 거짓말을 하려던 게 아니다. **도구가 이유를 안 주면 모델은 이유를 지어낸다.** 이유를 주자
// 같은 모델이 조건을 여섯 번 나눠 불러 432개를 처리했다.
//
// 이건 파일 손의 버릇이 아니라 **모든 손에 있는 병의 모양**이다. 그래서 손별로 고치지 않고
// 여기서 계약으로 세운다:
//
//   빈 결과를 줄 때는 셋을 함께 준다 — **무엇을 찾았는가 · 어디를 얼마나 훑었는가 · 다음 길**.
//
// 없으면 모델은 빈칸을 추측으로 메우고, 그 추측이 사용자에게 사실처럼 나간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';
import { makeSessionSearchTool } from '../src/runtime/session-search-tool.js';

/** 빈 결과 하나가 계약을 지키는가 — 셋을 다 갖췄는가. */
function 빈결과계약(이름, out, { 찾은말, 훑음 }) {
  const 말 = String(out?.userSafeSummary ?? '');
  assert.ok(말.trim(), `${이름}: 사용자면 문장이 없다`);
  assert.ok(말.includes(찾은말), `${이름}: 무엇을 찾았는지가 없다 — "${말}"`);
  assert.match(말, 훑음, `${이름}: 어디를 얼마나 훑었는지가 없다 — 모델이 빈칸을 추측으로 메운다: "${말}"`);
  assert.ok(String(out?.nextSafeAction ?? '').trim(),
    `${이름}: 다음 길이 없다 — 막다른 답이다`);
}

// ── ① 파일 손 — 묶음 이동(이미 닫힘, 회귀 방지) ────────────────────────────
test('파일: 묶음 이동 0개는 조건별 개수와 함께 온다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zero-file-'));
  for (const f of ['backup-1.png', '#임시#메모.txt']) await writeFile(join(dir, f), 'x');
  const tool = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const out = await tool.handler({
    action: 'bulk_move', path: '.', to: '__T',
    match: { namePrefix: 'backup-', nameIncludes: ['임시'] },
  });
  빈결과계약('bulk_move', out, { 찾은말: 'backup-', 훑음: /\d+개/ });
  assert.match(out.userSafeSummary, /모두 만족해야/, '왜 0인지의 핵심(AND)이 빠졌다');
});

// ── ② 자리 찾기 — 어디를 몇 개나 뒤졌는가 ──────────────────────────────────
test('자리 찾기: 못 찾았을 때 **얼마나 훑었는지**가 함께 온다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zero-locate-'));
  await mkdir(join(dir, '가'), { recursive: true });
  await mkdir(join(dir, '나'), { recursive: true });
  await writeFile(join(dir, '가', 'x.txt'), 'x');
  const tool = makeLocalLocateTool({ roots: [dir] });
  const out = await tool.handler({ what: '존재하지않는프로젝트', from: dir, depth: 2 });
  빈결과계약('local.locate', out, { 찾은말: '존재하지않는프로젝트', 훑음: /\d+/ });
});

// ── ③ 지난 대화 찾기 — 몇 개의 대화를 봤는가 ───────────────────────────────
test('대화 찾기: 못 찾았을 때 **몇 개를 뒤졌는지**가 함께 온다', async () => {
  const store = {
    async loadAll() {
      return [
        { id: 's1', title: '견적', transcript: [{ role: 'user', text: '견적서 만들어줘' }], updatedAt: 1 },
        { id: 's2', title: '정산', transcript: [{ role: 'user', text: '정산표 확인' }], updatedAt: 2 },
      ];
    },
  };
  const tool = makeSessionSearchTool({ store });
  const out = await tool.handler({ query: '없는낱말' });
  빈결과계약('session.search', out, { 찾은말: '없는낱말', 훑음: /\d+개/ });
});

// ── ④ 계약 자체가 무는가 — 일부러 깨뜨려 본다 ──────────────────────────────
test('반대시험: 훑은 양이 빠지면 계약 검사가 걸린다', () => {
  assert.throws(
    () => 빈결과계약('가짜손', {
      userSafeSummary: '"무언가"를 찾지 못했어요.',
      nextSafeAction: '다시 해볼까요?',
    }, { 찾은말: '무언가', 훑음: /\d+개/ }),
    /얼마나 훑었는지가 없다/,
    '훑은 양이 없는데도 통과한다 — 이 검사는 장식이다',
  );
});

test('반대시험: 다음 길이 없으면 계약 검사가 걸린다', () => {
  assert.throws(
    () => 빈결과계약('가짜손', {
      userSafeSummary: '"무언가"를 12개 중에서 찾지 못했어요.',
    }, { 찾은말: '무언가', 훑음: /\d+개/ }),
    /막다른 답/,
  );
});

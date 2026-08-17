// ③ B — 형식 주장 vs 실제 대조 (선등록 §7-cn · 오너 지시 · 답 레인 최고 강도 검문 경유)
//
// 실물: 순서 7 라이브 4회차 중 한 회차에서 모델이 **「작업 폴더 파일 크기를 표로 정리하면:」**
// 이라 말해 놓고 **목록**을 냈다(§7-ck-1 관측). 자기 답의 형식을 주장하고 실제와 어긋난 것이다.
// 나머지 3회차는 「정리하면/정리했어요」로 **형식 명사 주장이 0** — 정의역 밖이다.
// 그래서 이 선빨강은 **빨강 1 · 정의역 밖 3**이 정답이고, B 는 4연속 실패를 고치는 것이 아니라
// 그중 **자기모순 1건**을 고친다(이름으로 닫기 차단 · 선등록 선고정).
//
// 정의역 셋(A2 「결속-먼저」 판례 — 셋 다 서야 열린다): 형식 **명사** 주장(표/테이블/도표 ·
// 「정리」류 동사는 밖) ∧ `우리말만(reply)` 자리(F-87 — 인용 안의 말은 우리 주장이 아니다) ∧
// 표 표지 **문자** 판정(마크다운 구분행). 산문 판독 0.
//
// A3 무접촉: 술어는 `exit-verification.js`(import 0 · model 호출 0 · fallbackReplyFrom 0)에만
// 산다. `절대재검증`에 넣지 않는다 — 넣으면 커널이 형식을 이유로 답을 죽이고 A3 문장을 짓는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 완료주장검증 } from '../src/kernel/l2-plan/exit-verification.js';

const 라이브자리 = join(dirname(fileURLToPath(import.meta.url)),
  '../docs/03-verification/evidence/terminal-2026-08-17/순서7-라이브');
/** 그 회차 답 원문을 그대로 읽는다(재서술 0). */
async function 라이브답(이름) {
  return JSON.parse(await readFile(join(라이브자리, `${이름}.json`), 'utf8')).reply;
}
/** 성공한 파일 읽기 영수증 하나 — 「말로만 끝남」 갈래로 안 떨어지게 하는 전제. */
const 영수증 = [{
  intended: '목록 읽기',
  actualCall: { tool: 'local.file', args: { action: 'list', path: '작업' } },
  failureState: 'none',
  userSafeSummary: '3개를 찾았어요.',
  result: { path: '작업', items: [{ name: 'a.md', kind: 'file' }] },
}];
const 검증 = (reply) => 완료주장검증({ reply, receipts: 영수증, 원장글: '', 이미돌려줬나: false });

test('★ 선빨강 — 답이 「표로」라 말해 놓고 표가 없으면 그 사실이 모델에게 간다', async () => {
  const reply = await 라이브답('두벌시험');
  assert.match(reply, /표로 정리하면/, '전제 붕괴 — 이 회차 원문에 형식 주장이 없다(자를 잘못 골랐다)');
  assert.doesNotMatch(reply, /\|[\s:-]*-{2,}[\s:-]*\|/, '전제 붕괴 — 이 회차 답에 실제로 표가 있다');
  const r = 검증(reply);
  assert.equal(r.일치, false,
    '**답이 「표로 정리하면」이라 말하고 목록을 냈는데 커널이 그냥 통과시킨다** — '
    + '자기 답의 형식 주장과 실제가 어긋난 것을 아무도 안 본다(라이브 실물 · §7-ck-1).');
  assert.match(String(r.모델에게 ?? ''), /표/, '어긋난 사실이 모델에게 갈 문장에 안 담겼다');
});

for (const 이름 of ['기저1', '기저2', '라시험']) {
  test(`정의역 밖 — ${이름}: 형식 명사 주장이 없으면 열리지 않는다(「정리」류 동사는 밖)`, async () => {
    const reply = await 라이브답(이름);
    assert.doesNotMatch(reply, /표로|표를|테이블|도표/, `전제 붕괴 — ${이름} 에 형식 명사 주장이 있다`);
    const r = 검증(reply);
    assert.notEqual(r.모델에게 && /형식|표/.test(String(r.모델에게)), true,
      `**${이름} 이 B 로 잡혔다** — 「정리하면/정리했어요」까지 물면 정직한 답 셋이 함께 잡힌다(넓힘).`);
  });
}

test('닻(유도) — 어긋남 사실은 관측 진술이지 재수행 지시가 아니다', async () => {
  const r = 검증(await 라이브답('두벌시험'));
  const 말 = String(r.모델에게 ?? '');
  assert.ok(말.length > 0, '전제 붕괴 — 모델에게 갈 문장이 비었다');
  assert.doesNotMatch(말, /다시 (써|작성|정리)|표로 (써|바꿔)|해라|하라/,
    '사실 자리에 재수행 지시가 섞였다 — 무엇을 말할지는 모델이 정한다(강제가 아니라 유도)');
});

test('닻(인용) — 인용 안의 형식 말은 우리 주장이 아니다(F-87)', () => {
  const r = 검증('사용자가 "표로 정리해줘"라고 하셨죠. 아래처럼 정리했어요.\n\n- a.md');
  assert.notEqual(r.모델에게 && /표/.test(String(r.모델에게)), true,
    '인용 안의 「표로」를 우리 형식 주장으로 읽었다 — F-87 판례 위반');
});

test('닻(대칭) — 「목록으로」라 말해 놓고 표를 내면 같은 자로 잡힌다', () => {
  const r = 검증('목록으로 정리했어요.\n\n| 파일 | 크기 |\n|---|---|\n| a.md | 1B |');
  assert.equal(r.일치, false, '대칭 방향이 안 잡힌다 — 자가 한쪽만 본다');
});

test('닻(무발동) — 주장대로 표를 냈으면 열리지 않는다', () => {
  const r = 검증('표로 정리했어요.\n\n| 파일 | 크기 |\n|---|---|\n| a.md | 1B |');
  assert.notEqual(r.모델에게 && /형식/.test(String(r.모델에게)), true, '주장과 실제가 맞는데 잡혔다');
});

test('닻(A3 무접촉) — 이 술어는 순수 모듈에만 산다: 답 짓기·모델 호출 0', async () => {
  const 소스 = await readFile(join(dirname(fileURLToPath(import.meta.url)),
    '../src/kernel/l2-plan/exit-verification.js'), 'utf8');
  assert.doesNotMatch(소스, /fallbackReplyFrom\s*\(/, 'A3 자리(최종 문장 짓기)를 부른다 — 중단선');
  assert.doesNotMatch(소스, /await\s+ctx\.model|model\.respond/, '모델을 부른다 — 순수 술어가 아니다');
});

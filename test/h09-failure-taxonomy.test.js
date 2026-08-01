// H09 · 실패 분류 — **실패는 다섯 종류의 기계 사실이다.**
//
// 동결 판정문(H09): 같은 실패 반복 0 · 숨은 재시도 0 · 다른 손 전환 또는 정직한 다음 길 ·
// 원장과 답 일치. 인간 기준선: 정직 1/3(읽은 척 · 사용자 전가).
//
// 이 파일의 검사는 전부 **수정 전 실패를 실측**하고 만든 반대시험이다:
//   · 실패종류 export 없음(파일 전체 import 실패)
//   · ENOENT·EISDIR 실패에 nextRung 이 null — 정직한 다음 길이 없었다
//   · 도구 없음(blockedReceipt)이 "그건 지금 열지 못했어요"(일반 blocked)로 뭉개졌다
//   · 같은 실패(같은 손·같은 인자) 두 번째에도 사다리가 또 "다시 시도"를 권했다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { nextRung, rungMessage, 실패종류 } from '../src/kernel/l2-plan/recovery-ladder.js';

/** 진짜 실행 경로(ToolRunner)로 영수증을 만든다 — 손으로 빚은 모양이 아니라 원장의 실제 모양. */
async function 실패영수증(handler, args = {}) {
  const runner = new ToolRunner({ 손: { handler } });
  return runner.run('손', args, { connectedTools: [{ id: '손', executable: true }] });
}

// ── 다섯 종류가 원장 영수증의 기계 사실에서 나온다 ───────────────────────
test('파일 없음: ENOENT 가 진단면에 남고 not_found 로 분류된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-h09-'));
  const rec = await 실패영수증(async (a) => { await readFile(join(dir, a.path), 'utf8'); }, { path: '없는파일.txt' });
  assert.equal(rec.failureState, 'failed');
  assert.equal(실패종류(rec), 'not_found');
});

test('형식 미지원: 폴더를 파일로 읽으면(EISDIR) unsupported_format 이다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-h09-'));
  const rec = await 실패영수증(async () => { await readFile(dir, 'utf8'); }, { path: '.' });
  assert.equal(실패종류(rec), 'unsupported_format');
});

test('접근 거부: 권한 코드(EACCES)·범위 밖·보호 영역이 전부 access_denied 다', async () => {
  const rec = await 실패영수증(async () => {
    throw Object.assign(new Error('EACCES: permission denied, open …'), { code: 'EACCES' });
  }, { path: 'x' });
  assert.equal(실패종류(rec), 'access_denied');
  assert.equal(실패종류({ failureState: 'blocked', scopeState: 'out_of_scope' }), 'access_denied');
  assert.equal(실패종류({ failureState: 'blocked', scopeState: 'protected' }), 'access_denied');
  assert.equal(실패종류({ failureState: 'blocked', fetchState: 'login_wall' }), 'access_denied');
});

test('도구 없음: 실행 불가 게이트의 blockedReceipt(호출 0)가 tool_missing 이다', async () => {
  const runner = new ToolRunner({});
  const rec = await runner.run('없는손', {}, { connectedTools: [] });
  assert.equal(rec.actualCall, null, '호출한 척이 남았다');
  assert.equal(실패종류(rec), 'tool_missing');
});

test('실행 실패: 코드 없는 예외는 exec_failed 로, 성공은 null 로', async () => {
  const rec = await 실패영수증(async () => { throw new Error('그냥 죽음'); }, {});
  assert.equal(실패종류(rec), 'exec_failed');
  assert.equal(실패종류({ failureState: 'none' }), null);
  assert.equal(실패종류(undefined), null);
});

// ── 분류가 사다리의 정직한 다음 길로 이어진다 ────────────────────────────
test('파일 없음 + 찾는 손이 있으면 내가 다른 손으로 이어서 찾는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-h09-'));
  const rec = await 실패영수증(async (a) => { await readFile(join(dir, a.path), 'utf8'); }, { path: '보고서.md' });
  const step = nextRung([rec], ['local.locate', 'local.file']);
  assert.ok(step, '파일 없음에 다음 길이 없다(수정 전 실측: null)');
  assert.equal(step.rung, 'other_hand');
  assert.match(rungMessage(step), /다른 손으로 이어서/);
});

test('파일 없음인데 찾는 손이 없으면 사용자에게 정직하게 묻는다(없는 손 약속 금지)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-h09-'));
  const rec = await 실패영수증(async (a) => { await readFile(join(dir, a.path), 'utf8'); }, { path: '보고서.md' });
  for (const hands of [['local.file'], [], undefined]) {
    const step = nextRung([rec], hands);
    assert.equal(step?.rung, 'ask_user', `손 ${JSON.stringify(hands)}: 없는 손을 약속했다`);
    // 기본 ask_user 문구("화면 내용을 붙여 주시면")는 파일 없음과 무관하다 — 종류에 맞는 말이어야 한다.
    assert.doesNotMatch(rungMessage(step), /화면 내용을 붙여/, '파일 없음에 화면 붙여넣기를 시켰다');
  }
});

test('보호 영역 차단은 다른 경로로 찾겠다고 약속하지 않는다(비밀은 우회 대상이 아니다)', () => {
  const step = nextRung([{ failureState: 'blocked', scopeState: 'protected' }]);
  assert.ok(step, '보호 영역 차단에 다음 길이 없다(수정 전 실측: null)');
  assert.notEqual(step.rung, 'other_tool', '비밀 자리를 다른 경로로 우회하겠다고 했다');
  assert.ok(!step.useModelSearch, '비밀 자리에 모델 검색을 켰다');
  assert.match(rungMessage(step), /직접 확인/, '사람만 할 수 있는 최소 단계 안내가 없다');
});

test('도구 없음은 "그건 지금 열지 못했어요"(일반 blocked)로 뭉개지지 않는다', async () => {
  const runner = new ToolRunner({});
  const rec = await runner.run('없는손', {}, { connectedTools: [] });
  const step = nextRung([rec]);
  assert.ok(step, '도구 없음에 다음 길이 없다');
  assert.match(step.why ?? '', /도구|준비/, `도구 없음이 일반 차단으로 뭉개졌다: ${step.why}`);
});

test('형식 미지원은 재시도가 아니라 정직한 한 길을 준다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-h09-'));
  const rec = await 실패영수증(async () => { await readFile(dir, 'utf8'); }, { path: '.' });
  const step = nextRung([rec]);
  assert.ok(step, '형식 미지원에 다음 길이 없다');
  assert.notEqual(step.rung, 'retry', '같은 방법 재시도를 권했다 — 형식은 기다려도 안 바뀐다');
  assert.ok(rungMessage(step), '사용자에게 보일 한 줄이 없다');
});

// ── 같은 실패 반복 0 — 사다리 스스로 같은 계단을 두 번 권하지 않는다 ──────
test('같은 손·같은 인자의 실패가 반복되면 "다시 시도"를 또 권하지 않는다', () => {
  const 같은실패 = {
    failureState: 'failed', fetchState: 'timeout',
    actualCall: { tool: 'web.collect', args: { request: 'https://x.example/a' } },
  };
  const 첫번째 = nextRung([같은실패]);
  assert.equal(첫번째.rung, 'retry', '첫 실패의 계단이 바뀌었다(재시도는 한 번은 정당하다)');
  const 두번째 = nextRung([같은실패, { ...같은실패 }]);
  assert.notEqual(두번째?.rung, 'retry', '같은 실패 두 번째에도 또 재시도를 권했다(같은 실패 반복)');
  assert.ok(두번째, '반복 실패에 다음 길이 없다 — 막다른 답이다');
  assert.ok(rungMessage(두번째), '반복 실패의 사용자 문장이 없다');
});

test('다른 인자의 같은 종류 실패는 반복이 아니다(과잉 확전 금지)', () => {
  const a = { failureState: 'failed', fetchState: 'timeout', actualCall: { tool: 'web.collect', args: { request: 'https://x.example/a' } } };
  const b = { failureState: 'failed', fetchState: 'timeout', actualCall: { tool: 'web.collect', args: { request: 'https://x.example/b' } } };
  assert.equal(nextRung([a, b]).rung, 'retry', '다른 일인데 반복으로 확전했다');
});

// ── 기존 계약 불변 확인(회귀 방지) ───────────────────────────────────────
test('기존 계단(robots·로그인·범위 밖)은 그대로다', () => {
  assert.equal(nextRung([{ failureState: 'blocked', fetchState: 'robots_disallow' }]).rung, 'other_tool');
  assert.equal(nextRung([{ failureState: 'blocked', fetchState: 'login_wall' }]).rung, 'ask_user');
  assert.equal(nextRung([{ failureState: 'blocked', scopeState: 'out_of_scope' }], ['local.terminal']).rung, 'other_hand');
  assert.equal(nextRung([{ failureState: 'none' }]), null);
});

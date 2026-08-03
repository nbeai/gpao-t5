// Phase 0 감사 blocker B1·B2·B3 — 사용자 파일을 바꾸는 일은 **어느 입구로 와도** 승인을 받는다.
//
// 실제로 샌 세 곳:
//   B1 스킬이 `local.file` 을 밀어 넣으면 fileOp 가 없어 권한은 read 로 통과하고 실행은 delete 를 했다.
//   B2 undo 의 rename 이 그 자리에 있던 사용자 파일을 말없이 덮어썼다(휴지통에도 안 남았다).
//   B3 move·undo 가 organize 로 분류돼 승인 없이 실행됐다.
//
// 이 파일은 **목록이 아니라 불변식**을 검사한다. 위험 발화를 손으로 나열하면 다음에 또 새기 때문이다
// (게이트의 3문장 목록이 B1·B3 를 전부 통과시켰다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileKind } from '../src/kernel/l2-plan/action-plan.js';
import { decideAutoGrant } from '../src/kernel/l2-plan/authority.js';
import { parseFileRequest } from '../src/kernel/l1-intent/file-parse.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { runTurn } from '../src/kernel/turn.js';
import { makeSkillCandidate } from '../src/kernel/l5-growth/skill-learning.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';


// ── 불변식 1: 읽기·목록 외의 파일 작업은 어떤 모드에서도 자동 진행하지 않는다 ──
test('불변식: local.file 의 read/list 외 모든 action 은 자동 승인되지 않는다', () => {
  const mutating = ['write', 'move', 'delete', 'undo', 'rename', 'chmod', '(알 수 없는 새 action)'];
  for (const action of mutating) {
    const kind = fileKind({ action });
    assert.equal(decideAutoGrant({ kind }), false,
      `"${action}" 이 승인 없이 실행된다(kind=${kind})`);
  }
});

test('불변식: fileOp 가 아예 없으면 read 로 흘리지 않는다(스킬 주입 경로의 뿌리)', () => {
  for (const missing of [undefined, null, {}, { action: undefined }]) {
    const kind = fileKind(missing);
    assert.notEqual(kind, 'read', '작업을 모르는데 읽기로 취급하면 삭제가 그대로 통과한다');
    assert.equal(decideAutoGrant({ kind }), false);
  }
});

test('읽기·목록은 여전히 자연스럽게 진행된다(안전을 이유로 다 막지 않는다)', () => {
  for (const action of ['read', 'list']) {
    assert.equal(fileKind({ action }), 'read');
    assert.equal(decideAutoGrant({ kind: 'read' }), true);
  }
});

// 말로 들어오는 실제 표현이 위 불변식에 걸리는지 — 파싱이 바뀌어도 안전 쪽으로 떨어지는지 본다.
test('파일을 바꾸는 말은 파싱을 거쳐도 자동 진행으로 떨어지지 않는다', () => {
  const phrases = [
    '보고서.pdf 지워줘', 'a.md 를 b.md 로 옮겨줘', "메모.md 만들어서 '내용' 적어줘",
    '방금 거 되돌려줘', '소중한.md 이름을 x.md 로 바꿔줘', '자료.csv 삭제해줘',
  ];
  for (const p of phrases) {
    const kind = fileKind(parseFileRequest(p));
    assert.equal(decideAutoGrant({ kind }), false, `"${p}" 가 승인 없이 실행된다(kind=${kind})`);
  }
});

test('한국어 조사가 붙은 파일명도 대상 파일로 읽는다', () => {
  assert.deepEqual(parseFileRequest('정산_3월.csv를 지워줘'), {
    action: 'delete', path: '정산_3월.csv',
  });
  assert.deepEqual(parseFileRequest('보고서.pdf에서 내용을 읽어줘'), {
    action: 'read', path: '보고서.pdf',
  });
});

// ── B1: 스킬이 도구를 밀어 넣어도 삭제는 승인을 받는다 (실파일로 확인) ──
test('B1: 승격된 스킬이 local.file 을 골라도 삭제는 승인 없이 실행되지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-floor-'));
  await writeFile(join(dir, '보고서.pdf'), '사용자의 소중한 보고서');
  const skill = {
    ...makeSkillCandidate({ id: 's1', trigger: '보고서', tool: 'local.file', steps: ['정리'] }),
    state: 'admitted', userConfirmed: true, replayPassed: true,
  };
  const ctx = {
    env: demoEnv(), model: { respond: async () => '했어요' },
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    skills: [skill],
  };
  const r = await runTurn({ text: '보고서.pdf 지워줘' }, ctx);

  // 자동성 헌장(2026-08-03): 되돌릴 수 있는 삭제는 스킬이 밀었든 모델이 골랐든 자동으로 돈다.
  // **이 검사가 원래 지키던 것은 "스킬이 안전 경계를 우회하지 못한다"**이지 "삭제가 멈춘다"가
  // 아니었다(B1 의 원래 결함: 스킬 주입이 read 로 흘러 경계 자체를 건너뛰었다).
  // 헌장 아래에서 그 경계는 되돌림이다 — 스킬 경로도 **같은 휴지통**을 지나야 한다.
  assert.equal(r.kind, 'reply');
  const 남은것 = await readdir(join(dir, '.trash')).catch(() => []);
  assert.ok(남은것.some((f) => f.endsWith('보고서.pdf')),
    '스킬이 민 삭제가 휴지통을 건너뛰었다 — 사용자의 파일이 영영 사라진다');
  assert.equal(await readFile(join(dir, '.trash', 남은것.find((f) => f.endsWith('보고서.pdf'))), 'utf8'),
    '사용자의 소중한 보고서', '휴지통 사본이 원본이 아니다');
});

// ── B2: 되돌리기가 사용자 파일을 지우지 않는다 ──
test('B2: 되돌리는 자리에 새 파일이 있으면 덮어쓰지 않고 휴지통에 보관한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-undo-'));
  const tool = makeLocalFileTool({ roots: [dir], dataDir: dir });
  await writeFile(join(dir, 'a.md'), 'OLD-A');
  await tool.handler({ action: 'move', path: 'a.md', to: 'moved.md' });
  await writeFile(join(dir, 'a.md'), 'NEW-사용자가-새로-쓴-내용'); // 사용자가 같은 이름으로 새로 씀

  const out = await tool.handler({ action: 'undo' });
  assert.equal(out.result?.parked, true, '덮어쓸 파일이 있었다는 사실이 결과에 남아야 한다');
  assert.match(out.userSafeSummary, /휴지통/, '조용히 덮어쓰지 않는다 — 사용자가 알아야 한다');
  assert.equal(await readFile(join(dir, 'a.md'), 'utf8'), 'OLD-A');

  const trashed = (await readdir(join(dir, '.trash'))).filter((f) => !f.startsWith('undo-log'));
  assert.equal(trashed.length, 1, '새 내용이 휴지통에 남아 있어야 한다(영구 소실 금지)');
  assert.equal(await readFile(join(dir, '.trash', trashed[0]), 'utf8'), 'NEW-사용자가-새로-쓴-내용');
});

test('되돌릴 자리가 비어 있으면 휴지통을 만들지 않는다(불필요한 흔적 금지)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-undo2-'));
  const tool = makeLocalFileTool({ roots: [dir], dataDir: dir });
  await writeFile(join(dir, 'a.md'), 'OLD-A');
  await tool.handler({ action: 'move', path: 'a.md', to: 'moved.md' });

  const out = await tool.handler({ action: 'undo' });
  assert.equal(out.result?.parked, false);
  assert.equal(await readFile(join(dir, 'a.md'), 'utf8'), 'OLD-A');
});

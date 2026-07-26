// P6-L4 · 변경 확장 — **바꾸기는 잃기와 한 끗 차이다.**
// write 는 파일 전체를 갈아 끼운다. 한 줄 고치려고 write 를 쓰면 나머지가 사라진다.
// 여기서 잠그는 것: 조용한 실패 없음 · 조용한 덮어쓰기 없음 · 승인 전에 무엇이 바뀌는지 보임 ·
// 바꾼 것은 실제로 되돌아감.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

async function fixture(files = { 'note.md': '# 제목\n본문 첫 줄\n본문 둘째 줄\n' }) {
  const root = await mkdtemp(join(tmpdir(), 'gpao-t5-change-'));
  for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text);
  return { root, tool: makeLocalFileTool({ roots: [root], dataDir: root }) };
}

// ── 조용한 실패 금지 (이 저장소가 하루에 세 번 당한 것) ────────────────────
test('찾는 글이 없으면 바꾼 척하지 않는다', async () => {
  const { root, tool } = await fixture();
  const r = await tool.handler({ action: 'patch', path: 'note.md', find: '없는 글', replace: 'x' });
  assert.ok(r.blocked, '못 찾았는데 성공으로 돌아왔다 — replace 의 조용한 실패가 그대로 재현된다');
  assert.match(r.userSafeSummary, /아무것도 바꾸지 않았어요/);
  assert.equal(await readFile(join(root, 'note.md'), 'utf8'), '# 제목\n본문 첫 줄\n본문 둘째 줄\n');
});

test('여러 군데면 멋대로 고르지 않고 묻는다', async () => {
  const { root, tool } = await fixture({ 'a.md': '값\n값\n값\n' });
  const r = await tool.handler({ action: 'patch', path: 'a.md', find: '값', replace: '새값' });
  assert.ok(r.blocked);
  assert.match(r.userSafeSummary, /3군데/);
  assert.equal(await readFile(join(root, 'a.md'), 'utf8'), '값\n값\n값\n', '묻는 중에 이미 바꿔 놓으면 안 된다');
  const all = await tool.handler({ action: 'patch', path: 'a.md', find: '값', replace: '새값', all: true });
  assert.ok(!all.blocked);
  assert.equal(await readFile(join(root, 'a.md'), 'utf8'), '새값\n새값\n새값\n');
});

test('부분 수정은 나머지를 지키고, 되돌릴 수 있다', async () => {
  const { root, tool } = await fixture();
  await tool.handler({ action: 'patch', path: 'note.md', find: '본문 첫 줄', replace: '고친 첫 줄' });
  const after = await readFile(join(root, 'note.md'), 'utf8');
  assert.match(after, /고친 첫 줄/);
  assert.match(after, /# 제목/, 'write 처럼 전체를 갈아 끼우면 안 된다');
  assert.match(after, /본문 둘째 줄/);
  const undo = await tool.handler({ action: 'undo' });
  assert.ok(!undo.blocked, JSON.stringify(undo));
  assert.equal(await readFile(join(root, 'note.md'), 'utf8'), '# 제목\n본문 첫 줄\n본문 둘째 줄\n', '되돌린다고 해놓고 못 되돌리면 거짓말이다');
});

// ── 조용한 덮어쓰기 금지 — 세 갈래가 같은 손실 경로를 공유한다 ─────────────
test('옮기기·복사·이름 바꾸기 모두 있는 파일을 말없이 덮지 않는다', async () => {
  for (const action of ['move', 'copy', 'rename']) {
    const { root, tool } = await fixture({ 'a.md': '지켜야 할 내용', 'b.md': '덮이면 안 되는 내용' });
    const r = await tool.handler({ action, path: 'a.md', to: 'b.md' });
    assert.ok(r.blocked, `${action} 이 말없이 덮어쓴다`);
    assert.equal(await readFile(join(root, 'b.md'), 'utf8'), '덮이면 안 되는 내용');
  }
});

test('이름 바꾸기는 폴더를 옮기지 않는다(사용자가 뜻한 일이 아니다)', async () => {
  const { tool } = await fixture();
  const r = await tool.handler({ action: 'rename', path: 'note.md', to: '../밖으로.md' });
  assert.ok(r.blocked);
  assert.match(r.nextSafeAction, /옮겨줘/);
});

test('복사는 원본을 남긴다', async () => {
  const { root, tool } = await fixture();
  await tool.handler({ action: 'copy', path: 'note.md', to: '사본.md' });
  const names = await readdir(root);
  assert.ok(names.includes('note.md') && names.includes('사본.md'));
});

// ── 승인 전에 무엇이 바뀌는지 보인다 ─────────────────────────────────────
test('미리보기는 보여주기만 하고 바꾸지 않는다', async () => {
  const { root, tool } = await fixture();
  const original = await readFile(join(root, 'note.md'), 'utf8');
  for (const args of [
    { action: 'patch', path: 'note.md', find: '본문 첫 줄', replace: 'x' },
    { action: 'write', path: 'note.md', text: '전부 갈아엎기' },
    { action: 'delete', path: 'note.md' },
    { action: 'rename', path: 'note.md', to: '새이름.md' },
  ]) {
    const r = await tool.handler({ ...args, preview: true });
    assert.equal(r.result.applied, false, `${args.action} 미리보기가 실제로 실행됐다`);
    assert.equal(await readFile(join(root, 'note.md'), 'utf8'), original, `${args.action} 미리보기가 파일을 바꿨다`);
  }
});

test('덮어쓰기 미리보기는 전체가 바뀐다는 걸 말한다', async () => {
  const { tool } = await fixture();
  const r = await tool.handler({ action: 'write', path: 'note.md', text: '짧게', preview: true });
  assert.equal(r.result.preview.overwrite, true);
  assert.match(r.userSafeSummary, /전체를 바꿀 거예요/, '"저장할게요"만 보이면 사용자는 잃는 걸 모른 채 누른다');
});

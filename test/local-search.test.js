// P6-L3 · 찾기 — **사용자는 경로를 외우지 않는다.**
// "그 계약서 어디 있지"가 통하지 않으면 T5 는 다시 "경로를 알려주세요"로 떠넘긴다.
// 여기서 잠그는 것: 찾아지는가 · 어디를 뒤졌는지 말하는가 · **비밀이 이 길로 새지 않는가** ·
// 못 본 자리를 숨기지 않는가.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gpao-t5-search-'));
  await mkdir(join(root, '계약'), { recursive: true });
  await writeFile(join(root, '계약/부오상회-계약서.md'), '갑과 을은 다음과 같이 계약한다. 금액 300만원.');
  await writeFile(join(root, '메모.md'), '오늘 회의: 납품 일정 논의');
  await mkdir(join(root, 'node_modules/pkg'), { recursive: true });
  await writeFile(join(root, 'node_modules/pkg/계약서.md'), '도구가 만든 더미');
  await writeFile(join(root, '.env'), 'API_KEY=sk-진짜비밀');
  await writeFile(join(root, 'deploy.pem'), '-----BEGIN PRIVATE KEY-----');
  const tool = makeLocalFileTool({ roots: [root], dataDir: root });
  return { root, tool };
}

test('이름으로 찾는다 — 경로를 몰라도 된다', async () => {
  const { tool } = await fixture();
  const r = await tool.handler({ action: 'search', query: '계약서' });
  assert.ok(!r.blocked, JSON.stringify(r));
  assert.ok(r.result.hits.some((h) => h.path.endsWith('부오상회-계약서.md')));
  assert.ok(!r.result.hits.some((h) => h.path.includes('node_modules')), '도구가 만든 더미는 결과를 오염시킨다');
});

test('내용으로도 찾는다 — 이름을 기억 못 할 때가 더 많다', async () => {
  const { tool } = await fixture();
  const r = await tool.handler({ action: 'search', contains: '납품 일정' });
  assert.equal(r.result.hits.length, 1);
  assert.ok(r.result.hits[0].path.endsWith('메모.md'));
  assert.equal(r.result.hits[0].matched, 'text');
});

// ── 여기가 이 단계의 위험한 자리다 ────────────────────────────────────────
test('비밀은 찾기로도 안 샌다 — 이름으로도, 내용으로도', async () => {
  const { tool } = await fixture();
  const byName = await tool.handler({ action: 'search', query: 'env' });
  assert.ok(!byName.result.hits.some((h) => h.path.endsWith('.env')), '.env 가 결과에 나왔다');
  const byPem = await tool.handler({ action: 'search', query: 'pem' });
  assert.ok(!byPem.result.hits.some((h) => h.path.endsWith('.pem')), '인증서가 결과에 나왔다');
  // **내용 검색이 진짜 통로다** — 비밀 파일을 읽어 버리면 그 자체가 유출이다.
  const byText = await tool.handler({ action: 'search', contains: 'sk-진짜비밀' });
  assert.equal(byText.result.hits.length, 0, '비밀 파일 내용이 검색됐다 — 보호 영역을 찾기가 우회했다');
});

test('최근 파일을 최근 순으로 준다', async () => {
  const { root, tool } = await fixture();
  await new Promise((r) => setTimeout(r, 10));
  await writeFile(join(root, '방금.md'), '가장 최근');
  const r = await tool.handler({ action: 'recent' });
  assert.ok(r.result.hits[0].path.endsWith('방금.md'), '가장 최근 것이 맨 앞이어야 "아까 그거"가 이어진다');
});

test('무엇을 찾을지 없으면 지어내지 않고 되묻는다', async () => {
  const { tool } = await fixture();
  const r = await tool.handler({ action: 'search' });
  assert.ok(r.blocked);
  assert.ok(r.nextSafeAction);
});

// ── 못 본 자리를 숨기지 않는다 ───────────────────────────────────────────
test('어디를 뒤졌는지 결과에 남는다', async () => {
  const { root, tool } = await fixture();
  const r = await tool.handler({ action: 'search', query: '계약' });
  assert.deepEqual(r.result.searchedIn, [root], '어디를 봤는지 없으면 모델이 "없다"고 단정한다');
  assert.ok(r.result.skippedCount > 0, '안 들어간 자리가 있으면 그 사실을 남겨야 한다');
});

test('상한에 걸리면 잘랐다고 말한다(조용한 절단 금지)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gpao-t5-many-'));
  for (let i = 0; i < 60; i += 1) await writeFile(join(root, `보고서-${i}.md`), 'x');
  const tool = makeLocalFileTool({ roots: [root], dataDir: root });
  const r = await tool.handler({ action: 'search', query: '보고서' });
  assert.equal(r.result.hits.length, 40);
  assert.equal(r.result.moreHits, 20);
  assert.match(r.userSafeSummary, /더 있어요/, '사용자에게도 "이게 전부"로 들리면 안 된다');
});

// ── 모델이 읽을 모양 ─────────────────────────────────────────────────────
test('모델에게는 경로가 온전히 간다(가운데가 잘려 경로가 깨지지 않는다)', async () => {
  const { tool } = await fixture();
  const r = await tool.handler({ action: 'search', query: '계약서' });
  const view = compactResult(r.result);
  assert.match(view, /찾아본 곳:/);
  assert.match(view, /부오상회-계약서\.md/, '경로가 온전해야 다음 턴에 그 파일을 열 수 있다');
  assert.ok(!view.includes('가운데'), '경로 목록은 접지 않는다');
});

test('찾기는 읽기다 — 변경으로 분류되면 안 된다', async () => {
  // **범위 안에 있는 시스템 자리**로 봐야 진짜 검사가 된다. 범위 밖 경로로 하면
  // out_of_scope 로 먼저 막혀서 분류가 틀려도 초록이 뜬다(처음에 그렇게 썼다가 고쳤다).
  const tool = makeLocalFileTool({ roots: ['/usr/bin'], dataDir: await mkdtemp(join(tmpdir(), 'gpao-t5-sys-')) });
  const read = await tool.handler({ action: 'search', query: '없을만한이름', path: '/usr/bin' });
  assert.notEqual(read.scopeState, 'protected', '찾기가 변경으로 분류돼 시스템 읽기까지 막혔다');
  // 반대편도 같이 잠근다 — 변경은 그대로 막혀야 한다(읽기로 열었다고 쓰기까지 열리면 안 된다).
  const write = await tool.handler({ action: 'write', path: '/usr/bin/침입.md', text: 'x' });
  assert.equal(write.scopeState, 'protected', '시스템 변경이 열렸다');
});

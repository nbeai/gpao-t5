// P6-L2 · 폴더를 여는 길 — **떠넘김이 여기서 죽는다.**
//
// 실측(2026-07-27): "디벨로퍼 폴더 봐줘"에 T5 가 "터미널에서 `ls` 결과를 붙여 주세요"라고 답했다.
// 헌장에 "명령어 말고 사람 말로"를 넣어도 그대로였다 — 재 보니 **모델이 옳았다.**
// 폴더를 넓히는 길이 아예 없었으니(환경변수뿐), 실제로 되는 유일한 방법을 제안한 것이다.
//
// **지킬 수 없는 규칙은 모델을 무시하게 만든다.** 그래서 규칙이 아니라 길을 만들었다.
// 이 파일이 검사하는 것: 길이 실제로 있는가 · 사용자 결정을 거치는가 · 보호는 그대로인가.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { LocalRootsStore, wellKnownFor } from '../src/surface/local-roots-store.js';
import { makeLocalScopeTool } from '../src/runtime/local-scope-tool.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { demoDescriptors, demoEnv } from '../src/surface/demo-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';
import { classifyTier, isSafetyFloor } from '../src/kernel/l2-plan/authority.js';

const store = async () => new LocalRootsStore(await mkdtemp(join(tmpdir(), 'gpao-t5-roots-')));

// ── 이름으로 알아듣는다(경로를 외우게 하지 않는다) ────────────────────────
test('사용자가 부르는 이름으로 폴더를 찾는다', () => {
  assert.equal(wellKnownFor('데스크탑 좀 봐줘')?.key, 'desktop');
  assert.equal(wellKnownFor('바탕화면에 뭐 있어')?.key, 'desktop');
  assert.equal(wellKnownFor('다운로드 정리해줘')?.key, 'downloads');
  assert.equal(wellKnownFor('내 문서 폴더')?.key, 'documents');
  assert.equal(wellKnownFor('오늘 날씨'), undefined, '아무 말에나 폴더를 갖다 붙이지 않는다');
});

// ── 열면 **바로** 쓸 수 있어야 한다 ─────────────────────────────────────
test('관통: 폴더를 열면 그 즉시 그 안을 볼 수 있다', async () => {
  const s = await store();
  const target = await mkdtemp(join(tmpdir(), 'gpao-t5-target-'));
  await writeFile(join(target, '메모.md'), '안녕');

  const file = makeLocalFileTool({ dataDir: s.dir, rootsProvider: () => s.roots() });
  const before = await file.handler({ action: 'list', path: target });
  assert.ok(before.blocked, '열기 전에는 범위 밖이다');

  const scope = makeLocalScopeTool({ store: s });
  const opened = await scope.handler({ action: 'open', path: target });
  assert.match(opened.userSafeSummary, /열었어요/);

  const after = await file.handler({ action: 'list', path: target });
  assert.ok(!after.blocked, `열자마자 못 보면 "열었다"가 거짓이다: ${JSON.stringify(after)}`);
  assert.ok(after.result.items.some((i) => i.name === '메모.md'));
});

test('닫으면 다시 안 보인다(되돌릴 수 있다고 말하려면 경로가 있어야 한다)', async () => {
  const s = await store();
  const target = await mkdtemp(join(tmpdir(), 'gpao-t5-target2-'));
  const scope = makeLocalScopeTool({ store: s });
  const file = makeLocalFileTool({ dataDir: s.dir, rootsProvider: () => s.roots() });
  await scope.handler({ action: 'open', path: target });
  assert.ok(!(await file.handler({ action: 'list', path: target })).blocked);
  await scope.handler({ action: 'close', path: target });
  assert.ok((await file.handler({ action: 'list', path: target })).blocked, '닫았는데 보이면 안 된다');
});

// ── 사용자의 결정이다 ───────────────────────────────────────────────────
test('폴더 열기는 **승인을 받는다** — 모델이 혼자 넓히지 못한다', () => {
  const self = buildSelfState(demoEnv({ factOverrides: { 'local.scope': { connected: true } } }));
  const kind = toolActionKind({ toolId: 'local.scope', selfState: self });
  assert.equal(classifyTier({ kind }), 'A3', '권한을 여는 일은 강한 승인을 탄다');
  assert.equal(isSafetyFloor(kind), true, '안전 바닥이면 어느 모드에서도 자동 진행 안 된다');
});

test('열어 달라고 해도 열쇠가 있는 자리는 안 연다', async () => {
  const scope = makeLocalScopeTool({ store: await store() });
  const r = await scope.handler({ action: 'open', path: join(homedir(), '.ssh') });
  assert.ok(r.blocked);
  assert.match(r.userSafeSummary, /열지 않아요/);
  assert.ok(r.nextSafeAction, '막다른 답 금지');
});

test('없는 폴더를 열었다고 하지 않는다', async () => {
  const r = await makeLocalScopeTool({ store: await store() }).handler({ action: 'open', path: '/없는/폴더/여기' });
  assert.ok(r.blocked);
  assert.match(r.userSafeSummary, /찾지 못했어요/);
});

// ── 길이 실제로 존재하는가 (오너가 지정한 "검사 가능한 게이트") ───────────
test('폴더를 여는 길이 도구로 존재하고 모델에게 보인다', () => {
  const d = demoDescriptors().find((x) => x.id === 'local.scope');
  assert.ok(d, '길이 없으면 모델은 터미널을 제안할 수밖에 없다(실측)');
  assert.ok(d.schema?.description?.includes('터미널'), '스키마가 "터미널 대신 이걸 쓰라"고 말해야 한다');
  assert.equal(d.needsApproval, true);
  assert.equal(d.reversible, true, '되돌릴 수 있다고 말하려면 close 가 있어야 한다');
});

test('기본 작업 폴더는 열지 않아도 그대로 쓸 수 있다(처음부터 막혀 있지 않다)', async () => {
  const s = await store();
  const roots = await s.roots();
  assert.ok(roots.some((r) => r.endsWith('GPAO-T5')), '기본 폴더가 사라지면 기존 사용자가 깨진다');
});

// ── 턴 관통: 모델이 "폴더를 열겠다"고 골라도 사용자 승인에서 멈춘다 ────────
// 이게 이 단계의 안전 축이다. 폴더를 넓히는 길을 만들었으니, 그 길이 **모델 혼자 걸을 수 있는
// 길이 되면** 1단계의 보호 영역 전체가 무의미해진다. 등급 표만 보지 않고 실제 턴으로 확인한다.
test('관통: 모델이 폴더 열기를 골라도 승인 대기에서 멈춘다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { demoEnv: env, demoTools: tools } = await import('../src/surface/demo-context.js');
  const s = new LocalRootsStore(await mkdtemp(join(tmpdir(), 'gpao-t5-turn-roots-')));
  const target = await mkdtemp(join(tmpdir(), 'gpao-t5-turn-target-'));

  let used = false;
  const model = {
    async respond(_tc, opts = {}) {
      if (!used && opts.tools?.length) {
        used = true;
        return { text: '', toolCalls: [{ name: 'local.scope', args: { action: 'open', path: target } }] };
      }
      return opts.tools?.length ? { text: '했어요', toolCalls: [] } : '했어요';
    },
  };
  const r = await runTurn({ text: '그 폴더 봐줘' }, {
    env: env(), model, tools: tools({ localScope: makeLocalScopeTool({ store: s }) }),
  });

  assert.equal(r.kind, 'approval', `승인 없이 진행됐다(${r.kind})`);
  // **말만 승인이 아니라 실제로 안 열렸어야 한다.**
  assert.deepEqual(await s.opened(), [], '승인 전에 폴더가 이미 열렸다');
  const file = makeLocalFileTool({ dataDir: s.dir, rootsProvider: () => s.roots() });
  assert.ok((await file.handler({ action: 'list', path: target })).blocked, '승인 전인데 그 폴더가 보인다');
});

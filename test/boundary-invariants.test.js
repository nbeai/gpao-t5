// P2-5c · 경계 불변식 — **누가 골랐든 같은 답이어야 한다.**
//
// 왜 이 파일이 필요한가: 도구 선택이 정규식에서 모델로 넘어갔다(P2-5b). 그러면 "이 문장 → 이 도구"를
// 고정하던 테스트는 의미가 옅어진다. 대신 지켜야 할 것은 이것이다 —
//   **모델이 무엇을 고르든, 정규식이 무엇을 고르든, 경계는 똑같이 선다.**
// 감사관이 요구한 방향이기도 하다("목록이 아니라 불변식을 검사하라").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { toolActionKind, buildActionPlan } from '../src/kernel/l2-plan/action-plan.js';
import { decideAutoGrant, isSafetyFloor } from '../src/kernel/l2-plan/authority.js';
import { callsToIntentParts, TOOL_SCHEMAS } from '../src/kernel/l2-plan/tool-schema.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const selfState = buildSelfState(demoEnv());
const FILE_ACTIONS = TOOL_SCHEMAS['local.file'].parameters.properties.action.enum;

// 모델이 고른 것을 흉내내는 클라이언트. 실제 모델 대신 지정한 호출을 한 번 돌려준다.
const chooseOnce = (calls) => {
  let used = false;
  return {
    async respond(_tc, opts = {}) {
      if (!used && opts.tools?.length) { used = true; return { text: '', toolCalls: calls }; }
      return opts.tools?.length ? { text: '했어요', toolCalls: [] } : '했어요';
    },
  };
};

async function fileCtx(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-bound-'));
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
  return {
    dir,
    make: (calls) => ({
      env: demoEnv(),
      model: chooseOnce(calls),
      tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    }),
  };
}

// ── 1. 같은 작업이면 같은 등급이다(누가 골랐든) ──────────────────────────
test('불변식: 파일 작업의 권한 등급은 선택자와 무관하다', () => {
  for (const action of FILE_ACTIONS) {
    const viaModel = callsToIntentParts([{ name: 'local.file', args: { action, path: 'x.md' } }]).fileOp;
    const kindModel = toolActionKind({ toolId: 'local.file', args: viaModel, selfState });
    const kindRegex = toolActionKind({ toolId: 'local.file', args: { action, path: 'x.md' }, selfState });
    assert.equal(kindModel, kindRegex, `${action}: 경로에 따라 등급이 달라지면 안 된다`);
  }
});

test('불변식: 읽기·목록 외의 모든 파일 작업은 승인을 받는다', () => {
  for (const action of FILE_ACTIONS) {
    const kind = toolActionKind({ toolId: 'local.file', args: { action }, selfState });
    const auto = decideAutoGrant({ kind }, 'smart');
    if (action === 'read' || action === 'list') assert.equal(auto, true, `${action} 은 자연스럽게 진행돼야 한다`);
    else assert.equal(auto, false, `${action} 이 승인 없이 실행된다`);
  }
});

test('불변식: 전송 도구는 어떤 인자로도 안전 바닥이다', () => {
  for (const id of ['slack.post', 'telegram.send']) {
    const kind = toolActionKind({ toolId: id, args: { text: '아무거나' }, selfState });
    assert.equal(isSafetyFloor(kind), true, `${id} 가 안전 바닥에서 빠졌다`);
  }
});

// ── 2. 모델이 고른 위험 작업도 실행되지 않는다 ───────────────────────────
test('불변식: 모델이 고른 삭제·이동·되돌리기는 전부 승인 대기로 멈춘다', async () => {
  for (const action of ['delete', 'move', 'undo', 'write']) {
    const { dir, make } = await fileCtx({ '대상.md': '내용' });
    const args = { action, path: '대상.md', to: '옮긴.md', text: '새 내용' };
    const r = await runTurn({ text: '해줘' }, make([{ name: 'local.file', args }]));
    assert.equal(r.kind, 'approval', `${action}: 승인 없이 진행됐다(${r.kind})`);
    assert.deepEqual(r.ledger?.confirmed ?? [], [], `${action}: 승인 전에 실행 사실이 남았다`);
    await stat(join(dir, '대상.md')); // 원본은 그대로여야 한다
  }
});

// ── 3. 범위(scope)는 모델도 못 넘는다 ────────────────────────────────────
test('불변식: 모델이 작업 폴더 밖을 가리켜도 나가지 않는다', async () => {
  const { dir, make } = await fileCtx({ '안전.md': '내용' });
  const r = await runTurn({ text: '읽어줘' }, make([
    { name: 'local.file', args: { action: 'read', path: '../../../etc/passwd' } },
  ]));
  // 읽기는 자동 진행이라 실제로 실행까지 간다 — 그래서 **범위가 막는지**가 여기서 증명된다.
  const said = JSON.stringify(r.ledger ?? {});
  assert.ok(!said.includes('root:'), '범위 밖 파일 내용이 새어 나왔다');
  assert.match(said, /폴더 밖|찾지 못했|문제가 있었/, `막혔다는 사실이 남아야 한다: ${said}`);
  await stat(join(dir, '안전.md'));
});

// ── 4. 실행하지 않은 것을 했다고 하지 않는다 ─────────────────────────────
test('불변식: 승인 대기 상태에서는 원장에 실행 사실이 없다', async () => {
  const { make } = await fileCtx({ 'a.md': '내용' });
  const r = await runTurn({ text: '지워줘' }, make([{ name: 'local.file', args: { action: 'delete', path: 'a.md' } }]));
  assert.equal(r.kind, 'approval');
  assert.equal((r.ledger?.confirmed ?? []).length, 0);
  assert.equal((r.ledger?.unconfirmed ?? []).length + (r.ledger?.estimated ?? []).length >= 0, true);
});

test('불변식: 실행된 것은 반드시 원장에 남는다(조용한 실행 금지)', async () => {
  const { make } = await fileCtx({ 'a.md': '내용', 'b.md': '내용' });
  const r = await runTurn({ text: '봐줘' }, make([{ name: 'local.file', args: { action: 'list', path: '.' } }]));
  assert.equal(r.kind, 'reply');
  assert.ok((r.ledger?.confirmed ?? []).length > 0, '실행하고 기록을 안 남기면 나중에 무엇을 했는지 모른다');
});

// ── 5. 모르는 것은 실행하지 않는다 ───────────────────────────────────────
test('불변식: 등록되지 않은 도구 이름은 실행되지 않는다', async () => {
  const { make } = await fileCtx();
  const r = await runTurn({ text: '해줘' }, make([{ name: 'shell.exec', args: { cmd: 'rm -rf /' } }]));
  assert.ok(r.kind !== 'approval' || !JSON.stringify(r).includes('shell.exec'), '모르는 도구가 계획에 올랐다');
  assert.deepEqual(r.ledger?.confirmed ?? [], []);
});

test('불변식: 작업을 모르면 승인 쪽으로 떨어진다(모르면 안전하게)', () => {
  const kind = toolActionKind({ toolId: 'local.file', args: undefined, selfState });
  assert.equal(decideAutoGrant({ kind }, 'smart'), false);
  const plan = buildActionPlan({ intent: { neededTools: ['local.file'] }, selfState });
  assert.ok(plan.needsApproval.some((g) => g.action === 'local.file'));
});

// ── 6. 휴지통 계약: 지운 것은 되살릴 수 있다 ─────────────────────────────
test('불변식: 승인 뒤 삭제해도 되살릴 수 있는 상태로 남는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-bound2-'));
  await writeFile(join(dir, 'x.md'), '지워질 내용');
  const tool = makeLocalFileTool({ roots: [dir], dataDir: dir });
  await tool.handler({ action: 'delete', path: 'x.md' });
  const trash = (await readdir(join(dir, '.trash'))).filter((f) => !f.startsWith('undo-log'));
  assert.equal(trash.length, 1, '지운 것이 휴지통에 없으면 "되돌릴 수 있어요"는 거짓말이다');
});

// ── 7. 빈 답은 절대 내보내지 않는다 ──────────────────────────────────────
// 오너 실사용(2026-07-27): 네이버 지도 분석 요청에서 **빈 응답이 네 번 연속** 나갔다.
// 모델이 도구를 고름 → 실행 → robots 로 막힘 → 최종 호출에서 모델이 **또 도구를 고르며**
// 텍스트를 비워 보냈고, 우리는 그걸 그대로 사용자에게 내보냈다. 사용자는 먹통으로 겪는다.
test('불변식: 도구가 막혀도 빈 답을 내보내지 않는다', async () => {
  const blockedWeb = {
    sourceLedgerRequired: true,
    async handler() {
      return { blocked: true, fetchState: 'robots_disallow', userSafeSummary: '그 사이트가 수집을 허용하지 않아요.', nextSafeAction: '아는 범위로 답할까요?' };
    },
  };
  // 최종 호출에서도 계속 도구만 고르는 모델(실제로 그랬다).
  const alwaysTools = {
    async respond(_tc, opts = {}) {
      if (opts.tools?.length) return { text: '', toolCalls: [{ name: 'web.collect', args: { request: 'https://x.example' } }] };
      return ''; // 도구를 빼고 물어도 비었다 — 최악의 경우
    },
  };
  const r = await runTurn({ text: 'https://x.example 분석해줘' }, {
    env: demoEnv(), model: alwaysTools, tools: demoTools({ webCollector: blockedWeb }),
  });
  assert.equal(r.kind, 'reply');
  assert.ok((r.reply ?? '').trim().length > 0, '빈 답이 나갔다 — 사용자는 먹통으로 겪는다');
  assert.match(r.reply, /수집을 허용하지 않아요/, '무엇이 막혔는지 사실대로 말한다');
  assert.match(r.reply, /답할까요|주소/, '다음에 할 수 있는 것을 준다(막다른 답 금지)');
});

test('불변식: 모델이 문장을 못 만들어도 무슨 일이 있었는지는 말한다', async () => {
  const silent = { async respond() { return ''; } };
  const r = await runTurn({ text: '작업 폴더 목록 정리해줘' }, {
    env: demoEnv(), model: silent, tools: demoTools(),
  });
  assert.ok((r.reply ?? '').trim().length > 0);
});

// 재감사 blocker D1·D2 — 승인 게이트가 **다른 층에서** 새던 자리.
//
// D1: 턴은 삭제를 승인 카드로 막았는데, 같은 삭제가 자동화 후보로 저장돼 tick 이 무인 실행했다.
//     원인은 승인 여부를 **도구 단위 플래그**로 판정한 것 — 0-1 에서 고친 실패가 한 층 위에서 재현됐다.
// D2: 라이브에 손이 없는 도구를 말귀가 계속 라우팅해 "연결이 필요해요 / [연결 화면 열기]" 라는
//     죽은 버튼이 떴다. 연결할 대상이 존재하지 않으므로 거짓 안내다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tickAutomation } from '../src/runtime/automation-engine.js';
import { approveAutomation } from '../src/kernel/l5-growth/automation.js';
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';
import { isSafetyFloor } from '../src/kernel/l2-plan/authority.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { toolSchemasFor } from '../src/kernel/l2-plan/tool-schema.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { liveDeps } from '../src/surface/live-context.js';

const selfState = () => buildSelfState(demoEnv());

// ── D1: 사람 없는 실행은 되돌릴 수 없는 일을 하지 않는다 ────────────────
test('D1: 승인된 자동화라도 tick 이 파일을 지우지 않는다(확인해 줄 사람이 없다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-auto-'));
  await writeFile(join(dir, '메모.md'), '지워지면 안 되는 내용');
  const tools = demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) });
  const job = approveAutomation(
    { action: { tool: 'local.file', args: { action: 'delete', path: '메모.md' } }, statement: '매주 메모.md 지워줘' },
    { id: 'j1', now: 0, nextRunAt: 0 },
  );

  const ran = await tickAutomation([job], { tools, selfState: selfState(), now: 1 });

  await stat(join(dir, '메모.md')); // 없으면 throw — 파일은 살아 있어야 한다
  assert.equal(ran.length, 0, '무인 삭제는 실행 자체가 없어야 한다');
  const last = job.executions.at(-1);
  assert.equal(last.failureState, 'blocked');
  assert.match(last.userSafeSummary, /자동으로는 하지 않았어요/);
  assert.ok(last.nextSafeAction, '막다른 답 금지 — 지금 할 수 있는 길을 준다');
  assert.equal(job.state, 'paused', '조용히 사라지지 않는다(다시 켜거나 취소할 수 있어야 한다)');
});

test('되돌릴 수 있는 자동화는 그대로 돈다(안전을 이유로 자동화를 다 막지 않는다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-auto2-'));
  const tools = demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) });
  const job = approveAutomation(
    { action: { tool: 'local.file', args: { action: 'list', path: '.' } }, statement: '매주 파일 목록 정리해줘' },
    { id: 'j2', now: 0, nextRunAt: 0 },
  );
  const ran = await tickAutomation([job], { tools, selfState: selfState(), now: 1 });
  assert.equal(ran.length, 1);
  assert.equal(ran[0].receipt.failureState, 'none');
});

// 불변식: 승인·자동화·tick 이 **같은 함수**로 행동 종류를 판정한다(층마다 다른 답 금지).
test('불변식: 행동 종류 판정이 도구가 아니라 작업으로 나온다', () => {
  const s = selfState();
  assert.equal(toolActionKind({ toolId: 'local.file', args: { action: 'delete' }, selfState: s }), 'delete');
  assert.equal(toolActionKind({ toolId: 'local.file', args: { action: 'list' }, selfState: s }), 'read');
  assert.equal(toolActionKind({ toolId: 'local.file', args: undefined, selfState: s }), 'unknown_kind');
  assert.equal(toolActionKind({ toolId: 'slack.post', selfState: s }), 'send');
  // 만료 강제(external) 판정이 여기서 나온다 — 도구 플래그로 보면 파일 삭제가 무기한으로 통과했다.
  assert.equal(isSafetyFloor(toolActionKind({ toolId: 'local.file', args: { action: 'delete' }, selfState: s })), true);
  assert.equal(isSafetyFloor(toolActionKind({ toolId: 'local.file', args: { action: 'list' }, selfState: s })), false);
});

// ── D2: 연결 전 서비스는 **안내하되 실행 가능으로 노출하지 않는다** (P5-B-0) ──
// 예전 이 검사는 "mail.send 를 후보로 올리지 마라"였다. 그때는 메일 커넥터 선언이 아예 없어서
// 연결할 대상이 없었기 때문이다 — 연결을 권하면 죽은 버튼이 됐다.
//
// P5-B-0 에서 `mail` 커넥터를 선언했으므로 이제 **연결할 대상이 있다.** 바로 아래 형제 검사가
// 말하는 원칙 그대로다: "연결이 안 된 것과 아예 없는 것은 다르다."
// 그래서 잡아야 할 것이 바뀐다 — 안내는 하되, **실행 가능으로는 절대 새지 않아야 한다.**
test('D2: 연결 전 서비스는 안내는 하되 모델에게 실행 도구로 보이지 않는다', () => {
  const live = liveDeps({});
  const s = buildSelfState(live.env, { tools: live.tools });
  const i = interpret('김대리에게 메일로 보고서 보내줘', { selfState: s });
  // 안내는 된다 — 사용자가 "메일 계정을 연결하면 가능해요"를 들을 수 있어야 한다.
  assert.ok((i.neededTools ?? []).includes('mail.send'), '연결 대상이 있는데 숨기면 사용자가 길을 모른다');
  // 그러나 실행 가능은 아니다 — 여기가 새면 모델이 "보냈다"고 약속한다.
  assert.equal(s.connectedTools.find((t) => t.id === 'mail.send')?.executable, false);
  assert.ok(!toolSchemasFor(s).some((t) => t.name === 'mail.send'), '모델 schema 에 새면 안 된다');
});

test('연결이 안 된 것과 아예 없는 것은 다르다 — 있는 도구는 계속 안내한다', () => {
  const live = buildSelfState(liveDeps({}).env); // 슬랙 토큰 없음 = 선언은 있고 연결만 없음
  const i = interpret('슬랙에 회의 시작이라고 올려줘', { selfState: live });
  assert.ok((i.neededTools ?? []).includes('slack.post'), '연결만 없는 도구는 안내해야 한다(숨기면 안 된다)');
});

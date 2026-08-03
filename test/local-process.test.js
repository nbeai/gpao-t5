// P6-T3 · 장기 프로세스 — **켠 것을 기억하고, 진짜 살아있는지 보고, 말하면 끈다.**
//
// 이 표면의 계약 한 줄: **죽은 프로세스를 살아있다고 말하지 않는다.**
// 기록에 'running' 이 남은 것과 실제로 도는 것은 다른 사실이다. 그걸 섞으면
// 사용자는 켜진 줄 알고 기다리고, 모델은 없는 서버 위에서 다음 일을 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalProcessTool, alive } from '../src/runtime/local-process.js';
import { ProcessStore } from '../src/runtime/process-store.js';
import { lifecycleRisk } from '../src/runtime/lifecycle-guard.js';

const 오래도는것 = 'node -e "setInterval(()=>console.log(\'살아있음 \'+Date.now()),200)"';
const 금방죽는것 = 'node -e "console.error(\'포트가 이미 쓰이는 중\'); process.exit(1)"';

async function 도구() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-proc-'));
  return { dir, store: new ProcessStore(dir), tool: makeLocalProcessTool({ store: new ProcessStore(dir), dataDir: dir, cwd: dir }) };
}
const 끝내기 = async (tool) => { for (const p of (await tool.handler({ action: 'status' })).result.procs ?? []) await tool.handler({ action: 'stop', target: p.id }); };

test('① 켠다 — ② 상태를 본다 — ③ 로그를 읽는다 — ④ 끈다', async () => {
  const { tool } = await 도구();
  try {
    const s = await tool.handler({ action: 'start', command: 오래도는것, label: '개발 서버', settleMs: 200 });
    assert.ok(!s.blocked, `못 켰다: ${JSON.stringify(s)}`);
    assert.equal(s.result.status, 'running');
    assert.ok(s.result.pid > 0);

    const st = await tool.handler({ action: 'status' });
    assert.match(st.userSafeSummary, /개발 서버/, '사용자가 부른 이름으로 돌려줘야 "그거 꺼줘"가 된다');
    assert.equal(st.result.procs[0].status, 'running');

    await new Promise((r) => setTimeout(r, 350));
    const lg = await tool.handler({ action: 'logs', target: '개발 서버' });
    assert.match(lg.result.logTail, /살아있음/, '로그를 못 읽으면 "왜 안 켜지는지" 답을 못 한다');

    const sp = await tool.handler({ action: 'stop', target: '개발 서버' });
    assert.ok(!sp.blocked, JSON.stringify(sp));
    assert.equal(alive(s.result.pid), false, '껐다고 했는데 실제로는 살아있다');
  } finally { await 끝내기(tool); }
});

// ── 이 표면의 핵심 계약 ──────────────────────────────────────────────────
test('⑤ 시작하자마자 죽으면 "켰어요"라고 하지 않는다', async () => {
  const { tool } = await 도구();
  const r = await tool.handler({ action: 'start', command: 금방죽는것, label: '안 켜지는 것', settleMs: 800 });
  assert.ok(r.blocked, '죽은 걸 켰다고 답했다 — 사용자는 켜진 줄 알고 기다린다');
  assert.match(r.userSafeSummary, /켜진 게 아니에요/);
  assert.match(r.result.logTail, /포트가 이미 쓰이는 중/, '왜 죽었는지를 같이 줘야 다음 조치를 말할 수 있다');
});

test('⑤ 밖에서 죽은 프로세스를 살아있다고 하지 않는다', async () => {
  const { tool } = await 도구();
  const s = await tool.handler({ action: 'start', command: 오래도는것, label: '곧 죽을 것', settleMs: 200 });
  // T5 가 모르는 사이 밖에서 죽는다(사용자가 터미널에서 껐거나, 크래시했거나).
  process.kill(s.result.pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 150));

  const st = await tool.handler({ action: 'status' });
  assert.equal(st.result.procs[0].status, 'exited', '기록만 보고 running 이라고 답했다');
  assert.match(st.userSafeSummary, /도는 건 없어요/);
});

test('⑤ 이미 꺼진 걸 껐다고 하지 않는다', async () => {
  const { tool } = await 도구();
  const s = await tool.handler({ action: 'start', command: 오래도는것, label: 'x', settleMs: 200 });
  process.kill(s.result.pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 150));
  const r = await tool.handler({ action: 'stop', target: 'x' });
  assert.equal(r.result.alreadyStopped, true, '이미 죽은 걸 "제가 껐어요"라고 하면 거짓이다');
});

test('기록은 파일에 남는다 — T5 를 껐다 켜도 자기가 켠 걸 기억한다', async () => {
  const { dir, tool } = await 도구();
  try {
    await tool.handler({ action: 'start', command: 오래도는것, label: '재시작 뒤에도', settleMs: 200 });
    // 새 도구 인스턴스 = T5 재시작. 메모리에만 뒀으면 여기서 잊는다(주인 없는 프로세스가 남는다).
    const 다시 = makeLocalProcessTool({ store: new ProcessStore(dir), dataDir: dir });
    const st = await 다시.handler({ action: 'status' });
    assert.match(st.userSafeSummary, /재시작 뒤에도/);
    await 끝내기(다시);
  } finally { await 끝내기(tool); }
});

test('없는 걸 찾으면 지어내지 않고 다음 길을 준다', async () => {
  const { tool } = await 도구();
  const r = await tool.handler({ action: 'stop', target: '없는서버' });
  assert.ok(r.blocked);
  assert.ok(r.nextSafeAction, '막다른 답 금지');
});

// ── ⑥ 자기보존 ─────────────────────────────────────────────────────────
test('⑥ T5 자기 자신은 끄지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-self-'));
  const store = new ProcessStore(dir);
  // 자기 PID 가 기록에 들어간 상황을 만든다(어떤 경로로든 들어올 수 있다).
  await store.add({ id: '자기', command: 'node src/surface/server.js', pid: process.pid, label: '나 자신', status: 'running' });
  const tool = makeLocalProcessTool({ store, dataDir: dir });
  const r = await tool.handler({ action: 'stop', target: '자기' });
  assert.equal(r.lifecycleBlocked, true, 'T5 가 자기를 껐다 — 껐다는 말을 할 주체가 사라진다');
  assert.equal(alive(process.pid), true);
});

test('⑥ 자기 기억을 지우거나 자동 실행을 거는 명령은 직접 하지 않는다', () => {
  const D = '/Users/누구/.local/state/gpao-t5';
  for (const cmd of [`kill ${process.pid}`, 'pkill -f gpao-t5', `rm -rf ${D}`, `rm -rf ${D}/sessions`, 'launchctl load ~/Library/LaunchAgents/x.plist']) {
    assert.ok(lifecycleRisk(cmd, { dataDir: D }), `자기보존 경계를 통과했다: ${cmd}`);
  }
  // **기대값이 바뀐 자리.** 예전엔 `kill 999999`(남의 프로세스)를 자유 통과로 뒀다 —
  // 일반 승인 경로가 잡을 거라고 봤기 때문이다. 라이브가 그 전제를 깼다(2026-07-28):
  // 모델이 `kill 4356 2>/dev/null || true` 를 썼고, 그 관용구가 **막혔다는 증거를 지워서**
  // exitCode 0 → changes:false → 승인 없음 → granted 없음 → 다시 probe → 또 막힘의 고리가 됐다.
  // 사용자는 승인을 눌러도 아무 일이 안 일어났다. 그 앞 회차에는 승인 없이 죽기까지 했다.
  // 끄는 일은 되돌릴 수 없으므로 승인 경계가 맞다 — 승인 뒤에는 granted 로 실제 실행된다.
  assert.ok(lifecycleRisk('kill 999999', { dataDir: D }), '남의 프로세스를 끄는데 승인 경계가 없다');
  assert.ok(!lifecycleRisk('kill 999999', { dataDir: D, managed: 999999 }),
    'T5 가 켠 것을 끄는 데까지 승인을 다시 받으면 그게 능력 축소다');

  // 막기만 하면 도구가 아니다 — 남의 폴더·평범한 명령은 그대로 다룬다.
  for (const cmd of [
    'rm -rf /tmp/남의것', 'ls -la', 'npm test',
    'ls ~/Library/LaunchAgents /Library/LaunchDaemons',
    'launchctl list',
  ]) {
    assert.ok(!lifecycleRisk(cmd, { dataDir: D }), `평범한 명령이 자기보존에 걸렸다: ${cmd}`);
  }
});

// ── 켜는 것도 자동이다 ─────────────────────────────────────────────────
// (역사) 예전 계약은 "켜기는 승인"이었다. 근거는 라이브 실측 — "9913 포트로 서버 띄워봐"에
// 승인 없이 떴고, 포트를 잡고 턴을 넘어 사는 일이 사용자 모르게 일어나면 안 된다고 봤다.
// 자동성 헌장(2026-08-03) + 오너 결정: **서버 켜기도 자동이다.** 헌장 넷에 "포트 점유"나
// "턴을 넘어 사는 프로세스"가 없고, 켜는 것은 되돌릴 수 있다(끄면 된다 — 도구가 `reversible:true`
// 와 함께 "꺼줘라고 하시면 바로 꺼요"를 선언한다). 대신 **켰다는 사실이 사용자에게 남아야 한다** —
// 헌장이 승인 카드를 걷은 자리를 메우는 것은 원장과 되돌리기다.
test('켜기·보기·로그·끄기는 자동으로 돌고, 모르는 작업만 승인으로 간다', async () => {
  const { toolActionKind } = await import('../src/kernel/l2-plan/action-plan.js');
  const { decideAutoGrant } = await import('../src/kernel/l2-plan/authority.js');
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { demoEnv } = await import('../src/surface/demo-context.js');
  const self = buildSelfState(demoEnv());
  const 손 = self.connectedTools.find((t) => t.id === 'local.process');
  const 자동 = (action) => decideAutoGrant({
    kind: toolActionKind({ toolId: 'local.process', args: { action }, selfState: self }),
    revocable: 손?.reversible,
  });

  assert.equal(손?.reversible, true, '켜기가 자동으로 도는 근거는 이 선언 하나뿐이다("꺼줘"로 되돌린다)');
  assert.equal(자동('start'), true, '켜 달라고 말한 것을 또 묻지 않는다');
  assert.equal(자동('status'), true, '확인마다 승인을 물으면 승인을 기계적으로 누르게 된다');
  assert.equal(자동('logs'), true, '"왜 안 켜지지"를 물을 때마다 승인 카드가 뜨면 안 된다');
  assert.equal(자동('stop'), true, '"꺼줘"라고 말한 것을 또 물으면 안 된다');
  assert.equal(자동('처음보는작업'), false, '모르는 작업은 승인으로 간다');
});

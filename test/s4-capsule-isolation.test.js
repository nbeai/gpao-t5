// **S4 캡슐 격리 — 여섯 성질을 반대시험으로 증명한다.**
//
// 정본 §S4: *"어느 수단이든 아래 격리 성질을 **반대시험으로 증명**해야 한다."*
// 통과를 재지 않는다. **탈출 시도가 막히는 것**을 잰다.
//
// ── 왜 이렇게 좁은가 ───────────────────────────────────────────────────────
// 비교군 실측(2026-08-04): Hermes `execute_code` 는 자식 프로세스 + RPC 뿐이고 OS 커널
// 격리가 없다(`sandbox-exec`·`bwrap`·`nsjail`·`setrlimit` 전수 grep 0). 게다가 허용 도구에
// **`terminal` 이 들어 있다** — 스크립트가 셸을 부를 수 있으므로 스크립트 안에서 하는 일은
// 에이전트의 승인 경계를 지나지 않는다. 정본이 지목한 "헌장 우회" 사고가 여기서 구조적으로 난다.
//
// T5 는 반대로 간다: **캡슐은 파일시스템을 아예 못 만진다.** 모든 효과가 RPC 로 T5 의 손을
// 지나므로 기존 Authority·ToolReceipt·되돌리기가 그대로 선다. 좁아서 증명할 수 있다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { 캡슐실행, 캡슐상한 } from '../src/runtime/capsule.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const selfState = buildSelfState(demoEnv({ include: ['local.file'], hands: ['local.file'] }));

async function 무대() {
  const dir = await mkdtemp(join(tmpdir(), 's4-capsule-'));
  await writeFile(join(dir, 'a.txt'), '가나다');
  await writeFile(join(dir, 'b.txt'), '라마바');
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  return { dir, tools: new ToolRunner({ 'local.file': localFile }) };
}

const 돌리기 = async (코드, 더 = {}) => {
  const { dir, tools } = 더.무대 ?? await 무대();
  return {
    dir,
    결과: await 캡슐실행({ 코드, tools, selfState, cwd: dir, ...더ARGS(더) }),
  };
};
const 더ARGS = ({ 무대: _무대, ...나머지 }) => 나머지;

// ── 성질 ①: 파일시스템 기본 차단 ───────────────────────────────────────────
test('① scratch 밖으로 **쓰지 못한다**', async () => {
  const { dir, 결과 } = await 돌리기(`
    const fs = require('node:fs');
    fs.writeFileSync(${JSON.stringify(join(tmpdir(), 's4-escape-write.txt'))}, '탈출');
  `);
  assert.equal(결과.ok, false, '캡슐 밖으로 쓰기가 성공했다 — 격리가 아니다');
  assert.equal(existsSync(join(tmpdir(), 's4-escape-write.txt')), false, '파일이 실제로 생겼다');
  assert.ok(String(dir).length);
});

test('① 사용자 작업 폴더에도 **직접** 쓰지 못한다(손을 통해서만)', async () => {
  const { dir, tools } = await 무대();
  // **절대 경로로** 작업 폴더를 직접 노린다. 상대 경로는 scratch 로 떨어지므로 계약을 못 잰다.
  await 캡슐실행({
    코드: `try { require('node:fs').writeFileSync(${JSON.stringify(join(dir, '__직접쓰기.txt'))}, 'x'); }
           catch (e) { console.log('막힘:' + e.code); }`,
    tools, selfState, cwd: dir,
  });
  assert.equal(existsSync(join(dir, '__직접쓰기.txt')), false,
    '캡슐이 작업 폴더를 직접 바꿨다 — 그러면 영수증도 되돌리기도 없다');
});

// ── 성질 ②: 네트워크 기본 차단 ─────────────────────────────────────────────
test('② 바깥으로 나가지 못한다', async () => {
  const { 결과 } = await 돌리기(`
    const net = require('node:net');
    const s = net.connect(80, '93.184.216.34');
    s.on('connect', () => { console.log('연결됨'); process.exit(0); });
    s.on('error', (e) => { console.log('막힘: ' + e.code); process.exit(3); });
    setTimeout(() => { console.log('시간초과'); process.exit(4); }, 3000);
  `);
  assert.doesNotMatch(String(결과.stdout ?? ''), /연결됨/, '캡슐이 바깥에 닿았다');
});

// ── 성질 ③: 환경변수·비밀 제거 ─────────────────────────────────────────────
test('③ 비밀 환경변수가 캡슐 안에 없다', async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: "console.log(JSON.stringify(Object.keys(process.env).sort()));",
    tools, selfState, cwd: dir,
    env: { ...process.env, OPENAI_API_KEY: 'sk-비밀', ANTHROPIC_API_KEY: 'sk-비밀2', PATH: process.env.PATH },
  });
  const 이름들 = JSON.parse(String(결과.stdout ?? '[]').trim().split('\n').at(-1));
  for (const 비밀 of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
    assert.equal(이름들.includes(비밀), false, `${비밀} 가 캡슐 안에서 보인다`);
  }
  assert.doesNotMatch(String(결과.stdout ?? ''), /sk-비밀/, '비밀 값이 새어 나왔다');
});

test('③ 비밀 **파일**도 읽지 못한다', async () => {
  const { 결과 } = await 돌리기(`
    try {
      const t = require('node:fs').readFileSync(${JSON.stringify(join(homedir(), '.ssh', 'id_rsa'))}, 'utf8');
      console.log('읽음:' + t.length);
    } catch (e) { console.log('막힘:' + e.code); }
  `);
  assert.doesNotMatch(String(결과.stdout ?? ''), /읽음:/, '비밀 파일을 읽었다');
});

// ── 성질 ④: 도구 접근은 제한된 RPC 표면만 ──────────────────────────────────
test('④ RPC 로 준 손만 부를 수 있다(목록 밖은 거부)', async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: `
      const r = await t5.call('local.terminal', { command: 'echo 뚫림' });
      console.log(JSON.stringify(r));
    `,
    tools, selfState, cwd: dir, 허용손: ['local.file'],
  });
  assert.doesNotMatch(String(결과.stdout ?? ''), /뚫림/, '허용하지 않은 손이 돌았다');
  assert.match(String(결과.stdout ?? '') + String(결과.stderr ?? ''), /허용|없|거부/,
    '거부됐다는 사실이 스크립트에도 안 간다');
});

test('④ 셸·프로세스 생성이 막힌다', async () => {
  const { 결과 } = await 돌리기(`
    try {
      const out = require('node:child_process').execSync('echo 셸뚫림').toString();
      console.log(out);
    } catch (e) { console.log('막힘'); }
  `);
  assert.doesNotMatch(String(결과.stdout ?? ''), /셸뚫림/, '캡슐이 셸을 띄웠다 — Hermes 의 구멍이다');
});

// ── 성질 ⑤: 자동성 헌장 넷이 캡슐 안에서도 유효 ────────────────────────────
test('⑤ 되돌릴 수 없는 일은 캡슐 안에서도 자동으로 안 된다', async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: `
      const r = await t5.call('local.file', { action: 'delete', path: 'a.txt' });
      console.log(JSON.stringify(r));
    `,
    tools, selfState, cwd: dir, 허용손: ['local.file'],
    승인문맥: { 허락한손: new Set() }, // 아무 것도 승인 안 됨
  });
  // 삭제 자체는 되돌릴 수 있는 손이라 자동이다 — 실제로 **휴지통에 남는지**가 계약이다.
  assert.ok(existsSync(join(dir, '.trash')) || 결과.승인필요?.length,
    '되돌릴 수 있는 삭제인데 휴지통도 승인도 없다 — 헌장 ②가 캡슐 안에서 사라졌다');
});

test('⑤ 캡슐의 모든 실행이 **영수증**을 남긴다', async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: `
      await t5.call('local.file', { action: 'read', path: 'a.txt' });
      await t5.call('local.file', { action: 'read', path: 'b.txt' });
    `,
    tools, selfState, cwd: dir, 허용손: ['local.file'],
  });
  assert.equal((결과.영수증 ?? []).length, 2,
    '캡슐 안 실행이 원장에 안 남으면 모델도 사용자도 무슨 일이 있었는지 모른다');
  assert.ok(결과.영수증.every((r) => r.actualCall?.tool === 'local.file'));
});

// ── 성질 ⑥: self-grant 불가 ────────────────────────────────────────────────
test('⑥ 캡슐이 자기 권한을 넓히지 못한다', async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: `
      const 시도 = [];
      for (const 손 of ['work.state', 'memory.propose', 'skill.propose', 'automation.propose']) {
        const r = await t5.call(손, {});
        시도.push([손, r?.ok === true]);
      }
      console.log(JSON.stringify(시도));
    `,
    tools, selfState, cwd: dir, 허용손: ['local.file'],
  });
  const 시도 = JSON.parse(String(결과.stdout ?? '[]').trim().split('\n').at(-1) || '[]');
  assert.ok(시도.every(([, 됨]) => 됨 === false), `통제 채널이 캡슐에서 열렸다: ${JSON.stringify(시도)}`);
});

// ── 상한 ───────────────────────────────────────────────────────────────────
test('상한은 동결값이고 실측 근거가 있다', () => {
  const 상한 = 캡슐상한();
  assert.equal(상한.시간ms, 60_000, '턴 벽시계 예산 180s 의 1/3');
  assert.equal(상한.호출, 200, '되돌릴 수 있는 것 뒷단과 같은 값');
  assert.equal(상한.출력바이트, 16_000);
});

test('시간 상한이 실제로 문다', async () => {
  const { dir, tools } = await 무대();
  const 시작 = Date.now();
  const 결과 = await 캡슐실행({
    코드: 'while (true) {}', tools, selfState, cwd: dir, 상한: { 시간ms: 1500 },
  });
  assert.ok(Date.now() - 시작 < 12_000, '상한이 안 물어 캡슐이 계속 돈다');
  assert.equal(결과.ok, false);
  assert.match(String(결과.멈춘이유 ?? ''), /시간/);
});

test('호출 상한이 실제로 문다', async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: `
      let n = 0;
      for (let i = 0; i < 50; i += 1) {
        const r = await t5.call('local.file', { action: 'read', path: 'a.txt' });
        if (r?.ok) n += 1;
      }
      console.log('성공:' + n);
    `,
    tools, selfState, cwd: dir, 허용손: ['local.file'], 상한: { 호출: 5 },
  });
  assert.ok((결과.영수증 ?? []).length <= 5, `호출 상한 5인데 ${결과.영수증?.length}건 돌았다`);
});

// ── 없는 능력을 있는 척하지 않는다 ─────────────────────────────────────────
test('샌드박스를 못 쓰는 곳에서는 캡슐을 열지 않는다', async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: 'console.log(1)', tools, selfState, cwd: dir, 샌드박스가능: () => false,
  });
  assert.equal(결과.ok, false, '커널 격리가 없는데 캡슐이 돌았다');
  assert.match(String(결과.멈춘이유 ?? ''), /격리|샌드박스/);
});

#!/usr/bin/env node
// 비교군 H01~H10 라이브 계측기 — **OpenClaw 전용**.
//
// Hermes 는 여기 없다. `hermes -z` 는 승계 표면이 아니다 — `run_oneshot()` 이 세션 인자를 받지
// 않고(`oneshot.py:170`) `--resume` 은 TUI 전용 플래그다(`main.py:2322`). 실제로 재보니 H04 가
// `이 터미널 세션과는 별개의 이전 세션`이라고 답하고 입력 토큰이 212(1턴 5,746)였다. 같은 파일에
// 두면 또 오용되므로 뺐다. Hermes 는 `h_runner_v2.py`(대화형 PTY + SessionHost)로 잰다.
//
// OpenClaw `agent --local --json --session-key` 는 2턴 시험에서 승계가 확인됐다
// (`내 이름은 종윤이야.` → 다음 턴 `내 이름 뭐라고 했지?` → `종윤`).
//
// 실행표는 `h-branches.json` 이다. 무효 판정된 14턴 표는 삭제했다.
// 분기마다 상태 폴더를 따로 두고(앞 분기의 기억이 다음 분기의 사전 상태를 바꾸지 못한다),
// 대화는 `--session-key` 로 가른다.
//
// 재지 않는 것: 모델·도구·에이전트 호출 수를 추정하지 않는다. `--json` 이 준 값만 옮기고,
// 없으면 `null` 로 남긴다. 빈 칸을 숫자로 채우지 않는다.
//
// 시간은 `surface*` 로 적는다. 표면마다 의미가 달라 T5 UI 수치와 나란히 놓지 않는다.
//
// 사용:
//   node h-runner.mjs --run 1 --dry-run
//   node h-runner.mjs --run 1 --model gpt-5.3-chat-latest
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync,
  chmodSync, readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = process.env.LIVE_DIR ?? dirname(fileURLToPath(import.meta.url));
const SPEC = JSON.parse(readFileSync(join(HERE, 'h-branches.json'), 'utf8'));
const SECRET = join(HERE, 'secret-env.sh');
const DOWNLOADS = join(homedir(), 'Downloads');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const dryRun = process.argv.includes('--dry-run');
const run = Number(arg('run', '1'));
// OpenClaw 카탈로그에 gpt-5.1 이 없다. 모델이 다르면 제품 구조 우열로 보고하지 않는다.
const model = arg('model', 'gpt-5.3-chat-latest');

// fixture 는 이 정확한 세 경로뿐이다. 정리도 이 목록만 지운다. glob 으로 넓히지 않는다.
const FIXTURE_FILES = {
  '견적서_A사_v1.csv': '품목,수량,단가\n모니터,2,320000\n키보드,3,45000\n',
  '견적서_A사_최종.csv': '품목,수량,단가\n모니터,2,310000\n키보드,3,42000\n마우스,3,28000\n',
  '견적서_B사_v1.csv': '품목,수량,단가\n모니터,1,350000\n',
};
const LOCKED = '견적서_A사_최종.csv';

const OC = {
  label: 'OpenClaw 2026.7.2',
  cwd: join(HERE, 'oc-2026.7.2'),
  nodeBin: existsSync(join(HERE, 'node-bin.txt'))
    ? readFileSync(join(HERE, 'node-bin.txt'), 'utf8').trim()
    : null,
};

// ── fixture: 정확한 경로만 ───────────────────────────────────────────────────
const fixtureMake = () => Object.entries(FIXTURE_FILES).map(([name, body]) => {
  const p = join(DOWNLOADS, name);
  writeFileSync(p, body);
  return p;
});
const fixtureLock = () => chmodSync(join(DOWNLOADS, LOCKED), 0o000);
const fixtureUnlock = () => {
  const p = join(DOWNLOADS, LOCKED);
  if (existsSync(p)) chmodSync(p, 0o644);
};
const listDownloads = () => {
  try { return new Set(readdirSync(DOWNLOADS)); } catch { return new Set(); }
};

// ── 상태 폴더당 살아있는 제품 프로세스 수를 OS 에게 직접 묻는다 ───────────────
// 내부 장부를 믿지 않는다. 같은 홈에 두 writer 가 붙은 것이 지난 두 판을 무효로 만들었다.
const countProcesses = (stateDir) => {
  const ps = spawnSync('ps', ['-eo', 'pid=,command='], { encoding: 'utf8' });
  if (ps.error) return -1;
  let n = 0;
  for (const line of (ps.stdout ?? '').split('\n')) {
    if (!line.includes('openclaw.mjs')) continue;
    const pid = line.trim().split(/\s+/)[0];
    const env = spawnSync('ps', ['-p', pid, '-wwE', '-o', 'command='], { encoding: 'utf8' });
    if ((env.stdout ?? '').includes(`OPENCLAW_STATE_DIR=${stateDir}`)) n += 1;
  }
  return n;
};

// ── usage: 제품이 `--json` 으로 준 값만 옮긴다 ───────────────────────────────
const readUsage = (stdout) => {
  const lines = stdout.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const r = JSON.parse(lines[i]);
      const u = r.usage ?? r.tokenUsage ?? {};
      const n = (v) => (typeof v === 'number' ? v : null);
      return {
        apiCalls: n(u.apiCalls ?? u.api_calls ?? r.apiCalls),
        costUsd: n(u.costUsd ?? u.cost_usd ?? r.costUsd),
        tokensIn: n(u.inputTokens ?? u.input_tokens ?? u.promptTokens),
        tokensOut: n(u.outputTokens ?? u.output_tokens ?? u.completionTokens),
        totalTokens: n(u.totalTokens ?? u.total_tokens),
        toolCalls: Array.isArray(r.toolCalls) ? r.toolCalls.length : n(r.toolCalls),
        model: r.model ?? null,
        sessionId: r.sessionId ?? r.session_id ?? null,
        source: 'agent --json',
      };
    } catch { /* JSON 아닌 진단 줄은 건너뛴다 */ }
  }
  return { apiCalls: null, costUsd: null, source: 'json-absent' };
};

// ── 한 턴 = 프로세스 하나. 끝나면 확실히 죽는다 ──────────────────────────────
const runTurn = (turn, stateDir) => new Promise((resolve) => {
  const key = `${turn.branchId}-${turn.session}`;
  const args = [
    'openclaw.mjs', 'agent', '--local', '--json',
    '--message', turn.prompt,
    '--model', model,
    '--session-key', key,
  ];
  const env = {
    ...process.env,
    HOME: stateDir,
    OPENCLAW_HOME: stateDir,
    OPENCLAW_STATE_DIR: join(stateDir, '.openclaw'),
    OPENCLAW_CONFIG_PATH: join(stateDir, '.openclaw', 'openclaw.json'),
  };
  if (OC.nodeBin) env.PATH = `${OC.nodeBin}:${env.PATH}`;

  // 자격은 오너가 입력한 파일에서 자식 프로세스 안으로만 들어간다.
  // 계측기는 값을 읽지 않고, 출력·기록에도 남지 않는다.
  const useSecret = existsSync(SECRET);
  const file = useSecret ? 'bash' : 'node';
  const spawnArgs = useSecret
    ? ['-c', 'set -a; . "$0"; exec "$@"', SECRET, 'node', ...args]
    : args;

  const t0 = process.hrtime.bigint();
  let firstOut = null;
  let lastAt = t0;
  let longestGap = 0;
  let out = '';
  let err = '';
  const ms = (a, b) => Number(b - a) / 1e6;

  const child = spawn(file, spawnArgs, { cwd: OC.cwd, env });
  const onChunk = (buf, sink) => {
    const now = process.hrtime.bigint();
    if (firstOut === null) firstOut = now;
    longestGap = Math.max(longestGap, ms(lastAt, now));
    lastAt = now;
    if (sink === 'out') out += buf.toString(); else err += buf.toString();
  };
  child.stdout.on('data', (b) => onChunk(b, 'out'));
  child.stderr.on('data', (b) => onChunk(b, 'err'));

  child.on('close', (code) => {
    const t1 = process.hrtime.bigint();
    longestGap = Math.max(longestGap, ms(lastAt, t1));
    resolve({
      run,
      branch: turn.branchId,
      home: turn.home,
      seq: turn.seq,
      id: turn.id,
      session: turn.session,
      sessionKey: key,
      role: turn.role ?? null,
      prompt: turn.prompt,
      measure: turn.measure ?? null,
      exitCode: code,
      // 표면별 의미가 다르다. T5 UI 수치와 나란히 놓지 않는다.
      surfaceFirstPaintMs: firstOut === null ? null : Math.round(ms(t0, firstOut)),
      surfaceQuietGapMs: Math.round(longestGap),
      surfaceNote: 'CLI 1턴: 진단 로그가 먼저 나오고 응답은 끝에 한 번에 나온다',
      totalMs: Math.round(ms(t0, t1)),
      usage: readUsage(out),
      stdout: out,
      stderr: err,
      // 사람이 채운다. 자동 판정하지 않는다.
      goal: null,
      unnecessaryQuestions: null,
      approvals: null,
      agentDelegation: null,
    });
  });
});

const main = async () => {
  const branches = SPEC.branches;
  const total = branches.reduce((a, b) => a + b.turns.length, 0);
  if (total !== SPEC.turnsPerRun) {
    console.error(`분기표 불일치: ${total}턴 vs ${SPEC.turnsPerRun} 선언`);
    process.exit(2);
  }
  if (!dryRun && !existsSync(SECRET)) {
    console.error('자격 파일이 없다. 키 입력 창을 먼저 실행하라.');
    process.exit(2);
  }

  const runroot = join(HERE, `oc-run-${run}`);
  const outPath = join(runroot, 'turns.jsonl');
  const receipt = { product: OC.label, run, model, branches: [] };
  const manifest = [];
  const before = listDownloads();

  console.log(`[${OC.label}] 회차 ${run} · ${total}턴 · ${model}${dryRun ? ' · DRY RUN' : ''}`);
  console.log(`모델 주의: ${SPEC.modelCaveat}`);

  if (!dryRun) {
    rmSync(runroot, { recursive: true, force: true });
    mkdirSync(runroot, { recursive: true });
    writeFileSync(outPath, '');
  }

  try {
    for (const br of branches) {
      const stateDir = join(runroot, br.home);
      console.log(`\n── ${br.id}  home=${br.home}  (${br.purpose})`);
      if (!dryRun) mkdirSync(join(stateDir, '.openclaw'), { recursive: true });

      for (const step of br.fixture ?? []) {
        if (dryRun) console.log(`     fixture:${step}`);
        else if (step === 'make') {
          manifest.push(...fixtureMake());
          console.log('     fixture make → 3개');
        } else if (step === 'unlock') fixtureUnlock();
      }

      for (const t of br.turns) {
        for (const step of t.setup ?? []) {
          if (step === 'fixture:lock') {
            if (dryRun) console.log('     fixture:lock');
            else fixtureLock();
          }
        }

        if (dryRun) {
          console.log(`  ${String(t.seq).padStart(2)} ${t.id.padEnd(13)} ${t.session} ` +
            `key=${br.id}-${t.session}  ${(t.role ?? t.measure ?? '').slice(0, 40)}`);
          continue;
        }

        // 턴 전에 이 상태 폴더에 붙은 프로세스가 없어야 한다.
        const busy = countProcesses(join(stateDir, '.openclaw'));
        if (busy > 0) throw new Error(`${br.id}: 이 상태 폴더에 제품 프로세스 ${busy}개가 살아 있다`);

        const rec = await runTurn({ ...t, branchId: br.id, home: br.home }, stateDir);
        appendFileSync(outPath, `${JSON.stringify(rec)}\n`);

        // 턴 뒤에도 남아 있으면 즉시 중단한다. 다중 writer 를 다음 턴으로 넘기지 않는다.
        const left = countProcesses(join(stateDir, '.openclaw'));
        if (left > 0) throw new Error(`${br.id}/${t.id}: 턴 뒤 제품 프로세스 ${left}개가 남았다`);

        console.log(`  ${String(rec.seq).padStart(2)} ${rec.id.padEnd(13)} ${rec.session} ` +
          `exit=${rec.exitCode} 총=${rec.totalMs}ms 호출=${rec.usage.apiCalls ?? '기록없음'}`);
        if (rec.exitCode !== 0) {
          console.log(`     ! ${(rec.stderr.trim().split('\n').pop() ?? '').slice(0, 160)}`);
        }
      }

      if (!dryRun) {
        receipt.branches.push({
          id: br.id,
          home: br.home,
          stateDir,
          processesAfter: countProcesses(join(stateDir, '.openclaw')),
        });
      }
    }
  } finally {
    if (!dryRun) {
      fixtureUnlock();
      const removed = [];
      for (const p of manifest) {
        if (existsSync(p)) { unlinkSync(p); removed.push(p); }
      }
      const after = listDownloads();
      const created = [...after].filter((n) => !before.has(n)).sort();
      receipt.fixtureManifest = manifest;
      receipt.fixtureRemoved = removed;
      // 제품이 만든 파일은 지우지 않고 정확한 경로로 보고한다.
      receipt.productCreated = created.map((n) => join(DOWNLOADS, n));
      writeFileSync(join(runroot, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
      console.log(`\nfixture 삭제 ${removed.length}건`);
      if (created.length) {
        console.log('제품이 만든 파일 (지우지 않았다. 정확한 경로로 보고한다):');
        for (const n of created) console.log(`  ${join(DOWNLOADS, n)}`);
      }
      console.log(`기록: ${outPath}\n영수증: ${join(runroot, 'receipt.json')}`);
    }
  }
};

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });

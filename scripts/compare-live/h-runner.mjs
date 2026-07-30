#!/usr/bin/env node
// 비교군 H01~H10 라이브 계측기 — **OpenClaw 전용**.
//
// Hermes 는 여기 없다. `hermes -z` 는 승계 표면이 아니다 — `run_oneshot()` 이 세션 인자를 받지
// 않고(`oneshot.py:170`) `--resume` 은 TUI 전용 플래그다(`main.py:2322`). 실제로 재보니 H04 가
// `이 터미널 세션과는 별개의 이전 세션`이라고 답하고 입력 토큰이 212(1턴 5,746)였다. 같은 파일에
// 두면 또 오용되므로 뺐다. Hermes 는 `h_runner_v3.py`(SessionHost 위의 대화형 PTY)로 잰다.
// (`h_runner_v2.py` 는 다중 writer 결함으로 차단됐고 감사 대조용으로만 남는다.)
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
  mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync,
  readdirSync, rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chmodOwned, cleanupOwned, createOwned } from './fixture-ownership.mjs';
import { prepareUserView } from './user-view.mjs';

const HERE = process.env.LIVE_DIR ?? dirname(fileURLToPath(import.meta.url));
const SPEC = JSON.parse(readFileSync(join(HERE, 'h-branches.json'), 'utf8'));
const SCENARIOS = JSON.parse(readFileSync(join(HERE, 'h-scenarios.json'), 'utf8'));
for (const branch of SPEC.branches) {
  for (const turn of branch.turns) {
    if ('prompt' in turn) throw new Error(`${turn.id}: 실행표에 원문을 다시 쓰지 않는다`);
    const prompt = SCENARIOS.prompts?.[turn.promptRef];
    if (typeof prompt !== 'string') throw new Error(`${turn.id}: 알 수 없는 promptRef ${turn.promptRef}`);
    const provenance = SCENARIOS.provenance?.[turn.promptRef];
    if (!provenance) throw new Error(`${turn.id}: provenance 없는 promptRef ${turn.promptRef}`);
    turn.prompt = prompt;
    turn.promptStatus = provenance.status;
    turn.promptSource = provenance.source;
  }
}
const contractProbe = spawnSync('python3', [join(HERE, 'compare_contract.py')], {
  encoding: 'utf8',
  timeout: 30_000,
});
if (contractProbe.status !== 0) {
  throw new Error(`비교 정본 계약 실패:\n${contractProbe.stdout || contractProbe.stderr || ''}`);
}
const SECRET = join(HERE, 'secret-env.sh');
const USER_HOME = process.env.T5_COMPARE_USER_HOME || homedir();
const DOWNLOADS = join(USER_HOME, 'Downloads');
// Hermes v3 와 같은 lock 파일 — 두 제품이 같은 Downloads fixture 를 공유하므로
// 어떤 조합의 동시 회차도 막는다.
const LOCK = join(HERE, 'run.lock');

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
// 턴 하나가 이 시간을 넘기면 프로세스 그룹을 죽이고 timedOut 으로 기록한다.
// 유료 회차가 멈춘 제품을 무한히 기다리면 안 된다. (v2 의 240s 를 승계)
const TURN_TIMEOUT_MS = 240_000;

const resolveOpenClaw = () => {
  const requested = process.env.OPENCLAW_COMPARE_BIN;
  const found = requested || spawnSync('which', ['openclaw'], { encoding: 'utf8' }).stdout?.trim();
  if (!found) throw new Error('OpenClaw 실행 파일을 찾지 못했다');
  const probeHome = mkdtempSync(join(tmpdir(), 'gpao-openclaw-probe-'));
  const probeEnv = {
    PATH: `${dirname(found)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: probeHome,
    OPENCLAW_HOME: probeHome,
    OPENCLAW_STATE_DIR: join(probeHome, '.openclaw'),
    OPENCLAW_CONFIG_PATH: join(probeHome, '.openclaw', 'openclaw.json'),
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
  };
  mkdirSync(join(probeHome, '.openclaw'), { recursive: true });
  try {
    const probe = spawnSync(found, ['--version'], {
      encoding: 'utf8', timeout: 30_000, env: probeEnv,
    });
    if (probe.status !== 0) {
      throw new Error(`OpenClaw 실행 불가: ${(probe.stderr || probe.error?.message || '').trim()}`);
    }
    const label = (probe.stdout || probe.stderr || '').trim();
    if (!label) throw new Error('OpenClaw가 실행 신분을 보고하지 않았다');
    const agentProbe = spawnSync(found, ['agent', '--help'], {
      encoding: 'utf8', timeout: 30_000, env: probeEnv,
    });
    const help = `${agentProbe.stdout || ''}\n${agentProbe.stderr || ''}`;
    const required = ['--local', '--json', '--message', '--model', '--session-key'];
    const missing = required.filter((option) => !help.includes(option));
    if (agentProbe.status !== 0 || missing.length) {
      throw new Error(
        `OpenClaw agent 활주로 불완전: status=${agentProbe.status}, missing=${missing.join(',')}`,
      );
    }
    return { bin: found, label };
  } finally {
    rmSync(probeHome, { recursive: true, force: true });
  }
};
const OC = resolveOpenClaw();

// ── fixture: 정확한 경로만 ───────────────────────────────────────────────────
// 감사 P0-2: 같은 이름의 기존 사용자 파일은 덮어쓰지 않는다. 회차 시작 전 충돌 검사 +
// 배타 생성('wx') 이중 방어. 삭제 전에는 스냅샷을 남긴다.
const fixtureCollision = () =>
  Object.keys(FIXTURE_FILES).map((n) => join(DOWNLOADS, n)).filter((p) => existsSync(p));
const fixtureRecord = (records, name) => {
  const path = join(DOWNLOADS, name);
  const found = records.find((record) => record.path === path);
  if (!found) throw new Error(`소유권 기록이 없는 fixture: ${path}`);
  return found;
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
    if (!line.toLowerCase().includes('openclaw')) continue;
    const pid = line.trim().split(/\s+/)[0];
    const env = spawnSync('ps', ['-p', pid, '-wwE', '-o', 'command='], { encoding: 'utf8' });
    if ((env.stdout ?? '').includes(`OPENCLAW_STATE_DIR=${stateDir}`)) n += 1;
  }
  return n;
};

// ── usage: 제품이 `--json` 으로 준 값만 옮긴다 ───────────────────────────────
const readUsage = (stdout) => {
  const parse = (value) => {
    const r = value.result ?? value;
    const u = r.usage ?? r.tokenUsage ?? value.usage ?? {};
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
  };
  try {
    return parse(JSON.parse(stdout));
  } catch { /* 진단 줄과 JSON이 섞인 출력은 아래에서 찾는다 */ }
  const lines = stdout.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return parse(JSON.parse(lines[i]));
    } catch { /* JSON 아닌 진단 줄은 건너뛴다 */ }
  }
  return { apiCalls: null, costUsd: null, source: 'json-absent' };
};

// ── 한 턴 = 프로세스 하나. 끝나면 확실히 죽는다 ──────────────────────────────
const runTurn = (turn, stateDir) => new Promise((resolve) => {
  const key = `${turn.branchId}-${turn.session}`;
  const args = [
    'agent', '--local', '--json',
    '--message', turn.prompt,
    '--model', model,
    '--session-key', key,
  ];
  // 환경은 상속하지 않고 명시 구성한다 — 부모 셸의 키 변수·실제 HOME 이 제품에 새지 않는다.
  const env = {
    PATH: `${dirname(OC.bin)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: stateDir,
    OPENCLAW_HOME: stateDir,
    OPENCLAW_STATE_DIR: join(stateDir, '.openclaw'),
    OPENCLAW_CONFIG_PATH: join(stateDir, '.openclaw', 'openclaw.json'),
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
  };

  // 자격은 오너가 입력한 파일에서 자식 프로세스 안으로만 들어간다.
  // 계측기는 값을 읽지 않고, 출력·기록에도 남지 않는다.
  const useSecret = existsSync(SECRET);
  const file = useSecret ? 'bash' : OC.bin;
  const spawnArgs = useSecret
    ? ['-c', 'set -a; . "$0"; exec "$@"', SECRET, OC.bin, ...args]
    : args;

  const t0 = process.hrtime.bigint();
  let firstOut = null;
  let lastAt = t0;
  let longestGap = 0;
  let out = '';
  let err = '';
  const ms = (a, b) => Number(b - a) / 1e6;

  const child = spawn(file, spawnArgs, { cwd: stateDir, env, detached: true });
  let settled = false;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {
      try { child.kill('SIGKILL'); } catch { /* 이미 죽었다 */ }
    }
  }, (turn.timeoutS ? turn.timeoutS * 1000 : TURN_TIMEOUT_MS));
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
    if (settled) return;
    settled = true;
    clearTimeout(timer);
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
      promptStatus: turn.promptStatus,
      promptSource: turn.promptSource,
      measure: turn.measure ?? null,
      exitCode: code,
      timedOut,
      // CLI 는 턴마다 새 프로세스다 — 재시작 자체는 표면에 내재하고,
      // 이 턴이 재는 것은 재시작 뒤 `--session-key` 로 원 대화가 재개되는가다.
      restarted: turn.restartBefore ?? null,
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
  child.on('error', (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const t1 = process.hrtime.bigint();
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
      promptStatus: turn.promptStatus,
      promptSource: turn.promptSource,
      measure: turn.measure ?? null,
      exitCode: null,
      timedOut: false,
      spawnError: error.message,
      restarted: turn.restartBefore ?? null,
      surfaceFirstPaintMs: null,
      surfaceQuietGapMs: null,
      surfaceNote: 'CLI 프로세스가 시작되지 않았다',
      totalMs: Math.round(ms(t0, t1)),
      usage: { apiCalls: null, costUsd: null, source: 'spawn-error' },
      stdout: out,
      stderr: `${err}\n${error.message}`.trim(),
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
  for (const required of [DOWNLOADS, join(USER_HOME, 'Developer')]) {
    if (!existsSync(required)) {
      console.error(`봉인 기준선의 사용자 파일 시야가 없다: ${required}`);
      process.exit(3);
    }
  }
  if (!dryRun) {
    const clash = fixtureCollision();
    if (clash.length) {
      console.error(`Downloads 에 같은 이름의 기존 파일이 있다 — 덮어쓰지 않는다:\n  ${clash.join('\n  ')}`);
      process.exit(3);
    }
  }
  if (!dryRun && !existsSync(SECRET)) {
    console.error('자격 파일이 없다. 키 입력 창을 먼저 실행하라.');
    process.exit(2);
  }

  const runroot = join(HERE, `oc-run-${run}`);
  const outPath = join(runroot, 'turns.jsonl');
  const receipt = {
    product: OC.label,
    executable: OC.bin,
    userHome: USER_HOME,
    workingDirectory: 'per-branch isolated home',
    run,
    model,
    branches: [],
    abortedBranches: [],
  };
  const manifest = [];
  const before = listDownloads();
  let lockHeld = false;

  console.log(`[${OC.label}] 회차 ${run} · ${total}턴 · ${model}${dryRun ? ' · DRY RUN' : ''}`);
  console.log(`사용자 파일 시야: 격리 HOME의 Downloads·Developer → ${USER_HOME} 실제 폴더`);
  console.log(`모델 주의: ${SPEC.modelCaveat}`);

  if (!dryRun) {
    // 기존 회차 산출물은 증거다 — 재귀 삭제로 시작하지 않는다.
    if (existsSync(runroot)) {
      console.error(`기존 산출물이 있다 — 덮어쓰지 않는다: ${runroot}`);
      process.exit(3);
    }
    // 회차 lock: Hermes 회차와도 겹치지 않는다(같은 Downloads 를 쓴다).
    try {
      writeFileSync(LOCK, `run=${run} pid=${process.pid} runner=openclaw\n`, { flag: 'wx' });
      lockHeld = true;
    } catch {
      console.error(`다른 회차가 실행 중이다: ${readFileSync(LOCK, 'utf8').trim()}`);
      process.exit(3);
    }
    mkdirSync(runroot, { recursive: true });
    writeFileSync(outPath, '');
  }

  // 재시작 증거용: 대화(session-key)별로 제품이 처음 보고한 sessionId 를 기억한다.
  const firstSessionId = {};

  try {
    for (const br of branches) {
      const stateDir = join(runroot, br.home);
      console.log(`\n── ${br.id}  home=${br.home}  (${br.purpose})`);
      if (!dryRun) {
        mkdirSync(join(stateDir, '.openclaw'), { recursive: true });
        receipt.branches.push({
          id: br.id,
          home: br.home,
          stateDir,
          userView: prepareUserView(stateDir, USER_HOME),
          processesAfter: null,
        });
      }

      for (const step of br.fixture ?? []) {
        if (dryRun) console.log(`     fixture:${step}`);
        else if (step === 'make') {
          manifest.push(...createOwned(
            DOWNLOADS, FIXTURE_FILES, join(runroot, 'fixture-anchors')));
          console.log('     fixture make → 3개');
        } else if (step === 'unlock') {
          if (!chmodOwned(fixtureRecord(manifest, LOCKED), 0o644)) {
            throw new Error('잠금 해제 대상의 fixture 신분이 바뀌었다');
          }
        }
      }

      for (const t of br.turns) {
        for (const step of t.setup ?? []) {
          if (step === 'fixture:lock') {
            if (dryRun) console.log('     fixture:lock');
            else if (!chmodOwned(fixtureRecord(manifest, LOCKED), 0o000)) {
              throw new Error('잠금 대상의 fixture 신분이 바뀌었다');
            }
          }
        }

        if (dryRun) {
          console.log(`  ${String(t.seq).padStart(2)} ${t.id.padEnd(13)} ${t.session} ` +
            `key=${br.id}-${t.session}  ${(t.role ?? t.measure ?? '').slice(0, 40)}`);
          continue;
        }

        // 턴 전에 이 상태 폴더에 붙은 프로세스가 없어야 한다.
        // 계측 실패(-1)는 안전한 0 이 아니다 — 잴 수 없으면 실행하지 않는다(P1-4).
        const busy = countProcesses(join(stateDir, '.openclaw'));
        if (busy !== 0) {
          throw new Error(busy < 0
            ? `${br.id}: 프로세스 계측 불능(ps 실패) — 실행하지 않는다`
            : `${br.id}: 이 상태 폴더에 제품 프로세스 ${busy}개가 살아 있다`);
        }

        const rec = await runTurn({ ...t, branchId: br.id, home: br.home }, stateDir);
        const key = `${br.id}-${t.session}`;
        // 재시작 증거: 실행표 불리언이 아니라 제품이 보고한 session identity 로 남긴다(P1-3).
        if (t.restartBefore) {
          rec.restartEvidence = {
            expectedSessionId: firstSessionId[key] ?? null,
            gotSessionId: rec.usage.sessionId ?? null,
          };
        }
        if (rec.usage.sessionId && !firstSessionId[key]) firstSessionId[key] = rec.usage.sessionId;
        appendFileSync(outPath, `${JSON.stringify(rec)}\n`);

        // 턴 뒤에도 남아 있으면 즉시 중단한다. 다중 writer 를 다음 턴으로 넘기지 않는다.
        const left = countProcesses(join(stateDir, '.openclaw'));
        if (left !== 0) {
          throw new Error(left < 0
            ? `${br.id}/${t.id}: 턴 뒤 프로세스 계측 불능(ps 실패)`
            : `${br.id}/${t.id}: 턴 뒤 제품 프로세스 ${left}개가 남았다`);
        }

        console.log(`  ${String(rec.seq).padStart(2)} ${rec.id.padEnd(13)} ${rec.session} ` +
          `exit=${rec.exitCode} 총=${rec.totalMs}ms 호출=${rec.usage.apiCalls ?? '기록없음'}`);

        // 실패·시간초과 턴이 섞인 분기는 판정 재료가 아니다 — 그 분기만 중단하고
        // 다음 분기(홈 분리)로 간다. 기록은 남긴다(P1-1).
        if (rec.exitCode !== 0 || rec.timedOut) {
          console.log(`     ! ${(rec.stderr.trim().split('\n').pop() ?? '').slice(0, 160)}`);
          receipt.abortedBranches.push({
            id: br.id,
            atTurn: t.id,
            reason: rec.timedOut ? 'timeout' : `exitCode=${rec.exitCode}`,
          });
          console.log(`     ! 분기 중단: ${br.id} (${rec.timedOut ? '시간초과' : `exit=${rec.exitCode}`})`);
          break;
        }
      }

      if (!dryRun) {
        receipt.branches.at(-1).processesAfter = countProcesses(join(stateDir, '.openclaw'));
      }
    }
  } finally {
    if (!dryRun) {
      if (manifest.length) {
        chmodOwned(fixtureRecord(manifest, LOCKED), 0o644);
      }
      const { removed, preserved, outcomes } = cleanupOwned(
        manifest, join(runroot, 'fixtures-final'));
      const after = listDownloads();
      const created = [...after].filter((n) => !before.has(n)).sort();
      receipt.fixtureManifest = manifest;
      receipt.fixtureRemoved = removed;
      receipt.fixturePreserved = preserved;
      receipt.fixtureOutcomes = outcomes;
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
    if (lockHeld) { try { unlinkSync(LOCK); } catch { /* 이미 없다 */ } }
  }
};

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });

#!/usr/bin/env node
// 비교군 H01~H10 라이브 계측기.
//
// 왜 새로 만드는가: T5 3회는 브라우저 안에 MutationObserver를 주입해 어시스턴트 턴을 셌다.
// 비교군은 CLI라 같은 자를 쓸 수 없다. 같은 지표(첫 표시·가장 긴 공백·총 소요·질문·승인·
// 도구·에이전트·모델 호출)를 CLI 표면에서 재는 계측기가 필요하다.
//
// 재지 않는 것: 모델 호출 수를 추정하지 않는다. 제품이 남긴 usage 기록의 증분만 센다.
// 기록이 없으면 `null`로 남긴다. 빈 칸을 숫자로 채우지 않는다.
//
// 사용:
//   node h-runner.mjs --product hermes   --run 1 --dry-run   (자격 없이 배선 확인)
//   node h-runner.mjs --product openclaw --run 1
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 작업 디렉터리: 임시 홈·런타임·fixture 가 모여 있는 곳. LIVE_DIR 로 지정한다.
const HERE = process.env.LIVE_DIR ?? dirname(fileURLToPath(import.meta.url));
const TURNS = JSON.parse(readFileSync(join(HERE, 'h-turns.json'), 'utf8'));
const FIXTURES = join(HERE, 'prepare-fixtures.sh');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const has = (name) => process.argv.includes(`--${name}`);

const product = arg('product');
const run = Number(arg('run', '1'));
const dryRun = has('dry-run');
const model = arg('model', 'gpt-5.1');

// ── 제품 정의 ────────────────────────────────────────────────────────────────
// 각 제품은 (1) 격리 홈, (2) 한 턴 명령, (3) usage 증분 읽는 법을 제공한다.
const PRODUCTS = {
  hermes: {
    label: 'Hermes',
    cwd: '/Users/jyp/Developer/lab_un/hermes-agent',
    home: join(HERE, 'hermes-home'),
    homeEnv: 'HERMES_HOME',
    // `--usage-file` 은 1턴 JSON 을 덮어쓴다(`oneshot.py:127`). 누적 파일이 아니므로
    // 턴마다 별 파일로 받아 뒤에서 합친다. 실패해도 기록되므로 지출이 새지 않는다.
    usageDir: join(HERE, 'usage-hermes'),
    // 실증한 플래그만 쓴다(`hermes --help`): -z · -m · --provider · --usage-file · --resume
    // 어느 대화를 잇는지는 실행표의 `session` 이 정한다. 계측기가 문장을 해석하지 않는다.
    // 세션 ID 는 제품이 usage 보고서의 `session_id` 로 알려준다(`oneshot.py:149`).
    // 그 값을 그대로 --resume 에 넘긴다. 이름을 지어내지 않는다.
    turnCmd(turn, ctx) {
      const known = ctx.sessionIds.get(turn.session);
      return {
        file: './.venv/bin/hermes',
        args: [
          '-z', turn.prompt,
          '-m', model,
          '--provider', 'openai-api',
          '--usage-file', ctx.turnUsagePath,
          ...(known ? ['--resume', known] : []),
        ],
      };
    },
  },
  // pinned 2026.7.2 를 임시 로컬 Node v24.18.1 로 돌린다. 시스템 Node(v24.14.0)는 안 건드린다.
  // 설치본 2026.6.11 은 쓰지 않는다 — pinned 가 섰으므로 결과를 섞을 이유가 없다.
  openclaw: {
    label: 'OpenClaw 2026.7.2',
    cwd: join(HERE, 'oc-2026.7.2'),
    home: join(HERE, 'oc-state'),
    homeEnv: 'OPENCLAW_STATE_DIR',
    usageDir: join(HERE, 'usage-openclaw'),
    nodeBin: existsSync(join(HERE, 'node-bin.txt'))
      ? readFileSync(join(HERE, 'node-bin.txt'), 'utf8').trim()
      : null,
    extraEnv(P) {
      return { OPENCLAW_CONFIG_PATH: join(P.home, 'config.json') };
    },
    // 실증한 계약(`openclaw agent --help`): --local 임베디드 · --json 구조 결과 ·
    // --session-key 로 같은 대화/새 대화를 직접 가른다. Gateway 를 띄우지 않는다.
    turnCmd(turn, ctx) {
      // --session-key 가 대화를 직접 가른다. 실행표의 session 이름을 그대로 쓴다.
      const key = `h-${turn.session}`;
      return {
        file: 'node',
        args: [
          'openclaw.mjs', 'agent', '--local', '--json',
          '--message', turn.prompt,
          '--model', model,
          '--session-key', key,
        ],
      };
    },
    // OpenClaw 는 usage 파일 옵션이 없다. --json 결과에서 제품이 준 값만 옮긴다.
    usageFromStdout: true,
  },
};

const P = PRODUCTS[product];
if (!P) {
  console.error(`--product 를 지정하라: ${Object.keys(PRODUCTS).join(' | ')}`);
  process.exit(2);
}

// ── 격리 홈: 회차마다 새로 만든다(기억 0) ────────────────────────────────────
const freshHome = () => {
  rmSync(P.home, { recursive: true, force: true });
  mkdirSync(P.home, { recursive: true });
};

const fixture = (verb) =>
  new Promise((resolve) => {
    const c = spawn('bash', [FIXTURES, verb], { stdio: 'inherit' });
    c.on('close', () => resolve());
  });

// ── usage: 제품이 남긴 보고서를 그대로 읽는다. 없는 칸은 null 로 남긴다 ─────
// 모델 호출 수(`api_calls`)와 비용(`estimated_cost_usd`)은 제품이 계산한 값이다.
// 계측기는 세지 않고 옮긴다. 파일이 없으면 숫자를 만들지 않는다.
const readTurnUsage = (path) => {
  if (!existsSync(path)) {
    return { apiCalls: null, costUsd: null, tokensIn: null, tokensOut: null, source: 'absent' };
  }
  try {
    const r = JSON.parse(readFileSync(path, 'utf8'));
    return {
      apiCalls: r.api_calls ?? null,
      costUsd: r.estimated_cost_usd ?? null,
      costStatus: r.cost_status ?? null,
      tokensIn: r.input_tokens ?? null,
      tokensOut: r.output_tokens ?? null,
      cacheRead: r.cache_read_tokens ?? null,
      reasoning: r.reasoning_tokens ?? null,
      totalTokens: r.total_tokens ?? null,
      model: r.model ?? null,
      provider: r.provider ?? null,
      serviceTier: r.service_tier ?? null,
      sessionId: r.session_id ?? null,
      completed: r.completed ?? null,
      failed: r.failed ?? null,
      failure: r.failure ?? null,
      source: 'usage-file',
    };
  } catch (e) {
    return { apiCalls: null, costUsd: null, source: `unreadable: ${e.message}` };
  }
};

// OpenClaw: `agent --json` 결과에서 제품이 준 사용량만 옮긴다. 이름을 추측해 만들지 않는다.
const readStdoutUsage = (stdout) => {
  try {
    const r = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '');
    const u = r.usage ?? r.tokenUsage ?? {};
    const n = (v) => (typeof v === 'number' ? v : null);
    return {
      apiCalls: n(u.apiCalls ?? u.api_calls ?? r.apiCalls),
      costUsd: n(u.costUsd ?? u.cost_usd ?? r.costUsd),
      tokensIn: n(u.inputTokens ?? u.input_tokens ?? u.promptTokens),
      tokensOut: n(u.outputTokens ?? u.output_tokens ?? u.completionTokens),
      totalTokens: n(u.totalTokens ?? u.total_tokens),
      model: r.model ?? null,
      // 도구·에이전트 후속 호출: 제품이 결과에 남긴 것만
      toolCalls: Array.isArray(r.toolCalls) ? r.toolCalls.length : n(r.toolCalls),
      raw: u,
      source: 'agent --json',
    };
  } catch (e) {
    return { apiCalls: null, costUsd: null, source: `json-unreadable: ${e.message}` };
  }
};

const sumNums = (rows, key) => {
  const vals = rows.map((r) => r[key]).filter((v) => typeof v === 'number');
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};

// ── 한 턴 실행: 첫 출력·가장 긴 공백·총 소요를 실측 ──────────────────────────
const runTurn = (turn, ctx) =>
  new Promise((resolve) => {
    const { file, args } = P.turnCmd(turn, ctx);
    const env = { ...process.env, [P.homeEnv]: P.home, ...(P.extraEnv?.(P) ?? {}) };
    if (P.nodeBin) env.PATH = `${P.nodeBin}:${env.PATH}`;

    const t0 = process.hrtime.bigint();
    let firstOutputAt = null;
    let lastChunkAt = t0;
    let longestGapMs = 0;
    let out = '';
    let err = '';

    const ms = (a, b) => Number(b - a) / 1e6;
    const child = spawn(file, args, { cwd: P.cwd, env });

    const onChunk = (buf, sink) => {
      const now = process.hrtime.bigint();
      if (firstOutputAt === null) firstOutputAt = now;
      const gap = ms(lastChunkAt, now);
      if (gap > longestGapMs) longestGapMs = gap;
      lastChunkAt = now;
      if (sink === 'out') out += buf.toString(); else err += buf.toString();
    };
    child.stdout.on('data', (b) => onChunk(b, 'out'));
    child.stderr.on('data', (b) => onChunk(b, 'err'));

    child.on('close', (code) => {
      const t1 = process.hrtime.bigint();
      const finalGap = ms(lastChunkAt, t1);
      if (finalGap > longestGapMs) longestGapMs = finalGap;
      const usage = P.usageFromStdout ? readStdoutUsage(out) : readTurnUsage(ctx.turnUsagePath);

      resolve({
        seq: turn.seq,
        id: turn.id,
        state: turn.state,
        prompt: turn.prompt,
        measure: turn.measure ?? null,
        exitCode: code,
        // 공통 측정값 — 실측만
        firstOutputMs: firstOutputAt === null ? null : Math.round(ms(t0, firstOutputAt)),
        longestGapMs: Math.round(longestGapMs),
        totalMs: Math.round(ms(t0, t1)),
        // 모델·도구·에이전트 후속 호출 전부: 제품 usage 보고서 그대로. 추정 0.
        usage,
        // 아래 네 칸은 사람이 출력을 읽고 채운다. 자동 판정하지 않는다.
        goal: null,
        unnecessaryQuestions: null,
        approvals: null,
        agentDelegation: null,
        stdout: out,
        stderr: err,
      });
    });
  });

// ── 회차 ─────────────────────────────────────────────────────────────────────
const main = async () => {
  const outPath = join(HERE, `run-${product}-${run}.jsonl`);
  const usageDir = join(P.usageDir, `run-${run}`);
  const ctx = { sessionIds: new Map() };
  const rows = [];

  console.log(`[${P.label}] 회차 ${run} · ${TURNS.turnsPerRun}턴 · 모델 ${model}${dryRun ? ' · DRY RUN' : ''}`);
  if (TURNS.turns.length !== TURNS.turnsPerRun) {
    console.error(`실행표 불일치: ${TURNS.turns.length}턴 정의 vs ${TURNS.turnsPerRun} 선언`);
    process.exit(2);
  }

  freshHome();
  rmSync(usageDir, { recursive: true, force: true });
  mkdirSync(usageDir, { recursive: true });
  writeFileSync(outPath, '');

  for (const turn of TURNS.turns) {
    ctx.turnUsagePath = join(usageDir, `t${String(turn.seq).padStart(2, '0')}-${turn.id}.json`);
    for (const step of turn.setup ?? []) {
      if (step === 'home:fresh') continue; // 이미 회차 시작에서 했다
      if (step.startsWith('fixture:')) await fixture(step.split(':')[1]);
    }

    if (dryRun) {
      const { file, args } = P.turnCmd(turn, ctx);
      console.log(`  ${String(turn.seq).padStart(2)} ${turn.id.padEnd(8)} ${turn.state ?? 'independent'}`);
      console.log(`     ${file} ${args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`);
      continue;
    }

    const r = await runTurn(turn, ctx);
    // 제품이 알려준 세션 ID 를 기억해 다음 턴이 같은 대화를 잇게 한다.
    if (r.usage.sessionId && !ctx.sessionIds.has(turn.session)) {
      ctx.sessionIds.set(turn.session, r.usage.sessionId);
    }
    rows.push(r.usage);
    appendFileSync(outPath, `${JSON.stringify(r)}\n`);
    const calls = r.usage.apiCalls ?? '기록없음';
    console.log(
      `  ${String(r.seq).padStart(2)} ${r.id.padEnd(8)} exit=${r.exitCode} ` +
      `첫표시=${r.firstOutputMs ?? '-'}ms 최장공백=${r.longestGapMs}ms 총=${r.totalMs}ms 호출=${calls}`,
    );
    if (r.exitCode !== 0) console.log(`     ! ${r.stderr.trim().split('\n')[0] ?? ''}`);
  }

  await fixture('clean');
  if (!dryRun) {
    // 회차 합계도 제품 값의 합일 뿐이다. 빈 칸은 채우지 않는다.
    const calls = sumNums(rows, 'apiCalls');
    const cost = sumNums(rows, 'costUsd');
    const tin = sumNums(rows, 'tokensIn');
    const tout = sumNums(rows, 'tokensOut');
    const tiers = [...new Set(rows.map((r) => r.serviceTier).filter(Boolean))];
    console.log(
      `\n회차 ${run} 실측 — 모델 호출 ${calls ?? '기록없음'} · 비용 ` +
      `${cost === null ? '기록없음' : `$${cost.toFixed(4)}`} · in ${tin ?? '-'} · out ${tout ?? '-'}` +
      (tiers.length ? ` · tier ${tiers.join(',')}` : ''),
    );
    console.log(`턴 기록: ${outPath}`);
    console.log(`제품 usage 원본: ${usageDir}`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
// 생활모의 7과목 — Claude Code(opus) 팔. Hermes 팔과 대칭 계약:
// 격리 방(cwd=방) · 세션 이어가기(--resume) · 과목당 1회 · 재실행 0 · 전/후 방 걷기 · 산출물 수집.
// 비대칭 정직 고지: Hermes 는 방에 자격 사본(HOME=방), Claude 는 실HOME 자격을 쓰고 cwd 만 격리한다
//   (키체인 자격이 HOME 격리에서 안 서는 제품 성질 — 대신 오너 실자리 전후 감시를 붙인다).
// 모델: claude opus (T5 최불리 방향 동결 — 비교군에 가장 센 것을 준다). 모델 다름은 판정에 병기.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, relative, dirname } from 'node:path';

const repo = '/Users/jyp/Developer/t5-p-op';
const OUT = process.argv[2] ?? '/private/tmp/claude-501/-Users-jyp-Developer-t5-p-op/35ec8f7b-a7e5-48ec-af48-1db3b615756a/scratchpad/claude-livingsim-result.json';
const MODEL = process.env.ARM_MODEL ?? 'opus';
const spec = JSON.parse(await readFile(join(repo, 'scripts/human-use/living-sim-pilot-v1.json'), 'utf8'));

function 실행(cmd, args, opts) {
  return new Promise((ok) => {
    const start = Date.now();
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 300_000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => { clearTimeout(timer); ok({ exitCode: code, stdout: out, stderr: err, 걸린ms: Date.now() - start }); });
  });
}

async function 걷기(root) {
  const out = [];
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (['.claude', 'tmp', 'node_modules', '.git'].includes(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p); else out.push(relative(root, p));
    }
  }
  await walk(root);
  return out.sort();
}

// 오너 실자리 감시 — 이 팔은 실HOME 을 쓰므로 전후 목록을 반드시 남긴다.
async function 실자리지문() {
  const 자리 = [join(homedir(), '.local/state/gpao-t5'), join(homedir(), 'Desktop'), join(homedir(), 'Documents')];
  const out = {};
  for (const d of 자리) {
    try { out[d] = (await readdir(d)).sort().join('|').slice(0, 4000); } catch { out[d] = null; }
  }
  return out;
}

const 결과 = { kind: 'claude-livingsim', model: MODEL, startedAt: new Date().toISOString(), scenarios: [] };
결과.실자리전 = await 실자리지문();
for (const sc of spec.scenarios) {
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 'c-ls-')));
  const rec = { id: sc.id, 방, 턴들: [], 새파일: [], 실물: {}, 비용: 0 };
  let server = null;
  try {
    for (const [name, content] of Object.entries(sc.fixture ?? {})) {
      const p = join(방, name);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, 'utf8');
    }
    let base = '';
    if (sc.webFixture) {
      server = createServer((req, res) => {
        const body = sc.webFixture[req.url];
        if (body === undefined) { res.writeHead(404); res.end('없음'); return; }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body);
      });
      await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
      base = `http://127.0.0.1:${server.address().port}`;
    }
    const 전 = await 걷기(방);
    let 세션 = null;
    for (const rawTurn of sc.turns) {
      const 승인자리 = typeof rawTurn !== 'string';
      const 말 = 승인자리 ? '응, 진행해.' : String(rawTurn).replaceAll('{{WEB_BASE}}', base);
      const args = ['-p', 말, '--output-format', 'json', '--dangerously-skip-permissions', '--model', MODEL,
        ...(세션 ? ['--resume', 세션] : [])];
      const r = await 실행('claude', args, { cwd: 방, env: { ...process.env, TMPDIR: join(방, 'tmp') } });
      let j = null;
      try { j = JSON.parse(r.stdout); } catch { /* 비JSON */ }
      if (j?.session_id) 세션 = j.session_id;
      rec.비용 += Number(j?.total_cost_usd ?? 0);
      rec.턴들.push({
        말, ...(승인자리 ? { 원턴: '승인자리' } : {}), exitCode: r.exitCode, 걸린ms: r.걸린ms,
        답: String(j?.result ?? r.stdout).slice(0, 8000), isError: j?.is_error ?? null, 세션,
      });
      process.stderr.write(`[${sc.id}] 턴 ${rec.턴들.length}/${sc.turns.length} exit ${r.exitCode} ${r.걸린ms}ms\n`);
      if (r.exitCode !== 0 && !세션) break;
    }
    const 후 = await 걷기(방);
    rec.새파일 = 후.filter((p) => !전.includes(p));
    for (const p of rec.새파일.slice(0, 8)) {
      try { rec.실물[p] = (await readFile(join(방, p), 'utf8')).slice(0, 3000); } catch { /* 이진 */ }
    }
    rec.고정물사후 = {};
    for (const name of Object.keys(sc.fixture ?? {})) {
      try { rec.고정물사후[name] = (await readFile(join(방, name), 'utf8')).slice(0, 500); } catch { rec.고정물사후[name] = null; }
    }
  } finally {
    if (server) await new Promise((ok) => server.close(ok));
    await rm(방, { recursive: true, force: true });
  }
  결과.scenarios.push(rec);
  await writeFile(OUT, JSON.stringify(결과, null, 1), 'utf8');
}
결과.실자리후 = await 실자리지문();
결과.finishedAt = new Date().toISOString();
결과.총비용 = 결과.scenarios.reduce((a, s) => a + s.비용, 0);
await writeFile(OUT, JSON.stringify(결과, null, 1), 'utf8');
console.log('완료 →', OUT, '· 총비용 USD', 결과.총비용.toFixed(2));

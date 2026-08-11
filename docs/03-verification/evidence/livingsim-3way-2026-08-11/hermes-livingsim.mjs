#!/usr/bin/env node
// 생활모의 7과목 — Hermes(gpt-5.1) 팔. step6 Hermes회차 계약 계승:
// 격리 방(HOME=방·cwd=방) · 오너 ~/.hermes 자격 읽기만 복사 · hermes chat --resume 세션 유지 ·
// 전/후 방 걷기 · 산출물 실물 수집 · 과목당 1회 · 재실행 0. L3 웹픽스처는 로컬 서버로 공급.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = '/Users/jyp/Developer/t5-p-op';
const OUT = process.argv[2] ?? '/private/tmp/claude-501/-Users-jyp-Developer-t5-p-op/35ec8f7b-a7e5-48ec-af48-1db3b615756a/scratchpad/hermes-livingsim-result.json';
const 진짜홈 = homedir();
const spec = JSON.parse(await readFile(join(repo, 'scripts/human-use/living-sim-pilot-v1.json'), 'utf8'));

function 실행(cmd, args, opts) {
  return new Promise((resolveRun) => {
    const start = Date.now();
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); }, 240_000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ exitCode: code, stdout: out, stderr: err, 걸린ms: Date.now() - start, timedOut: Date.now() - start >= 239_000 });
    });
  });
}

async function 방걷기(root) {
  const out = [];
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (['.hermes', 'tmp', '.cache', '.config', '.local', 'Library', 'node_modules'].includes(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p); else out.push(relative(root, p));
    }
  }
  await walk(root);
  return out.sort();
}

const { 저장된연결 } = await import(pathToFileURL(join(repo, 'scripts/s1/run.mjs')).href);
const 연결 = 저장된연결();
if (연결?.provider !== 'openai') throw new Error('OPENAI 자격 필요');

const 결과 = { kind: 'hermes-livingsim', model: 'gpt-5.1', startedAt: new Date().toISOString(), scenarios: [] };
for (const sc of spec.scenarios) {
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 'h-ls-')));
  const rec = { id: sc.id, 방, 턴들: [], 새파일: [], 실물: {} };
  let server = null;
  try {
    // 고정물 — 방 루트에
    for (const [name, content] of Object.entries(sc.fixture ?? {})) {
      const p = join(방, name);
      await mkdir(join(p, '..'), { recursive: true }).catch(() => {});
      await writeFile(p, content, 'utf8');
    }
    // 웹 픽스처
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
    // Hermes 방 자격
    const 원 = join(진짜홈, '.hermes'); const 사본 = join(방, '.hermes');
    await mkdir(사본, { recursive: true });
    for (const f of ['config.yaml', 'auth.json', 'models_dev_cache.json']) {
      if (existsSync(join(원, f))) await copyFile(join(원, f), join(사본, f));
    }
    const env = { PATH: process.env.PATH, HOME: 방, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', TERM: 'dumb', TMPDIR: join(방, 'tmp'), OPENAI_API_KEY: 연결.자격 };
    await mkdir(env.TMPDIR, { recursive: true });
    const 전 = await 방걷기(방);
    let 세션id = null;
    for (const rawTurn of sc.turns) {
      // T5 승인 카드 응답 자리(object) → 다른 하네스에는 사용자 동의 발화로 번역(채점 전 동결).
      const 승인자리 = typeof rawTurn !== 'string';
      const 말 = 승인자리 ? '응, 진행해.' : String(rawTurn).replaceAll('{{WEB_BASE}}', base);
      const args = ['chat', ...(세션id ? ['--resume', 세션id] : []), '-q', 말, '-m', 'gpt-5.1', '--yolo'];
      const r = await 실행('hermes', args, { cwd: 방, env });
      const m = r.stdout.match(/Session:\s+(\S+)/);
      if (m) 세션id = m[1];
      rec.턴들.push({ 말, ...(승인자리 ? { 원턴: '승인자리' } : {}), exitCode: r.exitCode, 걸린ms: r.걸린ms, 답: r.stdout.slice(0, 8000), stderr: r.stderr.slice(0, 800), 세션id, ...(r.timedOut ? { timedOut: true } : {}) });
      process.stderr.write(`[${sc.id}] 턴 ${rec.턴들.length}/${sc.turns.length} exit ${r.exitCode} ${r.걸린ms}ms\n`);
      if (r.exitCode !== 0 && !세션id) break;
    }
    const 후 = await 방걷기(방);
    rec.새파일 = 후.filter((p) => !전.includes(p));
    for (const p of rec.새파일.slice(0, 8)) {
      try { rec.실물[p] = (await readFile(join(방, p), 'utf8')).slice(0, 3000); } catch { /* 이진 */ }
    }
    // 고정물 사후(변조 확인)
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
결과.finishedAt = new Date().toISOString();
await writeFile(OUT, JSON.stringify(결과, null, 1), 'utf8');
console.log('완료 →', OUT);

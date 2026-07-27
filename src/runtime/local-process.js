// L3 · 장기 프로세스 (P6-T3) — **켠 것을 기억하고, 진짜 살아있는지 보고, 사용자가 말하면 끈다.**
//
// terminal 과 나누는 이유는 수명이다. 명령은 한 턴에 끝나지만 서버는 턴을 넘어 산다.
// receipt(한 턴의 기록)로는 "아까 켠 서버 꺼줘"를 못 한다 — 지속 상태가 있어야 한다.
//
// 이 표면의 계약 한 줄: **죽은 프로세스를 살아있다고 말하지 않는다.**
// 기록에 'running' 이 남아 있는 것과 실제로 도는 것은 다른 사실이다. 매번 확인한다.
import { spawn } from 'node:child_process';
import { open, readFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { lifecycleRisk, lifecycleMessage } from './lifecycle-guard.js';
import { protectionFor } from './local-protection.js';

/** dataDir 을 안 받았을 때의 자리. **소스 트리에는 절대 쓰지 않는다**(게이트가 검사한다). */
function defaultStateDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

const LOG_TAIL_CHARS = 4000; // 로그를 통째로 던지지 않는다 — 모델도 사용자도 못 읽는다

/** PID 가 **지금** 살아있는가. 기록이 아니라 커널에 묻는다. */
export function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
}

/** 로그 끝부분. 앞은 이미 지나간 일이고, 안 켜지는 이유는 대개 끝에 있다. */
async function tail(file, chars = LOG_TAIL_CHARS) {
  try {
    const info = await stat(file);
    const from = Math.max(0, info.size - chars);
    const fh = await open(file, 'r');
    try {
      const buf = Buffer.alloc(info.size - from);
      await fh.read(buf, 0, buf.length, from);
      return { text: (from > 0 ? '…(앞부분 생략)…\n' : '') + buf.toString('utf8'), bytes: info.size };
    } finally { await fh.close(); }
  } catch { return { text: '', bytes: 0 }; }
}

/**
 * @param {{store:import('./process-store.js').ProcessStore, cwd?:string, dataDir?:string, logDir?:string}} deps
 */
export function makeLocalProcessTool(deps = {}) {
  const store = deps.store;
  // 로그도 **사용자 데이터**다. dataDir 이 없다고 /tmp 로 흩어지면 다음 실행에서 못 찾고,
  // 사용자는 "왜 안 켜졌는지" 답을 영영 못 듣는다(라이브에서 실제로 /tmp 로 샜다).
  const logDir = deps.logDir ?? join(deps.dataDir ?? defaultStateDir(), 'process-logs');
  const guardCtx = () => ({ dataDir: deps.dataDir });

  const ok = (userSafeSummary, result) => ({ result, userSafeSummary });
  const fail = (userSafeSummary, nextSafeAction) => ({ blocked: true, userSafeSummary, nextSafeAction });

  /** 기록 위에 **지금 사실**을 얹는다. 이 함수를 거치지 않고 기록을 그대로 말하면 거짓이 된다. */
  async function 지금상태(p) {
    const 산다 = alive(p.pid);
    if (!산다 && p.status === 'running') {
      await store.update(p.id, { status: 'exited', endedAt: new Date().toISOString() });
      return { ...p, status: 'exited', endedAt: new Date().toISOString() };
    }
    return { ...p, status: 산다 ? 'running' : (p.status === 'running' ? 'exited' : p.status) };
  }

  return {
    async handler(args = {}) {
      if (!store) return fail('지금은 프로세스를 다루는 기능이 준비되지 않았어요.');
      const action = args.action ?? 'status';

      // ── 시작 ────────────────────────────────────────────────────────
      if (action === 'start') {
        const command = String(args.command ?? '').trim();
        if (!command) return fail('무엇을 켤지 알려주세요.', '실행할 명령이나 하려는 일을 말씀해 주세요.');

        const risk = lifecycleRisk(command, guardCtx());
        if (risk) return { blocked: true, lifecycleBlocked: true, ...lifecycleMessage(risk) };

        const cwd = args.cwd ? String(args.cwd) : (deps.cwd ?? process.cwd());
        const prot = protectionFor(cwd);
        if (prot?.kind === 'secret') {
          return { blocked: true, scopeState: 'protected', userSafeSummary: `그 자리에서는 실행하지 않아요 — ${prot.why}.` };
        }

        const id = randomUUID().slice(0, 8);
        await mkdir(logDir, { recursive: true });
        const logFile = join(logDir, `${id}.log`);
        const fh = await open(logFile, 'a');
        // detached: T5 가 꺼져도 서버는 살아 있어야 한다. 그래서 기록을 파일에 남기는 것이다.
        const child = spawn('/bin/zsh', ['-c', command], {
          cwd, detached: true, stdio: ['ignore', fh.fd, fh.fd],
        });
        child.unref();
        await fh.close();

        const proc = {
          id, command, cwd, pid: child.pid, logFile,
          label: args.label ? String(args.label) : command.slice(0, 40),
          startedAt: new Date().toISOString(), status: 'running',
          ...(args.port ? { port: Number(args.port) } : {}),
        };
        await store.add(proc);

        // **바로 살아있다고 하지 않는다.** 잘못된 명령은 순식간에 죽는데, 그걸 "켰어요"라고 하면
        // 사용자는 켜진 줄 알고 기다린다. 잠깐 두고 확인한 뒤 사실대로 말한다.
        // 통째로 기다리지 않고 지켜본다 — 죽으면 그 순간 알 수 있으니 사용자를 세워 둘 이유가 없다.
        const settle = args.settleMs ?? 700;
        let 산다 = true;
        for (let t = 0; t < settle; t += 50) {
          await new Promise((r) => setTimeout(r, 50));
          if (!alive(child.pid)) { 산다 = false; break; }
        }
        const 로그 = await tail(logFile, 1200);
        if (!산다) {
          await store.update(id, { status: 'exited', endedAt: new Date().toISOString() });
          return {
            blocked: true,
            result: { id, command, cwd, pid: child.pid, status: 'exited', logTail: 로그.text },
            userSafeSummary: '시작하자마자 꺼졌어요 — 켜진 게 아니에요.',
            nextSafeAction: 로그.text ? '로그 끝부분을 같이 보고 원인을 찾아볼게요.' : '명령이 맞는지 같이 확인해 볼까요?',
          };
        }
        return ok(`켰어요 (pid ${child.pid}). 끄고 싶으시면 말씀만 하세요.`,
          { id, command, cwd, pid: child.pid, status: 'running', logFile, logTail: 로그.text });
      }

      // ── 상태 ────────────────────────────────────────────────────────
      if (action === 'status' || action === 'list') {
        const 찾은것 = await store.find(args.target ?? args.id ?? args.name);
        const 목록 = await Promise.all(찾은것.map(지금상태));
        const 산다 = 목록.filter((p) => p.status === 'running');
        return ok(
          목록.length === 0 ? '제가 켜 둔 건 없어요.'
            : 산다.length === 0 ? `${목록.length}개 있었는데 지금 도는 건 없어요.`
              : `${산다.map((p) => `${p.label}(pid ${p.pid})`).join(', ')} 가 돌고 있어요.`,
          { procs: 목록 },
        );
      }

      // ── 로그 ────────────────────────────────────────────────────────
      if (action === 'logs') {
        const [p] = await store.find(args.target ?? args.id ?? args.name);
        if (!p) return fail('그런 건 못 찾았어요.', '제가 켜 둔 것 목록부터 보여드릴까요?');
        const now = await 지금상태(p);
        const 로그 = await tail(p.logFile, Number(args.chars) || LOG_TAIL_CHARS);
        return ok(
          `${p.label} 로그 끝부분이에요${now.status === 'running' ? '' : ' (지금은 꺼져 있어요)'}.`,
          { id: p.id, pid: p.pid, status: now.status, logTail: 로그.text, logBytes: 로그.bytes, logFile: p.logFile },
        );
      }

      // ── 중지 ────────────────────────────────────────────────────────
      if (action === 'stop') {
        const [p] = await store.find(args.target ?? args.id ?? args.name);
        if (!p) return fail('그런 건 못 찾았어요.', '제가 켜 둔 것 목록부터 보여드릴까요?');
        const risk = lifecycleRisk(`kill ${p.pid}`, guardCtx());
        if (risk) return { blocked: true, lifecycleBlocked: true, ...lifecycleMessage(risk) };
        if (!alive(p.pid)) {
          await store.update(p.id, { status: 'exited' });
          return ok('그건 이미 꺼져 있어요.', { id: p.id, pid: p.pid, status: 'exited', alreadyStopped: true });
        }
        try { process.kill(p.pid, 'SIGTERM'); } catch { /* 그 사이 죽었을 수 있다 */ }
        // 얌전히 끝날 시간을 준 뒤, 그래도 살아있으면 확실히 끈다.
        // 촘촘히 지켜본다 — 대개 곧바로 끝나는데 성글게 보면 그만큼 사용자를 세워 둔다.
        for (let i = 0; i < 40 && alive(p.pid); i += 1) await new Promise((r) => setTimeout(r, 25));
        let 강제 = false;
        if (alive(p.pid)) {
          강제 = true;
          try { process.kill(p.pid, 'SIGKILL'); } catch { /* 이미 죽음 */ }
          await new Promise((r) => setTimeout(r, 200));
        }
        const 아직산다 = alive(p.pid);
        await store.update(p.id, { status: 아직산다 ? 'running' : 'stopped', endedAt: new Date().toISOString() });
        // **못 껐으면 껐다고 하지 않는다.**
        if (아직산다) return fail(`${p.label} 이(가) 안 꺼져요 (pid ${p.pid}).`, '권한 문제일 수 있어요 — 터미널에서 직접 끄시면 그 뒤로 이어서 도울게요.');
        return ok(`${p.label} 껐어요.`, { id: p.id, pid: p.pid, status: 'stopped', forced: 강제 });
      }

      return fail(`'${action}' 은(는) 제가 할 수 있는 작업이 아니에요.`, '켜기·상태 보기·로그 보기·끄기가 가능해요.');
    },
  };
}

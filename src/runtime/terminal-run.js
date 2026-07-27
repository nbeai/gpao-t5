// L3 · 명령 실행 (P6-T1) — **터미널은 사용자에게 떠넘기는 것이 아니라 T5 의 손발이다.**
//
// 셸을 통째로 준다. 파이프·리다이렉션·`&&`·서브셸 전부. 안 그러면 `npm test 2>&1 | tail` 도 못 하고,
// 그러면 사용자가 다시 터미널을 켜야 한다 — 그게 우리가 없애려는 바로 그 실패다.
//
// 안전은 명령을 좁혀서가 아니라 **실행 환경**에서 온다(sandbox.js):
//   ① probe 로 먼저 돌린다 — 성공하면 아무것도 안 바꿨다는 증명이라 그대로 쓴다.
//   ② 막히면 승인을 받고 granted 로 다시 돌린다. 그때도 비밀 자리는 닫혀 있다.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxProfile, sandboxAvailable } from './sandbox.js';

export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT = 30_000; // 모델 입력을 삼키지 않게. 넘으면 **잘랐다고 말한다**(조용한 절단 금지).

/** 가운데를 접는다. 앞은 무슨 일이 시작됐는지, 뒤는 어떻게 끝났는지 — 둘 다 필요하다. */
function fold(text, max = MAX_OUTPUT) {
  if (text.length <= max) return { text, truncated: false };
  const head = Math.floor(max * 0.4);
  const tail = max - head;
  const cut = text.length - max;
  return {
    text: `${text.slice(0, head)}\n…(가운데 ${cut}자 생략)…\n${text.slice(-tail)}`,
    truncated: true, omittedChars: cut,
  };
}

/**
 * 명령 한 번 실행. **이 함수는 승인을 판단하지 않는다** — 시키는 모드로 돌리고 사실만 돌려준다.
 * @param {string} command 셸 명령 원문
 * @param {{mode?:'probe'|'granted'|'raw', cwd?:string, timeoutMs?:number, env?:object, signal?:AbortSignal}} opts
 */
export async function runCommand(command, opts = {}) {
  const mode = opts.mode ?? 'probe';
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs = Math.min(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const startedAt = Date.now();

  let profileDir; let argv;
  if (mode === 'raw' || !sandboxAvailable()) {
    argv = ['/bin/zsh', ['-c', command]];
  } else {
    profileDir = await mkdtemp(join(tmpdir(), 'gpao-t5-sb-'));
    const file = join(profileDir, 'p.sb');
    await writeFile(file, sandboxProfile(mode), 'utf8');
    argv = ['/usr/bin/sandbox-exec', ['-f', file, '/bin/zsh', '-c', command]];
  }

  try {
    const child = spawn(argv[0], argv[1], {
      cwd,
      // 비밀은 자식에게 넘기지 않는다 — 명령이 `env` 만 찍어도 새어 나간다.
      env: { ...redactEnv(opts.env ?? process.env), GPAO_T5_IN_TOOL: '1' },
      stdio: ['ignore', 'pipe', 'pipe'], // stdin 은 닫는다: 비밀번호·y/n 프롬프트에서 영원히 멈추지 않게
    });

    let out = ''; let err = ''; let killed = null;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });

    const timer = setTimeout(() => {
      killed = 'timeout';
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    }, timeoutMs);
    const onAbort = () => { killed = 'aborted'; child.kill('SIGTERM'); };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const exitCode = await new Promise((res) => {
      child.on('error', () => res(-1));
      child.on('close', (code) => res(code ?? -1));
    });
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);

    const stdout = fold(out); const stderr = fold(err);
    return {
      command, cwd, mode,
      exitCode, durationMs: Date.now() - startedAt,
      stdout: stdout.text, stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
      omittedChars: (stdout.omittedChars ?? 0) + (stderr.omittedChars ?? 0),
      // **끝난 이유를 남긴다.** 시간이 다 돼서 죽인 것과 명령이 실패한 것은 다른 사실이다.
      ...(killed ? { stopped: killed } : {}),
    };
  } finally {
    if (profileDir) await rm(profileDir, { recursive: true, force: true });
  }
}

/** 자식에게 넘기지 않을 환경변수. 명령 하나가 `env` 만 찍어도 토큰이 화면에 나온다. */
function redactEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|SESSION)/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

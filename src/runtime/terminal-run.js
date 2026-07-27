// L3 · 명령 실행 (P6-T1) — **터미널은 사용자에게 떠넘기는 것이 아니라 T5 의 손발이다.**
//
// 셸을 통째로 준다. 파이프·리다이렉션·`&&`·서브셸 전부. 안 그러면 `npm test 2>&1 | tail` 도 못 하고,
// 그러면 사용자가 다시 터미널을 켜야 한다 — 그게 우리가 없애려는 바로 그 실패다.
//
// 안전은 명령을 좁혀서가 아니라 **실행 환경**에서 온다(sandbox.js):
//   ① probe 로 먼저 돌린다 — 성공하면 아무것도 안 바꿨다는 증명이라 그대로 쓴다.
//   ② 막히면 승인을 받고 granted 로 다시 돌린다. 그때도 비밀 자리는 닫혀 있다.
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
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

  let profileDir; let argv; let scratch;
  if (mode === 'raw' || !sandboxAvailable()) {
    argv = ['/bin/zsh', ['-c', command]];
  } else {
    profileDir = await mkdtemp(join(tmpdir(), 'gpao-t5-sb-'));
    const file = join(profileDir, 'p.sb');
    if (mode === 'probe') {
      // 이번 실행만 쓰는 임시 자리. 셸의 heredoc·here-string 이 여기에 쓴다 — 이게 없으면
      // 읽기만 하는 명령이 "파일을 바꾸려 했다"로 잡혀 승인 카드로 간다(sandbox.js 주석 참고).
      // realpath 로 편다: macOS 의 /var 는 /private/var 로 가는 심볼릭 링크라, 편 경로가 아니면
      // 프로파일의 subpath 가 실제 접근 경로와 안 맞아 조용히 안 열린다.
      scratch = await realpath(await mkdir(join(profileDir, 'tmp')).then(() => join(profileDir, 'tmp')));
    }
    // allowRead: 커넥터가 선언한 자리만 도로 연다(그 명령의 자기 자격). 선언이 없으면 그대로 막힌다.
    await writeFile(file, sandboxProfile(mode, { scratch, allowRead: opts.allowRead }), 'utf8');
    argv = ['/usr/bin/sandbox-exec', ['-f', file, '/bin/zsh', '-c', command]];
  }

  try {
    const child = spawn(argv[0], argv[1], {
      cwd,
      // 비밀은 자식에게 넘기지 않는다 — 명령이 `env` 만 찍어도 새어 나간다.
      // 임시 자리를 만들었으면 셸과 자식 프로그램에게 **거기를 쓰라고** 알려준다.
      // TMPDIR 만으로는 부족하다 — zsh 의 TMPPREFIX 는 $TMPDIR 에서 나오지 않고 컴파일 시점
      // 기본값(`/tmp/zsh`)을 쓴다. 실측으로 확인했다: TMPDIR 을 옮겨도 TMPPREFIX 는 /tmp/zsh 였고
      // heredoc 은 그대로 막혔다. heredoc 임시 파일은 TMPPREFIX 를 따르므로 이걸 같이 옮겨야 한다.
      env: {
        ...redactEnv(opts.env ?? process.env),
        GPAO_T5_IN_TOOL: '1',
        ...(scratch ? { TMPDIR: scratch, TMP: scratch, TEMP: scratch, TMPPREFIX: join(scratch, 'zsh') } : {}),
      },
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

    // 실행 자체가 안 된 이유를 **버리지 않는다.** 예전엔 error 를 삼켜서 exitCode -1 에
    // stderr 도 비어 있었다 — 모델도 사용자도 "왜 실패했는지" 알 방법이 없었다(라이브 실측).
    let spawnError;
    const exitCode = await new Promise((res) => {
      child.on('error', (e) => { spawnError = e; res(-1); });
      child.on('close', (code) => res(code ?? -1));
    });
    if (spawnError) err += `${err ? '\n' : ''}실행을 시작하지 못했어요: ${spawnError.message}`;
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

/**
 * 실행이 **왜** 끝났는가. 세 가지를 섞으면 사용자가 잘못된 결론을 낸다:
 *   · sandbox   — 우리 안전 시험 실행이 막았다. **코드 문제가 아니다.**
 *   · env       — 명령·런타임이 이 컴퓨터에 없다.
 *   · code      — 명령이 자기 일을 하다 실패했다(단언 실패 등). 이것만 "실패했다"고 말한다.
 *
 * 실측: `npm test` 가 probe 에서 `EPERM listen` 으로 죽었는데 T5 가 "테스트가 실패했다"고
 * 답했다. 사용자는 코드가 잘못된 줄 알았지만 원인은 우리 샌드박스였다.
 *
 * **이건 안전 판정의 근거가 아니다.** 안전은 커널이 이미 보장했다(막혔으니 아무 일도 안 났다).
 * 여기서 정하는 것은 사용자에게 뭐라고 말할지와, 승인을 물을지뿐이다.
 */
export function executionBlock(r) {
  if (!r || r.exitCode === 0) return undefined;
  const t = `${r.stderr ?? ''}\n${r.stdout ?? ''}`;
  // 포트를 열려다 막힌 것 — 서버를 띄우는 테스트·빌드에서 가장 흔하다.
  if (/\bEPERM\b|\bEACCES\b/i.test(t) && /listen|bind|port|socket|server/i.test(t)) {
    return { kind: 'sandbox', why: 'network', userWhy: '포트를 열어야 하는 일이 있어서 안전 시험 실행에서는 막혔어요' };
  }
  // 밖으로 나가려다 막힌 것
  if (/ENETUNREACH|ENOTFOUND|EAI_AGAIN|Could not resolve|Network is unreachable|Connection refused/i.test(t)) {
    return { kind: 'sandbox', why: 'network', userWhy: '인터넷에 연결해야 해서 안전 시험 실행에서는 막혔어요' };
  }
  // `launchctl setenv`·`config`처럼 파일 오류는 없지만 **컴퓨터 상태를 바꾸려다** OS 권한에
  // 막히는 경우. "아무 일도 안 바뀌었다"와 "읽기였다"를 섞으면 승인 경로가 사라진다.
  // sandbox가 막은 쓰기와 달리 OS 권한 신호지만, 계획 단계에서는 둘 다 사용자 승인 뒤에만
  // 실제 실행할 수 있는 변경 시도라는 사실이 같다.
  if (/not privileged|requires root|must be run as root/i.test(t)) {
    return { kind: 'permission', why: 'privilege', userWhy: '컴퓨터 설정을 바꾸려 했는데 권한이 필요해 안전 시험 실행에서 멈췄어요' };
  }
  // 파일을 바꾸려다 막힌 것
  if (/operation not permitted|not permitted|Permission denied|EPERM|EACCES|EROFS/i.test(t)) {
    return { kind: 'sandbox', why: 'write', userWhy: '파일을 바꿔야 해서 안전 시험 실행에서는 막혔어요' };
  }
  if (/command not found|No such file or directory: |ENOENT.*spawn|실행을 시작하지 못했어요/i.test(t)) {
    return { kind: 'env', why: 'missing', userWhy: '그 명령이 이 컴퓨터에 없어요' };
  }
  return { kind: 'code', why: 'failed', userWhy: '명령이 오류로 끝났어요' };
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

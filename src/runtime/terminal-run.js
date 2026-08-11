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
    // `reach` 도 쓰기가 막힌 모드다 — 셸이 heredoc 을 못 쓰면 읽기만 하는 명령이
    // "파일을 바꾸려 했다"로 잡힌다(아래 주석의 그 사고). probe 와 같은 이유로 같이 연다.
    if (mode === 'probe' || mode === 'reach') {
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
/**
 * 막힌 이름이 **명령이 놓이는 자리**에 있었는가. 파이프·`&&`·`;` 뒤도 명령 자리다.
 * 리다이렉트 대상(`> out`)은 명령 자리가 아니다 — 그래서 쓰기 시도와 안 섞인다.
 */
function 명령어자리인가(이름, command) {
  const 조각들 = String(command ?? '').split(/\||&&|\|\||;|\bthen\b|\bdo\b|\$\(|`/);
  const 이름끝 = 이름.split('/').pop();
  return 조각들.some((조각) => {
    const 첫단어 = 조각.trim().split(/\s+/)[0] ?? '';
    if (!첫단어) return false;
    // `env`·`command` 같은 앞말이 붙어도 뒤가 실제 명령이다. 앞 두 단어까지만 본다.
    const 후보 = 조각.trim().split(/\s+/).slice(0, 2).map((w) => w.split('/').pop());
    return 후보.includes(이름끝);
  });
}

/**
 * **"승인만 받으면 되는 일"과 "승인해도 안 되는 일"을 같은 말로 부르지 않는다.**
 *
 * 헤르메스 대조 실측(2026-08-03, 같은 미션): 헤르메스는 폴더 정리를 한 번에 끝냈고 T5 는
 * 사용자에게 **"파인더에서 직접 폴더를 만들어 주세요"** 라고 떠넘겼다. T5 의 터미널이
 * 실제로 막혀서가 아니다 — `probe`(쓰기를 막은 시험 실행)가 낸 `Operation not permitted` 를
 * 모델이 **시스템의 거부**로 읽었기 때문이다. 우리가 그렇게 말했다:
 *   "…안전 시험 실행에서는 **막혔어요**" + stderr 의 "Operation not permitted"
 *
 * 그건 실패가 아니라 **판정 성공**이다 — "이 명령은 파일을 바꾼다"를 알아냈고, 승인 한 번이면
 * 그대로 실행된다. 오너 기준 「안 해 본 일을 '막혔다'고 말하지 않는다」를 T5 자신이 어겼다.
 *
 * 그래서 `sandbox`·`permission`(승인하면 되는 것)은 확인 요청의 언어로 말하고,
 * `env`(승인해도 안 되는 것 — 없는 명령·못 띄우는 도구)는 그대로 둔다. 둘을 섞으면
 * 모델은 되는 일도 포기하고 사용자에게 넘긴다.
 */
/**
 * **실패를 삼키는 명령은 exit code 로 판정할 수 없다.**
 *
 * 헤르메스 대조 실측(2026-08-03): 모델이 `mkdir … && mv … 2>/dev/null || true` 를 냈다.
 * 샌드박스가 mkdir 을 막았지만 `|| true` 가 exit code 를 0 으로 만들었고, 아래 첫 줄이
 * "exit 0 이면 막힘 없음"으로 보아 **probe 실행을 진짜 실행 성공으로 처리**했다.
 * 원장에 `실행했어요 · failureState: none` 이 남았는데 디스크는 하나도 안 바뀌었다 —
 * T5 가 **하지 않은 일을 했다고 적은 것**이다(오너 절대 원칙 위반, 모델이 아니라 런타임이).
 *
 * 위험 명령 목록으로 알아맞히지 않는다(그건 다음 문법에서 또 샌다). 재는 것은 **구문 사실**
 * 하나다: 이 명령은 자기 실패를 감추는가. 그렇다면 exit code 는 정보가 아니므로 판정 불능이고,
 * T5 의 기존 원칙대로 **모르면 승인으로 간다.**
 */
const 실패를삼킴 = /\|\|\s*(?:true|:)\s*(?:$|&|;|\))|2\s*>\s*(?:\/dev\/null|&1\s*>\s*\/dev\/null)|(?:^|\s)set\s+\+e(?:\s|$)/;

export function executionBlock(r) {
  if (!r) return undefined;
  if (r.exitCode === 0 && 실패를삼킴.test(String(r.command ?? ''))) {
    return {
      kind: 'sandbox',
      why: 'unreadable_exit',
      userWhy: '이 명령은 실패해도 성공처럼 끝나서 시험만으로는 결과를 알 수 없어요'
        + ' — 확인만 받으면 바로 실행해요. 아직 아무것도 안 바뀌었어요',
    };
  }
  // **우리가 막은 사실은 exit code 보다 세다**(라이브 실측 2026-08-11 · 3회차).
  //
  // 위 `실패를삼킴` 과 **같은 병의 다른 얼굴**이다: exit code 가 사실을 못 담는 자리.
  // 거기는 `|| true` 였고 여기는 `;` 사슬이다 — 실측 원문:
  // ```
  // W=$(mktemp -d); mkdir -p "$W/xl"; …; zip -q -r -X "$OUT" .; file "$OUT"
  // stderr  mktemp: mkdtemp failed …: Operation not permitted
  //         mkdir: /xl: Operation not permitted
  // exit    0        ← 사슬의 **마지막** `file` 이 성공해서다
  // ```
  // probe 가 정확히 제 일을 했는데(쓰기를 막았다) 아래 첫 줄이 「막힌 것 없음」으로 돌아섰고,
  // `changes:false` 라 **승인 카드가 안 떴다.** 진짜 실행은 영영 오지 않고, 모델은 그 stderr 를
  // 시스템의 거부로 읽어 *"임시 폴더를 못 쓰는 제한 때문에 못 만들었어요"* 로 끝냈다 —
  // 위 :150 주석이 경고한 그 오독이다. 엑셀 한 줄이 여기서 죽었다.
  //
  // 목록으로 알아맞히지 않는다. 재는 것은 기계 사실 하나다 — **우리 샌드박스가 실제로 거부했나.**
  // `stderr` 만 본다: `stdout` 은 읽어 온 **내용**이라, 남의 글 속 문구를 우리 거부로 읽으면
  // `cat` 한 번에 승인 카드가 뜬다(반례 검사가 문다).
  const 우리가막음 = /operation not permitted|permission denied|read-only file system|\bEPERM\b|\bEACCES\b|\bEROFS\b/i;
  if (r.exitCode === 0) {
    return 우리가막음.test(String(r.stderr ?? ''))
      ? { kind: 'sandbox', why: 'write', userWhy: '파일을 바꾸는 일이라 확인만 받으면 바로 실행해요 — 미리 시험해 봤고 아직 아무것도 안 바뀌었어요' }
      : undefined;
  }
  const t = `${r.stderr ?? ''}\n${r.stdout ?? ''}`;
  // 포트를 열려다 막힌 것 — 서버를 띄우는 테스트·빌드에서 가장 흔하다.
  if (/\bEPERM\b|\bEACCES\b/i.test(t) && /listen|bind|port|socket|server/i.test(t)) {
    // **나가서 읽는 것과 포트를 여는 것은 다른 사실이다**(오너 결정 2026-08-06 을 배선하다 밟음).
    // 둘 다 `network` 로 부르던 것을 갈랐다 — 읽기성 네트워크는 자동으로 열리는데, 포트를 여는
    // 것은 이 컴퓨터를 **바깥에서 닿을 수 있게 만드는** 상태 변경이라 그대로 승인이다.
    // 안 가르고 열었더니 `node s.js`(서버 띄우기)가 승인 없이 돌았다(회귀가 잡았다).
    return { kind: 'sandbox', why: 'listen', userWhy: '포트를 여는 일이라 확인만 받으면 바로 실행해요 — 미리 시험해 봤고 아직 아무것도 안 바뀌었어요' };
  }
  // 밖으로 나가려다 막힌 것
  if (/ENETUNREACH|ENOTFOUND|EAI_AGAIN|Could not resolve|Network is unreachable|Connection refused/i.test(t)) {
    return { kind: 'sandbox', why: 'network', userWhy: '인터넷에 연결하는 일이라 확인만 받으면 바로 실행해요 — 미리 시험해 봤고 아직 아무것도 안 바뀌었어요' };
  }
  // `launchctl setenv`·`config`처럼 파일 오류는 없지만 **컴퓨터 상태를 바꾸려다** OS 권한에
  // 막히는 경우. "아무 일도 안 바뀌었다"와 "읽기였다"를 섞으면 승인 경로가 사라진다.
  // sandbox가 막은 쓰기와 달리 OS 권한 신호지만, 계획 단계에서는 둘 다 사용자 승인 뒤에만
  // 실제 실행할 수 있는 변경 시도라는 사실이 같다.
  if (/not privileged|requires root|must be run as root/i.test(t)) {
    return { kind: 'permission', why: 'privilege', userWhy: '컴퓨터 설정을 바꾸는 일이라 확인만 받으면 바로 실행해요 — 미리 시험해 봤고 아직 아무것도 안 바뀌었어요' };
  }
  // **남의 프로세스를 건드리려다 막힌 것.** 파일 쓰기와 섞으면 승인 카드가 "파일을 바꿔야
  // 해서"라고 거짓을 말한다 — 사용자는 무엇을 허락하는지 모른 채 누르게 된다.
  // 실측 사고(오너 라이브 2026-07-28): `killall openclaw` 가 probe 에서 **실제로 죽였다.**
  // 이제 샌드박스가 막고(`deny signal`), 여기서 그 사실을 정확한 이름으로 부른다.
  //
  // 도구 이름이 아니라 **무엇을 하려다 막혔는지**로 잡는다 — 셋이 각각 다르게 말한다:
  //   zsh:kill:1: kill 123 failed: operation not permitted
  //   killall: warning: kill -term 123: Operation not permitted
  //   pkill: signalling pid 123: Operation not permitted
  if (/(?:\bkill\b|signalling)[^\n]*operation not permitted/i.test(t)) {
    return {
      kind: 'sandbox',
      why: 'signal',
      userWhy: '돌고 있는 프로그램을 끄는 일이라 확인만 받으면 바로 실행해요 — 미리 시험해 봤고 아직 아무것도 안 바뀌었어요',
    };
  }
  // **실행 파일 자체를 못 띄운 것.** `ps`·`top` 같은 setuid 도구는 어느 샌드박스 모드에서도
  // exec 이 거부된다(실측: `(allow default)` 만 있는 프로파일에서도 동일). 이건 "바꾸려다 막힌
  // 것"이 아니라 **아무것도 돌지 않은 것**이다 — 승인해도 달라지지 않는다.
  //
  // 실측(오너 라이브 2026-07-28, 웹 화면): "컴퓨터가 왜 느린지 봐줘"의 다음 걸음 `ps -p …` 가
  // 승인 카드로 갔고, 카드가 **"내용을 남기거나 덮어쓰는 일이라"**고 말했다. 거짓이다.
  // 사용자는 일어나지도 않을 변경에 승인을 눌러야 했다.
  //
  // 가르는 근거는 목록이 아니라 사실이다: 셸이 막았다고 말한 **그 이름이 실행하려던 명령 자체**면
  // exec 거부다. 리다이렉트 대상이면 쓰기 거부다 — `echo x > out` 도, `echo x > /usr/bin/ps` 도
  // 명령 이름(`echo`)과 다르므로 쓰기로 남는다.
  const 막힌이름 = t.match(/operation not permitted:\s*(\S+)/i)?.[1];
  if (막힌이름 && 명령어자리인가(막힌이름, r.command)) {
    return {
      kind: 'env',
      why: 'not_executable',
      userWhy: `${막힌이름} 은(는) 이 자리에서는 띄울 수 없는 도구예요 — 아무것도 실행되지 않았어요`,
    };
  }
  // 파일을 바꾸려다 막힌 것
  if (/operation not permitted|not permitted|Permission denied|EPERM|EACCES|EROFS/i.test(t)) {
    return { kind: 'sandbox', why: 'write', userWhy: '파일을 바꾸는 일이라 확인만 받으면 바로 실행해요 — 미리 시험해 봤고 아직 아무것도 안 바뀌었어요' };
  }
  if (/command not found|No such file or directory: |ENOENT.*spawn|실행을 시작하지 못했어요/i.test(t)) {
    return { kind: 'env', why: 'missing', userWhy: '그 명령이 이 컴퓨터에 없어요' };
  }
  return { kind: 'code', why: 'failed', userWhy: '명령이 오류로 끝났어요' };
}

/**
 * 자식에게 넘기지 않을 환경변수. 명령 하나가 `env` 만 찍어도 토큰이 화면에 나온다.
 * **한 자리에서 나온다** — 캡슐(S4)도 같은 규칙을 써야 하므로 내보낸다. 두 곳에 적으면
 * 언젠가 갈리고, 갈리는 쪽이 비밀을 흘린다.
 */
export function redactEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|SESSION)/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

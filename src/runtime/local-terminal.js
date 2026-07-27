// L3 · 터미널 도구 (P6-T2) — 실행기(terminal-run.js)를 T5 의 손으로 붙인다.
//
// 승인 흐름이 다른 도구와 다른 점: **등급을 실행 전에 알 수 없다.**
// `local.file` 은 action 만 보면 읽기인지 삭제인지 알지만, 명령은 돌려 봐야 안다.
// 그래서 계획 단계에서 **probe** 를 먼저 돌린다 — 쓰기·네트워크·비밀읽기가 막힌 상태라
// 승인 없이 돌려도 아무 영향이 없다(그래서 이게 안전하다). 그 결과가 등급을 정한다:
//   · probe 성공  → 아무것도 안 바꿨다는 증명. 그대로 답한다(A0).
//   · probe 막힘  → 바꾸려 했다는 뜻. 승인 카드로 간다(A2). 승인 뒤 granted 로 다시 돌린다.
import { runCommand } from './terminal-run.js';
import { protectionFor } from './local-protection.js';
import { lifecycleRisk, lifecycleMessage } from './lifecycle-guard.js';
import { homedir } from 'node:os';

/**
 * 빈 칸은 **없는 칸이다.** 모델은 안 쓰는 인자도 `''` 로 채워 보내므로 `??` 로 받으면
 * 빈 문자열이 진짜 값 행세를 한다. 실측: `cwd: ''` 가 통과해서 기본 자리(홈) 대신
 * 서버를 띄운 자리에서 돌았고, `find ..` 가 옆 프로젝트의 dist 수백 줄을 긁어와
 * 모델이 답을 못 냈다(같은 실수를 local.scope 에서도 했다 — `??` 마다 빈 값을 의심할 것).
 */
const blank = (v) => {
  const t = typeof v === 'string' ? v.trim() : v;
  return t === '' || t == null ? undefined : t;
};

/**
 * probe 가 "권한에 막혔다"고 말하는가.
 * **이건 안전 판정이 아니라 말투 판정이다.** 안전은 이미 커널이 보장했다(막혔으니 아무 일도 안 났다).
 * 여기서 하는 일은 "승인을 물을까, 그냥 실패를 알릴까"를 고르는 것뿐이라, 틀려도 최악은
 * `npm test` 실패에 승인을 묻거나(불편) 안 묻고 결과를 보여주는 것(안전)이다.
 */
function looksBlocked(r) {
  if (r.exitCode === 0) return false;
  return /operation not permitted|not permitted|Permission denied|sandbox/i.test(r.stderr);
}

/** 명령이 지금 이 자리에서 무엇을 하려 하는지 사용자 말로. 승인 카드에 실린다. */
export function describeCommand(command, probe) {
  if (!probe || probe.exitCode === 0) return `\`${command}\` 실행`;
  const 이유 = /network|resolve|Could not|커넥/i.test(probe.stderr) ? '인터넷에 연결하려고 해요'
    : '파일을 바꾸려고 해요';
  return `\`${command}\` — ${이유}`;
}

export function makeLocalTerminalTool(deps = {}) {
  const run = deps.run ?? runCommand;
  // 기본 자리는 **사용자의 홈**이다. process.cwd() 는 서버를 띄운 자리라 사용자와 무관하고,
  // 거기가 빈 작업 폴더면 모델이 아무리 찾아도 안 나와서 결국 "경로를 알려줘"로 떠넘긴다(실측).
  // 쓰기는 커널이 막으므로 넓게 둘러보는 것 자체는 안전하다 — 좁혀야 할 이유가 없다.
  const cwdOf = () => deps.cwd ?? homedir();

  /**
   * 계획 단계에서 부른다(실행 아님). 등급을 정할 사실을 만든다.
   * @returns {Promise<{command:string, cwd:string, probe:object, changes:boolean}>}
   */
  async function probe(command, opts = {}) {
    const risk = lifecycleRisk(command, { dataDir: deps.dataDir });
    if (risk) return { command, cwd: blank(opts.cwd) ?? cwdOf(), lifecycle: risk, changes: true };
    const cwd = blank(opts.cwd) ?? cwdOf();
    const r = await run(String(command ?? ''), { mode: 'probe', cwd, timeoutMs: opts.timeoutMs });
    return { command, cwd, probe: r, changes: looksBlocked(r) };
  }

  return {
    probe,
    async handler(args = {}) {
      const command = String(args.command ?? '').trim();
      if (!command) {
        return { blocked: true, userSafeSummary: '무엇을 실행할지 알려주세요.',
          nextSafeAction: '하려는 일을 말씀해 주시면 제가 명령을 만들어 볼게요.' };
      }
      // 자기보존은 커널 경계와 **별도**다 — 샌드박스는 파일 쓰기를 막지 시그널을 못 막는다.
      // T5 가 자기를 끄면 껐다는 말을 할 주체가 사라진다(승인 카드도 원장도 못 남긴다).
      const risk = lifecycleRisk(command, { dataDir: deps.dataDir });
      if (risk) return { blocked: true, lifecycleBlocked: true, ...lifecycleMessage(risk) };

      const cwd = blank(args.cwd) ?? cwdOf();
      // 작업 자리 자체가 보호 영역이면 아예 시작하지 않는다(커널도 막지만 여기서 사람 말로 먼저 답한다).
      const prot = protectionFor(cwd);
      if (prot?.kind === 'secret') {
        return { blocked: true, scopeState: 'protected',
          userSafeSummary: `그 자리에서는 실행하지 않아요 — ${prot.why}.`,
          nextSafeAction: '작업 폴더를 알려주시면 거기서 할게요.' };
      }

      // 이미 계획 단계에서 probe 를 했고 승인을 받았으면 granted 로 실제 실행한다.
      const mode = args.granted ? 'granted' : 'probe';
      // 계획 단계에서 돌린 결과가 오면 **그대로 쓴다.** 같은 명령을 두 번 돌리면 `date`·`ls` 처럼
      // 답이 달라지는 것에서 승인 카드에 보인 것과 실제 결과가 갈라진다.
      const r = (mode === 'probe' && args.probeResult)
        ? args.probeResult
        : await run(command, { mode, cwd, timeoutMs: args.timeoutMs });

      if (mode === 'probe' && looksBlocked(r)) {
        // **여기서 실행하지 않는다.** 승인은 커널의 일이고, 도구는 사실만 돌려준다.
        return {
          blocked: true, needsGrant: true,
          result: { command, cwd, probe: { exitCode: r.exitCode, stderr: r.stderr } },
          userSafeSummary: `${describeCommand(command, r)} — 먼저 확인받을게요.`,
          nextSafeAction: '진행해도 되면 승인해 주세요.',
        };
      }

      return {
        result: {
          command, cwd, exitCode: r.exitCode, durationMs: r.durationMs,
          stdout: r.stdout, stderr: r.stderr,
          ...(r.truncated ? { truncated: true, omittedChars: r.omittedChars } : {}),
          ...(r.stopped ? { stopped: r.stopped } : {}),
          applied: mode === 'granted',
        },
        // 못 한 것을 한 척하지 않는다 — exit code 를 그대로 말한다.
        userSafeSummary: r.stopped === 'timeout'
          ? `시간이 다 돼서 멈췄어요(${Math.round((args.timeoutMs ?? 120000) / 1000)}초).`
          : r.exitCode === 0 ? '실행했어요.' : `실행했는데 오류로 끝났어요(코드 ${r.exitCode}).`,
      };
    },
  };
}

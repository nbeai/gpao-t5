// L-T 1단계 · 공급자 중립 단일 프로세스 배치 손.
// 문자열 셸은 실행·분류·재작성하지 않는다. 구조화된 executable/argv만 격리 실행한다.
import { runProgram } from './terminal-run.js';
import { sandboxAvailable } from './sandbox.js';
import { protectionFor } from './local-protection.js';
import { homedir } from 'node:os';

const blank = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' || trimmed == null ? undefined : trimmed;
};

export function makeLocalTerminalTool(deps = {}) {
  const runStructured = deps.runProgram ?? runProgram;
  const cwdOf = () => deps.cwd ?? homedir();
  const hasSandbox = deps.sandboxAvailable ?? sandboxAvailable;

  return {
    // 경계 호환용이다. legacy command를 실행하거나 의미를 판정하지 않는다.
    async probe(command, opts = {}) {
      return {
        command, cwd: blank(opts.cwd) ?? cwdOf(), legacy: true,
        probe: { processDelivery: 'not_run', effects: { state: 'none' } },
      };
    },

    subjectOf(receipt) {
      if ((receipt?.failureState ?? 'none') !== 'none'
        && receipt?.result?.processDelivery !== 'delivered') return null;
      const executable = receipt?.result?.executable ?? receipt?.actualCall?.args?.executable;
      if (!executable) return null;
      const code = receipt.result?.exitCode;
      return {
        key: `cmd:${executable}`, kind: 'command', label: String(executable),
        detail: receipt.result?.cwd, exitCode: code,
        failed: typeof code === 'number' && code !== 0,
      };
    },

    async handler(args = {}) {
      const cwd = blank(args.cwd) ?? cwdOf();
      const notRun = (reason, summary, fields = {}) => ({
        blocked: true,
        failureResult: {
          ...fields, cwd, processDelivery: 'not_run', applied: false,
          effects: { state: 'none' },
        },
        diagnosticTrace: { reason },
        userSafeSummary: summary,
        nextSafeAction: '실행 파일은 executable, 각 인자는 argv 배열, 작업 폴더는 cwd로 나눠 호출해 주세요.',
      });

      if (Object.hasOwn(args, 'command')) {
        return notRun('legacy_shell_not_supported', '문자열 셸 명령은 실행하지 않았어요.', {
          command: String(args.command ?? ''),
        });
      }

      const executable = blank(args.executable);
      const argv = args.argv;
      const structuredFields = {
        executable, argv: Array.isArray(argv) ? [...argv] : argv,
      };
      if (!executable || !Array.isArray(argv) || argv.some((item) => typeof item !== 'string')) {
        return notRun('invalid_structured_spec', '실행 파일과 인자 배열이 구조화되지 않아 실행하지 않았어요.', structuredFields);
      }
      const protectedCwd = protectionFor(cwd);
      if (protectedCwd?.kind === 'secret') {
        return notRun('protected_cwd', `그 자리에서는 실행하지 않아요 — ${protectedCwd.why}.`, structuredFields);
      }
      if (!hasSandbox()) {
        return notRun('enforcement_unavailable', '격리 실행 경계를 사용할 수 없어 실행하지 않았어요.', structuredFields);
      }

      // 실행 지점은 여기 하나뿐이다. probe·approval·granted replay가 없다.
      const result = await runStructured(executable, argv, {
        cwd, timeoutMs: args.timeoutMs, sandboxAvailable: hasSandbox,
      });
      if (result?.processDelivery === 'not_run' || result?.enforcement?.state !== 'enforced') {
        return notRun('enforcement_unavailable', '격리 실행 경계가 확인되지 않아 실행하지 않았어요.', structuredFields);
      }

      const facts = {
        executable, argv: [...argv], cwd,
        exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
        processDelivery: result.processDelivery,
        effects: result.effects ?? { state: 'none', basis: 'structured_sandbox' },
        applied: false,
        ...(result.stopped ? { stopped: result.stopped } : {}),
      };
      const failed = result.exitCode !== 0 || Boolean(result.stopped)
        || result.processDelivery !== 'delivered';
      if (!failed) return { result: facts, userSafeSummary: '구조화 실행을 마쳤어요.' };
      return {
        failed: true,
        lifecycle: result.processDelivery === 'delivered' ? 'delivered' : 'failed',
        failureResult: facts,
        result: facts,
        userSafeSummary: result.stopped
          ? '구조화 실행이 중단됐어요.'
          : `구조화 실행이 코드 ${result.exitCode}로 끝났어요.`,
      };
    },
  };
}

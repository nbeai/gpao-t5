// L3 · 구조화 terminal — 셸 문장을 해석하거나 승인 뒤 다시 실행하지 않는다.
// 모델은 executable/program, argv[], cwd를 분리해 낸다. 실행기는 deny-default sandbox에서
// 단일 프로세스만 올리고 FD handshake가 선 경우에만 exit/stdout/stderr/effects:none을 채택한다.
import { runProgram } from './terminal-run.js';
import { protectionFor } from './local-protection.js';
import { homedir } from 'node:os';

const blank = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : value;
  return normalized === '' || normalized == null ? undefined : normalized;
};

const structuredInvocation = (args, fallbackCwd) => {
  const executable = blank(args?.executable ?? args?.program);
  if (!executable || !Array.isArray(args?.argv) || !args.argv.every((arg) => typeof arg === 'string')) return null;
  return {
    executable,
    argv: [...args.argv],
    cwd: blank(args.cwd) ?? fallbackCwd,
    ...(args.timeoutMs != null ? { timeoutMs: args.timeoutMs } : {}),
  };
};

const notRunFact = (args, cwd) => ({
  ...(typeof args?.command === 'string' ? { command: args.command } : {}),
  ...(args?.executable || args?.program ? { executable: args.executable ?? args.program } : {}),
  ...(Array.isArray(args?.argv) ? { argv: [...args.argv] } : {}),
  cwd, processDelivery: 'not_run', applied: false, effects: { state: 'none' },
});

export function describeCommand(value) {
  if (typeof value === 'string') return `셸 문자열 \`${value}\` (미실행)`;
  const executable = value?.executable ?? value?.program;
  return executable ? `${executable} 구조화 실행` : '구조화 terminal 실행';
}

export function makeLocalTerminalTool(deps = {}) {
  const execute = deps.runProgram ?? runProgram;
  const cwdOf = () => deps.cwd ?? homedir();
  // probeResult는 공개 인자와 이름이 겹친다. 값이나 표식을 믿으면 모델이 결과를 위조해
  // handler를 건너뛸 수 있으므로, 이 도구 인스턴스가 실제로 만든 객체 신분만 재사용한다.
  const measuredResults = new WeakSet();

  function connectedAlternatives(executionContext, { includeTerminal = true } = {}) {
    const usableTools = (executionContext?.selfState?.connectedTools ?? [])
      .filter((tool) => tool.status === 'usable');
    const usable = usableTools.map((tool) => tool.id);
    const alternatives = [];
    if (includeTerminal && (usable.includes('local.terminal') || !usableTools.length)) alternatives.push({
      방법: 'local.terminal', action: 'run', 필드: ['executable', 'argv', 'cwd'],
      왜: '셸 문장 대신 실행 파일과 인자를 분리하면 단일 프로세스 격리에서 관측할 수 있다',
    });
    if (usable.includes('local.process')) alternatives.push({
      방법: 'local.process', 왜: '프로세스 시작·종료·상태 변경은 구조화 프로세스 손으로 수행한다',
    });
    if (usable.includes('local.file')) alternatives.push({
      방법: 'local.file', action: 'write', 왜: 'stdout 계산 결과를 구조화 파일 쓰기로 저장한다',
    });
    if (usable.includes('web.collect')) alternatives.push({
      방법: 'web.collect', 왜: '밖의 공개 자료 읽기는 구조화 웹 손으로 수행한다',
    });
    for (const tool of usableTools.filter((item) => item.toolKind === 'send')) alternatives.push({
      방법: tool.id, 왜: '외부 전달은 대상·본문이 분리된 연결 손으로 수행한다',
    });
    return alternatives;
  }

  function blocked(args, cwd, executionContext, message) {
    const alternatives = connectedAlternatives(executionContext);
    return {
      blocked: true,
      lifecycle: 'abandoned',
      failureResult: notRunFact(args, cwd),
      ...(alternatives.length ? { 다음수단: alternatives } : {}),
      userSafeSummary: message,
      nextSafeAction: alternatives.length
        ? '실행 파일과 인자를 분리한 구조화 호출이나 지금 연결된 다른 손으로 이어갈 수 있어요.'
        : '이 효과를 구조화해서 실행할 수 있는 손은 지금 연결되어 있지 않아요.',
    };
  }

  async function probe(value, opts = {}) {
    const args = typeof value === 'object' && value !== null ? value : { command: value };
    const cwd = blank(args.cwd ?? opts.cwd) ?? cwdOf();
    const invocation = structuredInvocation({ ...args, cwd }, cwd);
    if (!invocation || typeof args.command === 'string') {
      const sandboxEnforcement = { state: 'unavailable' };
      return {
        ...args, cwd, legacyShell: typeof args.command === 'string',
        probeObservation: true, sandboxEnforcement,
        probe: { processDelivery: 'not_run', effects: { state: 'none' }, sandboxEnforcement },
      };
    }
    const result = await execute(invocation, { signal: opts.signal });
    if (result && typeof result === 'object') measuredResults.add(result);
    return {
      ...invocation,
      resolvedExecutable: result.resolvedExecutable,
      probeObservation: true,
      sandboxEnforcement: result.sandboxEnforcement ?? { state: 'unavailable' },
      probe: result,
    };
  }

  return {
    probe,
    probeInvocation: probe,
    ownsProbeResult(value) {
      return Boolean(value && typeof value === 'object' && measuredResults.has(value));
    },
    subjectOf(rec) {
      if ((rec?.failureState ?? 'none') !== 'none' && rec?.result?.processDelivery !== 'delivered') return null;
      const executable = rec?.result?.executable ?? rec?.actualCall?.args?.executable;
      if (!executable) return null;
      const argv = rec?.result?.argv ?? rec?.actualCall?.args?.argv ?? [];
      return {
        key: `program:${executable}:${JSON.stringify(argv)}`,
        kind: 'command', label: [executable, ...argv].join(' '),
        detail: rec?.result?.cwd, exitCode: rec?.result?.exitCode,
        failed: typeof rec?.result?.exitCode === 'number' && rec.result.exitCode !== 0,
      };
    },
    previewOf() { return undefined; },
    async handler(args = {}, executionContext = {}) {
      const cwd = blank(args.cwd) ?? cwdOf();
      if (protectionFor(cwd)?.kind === 'secret') {
        return blocked(args, cwd, executionContext, '보호된 자리에서는 terminal 실행을 시작하지 않았어요.');
      }
      if (typeof args.command === 'string') {
        return blocked(args, cwd, executionContext,
          '셸 명령 문자열은 실행하지 않았어요 — 실행 파일과 인자를 분리한 구조화 호출이 필요해요.');
      }
      const invocation = structuredInvocation(args, cwd);
      if (!invocation) {
        return blocked(args, cwd, executionContext,
          '실행 파일과 argv가 분리되지 않아 시작하지 않았어요.');
      }
      const result = args.probeResult?.mode === 'structured' && measuredResults.has(args.probeResult)
        ? args.probeResult
        : await execute(invocation, { signal: executionContext.signal });
      if (result?.sandboxEnforcement?.state !== 'enforced'
        || result?.processDelivery !== 'delivered') {
        return blocked(args, cwd, executionContext,
          '격리 적용을 기계적으로 확인하지 못해 실행 결과를 채택하지 않았어요.');
      }

      const baseResult = {
        executable: result.resolvedExecutable ?? result.executable,
        argv: [...invocation.argv], cwd,
        completed: Boolean(result.completed), exitCode: result.exitCode,
        stdout: result.stdout ?? '', stderr: result.stderr ?? '',
        processDelivery: 'delivered',
        effects: result.effects ?? {
          state: 'none', basis: 'sandbox_enforced', policy: 'deny-external-effects',
        },
        applied: false,
        ...(result.truncated ? { truncated: true, omittedChars: result.omittedChars } : {}),
        ...(result.stopped ? { stopped: result.stopped } : {}),
      };
      const failed = result.exitCode !== 0 || Boolean(result.stopped);
      return {
        ...(failed ? {
          failed: true, lifecycle: 'delivered', failureResult: baseResult, result: baseResult,
          ...(connectedAlternatives(executionContext, { includeTerminal: false }).length
            ? { 다음수단: connectedAlternatives(executionContext, { includeTerminal: false }) } : {}),
        } : { result: baseResult }),
        userSafeSummary: failed
          ? `격리된 단일 실행이 코드 ${result.exitCode}로 끝났어요.`
          : '격리된 단일 실행을 마쳤고 외부 효과는 없었어요.',
      };
    },
  };
}

import { randomUUID } from 'node:crypto';

const STATUS = /^-?\d+$/u;

function shellName(program) {
  return String(program ?? '').split(/[\\/]/u).at(-1).toLowerCase();
}

export function preparePipelineTruth({ command, commandExplanation, shellProgram,
  makeNonce = randomUUID } = {}) {
  if (commandExplanation?.ok !== true || commandExplanation.hasParseError
    || !commandExplanation.shapes?.includes('pipeline')) return null;
  const operators = commandExplanation.operators ?? [];
  const lastOperator = operators.at(-1);
  if (!['pipe', 'stderr-pipe'].includes(lastOperator?.kind)
    || operators.some((operator) => ['and', 'or', 'background'].includes(operator.kind))) return null;
  const shell = shellName(shellProgram); if (!['zsh', 'bash'].includes(shell)) return null;
  const nonce = String(makeNonce()).replace(/[^A-Za-z0-9]/gu, '');
  if (!nonce) throw new TypeError('pipeline truth nonce is invalid');
  const marker = `__T5_PIPELINE_STATUS_${nonce}__`;
  const stages = `__t5_pipeline_stages_${nonce}`;
  const overall = `__t5_pipeline_overall_${nonce}`;
  let trailer;
  if (shell === 'zsh') {
    trailer = [
      `${stages}=("\${pipestatus[@]}")`,
      `${overall}="\${${stages}[-1]}"`,
      `printf '\\n%s%s:%s\\n' '${marker}' "\${(j:,:)${stages}}" "$${overall}" >&2`,
      `exit "$${overall}"`,
    ].join('\n');
  } else {
    trailer = [
      `${stages}=("\${PIPESTATUS[@]}")`,
      `${overall}="\${${stages}[\${#${stages}[@]}-1]}"`,
      `(IFS=,; printf '\\n%s%s:%s\\n' '${marker}' "\${${stages}[*]}" "$${overall}" >&2)`,
      `exit "$${overall}"`,
    ].join('\n');
  }
  return { command: `${command}\n${trailer}`, marker, shell, scope: 'last_foreground_pipeline' };
}

export function settlePipelineTruth(result, prepared) {
  if (!prepared || !result || !['completed', 'failed', 'stopped'].includes(result.state)) return result;
  const escaped = prepared.marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}([^\\r\\n:]*):(-?\\d+)\\r?\\n?$`, 'u')
    .exec(String(result.stderr ?? ''));
  if (!match) return { ...result, pipelineObservation: {
    state: 'unavailable', shell: prepared.shell, scope: prepared.scope,
  } };
  const stageExitCodes = match[1].split(',').filter(Boolean).map((value) => (
    STATUS.test(value) ? Number(value) : Number.NaN
  ));
  if (!stageExitCodes.length || stageExitCodes.some((value) => !Number.isSafeInteger(value))) {
    return { ...result, stderr: String(result.stderr ?? '').slice(0, match.index), pipelineObservation: {
      state: 'malformed', shell: prepared.shell, scope: prepared.scope,
    } };
  }
  const originalExitCode = Number(match[2]);
  const pipelineObservation = {
    state: 'observed', shell: prepared.shell, scope: prepared.scope,
    stageExitCodes, overallExitCode: originalExitCode,
  };
  const cleaned = String(result.stderr ?? '').slice(0, match.index);
  return { ...result, stderr: cleaned, pipelineObservation };
}

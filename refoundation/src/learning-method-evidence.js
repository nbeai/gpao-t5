import { basename, extname } from 'node:path';

const SECRET = /(?:-----BEGIN|\b(?:sk|xox[baprs]|gh[pousr])[-_][A-Za-z0-9_-]{12,}|authorization|bearer|token|password|secret)/iu;
const SAFE_LITERAL = /^[\p{L}][\p{L}\p{N}_-]{0,31}$/u;
const SAFE_FLAG = /^--?[A-Za-z][A-Za-z0-9-]{0,30}$/u;

function safeExecutable(value) {
  const text = String(value ?? '').trim();
  if (!text || SECRET.test(text)) return '<command>';
  const name = basename(text); if (!name || name.length > 64) return '<command>';
  return text.startsWith('./') ? `./${name}` : name;
}

function safeArgument(value) {
  const text = String(value ?? '').trim();
  if (!text || SECRET.test(text) || text.includes('=') || /^https?:/iu.test(text)) return '<arg>';
  if (SAFE_FLAG.test(text) || SAFE_LITERAL.test(text)) return text;
  const extension = extname(text).toLocaleLowerCase();
  if (/^\.[a-z0-9]{1,12}$/u.test(extension)) return `<target${extension}>`;
  return '<arg>';
}

function execTemplates(receipt) {
  const explanation = receipt?.result?.commandExplanation;
  if (explanation?.ok !== true || !Array.isArray(explanation.steps)) return [];
  return explanation.steps.slice(0, 8).map((step) => {
    const argv = Array.isArray(step.argv) ? step.argv : [];
    return [safeExecutable(step.executable), ...argv.slice(1, 9).map(safeArgument)].join(' ');
  });
}

export function learningMethodTrace(run, { maxSteps = 8 } = {}) {
  const steps = [];
  for (const event of run?.events ?? []) {
    if (event.type !== 'tool_completed') continue;
    const receipt = event.payload?.receipt; if (receipt?.outcome !== 'succeeded') continue;
    const name = receipt?.requestedCall?.name ?? receipt?.actualCall?.name;
    if (!name || ['work_completion', 'learning_trial', 'tool_search'].includes(name)) continue;
    if (name === 'exec') {
      for (const template of execTemplates(receipt)) steps.push({ tool: 'exec', template });
    } else {
      steps.push({ tool: String(name), action: receipt?.requestedCall?.args?.action ?? null });
    }
  }
  const unique = [];
  for (const step of steps) {
    const key = JSON.stringify(step); if (unique.some((item) => item.key === key)) continue;
    unique.push({ key, step }); if (unique.length >= maxSteps) break;
  }
  return unique.map((item) => item.step);
}

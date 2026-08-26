import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { sanitizeTerminalPath } from './console-config.js';

const execFileAsync = promisify(execFile);
const PATH_MARKER = '__T5_SAFE_LOGIN_PATH__=';

function baseCaptureEnvironment(baseEnv, home) {
  const keep = ['PATH', 'Path', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TMP', 'TEMP'];
  return {
    ...Object.fromEntries(keep.flatMap((name) => (
      baseEnv?.[name] == null ? [] : [[name, baseEnv[name]]]
    ))),
    HOME: home,
    USERPROFILE: home,
    ZDOTDIR: home,
  };
}

export function parseCapturedTerminalPath(output, fallback = '') {
  const lines = String(output ?? '').split(/\r?\n/u);
  const marked = lines.filter((line) => line.startsWith(PATH_MARKER)).at(-1);
  if (!marked) return sanitizeTerminalPath(fallback);
  const candidate = marked.slice(PATH_MARKER.length);
  if (!candidate || candidate.length > 65_536 || /[\u0000-\u001f\u007f]/u.test(candidate)) {
    return sanitizeTerminalPath(fallback);
  }
  return sanitizeTerminalPath(candidate);
}

async function defaultCapture({ program, home, baseEnv }) {
  const command = `printf '\\n${PATH_MARKER}%s\\n' "$PATH"`;
  const { stdout } = await execFileAsync(program, ['-ilc', command], {
    env: baseCaptureEnvironment(baseEnv, home), timeout: 5_000, maxBuffer: 256 * 1024,
  });
  return stdout;
}

export async function resolveTerminalShellEnvironment({
  computer, home, baseEnv = process.env, capture = defaultCapture,
} = {}) {
  if (!computer?.commandRuntime || !home) throw new TypeError('computer and home are required');
  const fallback = sanitizeTerminalPath(baseEnv.PATH ?? baseEnv.Path ?? '');
  if (computer.commandRuntime.family !== 'posix') {
    return { PATH: fallback, HOME: home, USERPROFILE: home };
  }
  let captured = '';
  let source = 'fallback';
  try {
    captured = await capture({
      program: computer.commandRuntime.program, home, baseEnv: baseCaptureEnvironment(baseEnv, home),
    });
    source = 'login_shell_safe_path';
  } catch { /* fallback is intentionally content-free */ }
  return {
    PATH: parseCapturedTerminalPath(captured, fallback),
    HOME: home,
    USERPROFILE: home,
    ZDOTDIR: home,
    source,
  };
}

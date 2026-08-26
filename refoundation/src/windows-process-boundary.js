import { win32 } from 'node:path';

export function quoteWindowsArgument(value) {
  const text = String(value);
  if (text && !/[\s"]/u.test(text)) return text;
  let quoted = '"'; let slashes = 0;
  for (const char of text) {
    if (char === '\\') { slashes += 1; continue; }
    if (char === '"') { quoted += `${'\\'.repeat(slashes * 2 + 1)}"`; slashes = 0; continue; }
    quoted += `${'\\'.repeat(slashes)}${char}`; slashes = 0;
  }
  return `${quoted}${'\\'.repeat(slashes * 2)}"`;
}

export function windowsCommandLine(program, args = []) {
  return [program, ...args].map(quoteWindowsArgument).join(' ');
}

export function windowsJobHostLaunch({ host, program, args = [], cwd } = {}) {
  if (!win32.isAbsolute(String(host ?? '')) || !program || !cwd) {
    throw new TypeError('Windows Job Object host launch is invalid');
  }
  return {
    program: host,
    args: ['--application', program, '--command-line', windowsCommandLine(program, args), '--cwd', cwd],
    boundary: { kind: 'windows_job_object', qualified: true, killOnJobClose: true },
  };
}

export function trustedWindowsSystemExecutable(name, env = process.env) {
  if (!/^[A-Za-z0-9._-]+\.exe$/u.test(String(name ?? ''))) throw new TypeError('invalid Windows executable');
  const root = env.SystemRoot ?? env.WINDIR;
  if (!root || !win32.isAbsolute(root)) throw new Error('trusted Windows SystemRoot is unavailable');
  return win32.join(root, 'System32', name);
}

import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

function seatbelt(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

async function probe() {
  if (process.platform !== 'darwin') return { available: false, reason: 'physical macOS required' };
  const root = await mkdtemp(join(tmpdir(), 't5-macos-python-sandbox-probe-'));
  try {
    const source = join(root, 'program.py');
    const child = fileURLToPath(new URL('../../scripts/python-capsule-child.py', import.meta.url));
    const interpreter = await realpath('/usr/bin/python3');
    await writeFile(source, 'pass\n');
    const profile = [
      '(version 1)', '(allow default)', '(deny network*)', '(deny process-fork)', '(deny file-write*)',
      '(allow file-write* (regex #"^/dev/(null|stdout|stderr|tty|fd/[0-9]+)$"))',
      `(allow file-write* (subpath "${seatbelt(root)}"))`,
    ].join('\n');
    await execFile('/usr/bin/sandbox-exec', ['-p', profile, interpreter, child, root, source], {
      cwd: root, timeout: 5_000, maxBuffer: 16 * 1024,
      env: { PATH: '/usr/bin:/bin', HOME: root, USERPROFILE: root,
        LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TMPDIR: root, TMP: root, TEMP: root,
        PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', PYTHONSAFEPATH: '1' },
    });
    return { available: true, reason: null };
  } catch (error) {
    return { available: false, reason: `sandbox probe failed (${error?.code ?? 'unknown'})` };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

export const macosPythonSandbox = await probe();

export function physicalMacOSSandboxTest(name, fn) {
  return macosPythonSandbox.available
    ? test(name, fn)
    : test(name, { skip: `${macosPythonSandbox.reason}; physical qualification not claimed` }, fn);
}

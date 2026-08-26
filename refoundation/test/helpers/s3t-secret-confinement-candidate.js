import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function seatbeltString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export function macosSecretConfinementProfile(secretRoots = []) {
  const roots = [...new Set(secretRoots.map(String).filter(Boolean))];
  if (roots.some((root) => /[\u0000-\u001f\u007f]/u.test(root))) {
    throw new TypeError('secret root contains control characters');
  }
  return [
    '(version 1)',
    '(allow default)',
    ...roots.map((root) => `(deny file-read* (subpath "${seatbeltString(root)}"))`),
    '(deny process-exec (literal "/usr/bin/security"))',
  ].join('\n');
}

export async function runMacosConfinedCommand({
  command, cwd, env, secretRoots, run = execFileAsync, canonicalize = realpath,
} = {}) {
  let canonicalRoots;
  try { canonicalRoots = await Promise.all((secretRoots ?? []).map((root) => canonicalize(root))); }
  catch {
    return { state: 'failed', exitCode: null, stdout: '', stderr: 'secret root identity unavailable' };
  }
  const profile = macosSecretConfinementProfile(canonicalRoots);
  try {
    const { stdout = '', stderr = '' } = await run('/usr/bin/sandbox-exec', [
      '-p', profile, '/bin/sh', '-c', String(command ?? ''),
    ], { cwd, env, timeout: 5_000, maxBuffer: 256 * 1024 });
    return { state: 'completed', exitCode: 0, stdout, stderr };
  } catch (error) {
    return {
      state: 'failed', exitCode: Number.isInteger(error?.code) ? error.code : null,
      stdout: String(error?.stdout ?? ''), stderr: String(error?.stderr ?? ''),
    };
  }
}

function redact(value, secrets) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean)) text = text.replaceAll(String(secret), '[REDACTED]');
  return text;
}

export function makeFixtureCredentialBroker({ capabilities = {}, run = execFileAsync } = {}) {
  return {
    async execute({ capabilityId, action }) {
      const capability = capabilities[capabilityId];
      if (!capability) throw new Error('credential capability is not registered');
      const args = capability.actions?.[action];
      if (!Array.isArray(args)) throw new Error('credential capability action is not allowed');
      const secrets = capability.secretValues ?? [];
      try {
        const { stdout = '', stderr = '' } = await run(capability.program, args, {
          cwd: capability.cwd, env: capability.env, timeout: 5_000, maxBuffer: 256 * 1024,
        });
        return { state: 'completed', exitCode: 0,
          stdout: redact(stdout, secrets), stderr: redact(stderr, secrets) };
      } catch (error) {
        return { state: 'failed', exitCode: Number.isInteger(error?.code) ? error.code : null,
          stdout: redact(error?.stdout, secrets), stderr: redact(error?.stderr, secrets) };
      }
    },
  };
}

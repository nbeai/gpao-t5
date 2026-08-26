import { access, realpath } from 'node:fs/promises';

function seatbeltString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function profile(roots, protectedExecutableNames) {
  return [
    '(version 1)', '(allow default)',
    ...roots.map((root) => `(deny file-read* (subpath "${seatbeltString(root)}"))`),
    '(deny process-exec (literal "/usr/bin/security"))',
    ...protectedExecutableNames.map((name) => (
      `(deny process-exec (regex #"/${seatbeltString(name)}$"))`
    )),
  ].join('\n');
}

export async function makeTerminalPlatformAdapter({
  platform = process.platform,
  protectedReadRoots = [],
  protectedExecutableNames = [],
  sandboxExec = '/usr/bin/sandbox-exec',
  canonicalize = realpath,
  checkExecutable = access,
} = {}) {
  if (platform !== 'darwin') {
    return {
      kind: 'platform_passthrough', qualified: false,
      async prepare(launch) { return { ...launch, confinement: {
        kind: 'platform_passthrough', qualified: false, protectedRootCount: 0,
      } }; },
    };
  }
  await checkExecutable(sandboxExec);
  const roots = [];
  for (const candidate of protectedReadRoots.map(String).filter(Boolean)) {
    try { roots.push(await canonicalize(candidate)); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  const canonicalRoots = [...new Set(roots)];
  const executableNames = [...new Set(protectedExecutableNames.map(String).filter((name) => (
    /^[A-Za-z0-9._+-]+$/u.test(name)
  )))];
  return {
    kind: 'macos_seatbelt', qualified: true,
    async prepare(launch) {
      return {
        ...launch,
        program: sandboxExec,
        args: ['-p', profile(canonicalRoots, executableNames), launch.program, ...launch.args],
        confinement: {
          kind: 'macos_seatbelt', qualified: true,
          protectedRootCount: canonicalRoots.length,
          protectedExecutableCount: executableNames.length, keychainCliBlocked: true,
        },
      };
    },
  };
}

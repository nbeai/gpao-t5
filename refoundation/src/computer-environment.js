import { arch, homedir } from 'node:os';
import { readdir } from 'node:fs/promises';
import { join, win32 } from 'node:path';

function commandName(program) {
  return String(program).split(/[\\/]/).at(-1).toLowerCase();
}

function commandRuntime(platform, env) {
  const configured = env.T5_REFOUNDATION_SHELL;
  if (platform === 'win32') {
    const program = configured ?? env.ComSpec ?? env.COMSPEC ?? 'cmd.exe';
    const name = commandName(program);
    if (name === 'pwsh' || name === 'pwsh.exe' || name === 'powershell' || name === 'powershell.exe') {
      return {
        family: 'powershell', program,
        environmentKeys: ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'PSModulePath'],
        argsFor: (command) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      };
    }
    return {
      family: 'cmd', program,
      environmentKeys: ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT'],
      argsFor: (command) => ['/d', '/s', '/c', command],
    };
  }
  const program = configured ?? env.SHELL ?? '/bin/sh';
  return { family: 'posix', program, environmentKeys: [], argsFor: (command) => ['-c', command] };
}

export function discoverComputerEnvironment({
  platform = process.platform,
  architecture = arch(),
  userHome = homedir(),
  env = process.env,
} = {}) {
  return {
    platform,
    architecture,
    userHome,
    commandRuntime: commandRuntime(platform, env),
  };
}

export function publicComputerFacts(computer) {
  return {
    platform: computer.platform,
    architecture: computer.architecture,
    userHome: computer.userHome,
    commandFamily: computer.commandRuntime.family,
    commandProgram: computer.commandRuntime.program,
  };
}

export function defaultMacOSComputerFileRoots(userHome = homedir()) {
  return [
    'Desktop', 'Documents', 'Downloads', 'Movies', 'Music', 'Pictures', 'Public',
  ].map((name) => join(userHome, name)).concat(['/Users/Shared', '/Volumes']);
}

export function defaultWindowsComputerFileRoots(userHome = homedir()) {
  const home = win32.resolve(String(userHome));
  const usersRoot = win32.dirname(home);
  return [
    'Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos',
  ].map((name) => win32.join(home, name)).concat([win32.join(usersRoot, 'Public')]);
}

export async function discoverMacOSComputerFileRoots(userHome = homedir(), readDirectory = readdir) {
  const defaults = defaultMacOSComputerFileRoots(userHome);
  const fixedTail = new Set(['/Users/Shared', '/Volumes']);
  const roots = defaults.filter((root) => !fixedTail.has(root));
  try {
    const entries = await readDirectory(userHome, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'Library') continue;
      const root = join(userHome, entry.name);
      if (!roots.includes(root)) roots.push(root);
    }
  } catch { /* standard user folders remain the fail-closed baseline */ }
  roots.sort((left, right) => left.localeCompare(right));
  return [...roots, '/Users/Shared', '/Volumes'];
}

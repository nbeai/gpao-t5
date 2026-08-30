import { access, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

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

function pathInside(candidate, root) {
  const value = relative(root, candidate);
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

async function localChangeProfile(workspace, lexicalWorkspace, launch, scratch) {
  const targets = [];
  for (const value of launch.declaredEffect?.targets ?? []) {
    const requested = isAbsolute(value) ? resolve(value) : resolve(launch.cwd, value);
    const target = pathInside(requested, lexicalWorkspace)
      ? resolve(workspace, relative(lexicalWorkspace, requested)) : requested;
    if (!pathInside(target, workspace)) throw new Error('local change target is outside managed workspace');
    let directory = false; try { directory = (await lstat(target)).isDirectory(); } catch { directory = false; }
    targets.push({ target, directory, missingParents: [] });
  }
  if (!targets.length) throw new Error('local change requires a managed target');
  for (const item of targets) {
    item.directory ||= targets.some((candidate) => candidate.target !== item.target
      && pathInside(candidate.target, item.target));
    let parent = item.directory ? item.target : resolve(item.target, '..');
    while (pathInside(parent, workspace) && parent !== workspace) {
      try { await lstat(parent); break; }
      catch (error) { if (error?.code !== 'ENOENT') throw error;
        item.missingParents.unshift(parent); parent = resolve(parent, '..'); }
    }
  }
  return [
    '(version 1)', '(allow default)', '(deny file-write*)',
    '(allow file-write* (regex #"^/dev/(null|stdout|stderr|tty|fd/[0-9]+)$"))',
    `(allow file-write* (subpath "${seatbeltString(scratch)}"))`,
    ...[...new Set(targets.flatMap((item) => item.missingParents))]
      .map((path) => `(allow file-write-create (literal "${seatbeltString(path)}"))`),
    ...targets.map(({ target, directory }) => directory
      ? `(allow file-write* (subpath "${seatbeltString(target)}"))`
      : `(allow file-write* (literal "${seatbeltString(target)}"))`),
  ].join('\n');
}

function observationProfile(roots, protectedExecutableNames, scratch) {
  return [
    '(version 1)', '(allow default)',
    '(deny file-write*)',
    '(allow file-write* (regex #"^/dev/(null|stdout|stderr|tty|fd/[0-9]+)$"))',
    `(allow file-write* (subpath "${seatbeltString(scratch)}"))`,
    '(deny network*)',
    '(allow network-bind (local ip "localhost:*"))',
    '(allow network-inbound (local ip "localhost:*"))',
    '(allow network-outbound (remote ip "localhost:*"))',
    '(deny signal)',
    '(deny appleevent-send)',
    ...roots.map((root) => `(deny file-read* (subpath "${seatbeltString(root)}"))`),
    '(deny process-exec (literal "/usr/bin/security"))',
    ...protectedExecutableNames.map((name) => (
      `(deny process-exec (regex #"/${seatbeltString(name)}$"))`
    )),
  ].join('\n');
}

const DENIAL = /operation not permitted|permission denied|\bEPERM\b|\bEACCES\b|\bEROFS\b/iu;

function observationAssessment(result, roots) {
  const diagnostic = `${result?.stderr ?? ''}\n${result?.stdout ?? ''}`;
  if (!DENIAL.test(diagnostic)) return { blocked: false };
  const protectedRead = roots.some((root) => diagnostic.includes(root));
  return {
    blocked: true,
    state: protectedRead ? 'protected_read_denied' : 'effect_declaration_required',
    reason: protectedRead ? 'terminal_secret_boundary' : 'observation_sandbox_denied_effect',
  };
}

export async function makeTerminalPlatformAdapter({
  platform = process.platform,
  protectedReadRoots = [],
  protectedExecutableNames = [],
  managedWorkspace = null,
  sandboxExec = '/usr/bin/sandbox-exec',
  canonicalize = realpath,
  checkExecutable = access,
} = {}) {
  if (platform !== 'darwin') {
    return {
      kind: 'platform_passthrough', qualified: false, observationProbeQualified: false,
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
  const lexicalWorkspace = managedWorkspace ? resolve(managedWorkspace) : null;
  const canonicalWorkspace = managedWorkspace ? await canonicalize(managedWorkspace) : null;
  const rootAliases = [...new Set([
    ...protectedReadRoots.map(String).filter(Boolean), ...canonicalRoots,
  ])];
  const executableNames = [...new Set(protectedExecutableNames.map(String).filter((name) => (
    /^[A-Za-z0-9._+-]+$/u.test(name)
  )))];
  return {
    kind: 'macos_seatbelt', qualified: true, observationProbeQualified: true,
    async prepare(launch) {
      const confinedLocalChange = launch.declaredEffect?.kind === 'local_change' && canonicalWorkspace;
      let temporary = null; let scratch = null;
      if (confinedLocalChange) {
        temporary = await mkdtemp(join(tmpdir(), 't5-terminal-change-'));
        scratch = await mkdir(join(temporary, 'scratch'), { mode: 0o700 }).then(() => (
          realpath(join(temporary, 'scratch'))
        ));
      }
      return {
        ...launch,
        program: sandboxExec,
        args: ['-p', confinedLocalChange
          ? await localChangeProfile(canonicalWorkspace, lexicalWorkspace, launch, scratch)
          : profile(canonicalRoots, executableNames), launch.program, ...launch.args],
        ...(confinedLocalChange ? { env: { ...launch.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
          T5_DOCUMENT_CONFINED: '1',
          ZIPOPT: `-b ${scratch}`,
          TMPPREFIX: join(scratch, 'zsh') }, cleanup: () => rm(temporary, { recursive: true, force: true }) } : {}),
        confinement: {
          kind: confinedLocalChange ? 'macos_managed_local_change' : 'macos_seatbelt', qualified: true,
          protectedRootCount: canonicalRoots.length,
          protectedExecutableCount: executableNames.length, keychainCliBlocked: true,
          ...(confinedLocalChange ? { targetWriteConfined: true } : {}),
        },
      };
    },
    async prepareObservationProbe(launch) {
      const directory = await mkdtemp(join(tmpdir(), 't5-terminal-observe-'));
      const scratch = await mkdir(join(directory, 'scratch'), { mode: 0o700 }).then(() => (
        realpath(join(directory, 'scratch'))
      ));
      return {
        ...launch,
        program: sandboxExec,
        args: ['-p', observationProfile(canonicalRoots, executableNames, scratch),
          launch.program, ...launch.args],
        env: { ...launch.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
          TMPPREFIX: join(scratch, 'zsh') },
        confinement: {
          kind: 'macos_observation_probe', qualified: true,
          protectedRootCount: canonicalRoots.length,
          protectedExecutableCount: executableNames.length,
          fileWriteDenied: true, networkDenied: true, signalDenied: true,
          appleEventDenied: true, keychainCliBlocked: true,
        },
        assess: (result) => observationAssessment(result, rootAliases),
        cleanup: () => rm(directory, { recursive: true, force: true }),
      };
    },
  };
}

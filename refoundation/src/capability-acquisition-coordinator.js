import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const COMMIT = /^[a-f0-9]{40}$/u;
function gitUrl(value) { const url = new URL(String(value));
  if (url.protocol !== 'https:' || url.username || url.password) throw new TypeError('Git source must be credential-free HTTPS'); return url.href; }

export function makeLocalDirectoryResolver() {
  return { async resolve({ locator }) { return { packageRoot: String(locator), source: {
    kind: 'local_directory', locator: String(locator), resolvedRef: null,
  }, cleanup: async () => {} }; } };
}

export function makeGitExactRefResolver({ run = execute } = {}) {
  return { async resolve({ locator, resolvedRef }) {
    const url = gitUrl(locator); const commit = String(resolvedRef ?? '').replace(/^commit:/u, '');
    if (!COMMIT.test(commit)) throw new TypeError('Git source requires an exact 40-character commit');
    const room = await mkdtemp(join(tmpdir(), 't5-capability-git-')); const root = join(room, 'package');
    try {
      await run('git', ['init', '--quiet', root], { timeout: 10_000, maxBuffer: 64 * 1024 });
      await run('git', ['-C', root, 'remote', 'add', 'origin', url], { timeout: 10_000, maxBuffer: 64 * 1024 });
      await run('git', ['-C', root, 'fetch', '--quiet', '--depth=1', 'origin', commit], { timeout: 60_000, maxBuffer: 256 * 1024 });
      await run('git', ['-C', root, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], { timeout: 10_000, maxBuffer: 64 * 1024 });
      const { stdout } = await run('git', ['-C', root, 'rev-parse', 'HEAD'], { timeout: 5_000, maxBuffer: 1024 });
      if (String(stdout).trim() !== commit) throw new Error('Git resolved commit mismatch');
      await rm(join(root, '.git'), { recursive: true, force: true });
      return { packageRoot: root, source: { kind: 'git_exact_ref', locator: url, resolvedRef: `commit:${commit}` },
        cleanup: () => rm(room, { recursive: true, force: true }) };
    } catch (error) { await rm(room, { recursive: true, force: true }); throw error; }
  } };
}

export function makeCapabilityAcquisitionCoordinator({ store, resolvers = {} } = {}) {
  if (!store?.inspect || !store?.installInactive) throw new TypeError('capability package store is required');
  function assertSource(observed, expected) { if (observed?.kind !== expected.kind
    || (expected.kind !== 'local_directory' && observed?.locator !== expected.locator)
    || (expected.resolvedRef && observed?.resolvedRef !== expected.resolvedRef)) {
    throw new Error('capability manifest source does not match resolved source');
  } }
  async function resolved(input, work) { const resolver = resolvers[input.sourceKind];
    if (!resolver?.resolve) throw new Error('capability source resolver is unavailable');
    const source = await resolver.resolve({ locator: input.locator, resolvedRef: input.resolvedRef });
    try { const result = await work(source.packageRoot); return { ...result, resolvedSource: source.source }; }
    finally { await source.cleanup?.(); } }
  return {
    inspect(input) { return resolved(input, async (root) => { const value = await store.inspect(root);
      assertSource(value.source, { kind: input.sourceKind, locator: input.locator, resolvedRef: input.resolvedRef }); return value; }); },
    installInactive(input) { return resolved(input, async (root) => { const inspected = await store.inspect(root);
      assertSource(inspected.source, { kind: input.sourceKind, locator: input.locator, resolvedRef: input.resolvedRef });
      return store.installInactive(root); }); },
    enable: (id, generationId) => store.enable(id, generationId), disable: (id) => store.disable(id),
    rollback: (id) => store.rollback(id), uninstall: (id, generationId) => store.uninstall(id, generationId),
    list: () => store.list(),
  };
}

export function makeCapabilityPackageAdminTool({ coordinator, authorizeEffect } = {}) {
  if (!coordinator) throw new TypeError('capability acquisition coordinator is required');
  const mutations = new Set(['install', 'enable', 'disable', 'rollback', 'uninstall']);
  return { name: 'capability_package_admin',
    searchTerms: ['developer explicit capability package local git exact install extension rollback 개발자 확장 설치'],
    description: 'Inspect and manage a developer-explicit T5 capability package. Use only when the user explicitly asks to install or manage an extension source. Local directories and immutable Git commits are supported. It never searches for a package, chooses one, accepts a branch/tag, receives secrets, or makes an installed package usable without an explicit enable action.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['inspect', 'install', 'enable', 'disable', 'rollback', 'uninstall', 'list'] },
      sourceKind: { type: ['string', 'null'], enum: ['local_directory', 'git_exact_ref', null] },
      locator: { type: ['string', 'null'], maxLength: 4096 }, resolvedRef: { type: ['string', 'null'], maxLength: 200 },
      id: { type: ['string', 'null'], maxLength: 64 }, generationId: { type: ['string', 'null'], maxLength: 100 },
      effect: { type: ['object', 'null'] },
    }, required: ['action', 'sourceKind', 'locator', 'resolvedRef', 'id', 'generationId', 'effect'] },
    async preflight(args, context) { if (!mutations.has(args.action)) return { allowed: true };
      if (args.effect?.kind !== 'local_change' || args.effect?.confirmation !== 'not_applicable') return {
        allowed: false, outcome: 'not_executed', result: { state: 'managed_local_change_required' } };
      return typeof authorizeEffect === 'function' ? authorizeEffect(args, context) : { allowed: true }; },
    async execute(args) { if (args.action === 'list') return { packages: await coordinator.list() };
      if (args.action === 'inspect') return coordinator.inspect(args); if (args.action === 'install') return coordinator.installInactive(args);
      if (args.action === 'enable') return coordinator.enable(args.id, args.generationId);
      if (args.action === 'disable') return coordinator.disable(args.id); if (args.action === 'rollback') return coordinator.rollback(args.id);
      if (args.action === 'uninstall') return coordinator.uninstall(args.id, args.generationId);
      throw new TypeError('unsupported package admin action'); }
  };
}

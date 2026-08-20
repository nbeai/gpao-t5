import { appendFile, chmod, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EFFECT_SCHEMA } from './exec-tool.js';
import { makeSkillTool } from './skill-runtime.js';

export class ManagedSkillStore {
  constructor({ root, catalogSnapshot, policyCatalog } = {}) {
    if (!root || !catalogSnapshot?.contentByName || !policyCatalog?.byName) throw new TypeError('managed skill store inputs are required');
    this.root = root; this.catalog = catalogSnapshot; this.policyCatalog = policyCatalog; this.active = join(root, 'active');
    this.trash = join(root, 'trash'); this.ledger = join(root, 'skill-lifecycle.jsonl'); this.queue = Promise.resolve();
  }
  serialize(work) { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
  async ensure() { await mkdir(this.active, { recursive: true, mode: 0o700 }); await mkdir(this.trash, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700); await chmod(this.active, 0o700); await chmod(this.trash, 0o700); }
  entry(name) { const metadata = this.catalog.skills.find((item) => item.name === name); const content = this.catalog.contentByName.get(name);
    const policy = this.policyCatalog.byName.get(name);
    if (!metadata || typeof content !== 'string' || !policy) throw new Error('trusted skill package not found'); return { metadata, content, policy }; }
  async append(type, payload) { await this.ensure(); await appendFile(this.ledger, `${JSON.stringify({ schema: 't5.skill-lifecycle.v1', type, recordedAt: new Date().toISOString(), ...payload })}\n`, { mode: 0o600 }); await chmod(this.ledger, 0o600); }
  async installedNames() { await this.ensure(); return (await readdir(this.active, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort(); }
  async install(name) { return this.serialize(async () => { await this.ensure(); const { metadata, content, policy } = this.entry(name);
    if (policy.prepare === 'explicit_only') return { state: 'explicit_selection_required', ...metadata, policy };
    if (policy.prepare !== 'managed') throw new Error('skill package is not managed');
    if ((await this.installedNames()).includes(name)) return { state: 'already_installed', ...metadata, content };
    const temporary = join(this.root, `.install-${name}-${process.pid}`); await mkdir(temporary, { mode: 0o700 });
    await writeFile(join(temporary, 'SKILL.md'), content, { mode: 0o600 }); await chmod(join(temporary, 'SKILL.md'), 0o600);
    await rename(temporary, join(this.active, name)); await this.append('installed', { name, contentDigest: metadata.contentDigest });
    return { state: 'installed', ...metadata, policy, content }; }); }
  async remove(name) { return this.serialize(async () => { await this.ensure(); if (!(await this.installedNames()).includes(name)) throw new Error('managed skill is not installed');
    const target = join(this.trash, `${name}-${Date.now()}`); await rename(join(this.active, name), target); await this.append('removed', { name, trashName: target.split('/').at(-1) });
    return { state: 'removed', name, recoverable: true }; }); }
  async restore(name) { return this.serialize(async () => { await this.ensure(); if ((await this.installedNames()).includes(name)) throw new Error('managed skill is already installed');
    const candidates = (await readdir(this.trash)).filter((entry) => entry.startsWith(`${name}-`)).sort().reverse();
    if (!candidates.length) throw new Error('removed managed skill not found'); await rename(join(this.trash, candidates[0]), join(this.active, name));
    await this.append('restored', { name, trashName: candidates[0] }); return { state: 'restored', name }; }); }
}

export function makeSkillAcquisitionTool({ store, catalogSnapshot, authorizeEffect } = {}) {
  if (!store || !catalogSnapshot) throw new TypeError('skill acquisition inputs are required');
  const catalogTool = makeSkillTool({ snapshot: catalogSnapshot, catalogMode: 'on-demand' });
  return { name: 'capability_prepare', description: 'Search and prepare trusted bundled procedural methods only after skill search shows that no installed method can complete the goal. Never install a package already marked installed; use skill search/view instead. These packages contain SKILL.md text only, no executable code. Install is a reversible T5-managed local change and returns the method content for immediate use. Never call this for arbitrary URLs, packages, or commands.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['search', 'preview', 'install', 'remove', 'restore'] },
      name: { type: ['string', 'null'] }, effect: { anyOf: [EFFECT_SCHEMA, { type: 'null' }] },
    }, required: ['action', 'name', 'effect'] },
    async preflight(args, context) { if (['search', 'preview'].includes(args.action)) return { allowed: true };
      if (args.effect?.kind !== 'local_change' || args.effect?.reversible !== true) return { allowed: false, outcome: 'not_executed', result: { state: 'reversible_local_change_required' } };
      return typeof authorizeEffect === 'function' ? authorizeEffect(args, context) : { allowed: true }; },
    async execute(args) { if (args.action === 'search') { const result = await catalogTool.execute({ action: 'search', name: args.name });
        const installed = new Set(await store.installedNames()); return { ...result, skills: result.skills.map((skill) => ({ ...skill, installed: installed.has(skill.name), policy: store.entry(skill.name).policy })) }; }
      if (args.action === 'preview') { const entry = store.entry(args.name); return { state: 'previewed', ...entry.metadata, policy: entry.policy, codeExecution: false }; }
      if (args.action === 'install') return store.install(args.name); if (args.action === 'remove') return store.remove(args.name);
      if (args.action === 'restore') return store.restore(args.name); throw new Error('unsupported skill acquisition action'); },
  };
}

import { readFile } from 'node:fs/promises';

const SELECTIONS = new Set(['minimum_default', 'official_on_demand', 'environment_detected', 'developer_selected', 'restricted_selected']);
const PREPARE = new Set(['bundled', 'managed', 'explicit_only']);

export async function loadSkillPolicyCatalog(file) {
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (value?.schema !== 't5.skill-catalog.v1' || !Array.isArray(value.entries)) throw new Error('invalid skill catalog');
  const entries = []; const names = new Set();
  for (const raw of value.entries) {
    const name = String(raw?.name ?? '');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || names.has(name)
      || !SELECTIONS.has(raw.selection) || !PREPARE.has(raw.prepare)
      || typeof raw.activeByDefault !== 'boolean') throw new Error('invalid skill catalog entry');
    if (raw.activeByDefault !== (raw.selection === 'minimum_default')
      || (raw.activeByDefault && raw.prepare !== 'bundled')) throw new Error('invalid default skill policy');
    names.add(name); entries.push({ name, selection: raw.selection, activeByDefault: raw.activeByDefault,
      prepare: raw.prepare, requirements: raw.requirements && typeof raw.requirements === 'object'
        ? structuredClone(raw.requirements) : {} });
  }
  return { schema: value.schema, entries, byName: new Map(entries.map((entry) => [entry.name, entry])) };
}

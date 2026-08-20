import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import { parseDocument } from 'yaml';

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_BYTES = 64 * 1024;
const MAX_CATALOG_DESCRIPTION_CHARS = 4_000;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function frontmatter(text) {
  if (!text.startsWith('---\n')) throw new Error('missing frontmatter');
  const end = text.indexOf('\n---', 4);
  if (end < 0) throw new Error('unterminated frontmatter');
  const document = parseDocument(text.slice(4, end));
  if (document.errors.length) throw document.errors[0];
  const value = document.toJS();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid frontmatter');
  return value;
}

function publicSkill(entry) {
  return {
    name: entry.name,
    description: entry.description,
    contentDigest: entry.contentDigest,
  };
}

function catalogDescription(skills) {
  const heading = 'Skills are optional on-demand procedures for using existing tools. '
    + 'Call action=view only when a detailed procedure is needed to complete the goal. '
    + 'Do not view a skill merely because its topic matches when the summary and your current knowledge are sufficient. '
    + 'Available skills:';
  if (!skills.length) return `${heading} none.`;
  let text = heading;
  for (const skill of skills) {
    const next = `\n- ${skill.name}: ${skill.description}`;
    if ((text + next).length > MAX_CATALOG_DESCRIPTION_CHARS) break;
    text += next;
  }
  return text;
}

function onDemandDescription() {
  return 'Discover optional procedural skills without a preloaded catalog. '
    + 'For specialized apps, CLIs, formats, or workflows, use action=search with task keywords; '
    + 'then action=view. Use action=list only if search fails.';
}

function searchTokens(value) {
  return String(value ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function searchSkills(skills, query) {
  const tokens = [...new Set(searchTokens(query))];
  if (!tokens.length) throw new TypeError('skill search query is required');
  return skills.map((skill) => {
    const name = searchTokens(skill.name);
    const description = searchTokens(skill.description);
    let score = 0;
    for (const token of tokens) {
      if (name.includes(token)) score += 2;
      else if (description.includes(token)) score += 1;
    }
    return { skill, score };
  }).filter((entry) => entry.score > 0)
    .sort((left, right) => (right.score - left.score) || left.skill.name.localeCompare(right.skill.name))
    .slice(0, 8)
    .map((entry) => publicSkill(entry.skill));
}

/** Load one immutable, compact catalog snapshot for a Run. Skill bodies stay out of model context. */
export async function loadSkillSnapshot({ directory } = {}) {
  if (!directory) throw new TypeError('skill directory is required');
  let root;
  try { root = await realpath(directory); }
  catch (error) {
    if (error?.code === 'ENOENT') return { directory, digest: digest('[]'), skills: [], rejected: [] };
    throw error;
  }

  const accepted = [];
  const rejected = [];
  const contentByName = new Map();
  const children = await readdir(root, { withFileTypes: true });
  for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!child.isDirectory() && !child.isSymbolicLink()) continue;
    const candidate = join(root, child.name);
    let resolved;
    try { resolved = await realpath(candidate); }
    catch (error) {
      rejected.push({ name: child.name, reason: error?.code === 'ENOENT' ? 'missing_skill' : 'unreadable_skill' });
      continue;
    }
    if (!inside(root, resolved)) {
      rejected.push({ name: child.name, reason: 'outside_skill_root' });
      continue;
    }

    let content;
    try { content = await readFile(join(resolved, 'SKILL.md'), 'utf8'); }
    catch (error) {
      rejected.push({ name: child.name, reason: error?.code === 'ENOENT' ? 'missing_skill_file' : 'unreadable_skill' });
      continue;
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_BYTES) {
      rejected.push({ name: child.name, reason: 'skill_too_large' });
      continue;
    }

    let metadata;
    try { metadata = frontmatter(content); }
    catch {
      rejected.push({ name: child.name, reason: 'invalid_frontmatter' });
      continue;
    }
    if (!SKILL_NAME.test(metadata.name ?? '') || metadata.name !== child.name
      || typeof metadata.description !== 'string' || !metadata.description.trim()) {
      rejected.push({ name: child.name, reason: 'invalid_metadata' });
      continue;
    }
    const entry = {
      name: metadata.name,
      description: metadata.description.trim(),
      contentDigest: digest(content),
    };
    accepted.push(entry);
    contentByName.set(entry.name, content);
  }

  const skills = accepted.map(publicSkill);
  const snapshot = {
    directory: root,
    digest: digest(JSON.stringify(skills)),
    skills,
    rejected,
  };
  Object.defineProperty(snapshot, 'contentByName', { value: contentByName, enumerable: false });
  return snapshot;
}

/** Merge trusted roots in precedence order. Earlier roots win and bodies remain lazy. */
export function mergeSkillSnapshots(snapshots = []) {
  const skills = []; const rejected = []; const contentByName = new Map(); const seen = new Set();
  for (const snapshot of snapshots) {
    if (!snapshot?.skills) continue;
    rejected.push(...(snapshot.rejected ?? []).map((entry) => structuredClone(entry)));
    for (const skill of snapshot.skills) {
      if (seen.has(skill.name)) { rejected.push({ name: skill.name, reason: 'lower_precedence_duplicate' }); continue; }
      seen.add(skill.name); skills.push(publicSkill(skill));
      const content = snapshot.contentByName?.get(skill.name); if (typeof content === 'string') contentByName.set(skill.name, content);
    }
  }
  const merged = { directory: null, digest: digest(JSON.stringify(skills)), skills, rejected };
  Object.defineProperty(merged, 'contentByName', { value: contentByName, enumerable: false });
  return merged;
}

/** A knowledge surface, not a second executor. The model applies the selected text through other tools. */
export function makeSkillTool({ snapshot, catalogMode = 'inline' } = {}) {
  if (!snapshot || !Array.isArray(snapshot.skills)) throw new TypeError('skill snapshot is required');
  if (!['inline', 'on-demand'].includes(catalogMode)) throw new TypeError('unsupported skill catalog mode');
  return {
    name: 'skill',
    description: catalogMode === 'inline' ? catalogDescription(snapshot.skills) : onDemandDescription(),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'search', 'view'] },
        name: { type: ['string', 'null'] },
      },
      required: ['action', 'name'],
    },
    async execute({ action, name }) {
      if (action === 'list') return {
        state: 'listed', catalogDigest: snapshot.digest,
        skills: snapshot.skills.map(publicSkill), rejected: structuredClone(snapshot.rejected),
      };
      if (action === 'search') return {
        state: 'searched', catalogDigest: snapshot.digest,
        query: String(name ?? ''), skills: searchSkills(snapshot.skills, name),
      };
      if (action !== 'view') throw new Error(`Unknown skill action: ${action}`);
      const skill = snapshot.skills.find((entry) => entry.name === name);
      if (!skill) throw new Error(`Unknown skill: ${name}`);
      const content = snapshot.contentByName?.get(name);
      if (typeof content !== 'string') throw new Error(`Skill content unavailable: ${name}`);
      return {
        state: 'viewed', catalogDigest: snapshot.digest,
        name: skill.name, description: skill.description,
        contentDigest: skill.contentDigest, content,
      };
    },
  };
}

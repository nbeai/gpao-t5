import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

const SCHEMA = 't5.capability-manifest.v1';
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/u;
const WORD = /^[a-z][a-z0-9_]{0,63}$/u;
const MAX_MANIFEST_BYTES = 64 * 1024;
const PREPARATION = new Set([
  'user_authorization_available', 'product_registration_required',
  'provider_approval_required', 'generic_mcp_runtime_required',
]);

function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function clone(value) { return value == null ? value : structuredClone(value); }

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function https(value) {
  const url = new URL(String(value ?? ''));
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('https URL required');
  return url.href;
}

function capabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('capabilities required');
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 32
    || entries.some(([key, available]) => !WORD.test(key) || typeof available !== 'boolean')) {
    throw new Error('invalid capabilities');
  }
  return Object.fromEntries(entries);
}

function manifest(value, folder) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== SCHEMA) {
    throw new Error('invalid schema');
  }
  const id = String(value.id ?? '');
  const label = String(value.label ?? '').trim();
  const category = String(value.category ?? '').trim();
  const description = String(value.description ?? '').trim();
  if (!ID.test(id) || id !== folder || !label || !WORD.test(category) || !description) {
    throw new Error('invalid identity');
  }
  const terms = [...new Set((value.terms ?? []).map((term) => String(term).trim()).filter(Boolean))];
  if (!terms.length || terms.length > 32 || terms.some((term) => term.length > 120)) {
    throw new Error('invalid terms');
  }
  const route = value.route;
  if (!route || typeof route !== 'object' || route.kind !== 'remote_mcp'
    || !PREPARATION.has(route.preparation) || typeof route.canStart !== 'boolean'
    || !String(route.userSafeSummary ?? '').trim()) throw new Error('invalid route');
  return {
    id, label: label.slice(0, 120), category,
    description: description.slice(0, 500), terms,
    capabilities: capabilities(value.capabilities),
    route: {
      kind: route.kind, endpoint: https(route.endpoint), sourceUrl: https(route.sourceUrl),
      preparation: route.preparation, canStart: route.canStart,
      userSafeSummary: String(route.userSafeSummary).trim().slice(0, 500),
    },
  };
}

function publicCandidate(entry) {
  return {
    id: entry.id, label: entry.label, category: entry.category,
    description: entry.description, capabilities: clone(entry.capabilities),
    state: 'candidate', preparation: entry.route.preparation,
    canStart: entry.route.canStart, userSafeSummary: entry.route.userSafeSummary,
    routeKind: entry.route.kind, endpoint: entry.route.endpoint, sourceUrl: entry.route.sourceUrl,
    manifestDigest: entry.manifestDigest,
  };
}

function normalized(value) { return String(value ?? '').normalize('NFKC').toLocaleLowerCase(); }
function tokens(value) { return normalized(value).match(/[\p{L}\p{N}.:-]+/gu) ?? []; }

function search(entries, query) {
  const words = [...new Set(tokens(query))];
  if (!words.length) throw new TypeError('capability search query is required');
  return entries.map((entry) => {
    const label = normalized(entry.label);
    const id = normalized(entry.id);
    const terms = entry.terms.map(normalized);
    const description = normalized(entry.description);
    let score = 0;
    for (const word of words) {
      if (word === id || word === label) score += 8;
      else if (terms.some((term) => term === word || term.includes(word) || word.includes(term))) score += 4;
      else if (description.includes(word)) score += 1;
    }
    const whole = normalized(query);
    if (terms.some((term) => whole.includes(term))) score += 4;
    return { entry, score };
  }).filter(({ score }) => score > 0)
    .sort((left, right) => (right.score - left.score) || left.entry.id.localeCompare(right.entry.id))
    .slice(0, 8).map(({ entry }) => entry);
}

export async function loadCapabilityCatalog({ directory } = {}) {
  if (!directory) throw new TypeError('capability catalog directory is required');
  let root;
  try { root = await realpath(directory); }
  catch (error) {
    if (error?.code === 'ENOENT') return { directory, digest: digest('[]'), entries: [], rejected: [] };
    throw error;
  }
  const entries = [];
  const rejected = [];
  const ids = new Set();
  for (const child of (await readdir(root, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (!child.isDirectory() && !child.isSymbolicLink()) continue;
    let resolved;
    try { resolved = await realpath(join(root, child.name)); }
    catch { rejected.push({ name: child.name, reason: 'unreadable_manifest' }); continue; }
    if (!inside(root, resolved)) {
      rejected.push({ name: child.name, reason: 'outside_catalog_root' }); continue;
    }
    let text;
    try { text = await readFile(join(resolved, 'capability.json'), 'utf8'); }
    catch { rejected.push({ name: child.name, reason: 'unreadable_manifest' }); continue; }
    if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
      rejected.push({ name: child.name, reason: 'manifest_too_large' }); continue;
    }
    let entry;
    try { entry = manifest(JSON.parse(text), child.name); }
    catch { rejected.push({ name: child.name, reason: 'invalid_manifest' }); continue; }
    if (ids.has(entry.id)) {
      rejected.push({ name: child.name, reason: 'duplicate_id' }); continue;
    }
    ids.add(entry.id); entries.push({ ...entry, manifestDigest: digest(text) });
  }
  const publicEntries = entries.map(publicCandidate);
  const snapshot = {
    directory: root, digest: digest(JSON.stringify(publicEntries)),
    entries: publicEntries, rejected,
  };
  Object.defineProperty(snapshot, 'privateEntries', { value: entries, enumerable: false });
  return snapshot;
}

async function currentCandidates(snapshot, connectionDoctor) {
  const report = await connectionDoctor.inspect();
  const current = new Map((report.connections ?? []).map((entry) => [entry.id, entry]));
  return snapshot.entries.map((candidate) => {
    const live = current.get(candidate.id);
    if (!live) return clone(candidate);
    return {
      ...clone(candidate), state: live.state,
      capabilities: clone(live.capabilities), userSafeSummary: live.userSafeSummary,
      canStart: (live.actions ?? []).some((action) => ['oauth', 'user_action'].includes(action.kind)),
      currentConnection: true,
    };
  });
}

export function makeCapabilityCatalogTool({ snapshot, connectionDoctor } = {}) {
  if (!snapshot || !Array.isArray(snapshot.entries)) throw new TypeError('capability snapshot is required');
  if (!connectionDoctor || typeof connectionDoctor.inspect !== 'function') {
    throw new TypeError('connection doctor is required');
  }
  return {
    name: 'capability_catalog',
    description: 'Search the trusted bundled catalog only when the current tools, skills, and connection truth do not provide a needed capability. This catalog contains pre-install candidates and exact blockers; finding one does not mean it is installed, connected, or user-startable. Use search with the user goal, then inspect one exact id. Never claim success or begin a handoff when canStart=false.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['search', 'inspect', 'list'] },
        query: { type: ['string', 'null'], maxLength: 500 },
        id: { type: ['string', 'null'], maxLength: 64 },
      },
      required: ['action', 'query', 'id'],
    },
    async execute({ action, query, id }) {
      const candidates = await currentCandidates(snapshot, connectionDoctor);
      if (action === 'list') return {
        state: 'listed', catalogDigest: snapshot.digest,
        candidates: candidates.slice(0, 50), rejected: clone(snapshot.rejected),
      };
      if (action === 'search') {
        const privateFound = search(snapshot.privateEntries ?? [], query);
        const foundIds = new Set(privateFound.map((entry) => entry.id));
        return {
          state: 'searched', query: String(query ?? ''), catalogDigest: snapshot.digest,
          candidates: candidates.filter((entry) => foundIds.has(entry.id)),
        };
      }
      if (action !== 'inspect') throw new Error(`Unknown capability catalog action: ${action}`);
      const candidate = candidates.find((entry) => entry.id === String(id ?? ''));
      if (!candidate) throw new Error('capability candidate not found');
      return { state: 'inspected', catalogDigest: snapshot.digest, candidate };
    },
  };
}

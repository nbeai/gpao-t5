import { createHash } from 'node:crypto';

const SEARCH_DOMAIN = 't5.life-continuity.memory';
const BLOCKED_SENSITIVITY = new Set(['private', 'secret_ref', 'never_store']);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function claims(state) {
  if (!state || !Array.isArray(state.claims)) throw new TypeError('native search requires MemoryLedger state');
  return state.claims;
}

function exactIds(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const result = values.map((value) => String(value ?? '').trim()).filter(Boolean);
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must be unique`);
  return result;
}

function titleFor(claim) {
  if (claim.kind === 'preference') return '선호';
  if (claim.kind === 'decision') return '결정';
  return '기억';
}

function searchItem(claim) {
  const payload = { memoryId: claim.memoryId, revision: claim.subjectRevision,
    content: claim.value, sensitivity: claim.sensitivity };
  return {
    identifier: `t5.memory.${claim.memoryId}`,
    domain: SEARCH_DOMAIN,
    memoryId: claim.memoryId,
    revision: claim.subjectRevision,
    title: titleFor(claim),
    content: claim.value,
    contentDigest: sha256(JSON.stringify(payload)),
  };
}

export function deriveNativeSearchProjection({ state, personalOptInMemoryIds = [] } = {}) {
  const optedIn = new Set(exactIds(personalOptInMemoryIds, 'personalOptInMemoryIds'));
  const items = []; const blocked = [];
  for (const claim of claims(state)) {
    if (claim.status !== 'active') continue;
    if (BLOCKED_SENSITIVITY.has(claim.sensitivity)) {
      blocked.push({ memoryId: claim.memoryId, reason: 'sensitivity_blocked' }); continue;
    }
    if (claim.sensitivity === 'personal' && !optedIn.has(claim.memoryId)) {
      blocked.push({ memoryId: claim.memoryId, reason: 'personal_opt_in_required' }); continue;
    }
    if (claim.sensitivity !== 'normal' && claim.sensitivity !== 'personal') {
      blocked.push({ memoryId: claim.memoryId, reason: 'sensitivity_unknown' }); continue;
    }
    items.push(searchItem(claim));
  }
  return { domain: SEARCH_DOMAIN, items, blocked };
}

function sameItem(left, right) {
  return left?.identifier === right?.identifier && left?.domain === right?.domain
    && left?.contentDigest === right?.contentDigest && left?.revision === right?.revision;
}

export async function reconcileNativeSearch({ state, adapter, personalOptInMemoryIds = [] } = {}) {
  if (!adapter || typeof adapter.searchAvailability !== 'function') {
    throw new TypeError('native search requires a platform adapter');
  }
  const projection = deriveNativeSearchProjection({ state, personalOptInMemoryIds });
  if (await adapter.searchAvailability() !== 'available') return {
    state: 'platform_unavailable', platform: adapter.platform ?? 'unknown',
    verificationKind: adapter.searchVerificationKind ?? 'unavailable',
    indexed: [], deleted: [], blocked: projection.blocked,
  };
  try {
    const before = await adapter.listSearchItems({ domain: projection.domain });
    if (!Array.isArray(before)) throw new Error('native search list is unknown');
    const desired = new Map(projection.items.map((item) => [item.identifier, item]));
    const present = new Map(before.filter((item) => item.domain === projection.domain)
      .map((item) => [item.identifier, item]));
    const deleted = [...present.keys()].filter((identifier) => !desired.has(identifier));
    const indexed = projection.items.filter((item) => !sameItem(present.get(item.identifier), item));
    if (deleted.length) await adapter.deleteSearchItems({ domain: projection.domain, identifiers: deleted });
    if (indexed.length) await adapter.indexSearchItems({ domain: projection.domain, items: indexed });
    const after = await adapter.listSearchItems({ domain: projection.domain });
    if (!Array.isArray(after)) throw new Error('native search verification is unknown');
    const observed = new Map(after.filter((item) => item.domain === projection.domain)
      .map((item) => [item.identifier, item]));
    const remainingIdentifiers = [...observed.keys()].filter((identifier) => !desired.has(identifier));
    const missingOrChanged = projection.items.filter((item) => !sameItem(observed.get(item.identifier), item))
      .map((item) => item.identifier);
    const verified = remainingIdentifiers.length === 0 && missingOrChanged.length === 0
      && observed.size === desired.size;
    return {
      state: verified ? 'verified' : 'verification_failed', platform: adapter.platform,
      verificationKind: adapter.searchVerificationKind ?? 'os_index',
      indexed: indexed.map((item) => item.identifier), deleted,
      blocked: projection.blocked, remainingIdentifiers, missingOrChanged,
    };
  } catch (error) {
    return { state: 'unknown', platform: adapter.platform ?? 'unknown', indexed: [], deleted: [],
      verificationKind: adapter.searchVerificationKind ?? 'unknown',
      blocked: projection.blocked, errorKind: error?.code ?? error?.name ?? 'Error' };
  }
}

export const NATIVE_SEARCH_CONTRACT = Object.freeze({ domain: SEARCH_DOMAIN,
  defaultSensitivity: 'normal', personalRequiresExactOptIn: true });

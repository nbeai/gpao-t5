import { createHash } from 'node:crypto';

const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const KINDS = new Set(['event', 'reminder']);

function canonicalTime(value, label, nullable = false) {
  if (nullable && value === null) return null;
  const parsed = new Date(value);
  if (typeof value !== 'string' || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be canonical UTC time`);
  }
  return value;
}

function text(value, label, max = 512) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new TypeError(`${label} must be bounded text`);
  }
  return result;
}

function mutation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('calendar item is required');
  if (!KINDS.has(input.kind)) throw new TypeError('calendar item kind is unsupported');
  if (input.userInitiated !== true) return null;
  const item = {
    operationId: text(input.operationId, 'operationId', 256), kind: input.kind,
    title: text(input.title, 'title'), calendarId: text(input.calendarId, 'calendarId', 256),
    startsAt: canonicalTime(input.startsAt, 'startsAt', true),
    endsAt: canonicalTime(input.endsAt, 'endsAt', true),
    dueAt: canonicalTime(input.dueAt, 'dueAt', true),
  };
  if (item.kind === 'event' && (!item.startsAt || !item.endsAt || item.startsAt >= item.endsAt)) {
    throw new TypeError('event requires an exact positive time range');
  }
  if (item.kind === 'reminder' && !item.dueAt) throw new TypeError('reminder requires an exact due time');
  return item;
}

function observedItem(input) {
  if (!input || typeof input !== 'object') return null;
  return { kind: input.kind, title: input.title, calendarId: input.calendarId,
    startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null, dueAt: input.dueAt ?? null };
}

function sameCalendarItem(expected, observed) {
  return sha256(observedItem(expected)) === sha256(observedItem(observed));
}

export function makeMacOSMemoryPlatformAdapter({
  platform = process.platform, search = null, eventKit = null,
} = {}) {
  const available = platform === 'darwin';
  return {
    platform: available ? 'macos' : String(platform),
    async searchAvailability() {
      if (!available || !search?.available) return 'unavailable';
      return await search.available() ? 'available' : 'unavailable';
    },
    async listSearchItems(input) {
      if (!available || !search?.list) throw new Error('macOS search unavailable');
      return search.list(input);
    },
    async indexSearchItems({ domain, items }) {
      if (!available || !search?.index) throw new Error('macOS search unavailable');
      return search.index(items, { domain });
    },
    async deleteSearchItems({ domain, identifiers }) {
      if (!available || !search?.delete) throw new Error('macOS search unavailable');
      return search.delete(identifiers, { domain });
    },
    async upsertCalendarItem(input = {}) {
      if (!available) return { state: 'platform_unavailable', platform: String(platform) };
      if (input.userInitiated !== true) return { state: 'user_action_required', platform: 'macos' };
      const item = mutation(input);
      if (!eventKit?.authorization) return { state: 'platform_unavailable', platform: 'macos' };
      const authorization = await eventKit.authorization(item.kind);
      if (authorization === 'not_determined') return { state: 'permission_required', platform: 'macos',
        permission: item.kind === 'event' ? 'calendar_full_access' : 'reminders_full_access' };
      if (authorization !== 'full_access') return { state: 'permission_denied', platform: 'macos', authorization };
      if (!eventKit.save || !eventKit.read) return { state: 'platform_unavailable', platform: 'macos' };
      let saved;
      try { saved = await eventKit.save(item); } catch (error) {
        return { state: 'failed', platform: 'macos', effect: 'not_confirmed',
          errorKind: error?.code ?? error?.name ?? 'Error' };
      }
      if (!saved?.itemId) return { state: 'effect_unknown', platform: 'macos', effect: 'unknown' };
      let observed;
      try { observed = await eventKit.read({ kind: item.kind, itemId: saved.itemId }); }
      catch { return { state: 'effect_unknown', platform: 'macos', itemId: saved.itemId, effect: 'unknown' }; }
      return { state: sameCalendarItem(item, observed) ? 'verified' : 'verification_failed',
        platform: 'macos', itemId: saved.itemId, effect: 'external_change',
        expectedDigest: sha256(observedItem(item)),
        observedDigest: observed ? sha256(observedItem(observed)) : null };
    },
    async removeCalendarItem(input = {}) {
      if (!available) return { state: 'platform_unavailable', platform: String(platform) };
      if (input.userInitiated !== true) return { state: 'user_action_required', platform: 'macos' };
      const itemId = text(input.itemId, 'itemId', 512); const operationId = text(input.operationId, 'operationId', 256);
      if (!KINDS.has(input.kind)) throw new TypeError('calendar item kind is unsupported');
      const authorization = await eventKit?.authorization?.(input.kind);
      if (authorization !== 'full_access') return { state: authorization === 'not_determined'
        ? 'permission_required' : 'permission_denied', platform: 'macos', authorization };
      if (!eventKit?.remove || !eventKit?.read) return { state: 'platform_unavailable', platform: 'macos' };
      try { await eventKit.remove({ kind: input.kind, itemId, operationId }); }
      catch (error) { return { state: 'effect_unknown', platform: 'macos', itemId,
        errorKind: error?.code ?? error?.name ?? 'Error' }; }
      let observed;
      try { observed = await eventKit.read({ kind: input.kind, itemId }); }
      catch { return { state: 'effect_unknown', platform: 'macos', itemId }; }
      return { state: observed == null ? 'verified_absent' : 'verification_failed',
        platform: 'macos', itemId, effect: 'external_change' };
    },
  };
}

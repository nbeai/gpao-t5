import { revealInvocation } from './path-revealer.js';

export function makeWindowsMemoryPlatformAdapter({
  platform = process.platform, search = null,
} = {}) {
  const available = platform === 'win32';
  return {
    platform: available ? 'windows' : String(platform),
    searchVerificationKind: search?.verificationKind ?? 'unavailable',
    async searchAvailability() {
      if (!available || !search?.available) return 'unavailable';
      return await search.available() ? 'available' : 'unavailable';
    },
    async listSearchItems(input) {
      if (!available || !search?.list) throw new Error('Windows search projection unavailable');
      return search.list(input);
    },
    async indexSearchItems({ domain, items }) {
      if (!available || !search?.index) throw new Error('Windows search projection unavailable');
      return search.index(items, { domain });
    },
    async deleteSearchItems({ domain, identifiers }) {
      if (!available || !search?.delete) throw new Error('Windows search projection unavailable');
      return search.delete(identifiers, { domain });
    },
    async rebuildSearchItems({ domain, items }) {
      if (!available || !search?.rebuild) throw new Error('Windows search rebuild unavailable');
      await search.rebuild(items, { domain });
      const observed = await search.list({ domain });
      return { state: observed.length === items.length ? 'projection_verified' : 'verification_failed',
        verificationKind: search.verificationKind, count: observed.length };
    },
    explorerInvocation(path, kind = 'directory') {
      if (!available) return null;
      return revealInvocation('win32', path, kind);
    },
  };
}

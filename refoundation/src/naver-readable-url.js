export const naverReadableUrlResolver = {
  id: 'naver-mobile-ssr',
  resolve(raw) {
    let url;
    try { url = new URL(raw); } catch { return null; }
    const host = url.hostname.toLowerCase();
    if (host === 'map.naver.com' || host === 'maps.naver.com') {
      const placeId = url.pathname.match(/(?:entry\/)?place\/(\d+)/)?.[1]
        ?? url.searchParams.get('id');
      if (placeId) return {
        url: `https://m.place.naver.com/place/${placeId}/home`, reason: 'naver_mobile_ssr',
      };
      const query = url.pathname.match(/\/search\/([^/?]+)/)?.[1]
        ?? url.searchParams.get('query') ?? url.searchParams.get('q');
      if (query) return {
        url: `https://m.search.naver.com/search.naver?query=${query}`, reason: 'naver_mobile_ssr',
      };
    }
    if (host === 'place.naver.com') return {
      url: `https://m.place.naver.com${url.pathname}${url.search}`, reason: 'naver_mobile_ssr',
    };
    if (/^(?:search|blog|news|cafe|shopping)\.naver\.com$/.test(host)) return {
      url: `https://m.${host}${url.pathname}${url.search}`, reason: 'naver_mobile_ssr',
    };
    if (host === 'naver.com' || host === 'www.naver.com') {
      const query = url.searchParams.get('query') ?? url.searchParams.get('q');
      return {
        url: query
          ? `https://m.search.naver.com/search.naver?query=${encodeURIComponent(query)}`
          : 'https://m.naver.com/',
        reason: 'naver_mobile_ssr',
      };
    }
    return null;
  },
};

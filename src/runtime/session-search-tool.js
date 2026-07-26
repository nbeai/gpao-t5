// L3 · 지난 대화 찾기 도구 (P2-6) — 모델이 **직접 쓸 수 있게** 세션 검색을 손으로 만든다.
//
// 왜: 오너가 텔레그램에서 "내가 팔식당 물어본 세션 찾을 수 있어?"라고 했을 때 T5 는 "찾아볼 수
// 없어요"라고 답했다. 세션 검색은 진작 있었는데 **도구 목록에 없어서 모델이 존재를 몰랐다.**
// 가진 것을 못 쓰면 없는 것과 같다(§16-D).
//
// 경계: 제목·시각·짧은 조각만 돌려준다. 대화 내용을 통째로 옮기지 않는다(내보내기가 아니다).
//   지운 대화는 제외한다 — 휴지통이 검색으로 되살아나면 "지웠다"가 거짓말이 된다.
import { searchTranscripts } from '../kernel/l5-growth/session-search.js';

/** @param {{store:{loadAll:Function}, limit?:number}} deps */
export function makeSessionSearchTool(deps) {
  const limit = deps.limit ?? 5;
  return {
    async handler(args = {}) {
      const query = String(args.query ?? args.request ?? '').trim();
      if (!query) {
        return { blocked: true, userSafeSummary: '무엇을 찾을지 알려주세요.', nextSafeAction: '찾을 말을 한 단어로 주시면 돼요.' };
      }
      const sessions = (await deps.store.loadAll()).filter((s) => !s.deletedAt);
      const hits = searchTranscripts(sessions, query).slice(0, limit);
      if (!hits.length) {
        return { result: { hits: [] }, userSafeSummary: `"${query}"로 지난 대화에서 찾지 못했어요.` };
      }
      // 제목·시각·조각만. 전문을 옮기지 않는다.
      const byId = new Map(sessions.map((s) => [s.id, s]));
      const found = hits.map((h) => ({
        sessionId: h.sessionId,
        title: byId.get(h.sessionId)?.title ?? '대화',
        updatedAt: byId.get(h.sessionId)?.updatedAt ?? null,
        snippet: h.snippet,
      }));
      return {
        result: { hits: found },
        userSafeSummary: `지난 대화에서 ${found.length}건 찾았어요.`,
      };
    },
  };
}

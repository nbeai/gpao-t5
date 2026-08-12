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
    /** 찾은 지난 대화가 다음 턴의 대상이다("그 세션 기준으로"가 이어진다). */
    subjectOf(rec) {
      const hits = (rec?.result?.hits ?? []).filter((h) => h?.title);
      if (!hits.length) return null;
      const args = rec?.actualCall?.args ?? {};
      return {
        key: `search:${args.query ?? args.request ?? ''}`, kind: 'session',
        label: hits.map((h) => h.title).slice(0, 3).join(', '),
      };
    },
    async handler(args = {}) {
      const query = String(args.query ?? args.request ?? '').trim();
      if (!query) {
        return { blocked: true, userSafeSummary: '무엇을 찾을지 알려주세요.', nextSafeAction: '찾을 말을 한 단어로 주시면 돼요.' };
      }
      const sessions = (await deps.store.loadAll()).filter((s) => !s.deletedAt);
      const hits = searchTranscripts(sessions, query).slice(0, limit);
      if (!hits.length) {
        // **몇 개를 뒤졌는지 말한다.** "찾지 못했어요"만 주면 모델은 "대화가 없나"·"검색이
        // 막혔나"를 추측한다(S1 에서 파일 손이 정확히 그 병으로 거짓 진단을 냈다).
        // 대화가 0개인 것과 200개를 뒤져서 없는 것은 **완전히 다른 사실**이다.
        return {
          result: { hits: [], searched: sessions.length },
          userSafeSummary: sessions.length
            ? `"${query}"로 지난 대화 ${sessions.length}개를 뒤졌는데 찾지 못했어요.`
            : `"${query}"로 찾아봤는데 지난 대화가 아직 0개예요.`,
          nextSafeAction: sessions.length
            ? '다른 낱말로 찾아볼까요? 짧은 한 단어가 더 잘 걸려요.'
            : '대화가 쌓이면 그때부터 찾아볼 수 있어요.',
        };
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

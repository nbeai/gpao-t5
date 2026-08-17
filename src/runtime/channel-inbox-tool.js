// L3 · 채널 조회 손 (국면 4 슬라이스 1) — **받은 것을 꺼내 보는 손.**
//
// 왜: 채널 손은 지금까지 전부 **보내는 쪽**이었다(telegram.send · slack.post · mail.send).
// 받은 것을 조회하는 손은 0개였고(state-probe channel-inbox: 훑은 파일 66 · 조회 손 검색어
// 다섯 전부 0건 · 걸린 1건은 양성대조 telegram.send 뿐), 그래서 "텔레그램으로 뭐 왔어?" 는
// 끝날 자리가 없었다. `session.search` 가 밟은 그 병과 같다 — **가진 것을 못 쓰면 없는 것과 같다.**
//
// ★ 이 손의 어려운 점은 조회가 아니라 **정직**이다.
//   라이브 텔레그램 기본 정책은 `allowlist_only`(live-context.js:77)다. 허용 목록 밖 사람의
//   말은 게이트에서 걸리고, 걸린 것은 transcript 에 안 남는다(server.js:4040 이 respond 갈래
//   에서만 push 한다). 그러니 「처리한 것」만 목록으로 주면 사용자는 **빠진 게 있는 줄도 모른 채
//   그게 전부라고 믿는다.** 목적이 끝난 것처럼 보이지만 안 끝났다.
//   그래서 이 손은 안 보이는 것을 **숫자로라도 말한다** — `session.search` 가 세운 전례 그대로다
//   (session-search-tool.js:33-44 「대화가 0개인 것과 200개를 뒤져서 없는 것은 완전히 다른 사실」).
//
// 경계는 지어내지 않는다. 같은 재료에 이미 선 경계를 그대로 쓴다(session-search-tool.js:7):
//   **제목·조각만 돌려준다. 대화 내용을 통째로 옮기지 않는다(내보내기가 아니다).**
//
// 새 저장소를 만들지 않는다. 원천 둘 다 **이미 durable** 한 것이다:
//   ① 처리분 — 세션 transcript 의 channel 표시 항목(server.js:4041)
//   ② 거절분 — allowlist-store 의 pending 집계(server.js:3947 이 이미 남긴다)
//
// ⚠️ **메시지별 시각은 없다.** transcript 항목에는 `turnRef`(순서)만 실리고 시각이 안 실린다
//   (turn-ref.js `stampTurn`). 그래서 이 손은 방이 마지막으로 움직인 시각(`roomUpdatedAt`)만
//   낸다 — 도착 시각인 척하지 않는다. 「오늘 온 것」은 이 손의 정의역 밖이다.

const 조각상한 = 120;

/** 전문이 아니라 조각. 내보내기가 되지 않게 자른다. */
function 조각(text) {
  const 한줄 = String(text ?? '').replace(/\s+/g, ' ').trim();
  return 한줄.length > 조각상한 ? `${한줄.slice(0, 조각상한 - 1)}…` : 한줄;
}

/**
 * @param {{store:{loadAll:Function}, allowlist?:{listPending:Function},
 *   channels?:Function, limit?:number, pendingCap?:number}} deps
 *   store      — 세션 저장소. **교차 세션으로 읽는다**(전례 session-search-tool.js:30).
 *                채널 도착분은 방 세션에 쌓이므로, 자기 세션만 보면 웹에서 물었을 때
 *                「없어요」가 나온다 — 그건 거짓이다.
 *   allowlist  — 거절분 집계 원천. **읽기만 한다**(listPending).
 *   channels   — 채널 사실의 원천(liveChannels). 손이 채널 목록을 따로 복제하지 않는다.
 *   pendingCap — allowlist-store 가 pending 을 자르는 수(그 파일의 `list.slice(-20)`).
 */
export function makeChannelInboxTool(deps) {
  const limit = deps.limit ?? 10;
  const pendingCap = deps.pendingCap ?? 20;

  return {
    /** 조회한 채널이 다음 턴의 대상이다("거기에 답장해줘"가 이어진다). */
    subjectOf(rec) {
      const ch = rec?.result?.channel;
      if (!ch) return null;
      return { key: `inbox:${ch}`, kind: 'channel', label: rec?.result?.channelLabel ?? ch };
    },

    async handler(args = {}) {
      const channel = String(args.channel ?? 'telegram').trim() || 'telegram';
      const 채널목록 = (typeof deps.channels === 'function' ? deps.channels() : deps.channels) ?? [];
      const 채널 = 채널목록.find((c) => c?.id === channel);
      const label = 채널?.label ?? channel;

      // **보고 있지 않은 채널은 빈 목록으로 답하지 않는다.** 빈 목록은 "안 왔다"로 읽히고,
      // 그건 없는 능력을 있다고 말하는 것이다. 안 보고 있으면 안 보고 있다고 말한다.
      if (!채널?.hasReceiver) {
        return {
          result: { channel, channelLabel: label, hasReceiver: false, arrived: [], searched: 0, unknownSenders: null },
          userSafeSummary: `${label}은 지금 받는 배선이 없어요 — T5 가 그 채널을 보고 있지 않아요.`,
          nextSafeAction: '텔레그램은 보고 있어요. 거기로 온 것을 찾아볼까요?',
        };
      }

      // ① 처리분 — 지운 대화는 뺀다(휴지통이 조회로 되살아나면 "지웠다"가 거짓말이 된다).
      const sessions = (await deps.store.loadAll()).filter((s) => !s?.deletedAt);
      const 도착 = [];
      for (const s of sessions) {
        for (const e of s?.transcript ?? []) {
          if (e?.role !== 'user' || e?.channel !== channel) continue;
          도착.push({
            sessionId: s.id,
            title: s.title ?? '대화',
            // 도착 시각이 아니다 — 방이 마지막으로 움직인 시각이다(위 ⚠️).
            roomUpdatedAt: s.updatedAt ?? null,
            snippet: 조각(e.text),
          });
        }
      }
      const 최근순 = 도착.sort((a, b) => (b.roomUpdatedAt ?? 0) - (a.roomUpdatedAt ?? 0));
      const arrived = 최근순.slice(0, limit);

      // ② 거절분 — **집계만.** 신분(userId·username)은 한 글자도 내지 않는다.
      //   프라이버시이자 **단일 진실원**이다: 신분 목록에는 이미 전용 표면과 전용 동사가 있다
      //   (server.js `GET /channels/allowlist` · 허용/해제). 조회 답에 복제하면 같은 진실이
      //   두 표면에 갈라 앉는다(live-context.js 「도구가 서비스 목록을 따로 복제하지 않는다」).
      const pending = (await deps.allowlist?.listPending?.(channel)) ?? [];
      const unknownSenders = {
        people: pending.length,
        times: pending.reduce((n, p) => n + (Number(p?.count) || 0), 0),
        // 그 파일은 최근 N명에서 자른다 — 닿았으면 "전부"라고 말하면 안 된다.
        atCap: pending.length >= pendingCap,
      };

      const 못본말 = unknownSenders.people
        ? ` 그 밖에 모르는 사람 ${unknownSenders.people}명이 ${unknownSenders.times}번 말을 걸었는데`
          + ` 허용 목록 밖이라 내용은 안 봤어요${unknownSenders.atCap ? '(더 있을 수 있어요)' : ''}.`
        : '';

      const 머리 = arrived.length
        ? `${label}으로 온 것 ${arrived.length}건이에요 — T5 가 처리한 것 기준이에요.`
        : `${label}으로 온 것은 대화 ${sessions.length}개를 뒤졌는데 없었어요 — T5 가 처리한 것 기준이에요.`;

      return {
        result: {
          channel, channelLabel: label, hasReceiver: true,
          arrived,
          // 몇 개를 뒤졌는지 말한다 — 0개인 것과 N개를 뒤져서 없는 것은 완전히 다른 사실이다.
          searched: sessions.length,
          total: 도착.length,
          unknownSenders,
        },
        userSafeSummary: 머리 + 못본말,
      };
    },
  };
}

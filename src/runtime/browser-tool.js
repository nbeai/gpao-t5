// L3 · 브라우저 도구 (P2-10) — 관찰 결과를 **T5 의 사실**로 바꾼다.
//
// 이 파일이 하는 일은 번역이다: 화면에서 본 것 → 영수증. 사이트를 모른다(파서 없음).
//
// **영수증에 반드시 남기는 것 넷**(오너 지시):
//   · 실제 본 범위      seen{to, of, percent}
//   · 못 본 범위        unseen{amount, percent}
//   · 스크롤 가능성      canScroll / moreBelow
//   · 조작 여부          acted{kind, ...} — 무엇을 눌렀나·몇 번 내렸나·왜 멈췄나
//
// **observe 와 act 를 나눈다**(오너 지시): 보기(open·snapshot)와 조작(scroll·click)은 다른 도구다.
// 조작이라 해도 이 슬라이스는 **관찰 목적**뿐이다 — 스크롤과 탭·더보기까지. 입력·전송은 없다.
//
// 브라우저가 이 컴퓨터에 없으면 **선언하지 않는다**(선언 ⊆ 손, 게이트가 검사한다).
// 없다는 것은 실패가 아니라 능력의 한계다 — failureState 로 쓰지 않는다.
import { makeSourceEvidence, validateWebInput } from '../kernel/l2-plan/web-tool.js';

// 이만큼도 안 되면 **화면은 열렸지만 내용이 없는 것**이다(차단·안내·빈 페이지).
// web.collect 의 MIN_READABLE_CHARS 와 같은 기준 — 도구가 달라도 "읽었다"의 뜻은 같아야 한다.
const THIN_CHARS = 200;

/** 화면 한 장 → 사실. 사이트를 모르는 채로 말할 수 있는 것만 말한다. */
export function observationFacts(view) {
  const s = view?.scroll ?? {};
  const px = s.total || 0;
  // **본 범위는 글자 기준이다.** 브라우저가 준 텍스트는 화면에 보이는 만큼이 아니라 지금 DOM 에
  // 있는 전부다 — 픽셀로 "1%만 봤다"고 하면서 문서 전체를 설명하는 모순이 났다(라이브 실측).
  const captured = String(view?.text ?? '').length;
  const textTotal = view?.textTotal ?? captured;
  return {
    url: view?.url,
    title: view?.title,
    // 지금 화면에서 **글로 받은 범위**. 잘렸으면 잘렸다고 말한다.
    seen: textTotal
      ? { chars: captured, of: textTotal, percent: Math.round((captured / textTotal) * 100) }
      : undefined,
    // 못 받은 글자 — 우리가 상한(12,000자)에서 자른 몫이다.
    unseen: textTotal
      ? { chars: Math.max(textTotal - captured, 0), percent: Math.round(((textTotal - captured) / textTotal) * 100) }
      : undefined,
    // 화면 위치는 **다른 사실**이다. 스크롤이 의미를 갖는 것은 아직 DOM 에 없는 것(무한스크롤·
    // 지연 로딩)뿐이다 — 그래서 "더 내리면 새 내용이 나올 수 있다"로만 말한다.
    canScroll: px > (s.viewport ?? 0),
    moreBelow: px > 0 && (s.y ?? 0) + (s.viewport ?? 0) < px,
    // 더 열 수 있는 것: 탭과 펼침만(우리가 누를 수 있는 것과 같은 집합이다 — 못 누를 걸 보여주면 거짓말).
    // **얇은 화면**: 100% 를 받았어도 124자면 읽은 게 아니다. 실측(2026-07-27): 네이버가 띄운
    // IP 제한 안내(124자)를 100% 로 남겼더니, 모델이 "첫 화면의 일부 리뷰를 확인했다"고 말했다 —
    // 사실은 안내문만 봤다. 비율만으로는 이 차이가 안 보인다.
    thin: captured < THIN_CHARS,
    canOpen: (view?.actionable ?? [])
      .filter((a) => a.role === 'tab' || a.expanded !== undefined)
      .map((a) => ({ ref: a.ref, text: a.text, kind: a.role === 'tab' ? 'tab' : 'expander' }))
      .slice(0, 12),
  };
}

const NO_BROWSER = {
  blocked: true,
  fetchState: 'blocked',
  userSafeSummary: '이 컴퓨터에서 브라우저를 찾지 못했어요.',
  nextSafeAction: '주소를 주시면 그 페이지 원문은 지금도 읽을 수 있어요.',
};

/** 왜 스크롤을 멈췄는지 — 사람 말로. "더 안 나온다"와 "끝까지 봤다"는 다른 사실이다. */
const STOP_REASON = {
  reached_bottom: '끝까지 내려갔어요.',
  no_new_content: '더 내려도 새 내용이 나오지 않아서 멈췄어요.',
  time_limit: '시간이 오래 걸려서 거기까지만 봤어요.',
  reached_requested: undefined,
};

/** 화면 한 장 → 도구 결과(영수증 재료). observe·act 가 같은 형태로 남긴다. */
function toReceipt(view, { action, acted }) {
  const facts = observationFacts(view);
  if (!facts.url) return { blocked: true, fetchState: 'blocked', userSafeSummary: '화면을 읽지 못했어요.' };
  const text = String(view.text ?? '');
  const stopNote = acted?.stopped ? STOP_REASON[acted.stopped] : undefined;
  return {
    result: {
      title: facts.title, markdown: text, excerpt: text.slice(0, 500),
      observation: { ...facts, acted },
      surfaceAction: `browser_${action}`, // 사후 기록(P2-9 와 같은 계약)
    },
    sources: [makeSourceEvidence({
      sourceUrl: facts.url, title: facts.title ?? facts.url,
      excerpt: text.slice(0, 500), confidence: 0.7, // 직접 본 화면 — 검색 요약보다 높다
    })],
    userSafeSummary: facts.thin
      // 열렸다는 것과 읽었다는 것은 다르다. 내용이 없으면 없다고 말한다(본 척 금지).
      ? `화면은 열렸는데 글이 거의 없어요(${facts.seen?.chars ?? 0}자): ${facts.title ?? facts.url}.`
      : `화면으로 확인했어요: ${facts.title ?? facts.url}.`,
    ...(facts.moreBelow
      ? { nextSafeAction: `${stopNote ? `${stopNote} ` : ''}화면 아래쪽이 남아 있어요 — 더 내리면 새로 불러오는 내용이 있을 수 있어요. 계속 볼까요?` }
      : (stopNote ? { nextSafeAction: stopNote } : {})),
  };
}

const guard = async (browser, run) => {
  if (!browser) return NO_BROWSER;
  try { return await run(); } catch (e) {
    if (e?.noBrowser) return NO_BROWSER;
    return {
      blocked: true, fetchState: 'blocked',
      userSafeSummary: '브라우저로 여는 중에 문제가 있었어요.',
      nextSafeAction: '주소를 주시면 그 페이지 원문 읽기로 이어가 볼까요?',
    };
  }
};

/** 보기 — 주소를 열거나 지금 화면을 다시 본다. 화면을 바꾸지 않는다. */
export function makeBrowserObserveTool(deps = {}) {
  const browser = deps.browser;
  return {
    sourceLedgerRequired: true, // 봤다고 주장하려면 출처가 있어야 한다(웹 도구와 같은 계약)
    handler: (args = {}) => guard(browser, async () => {
      const action = args.action === 'snapshot' ? 'snapshot' : 'open';
      if (action === 'snapshot') return toReceipt(await browser.snapshot(), { action });
      const target = args.url ?? args.request ?? '';
      const v = validateWebInput({ url: target, request: target });
      if (!v.ok) return { blocked: true, fetchState: 'blocked', userSafeSummary: `열 수 없어요: ${v.reason}` };
      return toReceipt(await browser.open(v.normalized.url ?? target), { action });
    }),
  };
}

/**
 * 조작 — **관찰 목적으로만**. 화면을 내리거나(scroll) 탭·더보기를 편다(click).
 * 스크롤은 승인 없이 자동 진행한다(오너 지시) — 대신 한도·중단 조건·기록이 붙는다.
 * 입력·전송·구매는 이 슬라이스에 **아예 없다**(만들지 않았으므로 실수로도 못 한다).
 */
export function makeBrowserActTool(deps = {}) {
  const browser = deps.browser;
  return {
    sourceLedgerRequired: true,
    handler: (args = {}) => guard(browser, async () => {
      if (args.action === 'click') {
        const r = await browser.click(String(args.ref ?? ''));
        if (!r.clicked) {
          // 못 누른 것은 **실패가 아니라 경계**다. 왜 안 되는지 사람 말로 말한다.
          return {
            blocked: true, fetchState: 'blocked',
            userSafeSummary: r.reason === 'not_observational'
              ? '그건 탭이나 더보기가 아니라서 누르지 않았어요. 지금 브라우저로는 화면을 보기만 해요.'
              : '그 자리는 화면에서 사라졌어요.',
            nextSafeAction: '지금 화면을 다시 보고 이어갈까요?',
          };
        }
        return toReceipt(r, { action: 'click', acted: { kind: 'click', ref: args.ref } });
      }
      const view = await browser.scroll({ times: Number(args.times ?? 1) });
      return toReceipt(view, {
        action: 'scroll',
        acted: { kind: 'scroll', times: view.scrolled, stopped: view.stopped },
      });
    }),
  };
}

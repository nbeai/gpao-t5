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
import { 칸종류 } from './browser.js';
import { preferReadableUrl } from './web-collector.js';
import { waitPhrase } from './host-manners.js';

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
    // 더 열 수 있는 것: 수집이 ref 를 준 것 전부 — 링크·버튼·탭·펼침(우리가 누를 수 있는
    // 것과 같은 집합이다 — 못 누를 걸 보여주면 거짓말. 그 동일성은 클릭 시점이 같은 술어
    // 한 벌로 재판정한다 · browser.js 클릭가능술어). 상한 12 는 유지 — 실세계 혼잡·우선
    // 채움은 슬라이스 ② 의 이름 등재된 몫이다.
    // **얇은 화면**: 100% 를 받았어도 124자면 읽은 게 아니다. 실측(2026-07-27): 네이버가 띄운
    // IP 제한 안내(124자)를 100% 로 남겼더니, 모델이 "첫 화면의 일부 리뷰를 확인했다"고 말했다 —
    // 사실은 안내문만 봤다. 비율만으로는 이 차이가 안 보인다.
    thin: captured < THIN_CHARS,
    canOpen: (view?.actionable ?? [])
      .map((a) => ({ ref: a.ref, text: a.text,
        kind: a.role === 'tab' ? 'tab'
          : a.expanded !== undefined ? 'expander'
            : a.role === 'link' ? 'link' : 'button' }))
      .slice(0, 12),
    // **글자를 칠 수 있는 칸.** 여기 없는 자리는 짚을 이름이 없고, 이름이 없으면 안 친다.
    // 종류를 함께 준다 — 모델이 보안 칸을 고르고 나서 거절당하는 왕복을 안 하게 한다.
    // **칸에 이미 들어 있는 값은 싣지 않는다**(화면을 읽는 것과 남의 입력을 퍼오는 것은 다르다).
    canType: (view?.글자칸 ?? [])
      .map((f) => ({ ref: f.ref, label: f.label, kind: 칸종류(f.사실) }))
      .filter((f) => f.kind !== 'gone')
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

/**
 * **짚을 이름이 모델에게 닿는 자리.**
 *
 * 라이브 실측(2026-08-11 · 2회차): 모델이 `ref:"search"` 라는 **없는 이름**을 지어내 쳤고
 * 손이 `gone` 으로 물러났다. 손도 경계도 옳았는데 **이름이 모델에게 안 갔다** —
 * `compactResult` 의 브라우저 갈래가 `canOpen` 만 문장으로 풀고 `canType` 은 안 푼다.
 * 그 자리(`task-category` 계열 파일)는 다른 단위가 잡고 있어 여기서 안 건드린다.
 *
 * 대신 **손이 자기 사실을 자기 문장에 싣는다.** `userSafeSummary` 는 어떤 경로로도 모델에게
 * 그대로 간다(`summary`). 만든 것과 닿은 것은 다르다 — 닿는 자리에 놓는다.
 * 보안 칸·파일 칸은 여기 안 적는다: 어차피 손이 물러나므로 적으면 헛걸음을 부른다.
 */
function 칠수있는칸말(facts) {
  // 두 개까지만. 이 문장은 **사용자도 읽는다** — 목록을 쏟으면 사람 말이 아니게 된다.
  // (모델용 날것과 사용자용 사람 말을 두 벌로 가르는 것은 다른 단위의 일이다 · 계획서 §6.)
  const 쓸것 = (facts.canType ?? []).filter((f) => f.kind === 'search' || f.kind === 'text').slice(0, 2);
  if (!쓸것.length) return '';
  const 하나 = (f) => {
    const 이름 = String(f.label ?? '').replace(/[.。]+$/, '').trim() || (f.kind === 'search' ? '검색창' : '글자칸');
    return `${이름}${f.kind === 'search' ? '(검색창)' : ''}[ref=${f.ref}]`;
  };
  return ` 바로 글자를 넣을 수 있는 칸: ${쓸것.map(하나).join(' · ')}.`;
}

/** 행동 뒤 실제 네트워크 사실 — 다음 손이 고를 재료. Runtime은 순서를 정하지 않는다. */
function 요청사실말(requests) {
  if (!Array.isArray(requests) || requests.length === 0) return '';
  const shown = requests.slice(0, 4).map((r) => `${r.method} ${r.address}`);
  return ` 이 동작 뒤 실제 요청: ${shown.join(' · ')}${requests.length > shown.length ? ` · 그 밖 ${requests.length - shown.length}건` : ''}.`;
}

/** 화면 한 장 → 도구 결과(영수증 재료). observe·act 가 같은 형태로 남긴다. */
function toReceipt(view, { action, acted, profile }) {
  const facts = observationFacts(view);
  if (!facts.url) return { blocked: true, fetchState: 'blocked', userSafeSummary: '화면을 읽지 못했어요.' };
  const text = String(view.text ?? '');
  const stopNote = acted?.stopped ? STOP_REASON[acted.stopped] : undefined;
  return {
    result: {
      title: facts.title, markdown: text, excerpt: text.slice(0, 500),
      // **어느 브라우저 자리에서 봤나**(`isolated`=로그인 없음 / `persistent`=로그인이 남는 자리).
      // 이게 없어서 실측에서 거짓 약속이 두 번 나왔다 — 사용자도 모델도 "로그인된 걸로 본 화면"
      // 인지 알 길이 없었다. 프로필은 손이 아는 사실이므로 손이 말한다(추측 금지).
      observation: {
        ...facts, acted,
        ...(Array.isArray(view?.networkRequests) ? { networkRequests: view.networkRequests } : {}),
        ...(profile ? { profile } : {}),
      },
      surfaceAction: `browser_${action}`, // 사후 기록(P2-9 와 같은 계약)
    },
    sources: [makeSourceEvidence({
      sourceUrl: facts.url, title: facts.title ?? facts.url,
      excerpt: text.slice(0, 500), confidence: 0.7, // 직접 본 화면 — 검색 요약보다 높다
    })],
    userSafeSummary: (facts.thin
      // 열렸다는 것과 읽었다는 것은 다르다. 내용이 없으면 없다고 말한다(본 척 금지).
      ? `화면은 열렸는데 글이 거의 없어요(${facts.seen?.chars ?? 0}자): ${facts.title ?? facts.url}.`
      : `화면으로 확인했어요: ${facts.title ?? facts.url}.`)
      + 요청사실말(view?.networkRequests) + 칠수있는칸말(facts),
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
      const 자리 = browser.profileKind?.();
      if (action === 'snapshot') return toReceipt(await browser.snapshot(), { action, profile: 자리 });
      const target = args.url ?? args.request ?? '';
      const v = validateWebInput({ url: target, request: target });
      if (!v.ok) return { blocked: true, fetchState: 'blocked', userSafeSummary: `열 수 없어요: ${v.reason}` };
      // **읽히는 주소로 고쳐 연다** — `web.collect` 가 쓰던 그 규칙을 브라우저 손도 쓴다
      // (콘솔 라이브 2026-08-12). 예전엔 이 규칙이 웹 손에만 있어서, 모델이
      // `maps.naver.com/p/search/팔식당` 을 **브라우저로** 열자 데스크톱 지도(JS 앱)가
      // 헤드리스에서 「검색 결과가 없습니다」를 뿌렸다. 같은 사실을 두 손이 따로 알면
      // 한쪽만 고쳐지고 다른 쪽이 그대로 남는다 — 한 함수를 둘이 같이 쓴다.
      const open = preferReadableUrl(v.normalized.url ?? target);
      // 그 사이트가 쉬라고 했으면 **브라우저로도 안 연다.** 손이 둘이라고 두 번 두드리지 않는다.
      const cooling = browser.coolingMs?.(open) ?? 0;
      if (cooling > 0) {
        return {
          blocked: true, fetchState: 'rate_limited',
          userSafeSummary: '그 사이트에 너무 자주 물어봐서 잠시 막혔어요.',
          nextSafeAction: `${waitPhrase(cooling)} 뒤에 다시 열어 볼까요?`,
        };
      }
      return toReceipt(await browser.open(open), { action, profile: 자리 });
    }),
  };
}

/**
 * 손이 물러난 이유 → 사람 말. **못 한 것은 실패가 아니라 경계다** — 왜 안 되는지 말하고
 * 되는 길을 함께 준다(막다른 답 금지). 여기 없는 이유는 아래에서 기본 문장으로 떨어진다.
 */
const 경계말 = {
  secure_field: {
    말: '비밀번호처럼 보안이 걸린 칸이라 제가 글자를 넣지 않았어요.',
    다음: '그 칸은 직접 입력해 주세요. 넣으시면 이어서 할게요.',
  },
  file_input: {
    말: '파일을 올리는 칸이라 이 손으로는 건드리지 않았어요.',
    다음: '올릴 파일이 있으면 직접 골라 주세요.',
  },
  unknown_field: {
    말: '그 자리가 글자를 받는 칸인지 화면에서 읽지 못해서 넣지 않았어요.',
    다음: '지금 화면을 다시 보고 칸을 짚어 볼까요?',
  },
  not_editable: { 말: '그 칸은 지금 입력을 안 받는 상태예요.', 다음: '지금 화면을 다시 보고 이어갈까요?' },
  not_visible: { 말: '그 칸이 지금 화면에 안 보여요.', 다음: '조금 내려서 다시 찾아볼까요?' },
  gone: { 말: '그 자리는 화면에서 사라졌어요.', 다음: '지금 화면을 다시 보고 이어갈까요?' },
  // **여기가 헌장 ③ 의 자리다.** 검색 칸이 아닌 곳의 엔터는 상대에게 나가는 걸음일 수 있고,
  // 브라우저 손에는 그것을 물어볼 카드가 없다. 카드를 가진 손이 이미 있으므로 그쪽으로 넘긴다 —
  // 카드 없는 두 번째 길을 여기 내는 것이 곧 우회로다.
  not_search: {
    말: '그 칸은 검색 칸이 아니라서 여기서 엔터를 치지 않았어요 — 상대에게 나가는 걸음일 수 있어요.',
    다음: '보내는 걸음이면 한 번 확인받고 진행할게요. 그렇게 할까요?',
  },
  key_not_opened: {
    말: '이 손으로 치는 키는 엔터 하나예요.',
    다음: '다른 키가 필요하면 어떤 키인지 알려 주세요.',
  },
};

const 경계결과 = (reason) => {
  const m = 경계말[reason] ?? { 말: '그 자리는 이 손으로 하지 않았어요.', 다음: '지금 화면을 다시 보고 이어갈까요?' };
  // `blocked` 는 "능력의 경계"를 뜻한다 — `failureState` 를 안 붙인다(경계는 실패가 아니다).
  return { blocked: true, fetchState: 'blocked', userSafeSummary: m.말, nextSafeAction: m.다음 };
};

/**
 * 조작 — 화면을 내리고(scroll), 탭·더보기를 펴고(click), **관찰이 준 ref 의 칸에 글자를 넣고
 * (type) 검색을 끝낸다(press)**.
 *
 * **왜 글자를 여기서 치나**(2026-08-11 실측): 브라우저로 열어 놓고 글자를 치려니 화면 손(픽셀)
 * 으로 돌아갔고 승인 카드 2장이 떴다. 「사용자 손 0회」가 깨진 자리가 정확히 거기다.
 * 비교군 둘(OpenClaw·Hermes)은 브라우저가 **스냅샷 ref 위에서** 직접 친다 — 좌표가 아니다.
 *
 * **경계는 손 안에 있다**(`browser.js` 의 `타이핑판정`·`엔터판정`). 보안 칸·파일 칸·모르는
 * 요소에는 안 넣고, 검색 칸이 아닌 곳의 엔터는 안 친다. 폼 제출 버튼·구매·파일 올리기는
 * 애초에 동사가 없다(만들지 않았으므로 실수로도 못 한다).
 */
export function makeBrowserActTool(deps = {}) {
  const browser = deps.browser;
  const 자리 = () => browser?.profileKind?.();
  return {
    sourceLedgerRequired: true,
    handler: (args = {}) => guard(browser, async () => {
      if (args.action === 'click') {
        const r = await browser.click(String(args.ref ?? ''));
        if (!r.clicked) {
          // 못 누른 것은 **실패가 아니라 경계**다. 왜 안 되는지 사람 말로 말한다.
          return {
            blocked: true, fetchState: 'blocked',
            userSafeSummary: r.reason === 'not_clickable'
              ? '그 자리는 이 손이 누르지 않는 자리예요 — 폼을 제출하거나 바깥 사이트로 나가는 걸음은 스스로 하지 않아요.'
              : '그 자리는 화면에서 사라졌어요.',
            nextSafeAction: '지금 화면을 다시 보고 이어갈까요?',
          };
        }
        return toReceipt(r, { action: 'click', acted: { kind: 'click', ref: args.ref }, profile: 자리() });
      }
      if (args.action === 'type') {
        const 글 = String(args.text ?? args.값 ?? '');
        const r = await browser.type(String(args.ref ?? ''), 글);
        if (!r.typed) return 경계결과(r.reason);
        return toReceipt(r, {
          action: 'type',
          // **무엇을 어디에 넣었는지 남긴다.** 원장은 말이 아니라 값으로 확정한다.
          acted: { kind: 'type', ref: args.ref, 칸: r.kind, 넣은글: 글.slice(0, 60) },
          profile: 자리(),
        });
      }
      if (args.action === 'press') {
        const r = await browser.press(String(args.ref ?? ''), String(args.key ?? 'Enter'));
        if (!r.pressed) return 경계결과(r.reason);
        return toReceipt(r, {
          action: 'press',
          acted: { kind: 'press', ref: args.ref, 칸: r.kind, 키: 'Enter' },
          profile: 자리(),
        });
      }
      const view = await browser.scroll({ times: Number(args.times ?? 1) });
      return toReceipt(view, {
        action: 'scroll',
        acted: { kind: 'scroll', times: view.scrolled, stopped: view.stopped },
        profile: 자리(),
      });
    }),
  };
}

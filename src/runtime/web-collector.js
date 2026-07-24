// L3 · WebCollector — 실제 웹 수집 어댑터(P6-5). WebToolDescriptor(§6.6) 계약을 실행한다.
// 핵심 불변식: 봤으면 출처(SourceEvidence)를 반드시 남기고, 못 봤으면(로그인벽·봇벽·robots·차단)
//   내용·출처 없이 정직하게 상태만 돌린다. ToolRunner가 assertWebEvidence로 이를 강제한다.
// 정책: 읽기 전용(GET) · 대량수집 금지(validateWebInput maxPages cap) · 외부 전송 없음.
// 안전 규율: fetchImpl 주입 가능 — 테스트는 실네트워크 대신 로컬 서버/스텁을 쓴다.
import { validateWebInput, makeSourceEvidence, classifyWebFetch } from '../kernel/l2-plan/web-tool.js';

/**
 * HTTP 응답 → fetchState. 코드 + 본문 신호로 로그인벽/봇벽/robots/차단을 성공과 분리한다.
 * 200이어도 로그인·캡차 페이지를 200으로 주는 사이트가 있어 본문 신호를 함께 본다.
 * @param {number} status
 * @param {{body?:string}} [ctx]
 * @returns {'ok'|'login_wall'|'bot_wall'|'robots_disallow'|'blocked'}
 */
export function httpToFetchState(status, ctx = {}) {
  if (status === 401) return 'login_wall';
  if (status === 429) return 'bot_wall';
  if (status === 403) {
    const sig = classifyWebFetch({ body: ctx.body }); // 봇벽/캡차 신호면 bot_wall, 아니면 접근차단
    return sig === 'ok' ? 'blocked' : sig;
  }
  if (status >= 400) return 'blocked';
  if (status >= 200 && status < 300) {
    return classifyWebFetch({ body: ctx.body }); // login_wall/bot_wall/robots_disallow/ok
  }
  return 'blocked'; // 3xx 미해결·기타
}

// 의존성 0의 최소 HTML 파싱(제목·발췌). 대량 파서 도입은 과잉 — 발췌 지문만 있으면 출처 계약 충족.
function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}
function extractExcerpt(html, max = 500) {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, max);
}

// freeform 요청문에서 첫 http(s) URL을 뽑는다(turn은 generic하게 {request}만 넘긴다 — 웹 로직은 여기서).
function extractUrl(text) {
  const m = /(https?:\/\/[^\s"'<>]+)/i.exec(String(text ?? ''));
  return m ? m[1] : undefined;
}

const WALL_MESSAGE = {
  login_wall: '로그인이 필요한 페이지예요.',
  bot_wall: '봇 차단이 걸려 있어요.',
  robots_disallow: '그 사이트가 수집을 허용하지 않아요.',
  blocked: '그 사이트가 접근을 막고 있어요.',
  timeout: '그 페이지를 불러오지 못했어요.',
};

// 시간 제한 실행 — 응답이 끝나지 않는 페이지가 Work Chat을 멈추지 못하게(감사 보정, P6-5).
// signal을 무시하는 fetch도 멈추도록 race로 감싸고, 실제 요청엔 abort 신호를 보낸다.
async function withTimeout(factory, timeoutMs, controller) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(); // 실제 네트워크 요청 취소(리소스 정리)
      reject(Object.assign(new Error('timeout'), { name: 'AbortError' }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([factory(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 실제 웹 수집 도구 핸들러를 만든다. WebToolDescriptor 계약(sourceLedgerRequired)을 켠다.
 * @param {{fetchImpl?:Function, robotsCheck?:(url:string)=>Promise<boolean>, now?:()=>number, timeoutMs?:number}} [deps]
 * @returns {{sourceLedgerRequired:true, handler:(args:*)=>Promise<object>}}
 */
export function makeWebCollector(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const { robotsCheck, now } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    sourceLedgerRequired: true, // ToolRunner가 출처 없는 성공·내용 담은 실패를 막는다
    async handler(args) {
      // turn은 generic하게 {request}만 넘기므로, url이 없으면 요청문에서 URL을 뽑아 본다.
      const norm = { ...(args ?? {}), url: args?.url ?? extractUrl(args?.request) };
      const v = validateWebInput(norm);
      if (!v.ok) return { blocked: true, fetchState: 'blocked', userSafeSummary: `수집할 수 없어요: ${v.reason}` };
      const { url } = v.normalized;
      // 이 슬라이스는 URL 직접 수집만. 검색어 단독(SERP 수집)은 후속(정책·출처가 더 복잡).
      if (!url) return { blocked: true, fetchState: 'blocked', userSafeSummary: '수집할 URL이 필요해요.' };

      // robots 정책(주입). 실제 robots.txt fetch는 후속 — 지금은 주입된 판정만 존중한다.
      if (robotsCheck) {
        let allowed = true;
        try { allowed = await robotsCheck(url); } catch { allowed = false; }
        if (!allowed) return { blocked: true, fetchState: 'robots_disallow', userSafeSummary: WALL_MESSAGE.robots_disallow };
      }

      let res, body;
      try {
        // fetch + 본문 읽기 전체에 시간 제한(헤더·본문 어느 쪽이 멈춰도 잡는다).
        const controller = new AbortController();
        ({ res, body } = await withTimeout(async () => {
          const r = await fetchImpl(url, { redirect: 'follow', signal: controller.signal });
          const b = await r.text();
          return { res: r, body: b };
        }, timeoutMs, controller));
      } catch (e) {
        // 네트워크 실패·시간 초과는 timeout으로 정직하게(내용 없음). 원인은 진단면으로만.
        return { blocked: true, fetchState: 'timeout', userSafeSummary: WALL_MESSAGE.timeout, diagnosticTrace: { message: e?.message } };
      }

      const fetchState = httpToFetchState(res.status, { body });
      if (fetchState !== 'ok') {
        // 못 봤다 — 내용·출처 없이 상태만. "못 본 걸 본 척" 금지.
        return { blocked: true, fetchState, userSafeSummary: WALL_MESSAGE[fetchState] ?? WALL_MESSAGE.blocked };
      }

      // 봤다 — 출처 근거(SourceEvidence)를 반드시 만든다.
      const title = extractTitle(body);
      const excerpt = extractExcerpt(body);
      const source = makeSourceEvidence({ sourceUrl: res.url || url, title, excerpt, confidence: 0.6, now: now?.() });
      return {
        result: { title, excerpt },
        sources: [source],
        userSafeSummary: `공개 자료로 확인했어요${title ? `: ${title}` : ''}.`,
      };
    },
  };
}

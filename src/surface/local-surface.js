// 이 표면은 **이 컴퓨터의 이 사람 것**이다 (P-DIST-1 §3 로컬 표면 소유권).
//
// 루프백에만 붙는 것으로는 부족하다. 루프백에 떠 있어도
//   ① 사용자가 열어 둔 **아무 웹페이지**가 http://127.0.0.1:4173 으로 요청을 보낼 수 있고
//   ② 공격자 도메인이 127.0.0.1 로 해석되게 만들면(DNS rebinding) 그 페이지가 **같은 출처**가 된다
// 그러면 세션·기억·자동화·연결 API 가 그대로 열린다. 그래서 세 겹으로 막는다.
//
//   Host   — 우리 이름으로 온 요청만 받는다. rebinding 은 Host 가 공격자 도메인이라 여기서 걸린다.
//   Origin — 다른 페이지가 보낸 요청은 받지 않는다. 브라우저가 붙여 주는 것이라 위조되지 않는다.
//   토큰   — 브라우저가 아닌 프로그램에는 설치 신분이 있어야 한다.
//
// **토큰이 막지 못하는 것도 적어 둔다.** 토큰은 이 사람의 데이터 폴더에 있다. 같은 계정으로 도는
// 프로그램은 그 파일을 읽을 수 있으므로, 파일까지 읽는 프로그램은 막지 못한다. 막는 것은 "HTTP 는
// 부를 수 있지만 남의 파일은 못 읽는" 쪽이다 — 웹페이지가 정확히 그렇다. 더 막으려면 계정을
// 나누는 수밖에 없고, 그건 여기서 하는 일이 아니다.
//
// OAuth 되돌아오는 자리(loopback callback)는 **여기와 섞지 않는다.** 그건 자기 서버에서 state 로
// 확인한다(§3 원문). 여기는 제품 HTTP API 의 소유권만 본다.

/** 우리 이름들. 이 밖의 이름으로 온 요청은 우리에게 온 것이 아니다. */
const 우리이름 = new Set(['localhost', '127.0.0.1', '::1']);

/** 토큰을 묻지 않는 자리 — 비밀이 없고, 화면이 뜨려면 먼저 와야 하는 것들. */
export const 공개경로 = new Set(['/health', '/', '/index.html', '/markdown.js', '/approval-state.js']);

/** 화면에 신분을 건네는 쿠키 이름. HttpOnly 라 페이지 스크립트조차 못 읽는다. */
export const 신분쿠키 = 't5_surface';

/** `example.com:4173`, `[::1]:4173`, `127.0.0.1` 을 모두 이름과 포트로 가른다. */
export function 이름과포트(값) {
  const s = String(값 ?? '').trim();
  if (!s) return null;
  const 대괄호 = s.match(/^\[([^\]]+)\](?::(\d+))?$/);          // IPv6 는 [::1]:4173 꼴
  if (대괄호) return { 이름: 대괄호[1], 포트: 대괄호[2] ? Number(대괄호[2]) : null };
  const 조각 = s.split(':');
  if (조각.length > 2) return { 이름: s, 포트: null };            // 대괄호 없는 IPv6 — 우리 것이 아니다
  return { 이름: 조각[0], 포트: 조각[1] ? Number(조각[1]) : null };
}

function 쿠키에서(헤더, 이름) {
  for (const 조각 of String(헤더 ?? '').split(';')) {
    const at = 조각.indexOf('=');
    if (at < 0) continue;
    if (조각.slice(0, at).trim() === 이름) return 조각.slice(at + 1).trim();
  }
  return null;
}

/**
 * 소유권 검사기. **토큰이 없으면 검사기도 없다** — 신분을 안 준 기동(검사 하네스 등)에서
 * 있지도 않은 신분을 요구해 조용히 다 막는 것보다, 무엇을 검사하는지 분명한 편이 낫다.
 *
 * @param {object} 인자
 * @param {string} 인자.token   설치 신분 토큰
 * @param {() => number} 인자.내포트  지금 듣고 있는 포트(자리를 옮기면 따라 바뀐다)
 * @returns {(req: import('node:http').IncomingMessage, url: string) => null | {status:number, 사람말:string, 사유:string}}
 */
export function 소유권검사({ token, 내포트 }) {
  if (!token) return () => null;
  return function 검사(req, url) {
    const host = 이름과포트(req.headers?.host);
    if (!host || !우리이름.has(host.이름)) {
      // rebinding 이 여기서 걸린다. 무엇이 왔는지는 응답에 적지 않는다(공격자에게 알려 줄 이유가 없다).
      return { status: 403, 사유: 'host', 사람말: '이 주소로는 T5 에 연결할 수 없어요.' };
    }
    const origin = req.headers?.origin;
    if (origin && origin !== 'null') {
      let 온곳 = null;
      try { const u = new URL(origin); 온곳 = { 이름: u.hostname.replace(/^\[|\]$/g, ''), 포트: u.port ? Number(u.port) : null }; }
      catch { 온곳 = null; }
      const 우리포트 = 내포트?.();
      const 같은자리 = 온곳 && 우리이름.has(온곳.이름) && (온곳.포트 ?? 80) === 우리포트;
      if (!같은자리) {
        return { status: 403, 사유: 'origin', 사람말: '다른 웹페이지에서는 T5 를 부를 수 없어요.' };
      }
    }
    if (공개경로.has(url)) return null;
    // 신분은 **쿠키 한 길**로만 받는다. 헤더로도 받는 두 번째 문을 열어 두면 지금 아무도 안 쓰는데
    // 공격면만 넓어진다. 프로그램이 정당하게 부를 일이 생기면 그때 그 소비자와 함께 연다.
    const 준것 = 쿠키에서(req.headers?.cookie, 신분쿠키);
    if (준것 !== token) {
      return { status: 403, 사유: 'token', 사람말: 'T5 화면에서 다시 열어 주세요.' };
    }
    return null;
  };
}

/** 화면이 뜰 때 신분을 건넨다. SameSite=Strict 라 **다른 사이트에서 온 요청에는 붙지 않는다.** */
export function 신분쿠키헤더(token) {
  return `${신분쿠키}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`;
}

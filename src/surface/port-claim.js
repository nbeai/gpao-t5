// 자리를 잡는다 — **막혔다고 죽지 않는다** (P-DIST-1 §3·§4).
//
// 예전 규칙은 "4173 이 차 있으면 멈추고 `--port` 를 알려 준다"였다. 그건 터미널을 아는 사람에게만
// 쓸 수 있는 안내다. 설치본을 받은 사람에게 그건 그냥 **켜지지 않는 프로그램**이다.
//
// 그래서 세 갈래로 나눈다.
//   ① 4173 이 비었다        → 그대로 쓴다
//   ② 거기 있는 게 이 T5 다 → 하나 더 띄우지 않고 **그 T5 로 간다**(기억이 둘로 갈라지지 않게)
//   ③ 다른 프로그램이 쓴다  → 빈 자리로 옮기고 사람 말로 한 줄 알린다
//
// 마지막으로 잡은 자리는 자리표에 적혀 있다. 자리를 옮긴 뒤에도 다음 실행이 ②를 할 수 있는 건
// 그 파일 덕이다 — 자리표가 없으면 옮긴 T5 는 다시는 못 찾는다.
import { 자리표읽기 } from './install-locator.js';

/**
 * 그 자리에 있는 것이 **이 설치본의 T5** 인지 묻는다.
 * /health 는 열려 있으므로 아무나 답할 수 있다. 그래서 이름만 보지 않고 `installId` 까지 맞춘다.
 * 다른 설치본이면 남이다 — 남의 T5 에 사용자를 밀어 넣지 않는다.
 */
export async function 우리것인가(port, installId, { fetchImpl = fetch, 기다림 = 700 } = {}) {
  const 그만 = AbortSignal.timeout(기다림);
  try {
    const r = await fetchImpl(`http://127.0.0.1:${port}/health`, { signal: 그만 });
    if (!r.ok) return false;
    const j = await r.json();
    return j?.product === 'gpao-t5' && j?.installId === installId;
  } catch { return false; }
}

/**
 * @returns {Promise<{결정:'reuse'|'claim', port:number, 안내:string|null}>}
 *   `reuse` 면 서버를 띄우지 말고 그 자리로 가면 된다. `claim` 이면 그 포트로 시도한다
 *   (그 사이에 누가 채 갈 수 있으므로, 실제로 못 들으면 서버 쪽에서 빈 자리로 옮긴다).
 */
export async function 자리잡기({ dir, 원하는포트 = 4173, installId, fetchImpl = fetch, 기다림 = 700 }) {
  const 볼자리 = [];
  const 적힌것 = await 자리표읽기(dir);
  if (적힌것?.port) 볼자리.push(적힌것.port);
  if (!볼자리.includes(원하는포트)) 볼자리.push(원하는포트);

  for (const p of 볼자리) {
    if (await 우리것인가(p, installId, { fetchImpl, 기다림 })) {
      return { 결정: 'reuse', port: p, 안내: null };
    }
  }
  return { 결정: 'claim', port: 원하는포트, 안내: null };
}

/** 자리를 옮겼을 때 사람에게 하는 말. 포트 번호를 설명하지 않는다 — 그건 사용자의 일이 아니다. */
export function 옮김안내() {
  return '다른 프로그램이 기본 연결 위치를 쓰고 있어서 안전한 위치로 바꿨어요. 쓰던 대로 쓰시면 돼요.';
}

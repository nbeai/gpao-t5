// **와이어 도청기** — 실모델과 T5 사이에 앉아 오가는 전문을 그대로 받아 적는다.
//
// 왜 필요한가: 동결 §5.2 의 과정 증거 8종 중 넷(사용자 발화 1회 · 최초 선택의 주체 ·
// tool_call↔tool result 연결 · 심문 호출 0)은 **와이어에서만** 보인다. 원장은 실행된 것을
// 말하지 실행되지 않은 심문 호출을 말하지 않는다. 그리고 §1.1 이 요구하는 A/B 프롬프트·
// 스키마 sha256 동일성도 실제로 나간 본문에서 재야 주장이 아니라 사실이 된다.
//
// **제품 코드를 건드리지 않는다.** T5 는 `GPAO_T5_MODEL_BASE_URL` 이 가리키는 곳으로 갈 뿐이고,
// 여기서 진짜 OpenAI 로 그대로 흘려보낸다. 슬라이스 허용 파일 셋이 늘어나지 않는다.
//
// ── 자격 취급 ──────────────────────────────────────────────────────────────
// 들어온 `authorization` 헤더는 **읽지도 적지도 않는다.** 진짜 키는 이 모듈을 띄울 때
// 인자로 받아 메모리에만 두고 상류로 나갈 때만 붙인다. 기록에는 절대 들어가지 않는다.
import { createServer } from 'node:http';

/**
 * @param {Object} p
 * @param {string} p.상류      진짜 base URL (예: https://api.openai.com/v1)
 * @param {string} p.자격      진짜 API 키. 기록에 남기지 않는다.
 * @returns {Promise<{baseUrl:string, 기록:Array, close:()=>Promise<void>}>}
 */
export async function 도청기띄우기({ 상류, 자격 }) {
  const 기록 = [];

  const server = createServer((req, res) => {
    const 조각 = [];
    req.on('data', (c) => 조각.push(c));
    req.on('end', async () => {
      const 몸 = Buffer.concat(조각).toString('utf8');
      const 경로 = `${상류.replace(/\/$/, '')}${req.url.replace(/^\/+/, '/')}`;
      const 시작 = Date.now();
      let 보낸것 = null;
      try { 보낸것 = 몸 ? JSON.parse(몸) : null; } catch { /* 본문 그대로 흘린다 */ }

      let 상류응답;
      try {
        상류응답 = await fetch(경로, {
          method: req.method,
          headers: {
            'content-type': 'application/json',
            ...(자격 ? { authorization: `Bearer ${자격}` } : {}),
          },
          ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: 몸 }),
        });
      } catch (e) {
        기록.push({ 때: 시작, 경로: req.url, 보낸것, 오류: String(e?.message ?? e) });
        res.writeHead(502, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: '상류 도달 실패' } }));
      }

      // 응답은 **바이트 그대로** 돌려준다(SSE 포함) — 도청기가 와이어를 바꾸면 실험이 아니다.
      const 본문 = await 상류응답.text();
      기록.push({
        때: 시작,
        걸린ms: Date.now() - 시작,
        경로: req.url,
        상태: 상류응답.status,
        보낸것,
        받은것: 본문,
      });
      const 헤더 = { 'content-type': 상류응답.headers.get('content-type') ?? 'application/json' };
      res.writeHead(상류응답.status, 헤더);
      res.end(본문);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    기록,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** SSE 든 단발이든 **한 응답에서 모델이 고른 도구**를 뽑는다(OpenAI 와이어). */
export function 고른도구(받은것) {
  const 글 = String(받은것 ?? '');
  if (!글.startsWith('data:')) {
    try {
      const j = JSON.parse(글);
      return (j?.choices?.[0]?.message?.tool_calls ?? []).map((t) => ({
        name: t?.function?.name, args: 안전파싱(t?.function?.arguments),
      }));
    } catch { return []; }
  }
  // 스트림 — index 별로 name·arguments 를 이어 붙인다(provider 가 하는 것과 같은 방식).
  const 모음 = new Map();
  for (const 줄 of 글.split('\n')) {
    if (!줄.startsWith('data:')) continue;
    const 덩이 = 줄.slice(5).trim();
    if (!덩이 || 덩이 === '[DONE]') continue;
    let ev; try { ev = JSON.parse(덩이); } catch { continue; }
    for (const t of ev?.choices?.[0]?.delta?.tool_calls ?? []) {
      const 자리 = 모음.get(t.index) ?? { name: '', args: '' };
      if (t?.function?.name) 자리.name += t.function.name;
      if (t?.function?.arguments) 자리.args += t.function.arguments;
      모음.set(t.index, 자리);
    }
  }
  return [...모음.values()].map((v) => ({ name: v.name, args: 안전파싱(v.args) }));
}

/** SSE·단발 양쪽에서 **모델이 낸 글**을 뽑는다. */
export function 낸글(받은것) {
  const 글 = String(받은것 ?? '');
  if (!글.startsWith('data:')) {
    try { return String(JSON.parse(글)?.choices?.[0]?.message?.content ?? ''); } catch { return ''; }
  }
  let 나온것 = '';
  for (const 줄 of 글.split('\n')) {
    if (!줄.startsWith('data:')) continue;
    const 덩이 = 줄.slice(5).trim();
    if (!덩이 || 덩이 === '[DONE]') continue;
    try { 나온것 += JSON.parse(덩이)?.choices?.[0]?.delta?.content ?? ''; } catch { /* 조각 하나 */ }
  }
  return 나온것;
}

/** 이 응답이 쓴 토큰(있으면). 스트림은 마지막 usage 청크에 실린다. */
export function 쓴토큰(받은것) {
  const 글 = String(받은것 ?? '');
  const 하나 = (o) => (o?.usage ? {
    입력: o.usage.prompt_tokens ?? 0, 출력: o.usage.completion_tokens ?? 0,
  } : null);
  if (!글.startsWith('data:')) { try { return 하나(JSON.parse(글)); } catch { return null; } }
  let 마지막 = null;
  for (const 줄 of 글.split('\n')) {
    if (!줄.startsWith('data:')) continue;
    const 덩이 = 줄.slice(5).trim();
    if (!덩이 || 덩이 === '[DONE]') continue;
    try { 마지막 = 하나(JSON.parse(덩이)) ?? 마지막; } catch { /* 조각 하나 */ }
  }
  return 마지막;
}

function 안전파싱(s) {
  try { return JSON.parse(s ?? '{}'); } catch { return { _파싱실패: String(s ?? '').slice(0, 200) }; }
}

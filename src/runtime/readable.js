// L3 · 읽을 만한 본문 추출 (Phase 0-2b) — "LLM 이 읽기 좋은 마크다운".
//
// 왜: 이전 추출은 모든 태그를 지우고 **앞 500자**를 잘랐다. 그러면 네비게이션·쿠키 배너·광고가
// 앞에 있는 페이지에서는 그게 "본문"이 된다 — 찾아서 읽었는데 재료가 쓰레기다.
// 품질 기준은 Crawl4AI 의 "LLM-ready Markdown"(오너 결정): 껍데기를 걷고 제목·문단·목록·표·
// 링크의 **구조를 남긴다**. 단 의존성은 0으로 — 파서를 들이지 않고 필요한 만큼만 한다(§17·§20).
//
// 경계: 완벽한 HTML 파싱을 하지 않는다. 대부분의 문서형 페이지에서 본문을 건지는 게 목표이고,
// 못 건지면 **건진 척하지 않는다**(빈 결과를 정직하게 돌려주고 호출부가 다음 후보로 간다).

const DROP_BLOCKS = /<(script|style|noscript|template|svg|iframe|form|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi;
// 본문일 가능성이 높은 컨테이너(있으면 그 안만 본다).
const MAIN_CANDIDATES = [
  /<article\b[^>]*>([\s\S]*?)<\/article>/i,
  /<main\b[^>]*>([\s\S]*?)<\/main>/i,
  /<div[^>]+(?:id|class)="[^"]*(?:article|content|post|entry|body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
];
// 껍데기 문구(쿠키·구독 유도 등)는 본문으로 치지 않는다.
const BOILERPLATE = /^(쿠키|cookie|구독|subscribe|로그인|log ?in|sign ?in|광고|advertisement|메뉴|menu|검색|search)\b/i;

const decodeEntities = (s) => String(s)
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

const textOf = (html) => decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function extractTitle(html) {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (og) return decodeEntities(og[1]).trim().slice(0, 200);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return textOf(h1?.[1] ?? t?.[1] ?? '').slice(0, 200);
}

/** 페이지가 스스로 밝힌 요약(있으면 신뢰도 높은 한 줄). */
export function extractDescription(html) {
  const m = /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i.exec(html);
  return m ? decodeEntities(m[1]).trim().slice(0, 300) : '';
}

/**
 * 본문을 마크다운으로. 제목·문단·목록·표·인용을 남기고 껍데기는 버린다.
 * @param {string} html @param {{maxChars?:number}} [opts]
 * @returns {{markdown:string, blocks:number}}
 */
export function extractReadable(html, opts = {}) {
  const maxChars = opts.maxChars ?? 8000;
  let body = String(html ?? '').replace(DROP_BLOCKS, ' ');
  // 본문 컨테이너가 있으면 그 안만 — 없으면 <body> 전체.
  for (const re of MAIN_CANDIDATES) {
    const m = re.exec(body);
    if (m && textOf(m[1]).length > 200) { body = m[1]; break; }
  }

  const out = [];
  // 블록 요소를 순서대로 훑는다(정규식 하나로 위치 순서를 보존).
  const blockRe = /<(h[1-6]|p|li|blockquote|pre|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of body.matchAll(blockRe)) {
    const tag = m[1].toLowerCase();
    if (tag === 'tr') {
      const cells = [...m[2].matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => textOf(c[2]));
      // 1칸짜리 행은 대개 인포박스 제목·네비게이션이다(위키 "v t e" 등) — 표로 치지 않는다.
      if (cells.filter(Boolean).length < 2) continue;
      if (/^(v|t|e|edit)$/i.test(cells.join(''))) continue;
      out.push(`| ${cells.join(' | ')} |`);
      continue;
    }
    const text = textOf(m[2]);
    if (!text || BOILERPLATE.test(text)) continue;
    if (tag === 'p' && text.length < 20) continue;      // 캡션·라벨 조각은 버린다
    if (/^h[1-6]$/.test(tag)) out.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
    else if (tag === 'li') out.push(`- ${text}`);
    else if (tag === 'blockquote') out.push(`> ${text}`);
    else if (tag === 'pre') out.push(`\`\`\`\n${text}\n\`\`\``);
    else out.push(text);
  }

  // 아무 구조도 못 건졌으면 문단 없는 페이지다 — 통짜 텍스트로라도 준다(빈손보다 낫다).
  let markdown = out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!markdown) markdown = textOf(body).slice(0, maxChars);
  return { markdown: markdown.slice(0, maxChars), blocks: out.length };
}

/** 본문에서 바깥으로 나가는 링크(모델이 "더 볼 곳"을 알 수 있게). */
export function extractLinks(html, baseUrl, max = 10) {
  const seen = new Set();
  const out = [];
  for (const m of String(html ?? '').matchAll(/<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href = m[1];
    try { href = new URL(href, baseUrl).toString(); } catch { continue; }
    if (!/^https?:/.test(href) || seen.has(href)) continue;
    const text = textOf(m[2]);
    if (!text || text.length < 2) continue;
    seen.add(href);
    out.push({ text: text.slice(0, 80), url: href });
    if (out.length >= max) break;
  }
  return out;
}

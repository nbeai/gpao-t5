import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const DEFAULT_MAX_CHARS = 32_000;
const MAX_OUTPUT_CHARS = 64_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 8;
const MAX_RESPONSE_BYTES = 4_000_000;
export function webUserAgentForPlatform(platform = process.platform) {
  const system = platform === 'win32' ? 'Windows NT 10.0; Win64; x64'
    : platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36`;
}

function normalizedHostname(hostname) {
  return String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function ipv4Number(value) {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inV4Range(value, base, bits) {
  const number = ipv4Number(value);
  const root = ipv4Number(base);
  if (number == null || root == null) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(number / size) === Math.floor(root / size);
}

export function isPrivateWebAddress(value) {
  const address = normalizedHostname(value);
  const kind = isIP(address);
  if (kind === 4) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
      ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ].some(([base, bits]) => inV4Range(address, base, bits));
  }
  if (kind === 6) {
    if (address === '::' || address === '::1') return true;
    if (/^::ffff:/.test(address)) return isPrivateWebAddress(address.slice('::ffff:'.length));
    return /^(?:fc|fd|fe[89ab]|ff)/i.test(address);
  }
  return address === 'localhost' || address.endsWith('.localhost') || address.endsWith('.local');
}

export function normalizeWebUrl(raw) {
  let value = String(raw ?? '').trim();
  if (!value) throw new TypeError('url is required');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new TypeError('invalid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError('unsupported URL protocol');
  if (parsed.username || parsed.password) throw new TypeError('URL credentials are not allowed');
  parsed.hash = '';
  return parsed.href;
}

async function defaultResolveHost(hostname) {
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

async function publicTarget(url, resolveHost) {
  const parsed = new URL(url);
  const host = normalizedHostname(parsed.hostname);
  if (isPrivateWebAddress(host)) return false;
  let addresses;
  try { addresses = await resolveHost(host); }
  catch { return null; }
  return Array.isArray(addresses) && addresses.length > 0
    ? !addresses.some(isPrivateWebAddress)
    : null;
}

function contentType(headers) {
  return String(headers?.get?.('content-type') ?? '').split(';')[0].trim().toLowerCase();
}

async function limitedText(response, byteLimit = MAX_RESPONSE_BYTES) {
  if (!response.body?.getReader) {
    const text = await response.text();
    return { text: text.slice(0, byteLimit), bytes: Buffer.byteLength(text.slice(0, byteLimit)), truncated: Buffer.byteLength(text) > byteLimit };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = byteLimit - bytes;
    if (value.byteLength > remaining) {
      text += decoder.decode(value.subarray(0, Math.max(0, remaining)), { stream: true });
      bytes += Math.max(0, remaining);
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { text, bytes, truncated };
}

function compactText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\r/g, '').replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function balancedJsonEnd(source, start) {
  const opening = source[start];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length && index < start + 2_000_000; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === opening) depth += 1;
    else if (char === closing && --depth === 0) return index + 1;
  }
  return -1;
}

const EMBEDDED_SKIP_KEY = /^(?:__typename|__ref|id|index|priority|width|height)$/i;
const EMBEDDED_SKIP_VALUE_KEY = /(?:url|image|icon|token|hash|thumbnail)/i;

function harvestEmbedded(node, output, seen, maxItems, key = '') {
  if (output.length >= maxItems || node == null) return;
  if (typeof node === 'string') {
    const value = compactText(node);
    if (value.length < 2 || value.length > 1_000) return;
    if (/^(?:https?:|data:|\/|#)/i.test(value) || /^[0-9a-f-]{16,}$/i.test(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    output.push(key && !/^\d+$/.test(key) ? `${key}: ${value}` : value);
    return;
  }
  if (typeof node === 'number' || typeof node === 'boolean') {
    if (key && !EMBEDDED_SKIP_KEY.test(key)) output.push(`${key}: ${node}`);
    return;
  }
  if (Array.isArray(node)) {
    for (const value of node) harvestEmbedded(value, output, seen, maxItems, key);
    return;
  }
  if (typeof node === 'object') {
    for (const [childKey, value] of Object.entries(node)) {
      if (EMBEDDED_SKIP_KEY.test(childKey) || EMBEDDED_SKIP_VALUE_KEY.test(childKey)) continue;
      harvestEmbedded(value, output, seen, maxItems, childKey);
    }
  }
}

function embeddedPageData(html, { maxItems = 500, maxChars = 48_000 } = {}) {
  const groups = [];
  for (const match of String(html ?? '').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const script = match[1];
    if (!script || !/[{[]/.test(script)) continue;
    for (let offset = 0; offset < script.length;) {
      const relative = script.slice(offset).search(/[{[]/);
      if (relative < 0) break;
      const start = offset + relative;
      const end = balancedJsonEnd(script, start);
      if (end < 0) { offset = start + 1; continue; }
      let data;
      try { data = JSON.parse(script.slice(start, end).replace(/\\u002F/g, '/')); }
      catch { offset = start + 1; continue; }
      const values = [];
      harvestEmbedded(data, values, new Set(), maxItems);
      if (values.length) {
        const human = values.filter((value) => /\s|[^ -~]|[.!?,·]/.test(value)).length;
        groups.push({ values, human });
      }
      offset = end;
    }
  }
  groups.sort((left, right) => right.human - left.human);
  const seen = new Set();
  const values = [];
  for (const group of groups) {
    for (const value of group.values) {
      if (seen.has(value)) continue;
      seen.add(value);
      values.push(value);
      if (values.length >= maxItems) break;
    }
    if (values.length >= maxItems) break;
  }
  const full = values.join('\n');
  return {
    text: full.slice(0, maxChars), itemCount: values.length,
    observedChars: full.length,
    outputTruncated: full.length > maxChars,
    itemLimitReached: values.length >= maxItems,
  };
}

function htmlFragmentText(value) {
  const withBreaks = String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, (tag) => `${tag}\n`);
  const { document } = parseHTML(`<html><body>${withBreaks}</body></html>`);
  return compactText(document.body?.textContent ?? '');
}

function htmlFacts(html, url) {
  const { document } = parseHTML(html);
  const title = compactText(document.querySelector('title')?.textContent ?? '');
  const canonicalRaw = document.querySelector('link[rel~="canonical"]')?.getAttribute('href');
  let canonicalUrl = null;
  if (canonicalRaw) {
    try { canonicalUrl = normalizeWebUrl(new URL(canonicalRaw, url).href); } catch { canonicalUrl = null; }
  }
  const passwordField = Boolean(document.querySelector('input[type="password"]'));
  const scripts = document.querySelectorAll('script').length;
  const readableDocument = document.cloneNode(true);
  for (const element of readableDocument.querySelectorAll('script,style,noscript,template')) element.remove();
  const visibleFallback = htmlFragmentText(readableDocument.body?.innerHTML ?? '');
  let readable = null;
  try {
    const parsed = new Readability(readableDocument).parse();
    if (parsed?.textContent) readable = {
      title: compactText(parsed.title ?? title),
      text: htmlFragmentText(parsed.content ?? parsed.textContent),
    };
  } catch { /* use visible fallback */ }
  const text = readable?.text || visibleFallback;
  return {
    title: readable?.title || title,
    canonicalUrl,
    text,
    loginWall: passwordField && text.length < 1_000,
    dynamicShell: text.length < 120 && scripts > 0,
    partialDynamic: text.length >= 120 && text.length < 800 && scripts > 0 && html.length > 10_000,
  };
}

function contentWindow(text, maxChars) {
  const totalChars = text.length;
  const shown = text.slice(0, maxChars);
  return {
    text: shown, totalChars,
    trust: 'untrusted_external', instructionAuthority: 'none',
    truncated: totalChars > shown.length,
    omittedChars: Math.max(0, totalChars - shown.length),
  };
}

function responseState(status) {
  if (status === 401) return 'login_required';
  if (status === 429 || status === 503) return 'rate_limited';
  if (status < 200 || status >= 400) return 'blocked';
  return null;
}

export function makeWebReadTool({
  fetchImpl = globalThis.fetch,
  resolveHost = defaultResolveHost,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  allowPrivateUrls = false,
  urlResolvers = [],
  userAgent = webUserAgentForPlatform(),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  return {
    name: 'web_read',
    description: 'Read one exact public HTTP(S) URL. Returns observed source identity, redirects, content type, readable text, and honest login/dynamic/block/truncation boundaries.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Exact page URL selected from the request or web_search candidates.' },
        maxChars: { type: ['integer', 'null'], minimum: 500, maximum: MAX_OUTPUT_CHARS },
      },
      required: ['url', 'maxChars'],
      additionalProperties: false,
    },
    async execute(args = {}, context = {}) {
      const requestedUrl = normalizeWebUrl(args.url);
      const maxChars = args.maxChars == null ? DEFAULT_MAX_CHARS : Number(args.maxChars);
      if (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > MAX_OUTPUT_CHARS) {
        throw new TypeError(`maxChars must be an integer between 500 and ${MAX_OUTPUT_CHARS}`);
      }
      const redirects = [];
      let currentUrl = requestedUrl;
      let readStrategy = null;
      for (const resolver of urlResolvers) {
        const resolved = resolver?.resolve?.(requestedUrl);
        if (!resolved?.url) continue;
        const selectedUrl = normalizeWebUrl(resolved.url);
        if (selectedUrl === requestedUrl) continue;
        currentUrl = selectedUrl;
        readStrategy = {
          resolver: String(resolver.id ?? 'unnamed'),
          reason: String(resolved.reason ?? 'readable_alternative'), selectedUrl,
        };
        break;
      }
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        if (!allowPrivateUrls) {
          const safe = await publicTarget(currentUrl, resolveHost);
          if (safe !== true) return {
            state: 'blocked', reason: safe === false ? 'private_network' : 'dns_unverified',
            source: { requestedUrl, finalUrl: currentUrl, redirects, trust: 'untrusted_external', ...(readStrategy ? { readStrategy } : {}) },
            content: null,
          };
        }
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
        let response;
        try {
          response = await fetchImpl(currentUrl, {
            method: 'GET', redirect: 'manual', signal,
            headers: {
              accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.2',
              'user-agent': userAgent,
              'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
            },
          });
        } catch (error) {
          return {
            state: context.signal?.aborted ? 'cancelled' : 'failed',
            reason: error?.name === 'TimeoutError' ? 'timeout' : 'network_error',
            error: error?.message ?? String(error),
            source: { requestedUrl, finalUrl: currentUrl, redirects, trust: 'untrusted_external', ...(readStrategy ? { readStrategy } : {}) },
            content: null,
          };
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) return {
            state: 'blocked', reason: 'redirect_without_location',
            source: { requestedUrl, finalUrl: currentUrl, redirects, trust: 'untrusted_external', ...(readStrategy ? { readStrategy } : {}) }, content: null,
          };
          const next = normalizeWebUrl(new URL(location, currentUrl).href);
          if (redirects.some((entry) => entry.from === next) || next === requestedUrl) return {
            state: 'blocked', reason: 'redirect_loop',
            source: { requestedUrl, finalUrl: currentUrl, redirects, trust: 'untrusted_external', ...(readStrategy ? { readStrategy } : {}) }, content: null,
          };
          redirects.push({ status: response.status, from: currentUrl, to: next });
          currentUrl = next;
          continue;
        }
        const type = contentType(response.headers);
        const sourceBase = {
          requestedUrl, finalUrl: currentUrl, redirects, contentType: type || 'unknown',
          status: response.status, trust: 'untrusted_external', observedAt: new Date().toISOString(),
          ...(readStrategy ? { readStrategy } : {}),
        };
        const terminalState = responseState(response.status);
        if (terminalState) return { state: terminalState, source: sourceBase, content: null };
        const body = await limitedText(response);
        const source = { ...sourceBase, observedBytes: body.bytes, responseBodyTruncated: body.truncated };
        if (type === 'text/html' || type === 'application/xhtml+xml' || (!type && /<html/i.test(body.text))) {
          const facts = htmlFacts(body.text, currentUrl);
          const embedded = embeddedPageData(body.text, { maxChars: Math.min(48_000, maxChars) });
          const combinedText = embedded.text
            ? `${facts.text}${facts.text ? '\n\n' : ''}Embedded page data:\n${embedded.text}`
            : facts.text;
          source.title = facts.title;
          source.canonicalUrl = facts.canonicalUrl;
          source.embeddedData = {
            present: Boolean(embedded.text), itemCount: embedded.itemCount,
            observedChars: embedded.observedChars,
            outputTruncated: embedded.outputTruncated,
            itemLimitReached: embedded.itemLimitReached,
          };
          if (facts.loginWall) return { state: 'login_required', source, content: null };
          if (facts.dynamicShell && !embedded.text) return {
            state: 'dynamic_required', source, content: null,
            capabilityBoundary: {
              required: 'browser_render', available: false, staticObservationExhausted: true,
            },
          };
          if (!combinedText) return { state: 'empty', source, content: null };
          if (facts.partialDynamic || (facts.dynamicShell && Boolean(embedded.text))) {
            source.coverage = {
              kind: 'partial_dynamic', observedTextChars: facts.text.length,
              observedEmbeddedChars: embedded.text.length,
              observedHtmlChars: body.text.length, browserMayRevealMore: true,
            };
            return {
              state: 'partial_dynamic', source,
              content: { format: 'text', ...contentWindow(combinedText, maxChars) },
              capabilityBoundary: {
                required: 'browser_render', available: false, staticObservationExhausted: true,
              },
            };
          }
          source.coverage = {
            kind: 'readable', observedTextChars: facts.text.length,
            observedEmbeddedChars: embedded.text.length, browserMayRevealMore: false,
          };
          return { state: 'read', source, content: { format: 'text', ...contentWindow(combinedText, maxChars) } };
        }
        if (type === 'application/json' || type.endsWith('+json')) {
          let text = body.text;
          try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* preserve observed bytes */ }
          return { state: 'read', source, content: { format: 'json', ...contentWindow(text, maxChars) } };
        }
        if (type.startsWith('text/') || type === 'application/xml' || type.endsWith('+xml')) {
          return { state: 'read', source, content: { format: type.includes('xml') ? 'xml' : 'text', ...contentWindow(compactText(body.text), maxChars) } };
        }
        return { state: 'unsupported_content', source, content: null };
      }
      return {
        state: 'blocked', reason: 'too_many_redirects',
        source: { requestedUrl, finalUrl: currentUrl, redirects, trust: 'untrusted_external', ...(readStrategy ? { readStrategy } : {}) }, content: null,
      };
    },
  };
}

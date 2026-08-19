import { createHash } from 'node:crypto';

const ACTIONS = ['status', 'profiles', 'tabs', 'navigate', 'snapshot', 'screenshot'];
const DEFAULT_MAX_CHARS = 20_000;
const MAX_CHARS = 64_000;

function profileOf(driver) {
  return structuredClone(driver.profile ?? { id: 'isolated', kind: 'managed_isolated', selected: true });
}

function browserUrl(raw) {
  let parsed;
  try { parsed = new URL(String(raw ?? '').trim()); }
  catch { throw new TypeError('invalid browser URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError('unsupported browser URL protocol');
  if (parsed.username || parsed.password) throw new TypeError('browser URL credentials are not allowed');
  return parsed.href;
}

function observationResult(driver, value, maxChars) {
  const text = String(value?.snapshot?.text ?? '');
  const shown = text.slice(0, maxChars);
  const totalChars = Math.max(text.length, Number(value?.snapshot?.totalChars ?? 0));
  const observationId = createHash('sha256').update(JSON.stringify({
    tabId: value?.tab?.tabId ?? null,
    targetId: value?.tab?.targetId ?? null,
    url: value?.tab?.url ?? '', text, refs: value?.snapshot?.refs ?? {},
  })).digest('hex');
  return {
    state: 'observed', effect: 'observe', profile: profileOf(driver),
    tab: structuredClone(value.tab),
    observation: {
      observationId, text: shown, totalChars, shownChars: shown.length,
      truncated: value?.snapshot?.truncated === true || totalChars > shown.length,
      omittedChars: Math.max(0, totalChars - shown.length),
      refs: structuredClone(value?.snapshot?.refs ?? {}),
      refScope: {
        observationId, tabId: value?.tab?.tabId ?? null,
        targetId: value?.tab?.targetId ?? null, url: value?.tab?.url ?? '',
      },
      trust: 'untrusted_external', instructionAuthority: 'none',
    },
  };
}

export function makeBrowserObservationTool({ driver, publishScreenshot } = {}) {
  if (!driver || typeof driver.available !== 'function') throw new TypeError('browser driver is required');
  return {
    name: 'browser',
    description: 'Observe rendered web pages in a managed isolated browser. W1 is read-only: status, profiles, tabs, navigate, snapshot, and screenshot only; there is no click, typing, evaluation, upload, download, or computer use.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ACTIONS },
        url: { type: ['string', 'null'], description: 'HTTP(S) URL for navigate, otherwise null.' },
        tabId: { type: ['string', 'null'], description: 'Stable tabId from tabs or a prior observation, otherwise null.' },
        full: { type: ['boolean', 'null'], description: 'For snapshot: true includes full accessible page text; false is compact interactive structure.' },
        maxChars: { type: ['integer', 'null'], minimum: 500, maximum: MAX_CHARS },
        fullPage: { type: ['boolean', 'null'], description: 'For screenshot: capture the whole scrollable page.' },
      },
      required: ['action', 'url', 'tabId', 'full', 'maxChars', 'fullPage'],
      additionalProperties: false,
    },
    async execute(args = {}, context = {}) {
      if (!ACTIONS.includes(args.action)) throw new TypeError(`unsupported browser observation action: ${args.action}`);
      const availability = await driver.available();
      if (!availability?.available) return {
        state: 'unavailable', reason: availability?.reason ?? 'browser_unavailable', effect: 'observe',
      };
      if (args.action === 'status') return {
        ...(await driver.status(context.signal ? { signal: context.signal } : {})), effect: 'observe', profile: profileOf(driver),
      };
      if (args.action === 'profiles') return {
        state: 'observed', effect: 'observe', ...(await driver.profiles(context.signal ? { signal: context.signal } : {})),
      };
      if (args.action === 'tabs') return {
        state: 'observed', effect: 'observe', profile: profileOf(driver),
        ...(await driver.tabs(context.signal ? { signal: context.signal } : {})),
      };
      if (args.action === 'navigate') {
        if (!args.url) throw new TypeError('url is required for browser navigate');
        return observationResult(driver, await driver.navigate(browserUrl(args.url), context.signal ? { signal: context.signal } : {}),
          args.maxChars ?? DEFAULT_MAX_CHARS);
      }
      if (args.action === 'snapshot') {
        return observationResult(driver, await driver.snapshot({
          tabId: args.tabId, full: args.full === true,
          maxChars: args.maxChars ?? DEFAULT_MAX_CHARS,
          ...(context.signal ? { signal: context.signal } : {}),
        }), args.maxChars ?? DEFAULT_MAX_CHARS);
      }
      const captured = await driver.screenshot({
        tabId: args.tabId, fullPage: args.fullPage === true,
        ...(context.signal ? { signal: context.signal } : {}),
      });
      const preview = typeof publishScreenshot === 'function'
        ? await publishScreenshot(structuredClone(captured)) : null;
      return {
        state: 'captured', effect: 'observe', profile: profileOf(driver),
        tab: structuredClone(captured.tab),
        file: { ...structuredClone(captured.file), ...(preview?.url ? { previewUrl: preview.url } : {}) },
      };
    },
  };
}

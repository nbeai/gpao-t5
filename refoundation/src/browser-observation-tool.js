import { createHash } from 'node:crypto';
import { EFFECT_SCHEMA } from './exec-tool.js';
import { makeBrowserObservationRegistry } from './browser-action-state.js';

const ACTIONS = [
  'status', 'profiles', 'tabs', 'navigate', 'snapshot', 'screenshot', 'click', 'fill', 'submit',
  'login_start', 'login_status', 'login_cancel', 'download', 'upload',
];
const ACTION_KINDS = new Set(['click', 'fill', 'submit', 'download', 'upload']);
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

function observationResult(driver, value, maxChars, registry) {
  const text = String(value?.snapshot?.text ?? '');
  const shown = text.slice(0, maxChars);
  const totalChars = Math.max(text.length, Number(value?.snapshot?.totalChars ?? 0));
  const observationId = createHash('sha256').update(JSON.stringify({
    tabId: value?.tab?.tabId ?? null,
    targetId: value?.tab?.targetId ?? null,
    url: value?.tab?.url ?? '', text, refs: value?.snapshot?.refs ?? {},
  })).digest('hex');
  const result = {
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
  registry.remember(result.observation);
  return result;
}

const SECRET_AUTOCOMPLETE = /^(?:current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp|cc-exp-month|cc-exp-year|cc-name)$/i;

function effectTargetsCurrentPage(effect, observation) {
  let origin = '';
  try { origin = new URL(observation.refScope.url).origin; } catch { /* invalid observed URL */ }
  return Array.isArray(effect?.targets) && effect.targets.some((target) => {
    const value = String(target ?? '').trim();
    return value === observation.refScope.url || value === origin;
  });
}

function blocked(state, extra = {}) {
  return { allowed: false, outcome: 'not_executed', result: { state, ...extra } };
}

export function makeBrowserObservationTool({
  driver,
  publishScreenshot,
  observationRegistry = makeBrowserObservationRegistry(),
  authorizeEffect,
  authorizeUploadPath,
} = {}) {
  if (!driver || typeof driver.available !== 'function') throw new TypeError('browser driver is required');
  const tool = {
    name: 'browser',
    description: 'Observe and act in the T5-managed browser profile for this conversation. When login is required, T5 opens that same profile visibly and returns control to the user; the model never receives passwords, OTPs, cookies, or storage. download and upload are available only with exact observed controls and receipts.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string', enum: ACTIONS,
          description: 'Use submit, download, or upload rather than click for the corresponding observed control.',
        },
        url: { type: ['string', 'null'], description: 'HTTP(S) URL for navigate or login_start, otherwise null.' },
        tabId: { type: ['string', 'null'], description: 'Stable tabId from tabs or a prior observation, otherwise null.' },
        full: { type: ['boolean', 'null'], description: 'For snapshot: true includes full accessible page text; false is compact interactive structure.' },
        maxChars: { type: ['integer', 'null'], minimum: 500, maximum: MAX_CHARS },
        fullPage: { type: ['boolean', 'null'], description: 'For screenshot: capture the whole scrollable page.' },
        observationId: { type: ['string', 'null'], description: 'Exact latest observationId that supplied ref, otherwise null.' },
        ref: { type: ['string', 'null'], description: 'Exact ref from the bound observation for click, fill, submit, download, or upload; otherwise null.' },
        text: { type: ['string', 'null'], maxLength: 4_000, description: 'Non-secret text for fill, otherwise null.' },
        filePath: { type: ['string', 'null'], description: 'Exact absolute user-provided path for upload, otherwise null.' },
        effect: {
          description: 'For click/fill/submit/download/upload, targets must contain the exact current page URL or origin only; never append an element label or description.',
          anyOf: [EFFECT_SCHEMA, { type: 'null' }],
        },
      },
      required: [
        'action', 'url', 'tabId', 'full', 'maxChars', 'fullPage',
        'observationId', 'ref', 'text', 'filePath', 'effect',
      ],
      additionalProperties: false,
    },
    async execute(args = {}, context = {}) {
      if (!ACTIONS.includes(args.action)) throw new TypeError(`unsupported browser observation action: ${args.action}`);
      const availability = await driver.available();
      if (!availability?.available) return {
        state: 'unavailable', reason: availability?.reason ?? 'browser_unavailable', effect: 'observe',
      };
      const userControlActive = driver.userControlActive?.() === true;
      const safeDuringHandoff = new Set(['status', 'profiles', 'login_status', 'login_cancel']);
      if (userControlActive && !safeDuringHandoff.has(args.action)) return {
        state: 'user_control_in_progress', effect: 'not_executed', pageObserved: false,
        secretValuesObserved: false,
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
      if (args.action === 'login_start') {
        if (!args.url) throw new TypeError('url is required for browser login_start');
        return {
          ...(await driver.beginUserLogin(
            browserUrl(args.url), context.signal ? { signal: context.signal } : {},
          )),
          effect: 'observe',
        };
      }
      if (args.action === 'login_status') {
        const result = await driver.loginStatus({
          tabId: args.tabId, ...(context.signal ? { signal: context.signal } : {}),
        });
        if (!result?.snapshot) return { ...structuredClone(result), effect: 'observe' };
        const observed = observationResult(
          driver, result, args.maxChars ?? DEFAULT_MAX_CHARS, observationRegistry,
        );
        return {
          state: result.state, effect: 'observe', profile: profileOf(driver),
          secretFieldsPresent: false, secretValuesObserved: false,
          continuityEstablished: result.continuityEstablished === true,
          tab: observed.tab, observation: observed.observation,
          handoff: structuredClone(result.handoff),
        };
      }
      if (args.action === 'login_cancel') {
        return {
          ...(await driver.cancelUserLogin(context.signal ? { signal: context.signal } : {})),
          effect: 'observe',
        };
      }
      if (args.action === 'navigate') {
        if (!args.url) throw new TypeError('url is required for browser navigate');
        return observationResult(driver, await driver.navigate(browserUrl(args.url), context.signal ? { signal: context.signal } : {}),
          args.maxChars ?? DEFAULT_MAX_CHARS, observationRegistry);
      }
      if (args.action === 'snapshot') {
        return observationResult(driver, await driver.snapshot({
          tabId: args.tabId, full: args.full === true,
          maxChars: args.maxChars ?? DEFAULT_MAX_CHARS,
          ...(context.signal ? { signal: context.signal } : {}),
        }), args.maxChars ?? DEFAULT_MAX_CHARS, observationRegistry);
      }
      if (ACTION_KINDS.has(args.action)) {
        const safety = await actionSafety(args, context, false);
        if (!safety.allowed) return { ...safety.result, effect: 'not_executed' };
        const before = safety.binding.observation;
        const acted = await driver[args.action]({
          tabId: args.tabId, ref: args.ref,
          ...(args.action === 'fill' ? { text: args.text } : {}),
          ...(args.action === 'upload' ? {
            filePath: args.filePath, expectedSha256: safety.fileFacts?.sha256,
          } : {}),
          signal: context.signal,
        });
        const after = observationResult(driver, acted, args.maxChars ?? DEFAULT_MAX_CHARS, observationRegistry);
        return {
          state: 'acted', profile: profileOf(driver),
          action: structuredClone(acted.action ?? { kind: args.action, ref: args.ref }),
          declaredEffect: structuredClone(args.effect),
          before: {
            observationId: before.observationId,
            refScope: structuredClone(before.refScope),
            ref: args.ref, refFact: structuredClone(safety.binding.refFact),
          },
          tab: after.tab, after: after.observation,
          navigation: {
            changed: before.refScope.url !== after.tab.url,
            from: before.refScope.url, to: after.tab.url,
          },
          network: structuredClone(acted.network ?? { totalRequests: 0, truncated: false, requests: [] }),
          ...(['download', 'upload'].includes(args.action) ? {
            file: structuredClone(acted.file), source: structuredClone(acted.source),
          } : {}),
        };
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

  async function actionSafety(args, context, includeAuthority) {
    if (!ACTION_KINDS.has(args.action)) return { allowed: true };
    const binding = observationRegistry.resolve({
      observationId: args.observationId, tabId: args.tabId, ref: args.ref,
    });
    if (!binding.ok) return { ...blocked(binding.state, binding), binding };
    if (!args.effect?.kind) return { ...blocked('effect_declaration_required'), binding };
    if (!effectTargetsCurrentPage(args.effect, binding.observation)) {
      return { ...blocked('effect_target_mismatch', {
        observedUrl: binding.observation.refScope.url,
      }), binding };
    }
    const role = String(binding.refFact?.role ?? '').toLowerCase();
    let elementFacts = {};
    let submitFacts = null;
    try {
      if (args.action === 'submit') {
        submitFacts = await driver.submitFacts({ tabId: args.tabId, ref: args.ref, signal: context?.signal });
        elementFacts = submitFacts.element ?? {};
      } else {
        elementFacts = await driver.elementFacts({ tabId: args.tabId, ref: args.ref, signal: context?.signal });
      }
    }
    catch (error) { return { ...blocked('element_facts_unavailable', { reason: error?.message ?? String(error) }), binding }; }
    if (args.action === 'fill') {
      if (!['textbox', 'searchbox', 'combobox'].includes(role)) {
        return { ...blocked('ref_not_text_input', { role }), binding };
      }
      if (elementFacts.type === 'password' || SECRET_AUTOCOMPLETE.test(String(elementFacts.autocomplete ?? ''))
        || args.effect.kind === 'secret_input') {
        return { ...blocked('secret_input_required', { field: elementFacts }), binding };
      }
      if (!['external_send', 'external_change'].includes(args.effect.kind)) {
        return { ...blocked('effect_declaration_mismatch', { reason: 'external_send_required' }), binding };
      }
      if (args.text == null) return { ...blocked('text_required'), binding };
    }
    if (args.action === 'click') {
      const submitLike = String(elementFacts.type ?? '').toLowerCase() === 'submit';
      if (submitLike) return { ...blocked('submit_requires_explicit_action'), binding };
      if (elementFacts.download != null) return { ...blocked('download_requires_explicit_action'), binding };
      if (String(elementFacts.type ?? '').toLowerCase() === 'file') {
        return { ...blocked('upload_requires_explicit_action'), binding };
      }
      const mutableControl = ['button', 'checkbox', 'radio', 'switch', 'menuitem'].includes(role);
      if (mutableControl && args.effect.kind === 'observe') {
        return { ...blocked('effect_declaration_mismatch', {
          reason: 'external_change_required',
        }), binding };
      }
    }
    if (args.action === 'submit') {
      if (String(elementFacts.type ?? '').toLowerCase() !== 'submit') {
        return { ...blocked('ref_not_submit_control'), binding };
      }
      if (Number(submitFacts?.secretFieldCount ?? 0) > 0) {
        return { ...blocked('secret_input_required', { secretFieldCount: submitFacts.secretFieldCount }), binding };
      }
      if (Number(submitFacts?.fileInputCount ?? 0) > 0) {
        return { ...blocked('upload_action_not_open', { fileInputCount: submitFacts.fileInputCount }), binding };
      }
      if (!['external_send', 'payment', 'destructive'].includes(args.effect.kind)) {
        return { ...blocked('effect_declaration_mismatch', { reason: 'external_send_required' }), binding };
      }
    }
    if (args.action === 'download') {
      if (!['link', 'button'].includes(role)) {
        return { ...blocked('ref_not_download_control', { role }), binding };
      }
      if (args.effect.kind !== 'local_change') {
        return { ...blocked('effect_declaration_mismatch', { reason: 'local_change_required' }), binding };
      }
    }
    let fileFacts = null;
    if (args.action === 'upload') {
      if (String(elementFacts.type ?? '').toLowerCase() !== 'file') {
        return { ...blocked('ref_not_file_input'), binding };
      }
      if (!args.filePath || typeof authorizeUploadPath !== 'function'
        || await authorizeUploadPath(args.filePath, context) !== true) {
        return { ...blocked('upload_path_not_user_authorized'), binding };
      }
      if (args.effect.kind !== 'external_send') {
        return { ...blocked('effect_declaration_mismatch', { reason: 'external_send_required' }), binding };
      }
      if (args.effect.recipientNew === true) {
        return { ...blocked('upload_new_recipient_not_open'), binding };
      }
      try { fileFacts = await driver.uploadFileFacts(args.filePath); }
      catch (error) {
        return { ...blocked('upload_file_rejected', { reason: error?.message ?? String(error) }), binding };
      }
    }
    if (includeAuthority && typeof authorizeEffect === 'function') {
      const authority = await authorizeEffect(args, context);
      if (authority?.allowed === false) return { ...authority, binding };
    }
    return { allowed: true, binding, elementFacts, fileFacts };
  }

  if (typeof authorizeEffect === 'function') {
    tool.preflight = async (args, context) => {
      const safety = await actionSafety(args, context, true);
      return safety.allowed ? { allowed: true } : safety;
    };
  }
  return tool;
}

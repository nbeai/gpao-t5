import { createHash } from 'node:crypto';
import { EFFECT_SCHEMA } from './exec-tool.js';
import { makeBrowserObservationRegistry } from './browser-action-state.js';

const ACTIONS = [
  'status', 'profiles', 'tabs', 'navigate', 'snapshot', 'screenshot', 'click', 'fill', 'fill_editable', 'submit',
  'login_start', 'login_status', 'login_cancel', 'download', 'upload',
];
const ACTION_KINDS = new Set(['click', 'fill', 'fill_editable', 'submit', 'download', 'upload']);
const MODAL_INTENTS = [null, 'dismiss', 'continue', 'discard_existing', 'replace_existing'];
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
    editables: value?.snapshot?.editables ?? [],
  })).digest('hex');
  const refs = structuredClone(value?.snapshot?.refs ?? {});
  for (const fact of Object.values(refs)) {
    if (fact?.context?.modal === true) fact.context.documentRevision = observationId;
  }
  const result = {
    state: 'observed', effect: 'observe', profile: profileOf(driver),
    tab: structuredClone(value.tab),
    inputCapabilities: {
      fillEditable: true, acceptsObservedText: true, maxChars: 20_000,
      fileUploadRequired: false,
    },
    observation: {
      observationId, text: shown, totalChars, shownChars: shown.length,
      truncated: value?.snapshot?.truncated === true || totalChars > shown.length,
      omittedChars: Math.max(0, totalChars - shown.length),
      refs,
      editables: structuredClone(value?.snapshot?.editables ?? []),
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
  resolveUploadArtifact,
} = {}) {
  if (!driver || typeof driver.available !== 'function') throw new TypeError('browser driver is required');
  const tool = {
    name: 'browser',
    description: 'Observe and act in the T5-managed browser. navigate and snapshot return one current observation containing page text, refs, and any exact rich-editor targets; use fill_editable directly with an editableId from that same observation. Never inspect or control the managed browser through terminal/CDP. Login secrets remain user-controlled. Publishing/submission stays a separate explicit action.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string', enum: ACTIONS,
          description: 'Use navigate or snapshot, then fill_editable with an exact editableId from that same observation. fill_editable can pass full observed non-secret text, including text read from a user-authorized local file; that is browser text input, not file upload. Use submit, download, or upload rather than click for the corresponding observed control.',
        },
        url: { type: ['string', 'null'], description: 'HTTP(S) URL for navigate or login_start, otherwise null.' },
        tabId: { type: ['string', 'null'], description: 'Stable tabId from tabs or a prior observation, otherwise null.' },
        full: { type: ['boolean', 'null'], description: 'For snapshot: true includes full accessible page text; false is compact interactive structure.' },
        maxChars: { type: ['integer', 'null'], minimum: 500, maximum: MAX_CHARS },
        fullPage: { type: ['boolean', 'null'], description: 'For screenshot: capture the whole scrollable page.' },
        observationId: { type: ['string', 'null'], description: 'Exact latest observationId that supplied ref, otherwise null.' },
        ref: { type: ['string', 'null'], description: 'Exact ref from the bound observation for click, fill, submit, download, or upload; otherwise null.' },
        editableId: { type: ['string', 'null'], description: 'Exact editableId from editables for fill_editable, otherwise null.' },
        modalIntent: {
          type: ['string', 'null'], enum: MODAL_INTENTS,
          description: 'For a click target inside dialog/alertdialog, explicitly state dismiss, continue, discard_existing, or replace_existing. discard/replace require destructive effect. Otherwise null.',
        },
        text: { type: ['string', 'null'], maxLength: 20_000, description: 'Full non-secret text for fill or fill_editable, including text actually read from a user-authorized local file; otherwise null. Passing text is not a file upload.' },
        textFilePath: { type: ['string', 'null'], description: 'Exact user-provided local UTF-8 text path for fill or fill_editable when the runtime should read and hash the text without making the model copy it; otherwise null. This is not file upload.' },
        textFileStartLine: { type: ['integer', 'null'], minimum: 1, description: 'Optional 1-based first line to use from textFilePath; null when no text file is used.' },
        filePath: { type: ['string', 'null'], description: 'Exact absolute user-provided path for upload, otherwise null.' },
        attachmentId: { type: ['string', 'null'], description: 'For upload only: exact managed attachmentId from a prior browser download in this conversation when the user refers to that file; otherwise null.' },
        effect: {
          description: 'For click/fill/submit/download/upload, targets must contain the exact current page URL or origin only; never append an element label or description.',
          anyOf: [EFFECT_SCHEMA, { type: 'null' }],
        },
      },
      required: [
        'action', 'url', 'tabId', 'full', 'maxChars', 'fullPage',
        'observationId', 'ref', 'editableId', 'modalIntent', 'text', 'textFilePath', 'textFileStartLine',
        'filePath', 'attachmentId', 'effect',
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
        secretValuesObserved: false, nextAction: 'login_status',
        reason: 'login_handoff_requires_status_check',
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
        const value = await driver.navigate(
          browserUrl(args.url), context.signal ? { signal: context.signal } : {},
        );
        const editableValue = await driver.editables({
          tabId: value.tab?.tabId, ...(context.signal ? { signal: context.signal } : {}),
        });
        value.snapshot.editables = editableValue.editables;
        const observed = observationResult(
          driver, value, args.maxChars ?? DEFAULT_MAX_CHARS, observationRegistry,
        );
        const secretFacts = typeof driver.pageSecretFacts === 'function'
          ? await driver.pageSecretFacts({ tabId: value.tab?.tabId, ...(context.signal ? { signal: context.signal } : {}) })
          : { secretFieldCount: 0, secretValuesObserved: false };
        if (Number(secretFacts.secretFieldCount ?? 0) > 0) return {
          ...observed, secretFieldsPresent: true, secretValuesObserved: false,
          loginBoundary: { state: 'user_login_required', nextAction: 'login_start', url: observed.tab.url },
        };
        return observed;
      }
      if (args.action === 'snapshot') {
        const value = await driver.snapshot({
          tabId: args.tabId, full: args.full === true,
          maxChars: args.maxChars ?? DEFAULT_MAX_CHARS,
          ...(context.signal ? { signal: context.signal } : {}),
        });
        const editableValue = await driver.editables({
          tabId: value.tab?.tabId, ...(context.signal ? { signal: context.signal } : {}),
        });
        value.snapshot.editables = editableValue.editables;
        return observationResult(
          driver, value, args.maxChars ?? DEFAULT_MAX_CHARS, observationRegistry,
        );
      }
      if (ACTION_KINDS.has(args.action)) {
        const safety = await actionSafety(args, context, false);
        if (!safety.allowed) return { ...safety.result, effect: 'not_executed' };
        const before = safety.binding.observation;
        const driverAction = args.action === 'fill_editable' ? 'fillEditable' : args.action;
        const acted = await driver[driverAction]({
          tabId: args.tabId, ref: args.ref, editableId: args.editableId,
          ...(args.action === 'fill' ? { text: safety.textSource?.text ?? args.text } : {}),
          ...(args.action === 'fill_editable' ? { text: safety.textSource?.text ?? args.text } : {}),
          ...(args.action === 'upload' ? {
            filePath: safety.fileFacts?.path ?? args.filePath, expectedSha256: safety.fileFacts?.sha256,
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
            editableId: args.editableId,
            editableFact: structuredClone(safety.binding.editableFact),
          },
          tab: after.tab, after: after.observation,
          navigation: {
            changed: before.refScope.url !== after.tab.url,
            from: before.refScope.url, to: after.tab.url,
          },
          ...(args.action === 'click'
            && String(safety.binding.refFact?.role ?? '').toLowerCase() === 'link'
            ? { possibleAccountStateChange: true } : {}),
          ...(acted.tabTransition ? { tabTransition: structuredClone(acted.tabTransition) } : {}),
          ...(args.modalIntent ? {
            modalAction: {
              intent: args.modalIntent,
              context: structuredClone(safety.binding.refFact?.context ?? null),
            },
            effectTruth: {
              requestedKind: args.effect.kind,
              actualKind: ['discard_existing', 'replace_existing'].includes(args.modalIntent)
                ? 'destructive' : args.effect.kind,
            },
          } : {}),
          ...(acted.editorProvider ? { editorProvider: structuredClone(acted.editorProvider) } : {}),
          ...(safety.textSource ? {
            textSource: {
              path: safety.textSource.path, bytes: safety.textSource.bytes,
              sha256: safety.textSource.sha256, mimeType: safety.textSource.mimeType,
              textChars: safety.textSource.textChars,
              startLine: safety.textSource.startLine,
            },
          } : {}),
          network: structuredClone(acted.network ?? { totalRequests: 0, truncated: false, requests: [] }),
          ...(['download', 'upload'].includes(args.action) ? {
            file: structuredClone(acted.file), source: structuredClone(acted.source),
          } : {}),
          ...(args.action === 'upload' && safety.fileFacts?.attachmentId ? {
            artifact: {
              attachmentId: safety.fileFacts.attachmentId,
              path: safety.fileFacts.path, bytes: safety.fileFacts.bytes,
              sha256: safety.fileFacts.sha256, mimeType: safety.fileFacts.mimeType,
            },
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
    const binding = args.action === 'fill_editable'
      ? observationRegistry.resolveEditable({
        observationId: args.observationId, tabId: args.tabId, editableId: args.editableId,
      })
      : observationRegistry.resolve({
        observationId: args.observationId, tabId: args.tabId, ref: args.ref,
      });
    if (!binding.ok) return { ...blocked(binding.state, binding), binding };
    if (!args.effect?.kind) return { ...blocked('effect_declaration_required'), binding };
    if (!effectTargetsCurrentPage(args.effect, binding.observation)) {
      return { ...blocked('effect_target_mismatch', {
        observedUrl: binding.observation.refScope.url,
      }), binding };
    }
    const modal = args.action === 'click' && binding.refFact?.context?.modal === true;
    if (modal) {
      const modalContext = binding.refFact.context;
      if (!modalContext.modalId || !modalContext.controlId || !modalContext.frameId
        || modalContext.documentRevision !== binding.observation.observationId) {
        return { ...blocked('modal_context_incomplete'), binding };
      }
      let currentModal;
      try {
        currentModal = await driver.modalControlFacts?.({
          tabId: args.tabId, ref: args.ref, signal: context?.signal,
        });
      } catch (error) {
        return { ...blocked('modal_context_unavailable', {
          reason: error?.message ?? String(error),
        }), binding };
      }
      if (!currentModal || currentModal.modalId !== modalContext.modalId
        || currentModal.controlId !== modalContext.controlId
        || currentModal.frameId !== modalContext.frameId) {
        return { ...blocked('modal_identity_changed'), binding };
      }
      if (!args.modalIntent) {
        return {
          ...blocked('modal_intent_required', {
            modalContext: structuredClone(modalContext),
          }), binding,
        };
      }
      if (['discard_existing', 'replace_existing'].includes(args.modalIntent)
        && args.effect.kind !== 'destructive') {
        return { ...blocked('effect_declaration_mismatch', { reason: 'destructive_required' }), binding };
      }
      if (['dismiss', 'continue'].includes(args.modalIntent) && args.effect.kind === 'observe') {
        return { ...blocked('effect_declaration_mismatch', { reason: 'external_change_required' }), binding };
      }
    }
    const role = String(binding.refFact?.role ?? '').toLowerCase();
    let elementFacts = {};
    let submitFacts = null;
    try {
      if (args.action === 'fill_editable') {
        elementFacts = { type: 'contenteditable', autocomplete: null };
      } else
      if (args.action === 'submit') {
        submitFacts = await driver.submitFacts({ tabId: args.tabId, ref: args.ref, signal: context?.signal });
        elementFacts = submitFacts.element ?? {};
      } else {
        elementFacts = await driver.elementFacts({ tabId: args.tabId, ref: args.ref, signal: context?.signal });
      }
    }
    catch (error) { return { ...blocked('element_facts_unavailable', { reason: error?.message ?? String(error) }), binding }; }
    if (args.action === 'fill' || args.action === 'fill_editable') {
      if (args.action === 'fill_editable' && binding.editableFact?.secretLike) {
        return { ...blocked('secret_input_required'), binding };
      }
      if (args.action === 'fill_editable' && !args.editableId) {
        return { ...blocked('editable_required'), binding };
      }
      if (args.text != null && args.textFilePath != null) {
        return { ...blocked('text_source_ambiguous'), binding };
      }
      if (args.textFilePath == null && args.textFileStartLine != null) {
        return { ...blocked('text_source_ambiguous'), binding };
      }
      if (args.text == null && args.textFilePath == null) return { ...blocked('text_required'), binding };
      if (args.action === 'fill_editable' && !['external_send', 'external_change'].includes(args.effect.kind)) {
        return { ...blocked('effect_declaration_mismatch', { reason: 'external_send_required' }), binding };
      }
      if (args.action === 'fill_editable') {
        // The observed editable identity replaces an accessibility ref for rich editors.
      } else {
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
      }
    }
    let textSource = null;
    if ((args.action === 'fill' || args.action === 'fill_editable') && args.textFilePath != null) {
      if (typeof authorizeUploadPath !== 'function'
        || await authorizeUploadPath(args.textFilePath, context) !== true) {
        return { ...blocked('text_path_not_user_authorized'), binding };
      }
      try {
        textSource = await driver.readTextFile(args.textFilePath, {
          startLine: args.textFileStartLine ?? 1,
        });
      }
      catch (error) {
        return { ...blocked('text_source_rejected', { reason: error?.message ?? String(error) }), binding };
      }
    }
    if (args.action === 'click') {
      const submitLike = String(elementFacts.type ?? '').toLowerCase() === 'submit';
      if (submitLike) return { ...blocked('submit_requires_explicit_action'), binding };
      if (elementFacts.download != null) return { ...blocked('download_requires_explicit_action'), binding };
      if (String(elementFacts.type ?? '').toLowerCase() === 'file') {
        return { ...blocked('upload_requires_explicit_action'), binding };
      }
      const mutableControl = ['button', 'checkbox', 'radio', 'switch', 'menuitem'].includes(role);
      if (role === 'link' && args.effect.kind === 'observe') {
        return { ...blocked('effect_declaration_mismatch', {
          reason: 'link_navigation_may_change_account_state',
        }), binding };
      }
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
      if (args.filePath != null && args.attachmentId != null) return { ...blocked('upload_source_ambiguous'), binding };
      if (args.attachmentId != null) {
        if (typeof resolveUploadArtifact !== 'function') return { ...blocked('upload_artifact_not_authorized'), binding };
        try { fileFacts = await resolveUploadArtifact(args.attachmentId, context); }
        catch (error) { return { ...blocked('upload_artifact_not_authorized', { reason: error?.message ?? String(error) }), binding }; }
        if (!fileFacts?.path || !fileFacts?.sha256) return { ...blocked('upload_artifact_not_authorized'), binding };
      } else if (!args.filePath || typeof authorizeUploadPath !== 'function'
        || await authorizeUploadPath(args.filePath, context) !== true) {
        return { ...blocked('upload_path_not_user_authorized'), binding };
      }
      if (args.effect.kind !== 'external_send') {
        return { ...blocked('effect_declaration_mismatch', { reason: 'external_send_required' }), binding };
      }
      if (args.effect.recipientNew === true) {
        return { ...blocked('upload_new_recipient_not_open'), binding };
      }
      if (!fileFacts) {
        try { fileFacts = await driver.uploadFileFacts(args.filePath); }
        catch (error) {
          return { ...blocked('upload_file_rejected', { reason: error?.message ?? String(error) }), binding };
        }
      }
    }
    if (includeAuthority && typeof authorizeEffect === 'function') {
      const authority = await authorizeEffect(args, {
        ...context,
        requiredEffect: modal && ['discard_existing', 'replace_existing'].includes(args.modalIntent)
          ? 'destructive' : null,
      });
      if (authority?.allowed === false) return { ...authority, binding };
    }
    return { allowed: true, binding, elementFacts, fileFacts, textSource };
  }

  if (typeof authorizeEffect === 'function') {
    tool.preflight = async (args, context) => {
      const safety = await actionSafety(args, context, true);
      return safety.allowed ? { allowed: true } : safety;
    };
  }
  return tool;
}

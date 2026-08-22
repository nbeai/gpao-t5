import { createHash, randomUUID } from 'node:crypto';

import { chromium } from 'playwright-core';

const MAX_EDITABLES = 20;
const MAX_PREVIEW_CHARS = 200;
const MODAL_BINDING_ATTRIBUTE = 'data-t5-modal-binding';
const CONTROL_BINDING_ATTRIBUTE = 'data-t5-modal-control-binding';

function compactText(value) { return String(value ?? '').replace(/\s/gu, ''); }
function digest(value) { return createHash('sha256').update(String(value ?? '')).digest('hex'); }

function contentFact(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n');
  const compact = compactText(text);
  return {
    text, textChars: text.length, textPreview: text.slice(0, MAX_PREVIEW_CHARS),
    compactChars: compact.length, compactSha256: digest(compact),
  };
}

async function pageTargetId(context, page) {
  const session = await context.newCDPSession(page);
  try { return (await session.send('Target.getTargetInfo')).targetInfo?.targetId ?? null; }
  finally { await session.detach(); }
}

async function candidateFact(locator) {
  return locator.evaluate((element) => {
    const view = element.ownerDocument.defaultView;
    const style = view.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const text = String(element.innerText || element.textContent || '').replace(/\r\n/g, '\n');
    const placeholder = element.getAttribute('aria-label') || element.getAttribute('data-placeholder')
      || element.getAttribute('placeholder') || '';
    const type = String(element.getAttribute('type') || '').toLocaleLowerCase();
    const autocomplete = String(element.getAttribute('autocomplete') || '').toLocaleLowerCase();
    const ariaHidden = Boolean(element.closest('[aria-hidden="true"]'));
    const inViewport = rect.bottom > 0 && rect.right > 0
      && rect.top < view.innerHeight && rect.left < view.innerWidth;
    return {
      visible: style.display !== 'none' && style.visibility !== 'hidden'
        && rect.width > 0 && rect.height > 0 && !ariaHidden && inViewport,
      text, placeholder, tag: element.tagName.toLocaleLowerCase(), type, autocomplete,
      direct: element.isContentEditable === true
        || ['textarea', 'input'].includes(element.tagName.toLocaleLowerCase()),
      insideDirectEditable: Boolean(element.parentElement?.closest(
        '[contenteditable="true"], [contenteditable="plaintext-only"]',
      )),
    };
  });
}

function secretLike(fact) {
  return fact.type === 'password'
    || /password|one-time-code|cc-|otp|verification/u.test(fact.autocomplete);
}

export function makeManagedPlaywrightEditorProvider({ browserHost } = {}) {
  if (!browserHost || typeof browserHost.connection !== 'function') {
    throw new TypeError('browserHost is required');
  }
  let browser = null;
  let context = null;
  const targets = new Map();

  async function connection() {
    if (browser?.isConnected?.() && context) return { browser, context };
    const { cdpUrl } = await browserHost.connection();
    browser = await chromium.connectOverCDP(cdpUrl, {
      isLocal: true, noDefaults: true, timeout: 30_000,
    });
    context = browser.contexts()[0];
    browser.once('disconnected', () => { browser = null; context = null; targets.clear(); });
    return { browser, context };
  }

  async function pageFor(targetId) {
    const connected = await connection();
    for (const page of connected.context.pages()) {
      if (await pageTargetId(connected.context, page) === targetId) return page;
    }
    throw new Error('playwright provider could not bind the exact browser target');
  }

  async function inspect({ tab } = {}) {
    if (!tab?.targetId) return [];
    const page = await pageFor(tab.targetId);
    targets.clear();
    const rows = [];
    for (const frame of page.frames()) {
      const directLocator = frame.locator(
        '[contenteditable="true"], [contenteditable="plaintext-only"], textarea, input:not([type="hidden"])',
      );
      const hasEditorHost = await frame.locator(
        '[contenteditable="true"], [contenteditable="plaintext-only"]',
      ).count() > 0;
      const sources = [
        { locator: directLocator, mode: 'direct' },
        ...(hasEditorHost ? [{ locator: frame.locator('article p'), mode: 'click_to_edit' }] : []),
      ];
      for (const source of sources) {
        const count = Math.min(await source.locator.count(), MAX_EDITABLES - rows.length);
        for (let index = 0; index < count; index += 1) {
          const locator = source.locator.nth(index);
          const fact = await candidateFact(locator);
          if (!fact.visible || (source.mode === 'click_to_edit' && fact.insideDirectEditable)) continue;
          const id = `pw-${randomUUID()}`;
          const readLocator = source.mode === 'click_to_edit'
            ? locator.locator('xpath=ancestor::article[1]') : locator;
          const current = contentFact(fact.text);
          const label = String(fact.placeholder || current.textPreview || `편집 영역 ${rows.length + 1}`)
            .slice(0, 120);
          const row = {
            editableId: id, label, kind: 'editor', textChars: current.textChars,
            textPreview: current.textPreview, multiline: fact.tag !== 'input',
            secretLike: secretLike(fact), provider: 'managed_playwright',
            interactionMode: source.mode,
          };
          targets.set(id, {
            targetId: tab.targetId, page, frame, locator, readLocator, row, before: current,
            formControl: ['input', 'textarea'].includes(fact.tag),
          });
          rows.push(row);
          if (rows.length >= MAX_EDITABLES) return rows;
        }
      }
    }
    return rows;
  }

  async function inspectModals({ tab } = {}) {
    if (!tab?.targetId) return [];
    const page = await pageFor(tab.targetId);
    const modals = [];
    for (const frame of page.frames()) {
      const discovered = await frame.locator('body').evaluate((body, attributes) => {
        const visible = (element) => {
          const view = element.ownerDocument.defaultView;
          const style = view.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden'
            && style.opacity !== '0' && rect.width > 0 && rect.height > 0
            && rect.bottom > 0 && rect.right > 0
            && rect.top < view.innerHeight && rect.left < view.innerWidth
            && !element.closest('[aria-hidden="true"]');
        };
        const controlsIn = (element) => Array.from(element.querySelectorAll(
          'button, [role="button"], input[type="button"], input[type="submit"], a[href]',
        )).filter(visible);
        const explicit = (element) => element.matches(
          'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]',
        );
        const blockingOverlay = (element) => {
          const view = element.ownerDocument.defaultView;
          const style = view.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const viewportArea = Math.max(1, view.innerWidth * view.innerHeight);
          const coveredArea = Math.max(0, Math.min(rect.right, view.innerWidth) - Math.max(rect.left, 0))
            * Math.max(0, Math.min(rect.bottom, view.innerHeight) - Math.max(rect.top, 0));
          return style.position === 'fixed' && coveredArea / viewportArea >= 0.5
            && style.pointerEvents !== 'none';
        };
        const candidates = Array.from(body.querySelectorAll('*')).filter((element) => {
          if (!visible(element) || controlsIn(element).length === 0) return false;
          return explicit(element) || blockingOverlay(element);
        }).filter((element, _index, all) => {
          if (explicit(element)) {
            return !all.some((other) => other !== element && explicit(other) && element.contains(other));
          }
          return !all.some((other) => other !== element && explicit(other) && element.contains(other));
        });
        return candidates.map((element) => {
          let modalToken = element.getAttribute(attributes.modal);
          if (!modalToken) {
            modalToken = crypto.randomUUID();
            element.setAttribute(attributes.modal, modalToken);
          }
          const controls = controlsIn(element).map((control) => {
            let controlToken = control.getAttribute(attributes.control);
            if (!controlToken) {
              controlToken = crypto.randomUUID();
              control.setAttribute(attributes.control, controlToken);
            }
            control.setAttribute(attributes.modal, modalToken);
            return {
              bindingToken: controlToken,
              name: String(control.innerText || control.getAttribute('aria-label')
                || control.getAttribute('value') || '').trim(),
              role: control.getAttribute('role')
                || (control.tagName.toLocaleLowerCase() === 'a' ? 'link' : 'button'),
            };
          }).filter((control) => control.name);
          return {
            bindingToken: modalToken,
            role: element.getAttribute('role') || (element.tagName.toLocaleLowerCase() === 'dialog'
              ? 'dialog' : 'roleless_overlay'),
            textPreview: String(element.innerText || element.textContent || '').slice(0, 500),
            controls,
          };
        }).filter((modal) => modal.controls.length > 0);
      }, { modal: MODAL_BINDING_ATTRIBUTE, control: CONTROL_BINDING_ATTRIBUTE });
      const frameId = digest(`${frame.name()}\n${frame.url()}`);
      for (const modal of discovered) {
        modals.push({
          ...modal, frameUrl: frame.url(), frameId,
          modalId: digest(`${tab.targetId}\n${frameId}\n${modal.bindingToken}`),
          controls: modal.controls.map((control) => ({
            ...control,
            controlId: digest(`${tab.targetId}\n${frameId}\n${control.bindingToken}`),
          })),
        });
      }
    }
    return modals;
  }

  async function replace(record, value) {
    const shortcut = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
    await record.locator.click();
    if (record.formControl) await record.locator.fill(value);
    else {
      await record.locator.press(shortcut);
      await record.page.keyboard.insertText(String(value));
    }
    await record.page.waitForTimeout(150);
    const expected = contentFact(value);
    const leaf = contentFact(await record.locator.innerText());
    if (leaf.compactSha256 === expected.compactSha256) return { observed: leaf, contentMatched: true };
    const scope = contentFact(await record.readLocator.innerText());
    return {
      observed: scope,
      contentMatched: compactText(scope.text).includes(compactText(expected.text)),
    };
  }

  async function fill({ tab, editableId, text } = {}) {
    const record = targets.get(String(editableId ?? ''));
    if (!record || record.targetId !== tab?.targetId) throw new Error('playwright editable target is stale');
    if (record.row.secretLike) throw new Error('secret-like editable requires user control');
    const beforeNow = contentFact(await record.locator.innerText());
    if (beforeNow.compactSha256 !== record.before.compactSha256) {
      throw new Error('playwright editable target changed after observation');
    }
    const expected = contentFact(text);
    let observed;
    try {
      const replaced = await replace(record, text);
      observed = replaced.observed;
      if (!replaced.contentMatched) {
        throw new Error('playwright editable content verification failed');
      }
    } catch (error) {
      const restored = await replace(record, record.before.text).catch(() => null);
      if (!restored?.contentMatched) {
        throw new Error(`${error.message}; rollback could not be verified`);
      }
      throw error;
    }
    const row = {
      ...record.row, textChars: expected.textChars, textPreview: expected.textPreview,
    };
    targets.set(record.row.editableId, { ...record, row, before: observed });
    return {
      row, editables: [...targets.values()].filter((item) => item.targetId === tab.targetId)
        .map((item) => structuredClone(item.row)),
      verification: {
        provider: 'managed_playwright', requestedChars: expected.textChars,
        observedChars: observed.textChars, compactChars: observed.compactChars,
        compactSha256: observed.compactSha256, contentMatched: true,
      },
    };
  }

  return {
    provider: 'managed_playwright', inspect, inspectModals, fill,
    modalBindingAttributes: {
      modal: MODAL_BINDING_ATTRIBUTE, control: CONTROL_BINDING_ATTRIBUTE,
    },
    owns(editableId) { return targets.has(String(editableId ?? '')); },
    status() { return { connected: browser?.isConnected?.() === true, targets: targets.size }; },
  };
}
